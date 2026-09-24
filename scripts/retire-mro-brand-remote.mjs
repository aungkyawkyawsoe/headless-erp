#!/usr/bin/env node
/**
 * RETIRE the MRO BRAND domain on a REMOTE D1 — stock is not managed by brand.
 *
 *   mro_brand          the whole master collection (Bridgestone, Shell, …)
 *   mro_item_model.brand          (m2o → mro_brand)
 *   mro_stock_lots.brand          (m2o → mro_brand, indexed)
 *   mro_stock_serials.brand       (m2o → mro_brand, indexed)
 *   mro_inbound_lines.brand       (m2o → mro_brand)
 *
 * `apps/api/src/domain-modules/mro/schema-defs.json` is the single source of
 * truth: it removes the collection from `baseCollections`, lists every `brand`
 * in its `removeFields` block and adds `mro_brand` to `removeCollections`.
 * `scripts/apply-mro-schema.mjs` executes the FIELD drops locally through the
 * VALIDATED engine API (its PUT drives EntityMigrator's DROP COLUMN) — this
 * script mirrors that exact DDL for an operator WITHOUT a production admin token,
 * and additionally drops the populated `mro_brand` collection (which the apply
 * script's `removeCollections` step refuses to drop while it holds rows).
 *
 * What it does, idempotently (absent column/field/index/table ⇒ skipped):
 *   1. `DROP INDEX idx_<table>_brand` then `ALTER TABLE <table> DROP COLUMN brand`
 *      for each trace/source table, and remove the field declaration from
 *      `_entity_schemas.schema_json.fields`;
 *   2. `DELETE FROM cms_mro_brand` + `DROP TABLE cms_mro_brand` + delete the
 *      `_entity_schemas` row for `mro_brand`.
 * The brand DATA is destroyed (the columns/tables go away) — that is the point.
 *
 * Dry-run by default.
 *
 * Usage:
 *   node scripts/retire-mro-brand-remote.mjs --dry-run
 *   node scripts/retire-mro-brand-remote.mjs --apply
 *
 * Env overrides: CLOUDFLARE_ACCOUNT_ID, D1_ID (target).
 */
import { loadEnvFile } from './gen-wrangler.mjs';
import { loadCfToken } from './lib/cf-token.mjs';

const INFRA = loadEnvFile('prod');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || INFRA.CF_ACCOUNT_ID;
const DB_ID = process.env.D1_ID || INFRA.D1_ID;
const BASE = 'https://api.cloudflare.com/client/v4';
const APPLY = process.argv.includes('--apply');

/** Collections that carry a `brand` field to drop (slug → its declared index?). */
const FIELD_TARGETS = [
	{ slug: 'mro_item_model', indexed: false },
	{ slug: 'mro_stock_lots', indexed: true },
	{ slug: 'mro_stock_serials', indexed: true },
	{ slug: 'mro_inbound_lines', indexed: false },
];
const RETIRED = 'brand';
const BRAND_SLUG = 'mro_brand';

function sqlQuote(value) {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
	return `'${String(value).replace(/'/g, "''")}'`;
}

