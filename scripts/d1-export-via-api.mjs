/**
 * Fallback D1 exporter — reconstructs a full SQL dump (schema + data + FTS
 * rebuild) from the REMOTE D1 database via the Cloudflare HTTP query API
 * (api.cloudflare.com). Used when `wrangler d1 export`'s presigned-URL download
 * leg fails (flaky connection to the R2 storage host); this path only talks to
 * api.cloudflare.com, which is reliably reachable.
 *
 * Output is the same shape as `wrangler d1 export`: CREATE TABLE/INDEX/TRIGGER
 * statements + INSERTs + `INSERT INTO <fts>(<fts>) VALUES('rebuild')`.
 *
 * Usage:
 *   export CLOUDFLARE_API_TOKEN=<your-token>
 *   node scripts/d1-export-via-api.mjs > /tmp/mff-sys-db-remote.sql
 *
 * Restore: npx wrangler d1 execute <D1_NAME> --local --file /tmp/mff-sys-db-remote.sql -y
 *
 * Account + database are read from infra/env.prod (the single source of truth),
 * overridable via CLOUDFLARE_ACCOUNT_ID / D1_ID env vars.
 */
import { loadEnvFile } from './gen-wrangler.mjs';
import { loadCfToken } from './lib/cf-token.mjs';

const INFRA = loadEnvFile('prod');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || INFRA.CF_ACCOUNT_ID;
const DB_ID = process.env.D1_ID || INFRA.D1_ID;
const BASE = 'https://api.cloudflare.com/client/v4';
const CHUNK = 50_000; // D1 HTTP API caps rows per query well below this

/** Live token (refreshed if the OAuth grant lapsed) — see scripts/lib/cf-token.mjs. */
async function getToken() {
	return loadCfToken();
}

async function query(sql) {
	const res = await fetch(`${BASE}/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ sql }),
	});
	const json = await res.json();
	if (!json.success) {
		throw new Error(`D1 query failed (HTTP ${res.status}): ${JSON.stringify(json.errors ?? json).slice(0, 400)}`);
	}
	const first = json.result?.[0];
	if (!first?.success) {
		throw new Error(`D1 query errored: ${JSON.stringify(first?.error ?? first).slice(0, 400)}`);
	}
	return first.results ?? [];
}

/** SQL string literal quoting (same rules as apps/api/src/scheduled/backup.ts). */
function sqlQuote(value) {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
	if (typeof value === 'boolean') return value ? '1' : '0';
	return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlIdent(name) {
	return `"${name.replace(/"/g, '""')}"`;
}

async function dumpTable(out, name, sql) {
	out.push(sql.endsWith(';') ? sql : sql + ';', '');
	if (/^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(sql)) return 'virtual';
	const cols = (await query(`SELECT name FROM pragma_table_info('${name.replace(/'/g, "''")}')`)).map((r) => r.name);
	if (cols.length === 0) return 'normal';
	let offset = 0;
	for (;;) {
		const rows = await query(`SELECT * FROM ${sqlIdent(name)} LIMIT ${CHUNK} OFFSET ${offset}`);
		if (rows.length === 0) break;
		for (const row of rows) {
			const values = cols.map((c) => sqlQuote(row[c])).join(', ');
			out.push(`INSERT INTO ${sqlIdent(name)} (${cols.map(sqlIdent).join(', ')}) VALUES (${values});`);
		}
		offset += rows.length;
		if (rows.length < CHUNK) break;
	}
	return 'normal';
}

async function main() {
	// Cloudflare's internal `_cf_*` tables (e.g. `_cf_KV`) are excluded: the HTTP
	// API rejects `pragma_table_info('_cf_KV')` / `SELECT * FROM _cf_KV` with
	// `SQLITE_AUTH`, which used to abort the entire export. (`backup.ts` survives
	// them only because it wraps each table read in a try/catch.)
	const master = await query(
		`SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`,
	);
	const out = ['PRAGMA foreign_keys = OFF;', 'BEGIN TRANSACTION;', ''];
	const virtualTables = [];
	for (const m of master) {
		if (m.type === 'table') {
			if (!m.sql) continue;
			if ((await dumpTable(out, m.name, m.sql)) === 'virtual') virtualTables.push(m.name);
		}
	}
	for (const m of master) {
		if (m.type === 'table' || !m.sql) continue;
		out.push(m.sql.endsWith(';') ? m.sql : m.sql + ';');
	}
	for (const v of virtualTables) {
		out.push(`INSERT INTO ${sqlIdent(v)}(${sqlIdent(v)}) VALUES ('rebuild');`);
	}
	out.push('', 'COMMIT;');
	process.stdout.write(out.join('\n') + '\n');
}

main().catch((err) => {
	console.error(`❌ ${err.message}`);
	process.exit(1);
});
