#!/usr/bin/env node
/**
 * APPLY the inbound COUNTERPARTY change onto a REMOTE D1 — the vendor-less kinds.
 *
 *   node scripts/apply-mro-inbound-handoff-remote.mjs          # dry run
 *   node scripts/apply-mro-inbound-handoff-remote.mjs --apply  # write
 *
 * WHY: `schema-defs.json` now declares `mro_inbounds.handed_by` (the EMPLOYEE a
 * `return` came back from / who hands an opening balance over) and relaxes
 * `supplier` to purchase-only, with a `required_if` rule per kind. The engine's
 * VALIDATED path is `scripts/apply-mro-schema.mjs <url> <admin jwt>` (PUT
 * /api/collections/mro_inbounds), but that needs a production admin token. This
 * mirrors the statements that path runs for an operator without one — and it
 * reads every declared value from `schema-defs.json`, so it never duplicates them.
 *
 *  1. `ALTER TABLE <inbounds> ADD COLUMN handed_by TEXT` — the engine's DDL for a
 *     nullable m2o; skipped when the column already exists (idempotent).
 *  2. `_entity_schemas.schema_json.fields` — add the `handed_by` declaration and
 *     re-apply each declared field's `required` + `validation` from the defs,
 *     bumping `_schema_version` IN THE SAME STATEMENT so a client holding a
 *     cached schema re-fetches.
 *
 * REFUSES (loudly, writing nothing) when the physical `supplier` column is still
 * NOT NULL: relaxing nullability is a table REBUILD (CREATE → COPY → DROP →
 * RENAME), which only the engine's migrator may do — use the validated
 * `apply-mro-schema.mjs` path there (with an admin token). A fresh environment
 * never hits this (the column is created nullable from the defs).
 *
 * Env overrides: CLOUDFLARE_ACCOUNT_ID, D1_ID (target).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadEnvFile } from './gen-wrangler.mjs';
import { loadCfToken } from './lib/cf-token.mjs';

const APPLY = process.argv.includes('--apply');
const SLUG = 'mro_inbounds';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defs = JSON.parse(
	await readFile(join(__dirname, '..', 'apps', 'api', 'src', 'domain-modules', 'mro', 'schema-defs.json'), 'utf8'),
);

/** The declared collection def, wherever it lives in schema-defs.json. */
function defOf(slug, node) {
	if (Array.isArray(node)) {
		for (const item of node) {
			const hit = defOf(slug, item);
			if (hit) return hit;
		}
		return undefined;
	}
	if (node && typeof node === 'object') {
		if (node.slug === slug) return node;
		for (const value of Object.values(node)) {
			const hit = defOf(slug, value);
			if (hit) return hit;
		}
	}
	return undefined;
}

const def = defOf(SLUG, defs);
if (!def) throw new Error(`schema-defs.json has no ${SLUG} definition`);
const DECLARED = def.fields ?? [];
const NEW_FIELD = DECLARED.find((f) => f.name === 'handed_by');
if (!NEW_FIELD) throw new Error('schema-defs.json does not declare mro_inbounds.handed_by — nothing to apply');

const INFRA = loadEnvFile('prod');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || INFRA.CF_ACCOUNT_ID;
const DB_ID = process.env.D1_ID || INFRA.D1_ID;
const BASE = 'https://api.cloudflare.com/client/v4';

async function d1(sql, bindings = []) {
	for (let attempt = 0; ; attempt++) {
		try {
			const res = await fetch(`${BASE}/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${await loadCfToken()}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ sql, params: bindings }),
			});
			const json = await res.json();
			if (!json.success) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json.errors ?? json).slice(0, 300)}`);
			return json.result?.[0]?.results ?? [];
		} catch (err) {
			if (attempt >= 4) throw err;
			await new Promise((r) => setTimeout(r, 750 * (attempt + 1)));
		}
	}
}


const rows = await d1(`SELECT table_name, schema_json, _schema_version FROM _entity_schemas WHERE slug = ?`, [SLUG]);
const row = rows[0];
if (!row) {
	console.error(`No _entity_schemas row for \`${SLUG}\` — create the collection first (scripts/apply-mro-schema.mjs).`);
	process.exit(1);
}
const TABLE = row.table_name;