async function d1(sql) {
	for (let attempt = 0; ; attempt++) {
		try {
			const res = await fetch(`${BASE}/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${await loadCfToken()}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ sql }),
			});
			const json = await res.json();
			if (!json.success) throw new Error(`D1 request failed (HTTP ${res.status}): ${JSON.stringify(json.errors ?? json).slice(0, 300)}`);
			const first = json.result?.[0];
			if (first?.success === false) throw new Error(`D1 statement errored: ${JSON.stringify(first.error ?? first).slice(0, 300)}`);
			return first?.results ?? [];
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (!/not authorized|too many requests|429|5\d\d|fetch failed|ECONN|socket|Unexpected end of JSON/i.test(message) || attempt >= 5) throw err;
			await new Promise((r) => setTimeout(r, Math.min(15_000, 800 * 2 ** attempt)));
		}
	}
}

async function schemaRow(slug) {
	return (await d1(`SELECT table_name, schema_json FROM _entity_schemas WHERE slug = ${sqlQuote(slug)}`))[0];
}

async function main() {
	await loadCfToken();
	console.log(`\nRetire MRO brand → ${DB_ID}${APPLY ? '' : '  [DRY-RUN]'}\n`);

	const statements = [];
	const notes = [];

	// ── 1. Drop the brand column from every table that declared one ──────────
	for (const { slug, indexed } of FIELD_TARGETS) {
		const row = await schemaRow(slug);
		if (!row) {
			notes.push(`skip  ${slug}: not provisioned`);
			continue;
		}
		const table = String(row.table_name);
		const schema = JSON.parse(String(row.schema_json ?? '{}'));
		const fields = Array.isArray(schema.fields) ? schema.fields : [];
		const hasColumn = (await d1(`SELECT name FROM pragma_table_info('${table}') WHERE name = ${sqlQuote(RETIRED)}`)).length > 0;
		const hasField = fields.some((f) => f.name === RETIRED);
		const indexName = `idx_${table}_${RETIRED}`;
		const hasIndex = (await d1(`SELECT name FROM sqlite_master WHERE type='index' AND name = ${sqlQuote(indexName)}`)).length > 0;

		if (!hasColumn && !hasField && !hasIndex) {
			notes.push(`ok    ${slug}.${RETIRED}: already retired`);
			continue;
		}
		notes.push(`plan  ${slug}.${RETIRED}: ${hasColumn ? 'DROP COLUMN' : 'no column'} · ${hasField ? 'remove declaration' : 'no field'} · ${indexed && hasIndex ? 'drop index' : 'no index'}`);
		if (indexed && hasIndex) statements.push(`DROP INDEX IF EXISTS "${indexName}"`);
		if (hasColumn) statements.push(`ALTER TABLE ${table} DROP COLUMN ${RETIRED}`);
		if (hasField) {
			const kept = fields.filter((f) => f.name !== RETIRED);
			statements.push(`UPDATE _entity_schemas SET schema_json = ${sqlQuote(JSON.stringify({ ...schema, fields: kept }))} WHERE slug = ${sqlQuote(slug)}`);
		}
	}

	// ── 2. Drop the whole mro_brand collection (populated rows included) ─────
	const brandRow = await schemaRow(BRAND_SLUG);
	if (!brandRow) {
		notes.push(`ok    ${BRAND_SLUG}: already gone`);
	} else {
		const table = String(brandRow.table_name);
		notes.push(`plan  ${BRAND_SLUG}: DROP TABLE ${table} + delete its _entity_schemas row`);
		statements.push(`DROP TABLE IF EXISTS ${table}`);
		statements.push(`DELETE FROM _entity_schemas WHERE slug = ${sqlQuote(BRAND_SLUG)}`);
	}

	console.log(notes.join('\n'));
	console.log(`\nstatements: ${statements.length}`);
	if (!APPLY) {
		console.log('Dry-run — re-run with --apply.\n');
		return;
	}
	for (const sql of statements) await d1(sql);

	console.log('\nAfter:');
	for (const { slug } of FIELD_TARGETS) {
		const row = await schemaRow(slug);
		if (!row) {
			console.log(`  ${slug}: MISSING`);
			continue;
		}
		const table = String(row.table_name);
		const hasColumn = (await d1(`SELECT name FROM pragma_table_info('${table}') WHERE name = ${sqlQuote(RETIRED)}`)).length > 0;
		const schema = JSON.parse(String(row.schema_json ?? '{}'));
		const hasField = (schema.fields ?? []).some((f) => f.name === RETIRED);
		console.log(`  ${slug}.${RETIRED}: column ${hasColumn ? 'STILL PRESENT' : 'dropped'} · declaration ${hasField ? 'STILL PRESENT' : 'removed'}`);
	}
	const brandTable = (await d1(`SELECT name FROM sqlite_master WHERE type='table' AND name = 'cms_mro_brand'`)).length > 0;
	console.log(`  ${BRAND_SLUG}: ${brandTable ? 'STILL PRESENT' : 'dropped'}`);
	console.log('\nNote: raw DDL bypasses the engine schema cache — the API picks the new\nschema up within its cache TTL (~60s) or on the next deploy.\n');
}

main().catch((err) => {
	console.error(`\nRETIRE FAILED: ${err.message}\n`);
	process.exit(1);
});
