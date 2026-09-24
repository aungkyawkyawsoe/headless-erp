#!/usr/bin/env node
/**
 * APPLY the declared runtime policies for ONE collection onto a REMOTE D1.
 *
 *   node scripts/apply-collection-policy-remote.mjs --collection orders [--apply]
 *
 * WHY: `schema-defs.json` is the single source of truth for the mro module's
 * collection policies (write locks, confirmable docs, search mode, …). The
 * engine's VALIDATED path is `PUT /api/collections/:slug/policies`, but that
 * needs a production admin token. This mirrors the ONE statement that path runs
 * for an operator without one — and it reads the block from `schema-defs.json`,
 * so it never duplicates the declared values. It follows the engine's contract
 * for any `schema_json` change: `_schema_version` is bumped IN THE SAME
 * STATEMENT so a client holding a cached schema re-fetches.
 *
 * Idempotent: exits without writing when the merged policy already matches.
 *
 * Env overrides: CLOUDFLARE_ACCOUNT_ID, D1_ID (target).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { loadEnvFile } from './gen-wrangler.mjs';
import { loadCfToken } from './lib/cf-token.mjs';

const APPLY = process.argv.includes('--apply');
const SLUG = process.argv[process.argv.indexOf('--collection') + 1] ?? undefined;
if (!SLUG) {
	console.error('Usage: node scripts/apply-collection-policy-remote.mjs --collection <slug> [--apply]');
	process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const defs = JSON.parse(await readFile(join(__dirname, '..', 'apps', 'api', 'src', 'domain-modules', 'mro', 'schema-defs.json'), 'utf8'));

/** Find the declared policies for a slug anywhere in schema-defs.json. */
function declaredPolicies(slug, node) {
	if (Array.isArray(node)) {
		for (const item of node) {
			const hit = declaredPolicies(slug, item);
			if (hit) return hit;
		}
		return undefined;
	}
	if (typeof node !== 'object' || node === null) return undefined;
	if (node.slug === slug && node.policies && typeof node.policies === 'object') return node.policies;
	for (const value of Object.values(node)) {
		const hit = declaredPolicies(slug, value);
		if (hit) return hit;
	}
	return undefined;
}

const DECLARED = declaredPolicies(SLUG, defs);
if (!DECLARED) {
	console.error(`No \`policies\` declared for \`${SLUG}\` in schema-defs.json — refusing to run.`);
	process.exit(1);
}

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

const rows = await d1(`SELECT schema_json, _schema_version FROM _entity_schemas WHERE slug = ?`, [SLUG]);
const row = rows[0];
if (!row) {
	console.error(`No _entity_schemas row for \`${SLUG}\`.`);
	process.exit(1);
}

const schema = JSON.parse(row.schema_json);
const current = schema.policies ?? {};
// Partial-merge per feature, exactly like routes/policies.ts — updating one
// feature leaves the other declared/undeclared features untouched. `null`
// signals "dispose this feature".
const merged = { ...current };
for (const [feature, value] of Object.entries(DECLARED)) {
	if (value === null) {
		delete merged[feature];
	} else {
		merged[feature] = { ...(merged[feature] ?? {}), ...value };
	}
}
schema.policies = Object.keys(merged).length > 0 ? merged : undefined;

console.log(`_entity_schemas.${SLUG}._schema_version = ${row._schema_version}`);
console.log(`  policies now: ${JSON.stringify(current)}`);
console.log(`  declared:     ${JSON.stringify(DECLARED)}`);

if (isDeepStrictEqual(current, merged)) {
	console.log('already applied — nothing to do.');
	process.exit(0);
}

if (!APPLY) {
	console.log(`  would merge to: ${JSON.stringify(merged)} (bumping _schema_version to ${Number(row._schema_version ?? 1) + 1})`);
	console.log('Re-run with --apply to write.');
	process.exit(0);
}

await d1(`UPDATE _entity_schemas SET schema_json = ?, updated_at = ?, _schema_version = COALESCE(_schema_version, 1) + 1 WHERE slug = ?`, [
	JSON.stringify(schema),
	new Date().toISOString(),
	SLUG,
]);

const verify = await d1(`SELECT _schema_version, schema_json FROM _entity_schemas WHERE slug = ?`, [SLUG]);
console.log(
	`applied — _schema_version = ${verify[0]._schema_version}, policies now: ${JSON.stringify(JSON.parse(verify[0].schema_json).policies)}`,
);