// ── 1. The physical column (additive, idempotent) ──────────────────────────
const liveCols = await d1(`PRAGMA table_info(${TABLE})`);
const hasHandedBy = liveCols.some((c) => String(c.name) === 'handed_by');
const supplierCol = liveCols.find((c) => String(c.name) === 'supplier');
if (supplierCol && Number(supplierCol.notnull) === 1) {
	console.error(
		`\n✗ ${TABLE}.supplier is still NOT NULL. Relaxing nullability is a table REBUILD — run the validated path instead:\n` +
			'    node scripts/apply-mro-schema.mjs <baseUrl> <admin jwt>\n',
	);
	process.exit(1);
}

console.log(`target           : ${TABLE}  (db ${DB_ID})`);
console.log(`handed_by column : ${hasHandedBy ? 'present' : 'MISSING — would ADD COLUMN handed_by TEXT'}`);
console.log(`supplier column  : notnull=${supplierCol ? supplierCol.notnull : 'n/a'} (nullable ⇒ the other kinds may omit it)`);

// ── 2. The declared schema_json (fields merged BY NAME, engine semantics) ──
const schema = JSON.parse(row.schema_json);
const fields = [...(schema.fields ?? [])];
const byName = new Map(fields.map((f, i) => [f.name, i]));
let changed = 0;
for (const declared of DECLARED) {
	const at = byName.get(declared.name);
	if (at === undefined) {
		if (declared.name === NEW_FIELD.name) {
			fields.push({ ...declared });
			changed++;
		}
		continue;
	}
	const next = { ...fields[at] };
	// Nullability follows the engine's rule: ONLY an explicit `false` is nullable
	// (so a declaration flip in either direction is detected).
	if (Boolean(next.required !== false) !== Boolean(declared.required !== false)) {
		next.required = declared.required !== false;
		changed++;
	}
	// The per-kind rules (`required_if supplier | handed_by`) live in the defs.
	if (JSON.stringify(next.validation ?? null) !== JSON.stringify(declared.validation ?? null)) {
		if (declared.validation) next.validation = declared.validation;
		else delete next.validation;
		changed++;
	}
	fields[at] = next;
}

console.log(`schema_json      : v${row._schema_version} · ${fields.length} fields · ${changed} change(s)`);

if (!APPLY) {
	// No `process.exit()` on this path: it can truncate stdout before a pipe
	// drains, which made the report invisible when piped/redirected.
	console.log(
		hasHandedBy && changed === 0
			? '\nalready applied — nothing to do.'
			: `\nDry run — re-run with --apply to write${hasHandedBy ? '' : ' (ADD COLUMN + schema_json)'} and bump _schema_version to ${Number(row._schema_version ?? 1) + 1}.`,
	);
} else {
	if (!hasHandedBy) {
		await d1(`ALTER TABLE ${TABLE} ADD COLUMN handed_by TEXT DEFAULT NULL`);
		console.log('✓ added column handed_by');
	}
	if (changed > 0) {
		schema.fields = fields;
		await d1(
			`UPDATE _entity_schemas SET schema_json = ?, updated_at = ?, _schema_version = COALESCE(_schema_version, 1) + 1 WHERE slug = ?`,
			[JSON.stringify(schema), new Date().toISOString(), SLUG],
		);
		console.log('✓ schema_json updated + _schema_version bumped');
	}

	// ── 3. Verify ───────────────────────────────────────────────────────────
	const after = await d1(`SELECT schema_json, _schema_version FROM _entity_schemas WHERE slug = ?`, [SLUG]);
	const afterCols = (await d1(`PRAGMA table_info(${TABLE})`)).map((c) => String(c.name));
	const afterFields = JSON.parse(after[0].schema_json).fields ?? [];
	const supplier = afterFields.find((f) => f.name === 'supplier');
	const handed = afterFields.find((f) => f.name === 'handed_by');
	console.log(`\nverified — _schema_version = ${after[0]._schema_version}`);
	console.log(`  column   handed_by present : ${afterCols.includes('handed_by')}`);
	console.log(`  supplier : required=${supplier?.required !== false} validation=${JSON.stringify(supplier?.validation ?? null)}`);
	console.log(`  handed_by: ${handed?.type} → ${handed?.related_collection} validation=${JSON.stringify(handed?.validation ?? null)}`);
}
