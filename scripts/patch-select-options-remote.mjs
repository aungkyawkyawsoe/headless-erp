#!/usr/bin/env node
/**
 * SYNC a collection field's SELECT options onto a REMOTE D1.
 *
 *   node scripts/patch-select-options-remote.mjs --collection <slug> --field <name> [--apply]
 *
 * e.g. --collection orders --field status
 *      --collection products --field kind
 *
 * WHY: `apps/api/src/domain-modules/mro/schema-defs.json` is the single source of
 * truth for the field (it declares the options a form offers), and
 * `scripts/apply-mro-schema.mjs` pushes it through the VALIDATED engine API — but
 * that needs a production admin token. This script mirrors the exact one
 * statement that path would run for an operator WITHOUT one, and does NOT
 * duplicate the option list: it reads the options out of `schema-defs.json` and
 * writes them into `_entity_schemas.schema_json`.
 *
 * The engine's contract for any `schema_json` change (see routes/collections.ts)
 * is that `_schema_version` is bumped IN THE SAME STATEMENT, so a client holding
 * a cached schema re-fetches. This changes field METADATA only — no DDL, no rows.
 * A select column is TEXT, so widening its option list cannot invalidate data.
 *
 * Env overrides: CLOUDFLARE_ACCOUNT_ID, D1_ID (target).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadEnvFile } from './gen-wrangler.mjs';
import { loadCfToken } from './lib/cf-token.mjs';

const APPLY = process.argv.includes('--apply');
const INFRA = loadEnvFile('prod');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || INFRA.CF_ACCOUNT_ID;
const DB_ID = process.env.D1_ID || INFRA.D1_ID;
const BASE = 'https://api.cloudflare.com/client/v4';

/** The field this run reconciles (SSOT-declared), and where its def may live. */
const argOf = (flag) => {
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : undefined;
};
const SLUG = argOf('--collection');
const FIELD = argOf('--field');
if (!SLUG || !FIELD) {
	console.error('Usage: node scripts/patch-select-options-remote.mjs --collection <slug> --field <name> [--apply]');
	process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const defs = JSON.parse(await readFile(join(__dirname, '..', 'apps', 'api', 'src', 'domain-modules', 'mro', 'schema-defs.json'), 'utf8'));

/** Find the collection def by slug across every defs list. */
function defBySlug(slug) {
	for (const list of [defs.baseCollections, defs.recreateCollections, defs.newCollections, defs.moreCollections]) {
		const hit = (list ?? []).find((c) => c.slug === slug);
		if (hit) return hit;
	}
	return undefined;
}

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
			// The CF API intermittently answers 7403 / drops the socket; retry a few times.
			if (attempt >= 4) throw err;
			await new Promise((r) => setTimeout(r, 750 * (attempt + 1)));
		}
	}
}

const wanted = defBySlug(SLUG)?.fields?.find((f) => f.name === FIELD)?.options ?? [];
if (wanted.length === 0) {
	console.error(`No \`${FIELD}\` options declared for \`${SLUG}\` in schema-defs.json — refusing to run.`);
	process.exit(1);
}

const rows = await d1(`SELECT id, schema_json, _schema_version FROM _entity_schemas WHERE slug = ?`, [SLUG]);
const row = rows[0];
if (!row) {
	console.error(`No _entity_schemas row for \`${SLUG}\`.`);
	process.exit(1);
}

const schema = JSON.parse(row.schema_json);
const fields = Array.isArray(schema.fields) ? schema.fields : (schema.fields?.fields ?? []);
const field = fields.find((f) => f.name === FIELD);
if (!field) {
	console.error(`\`${SLUG}\` has no \`${FIELD}\` field in schema_json.`);
	process.exit(1);
}

const current = field.options ?? [];
const fmt = (opts) => opts.map((o) => o.value).join(', ') || '(none)';
const same = JSON.stringify(current) === JSON.stringify(wanted);
console.log(`_entity_schemas.${SLUG}._schema_version = ${row._schema_version}`);
console.log(`  current ${FIELD} options: ${fmt(current)}`);
console.log(`  wanted  ${FIELD} options: ${fmt(wanted)}`);

if (same) {
	console.log('already in sync — nothing to do.');
	process.exit(0);
}

field.options = wanted;
const json = JSON.stringify(schema);

if (!APPLY) {
	console.log(
		`\n--- DRY RUN ---\n  would UPDATE _entity_schemas SET schema_json = <${json.length} bytes>, _schema_version = ${Number(row._schema_version ?? 1) + 1} WHERE slug = '${SLUG}'`,
	);
	console.log('Re-run with --apply to write.');
	process.exit(0);
}

const updatedAt = new Date().toISOString();
await d1(`UPDATE _entity_schemas SET schema_json = ?, updated_at = ?, _schema_version = COALESCE(_schema_version, 1) + 1 WHERE slug = ?`, [
	json,
	updatedAt,
	SLUG,
]);

const verify = await d1(`SELECT _schema_version, schema_json FROM _entity_schemas WHERE slug = ?`, [SLUG]);
const after = JSON.parse(verify[0].schema_json).fields.find((f) => f.name === FIELD);
console.log(`applied — _schema_version = ${verify[0]._schema_version}, ${FIELD} options now: ${fmt(after.options ?? [])}`);
