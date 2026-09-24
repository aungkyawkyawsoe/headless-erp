/**
 * Push the LOCAL wrangler dev D1 state → the REMOTE production D1.
 * The reverse of scripts/pull-remote-data.sh: after working on data locally
 * (seeding MRO/veh-care, fixing rows), this replaces the remote database
 * contents with the local ones so prod mirrors your dev state exactly.
 *
 * ⚠️ DESTRUCTIVE — with --drop-existing it drops every remote table first
 * (excluding Cloudflare-internal `_cf_%`), then re-creates schema + data from
 * the local sqlite. There is no merge. Run --dry-run first.
 *
 * Usage:
 *   node scripts/push-local-d1.mjs --dry-run
 *   node scripts/push-local-d1.mjs --drop-existing
 *   node scripts/push-local-d1.mjs --local-sqlite /path/to/<hash>.sqlite
 *   node scripts/push-local-d1.mjs --verify          # local↔remote parity only
 *
 * Target database comes from infra/env.prod (D1_ID — the single source of
 * truth), overridable with CLOUDFLARE_ACCOUNT_ID / D1_ID env vars. Auth: the
 * plain wrangler OAuth login (api.cloudflare.com only — no presigned URLs, so
 * it works where `wrangler d1 export` flakes).
 *
 * After a full push, the imported `_users` password hashes were minted with
 * the LOCAL ADMIN_PASSWORD pepper — production never re-syncs an existing
 * admin, so the script deletes the ADMIN_USERNAME row and the next password
 * login re-bootstraps it from the production secret. Telegram-identity users
 * are unaffected (their logins never verify a password hash).
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadEnvFile } from './gen-wrangler.mjs';
import { loadCfToken } from './lib/cf-token.mjs';

const INFRA = loadEnvFile('prod');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || INFRA.CF_ACCOUNT_ID;
const DB_ID = process.env.D1_ID || INFRA.D1_ID;
const ADMIN_EMAIL = (process.env.ADMIN_USERNAME || INFRA.ADMIN_USERNAME || 'admin').toLowerCase();
const BASE = 'https://api.cloudflare.com/client/v4';

const args = process.argv.slice(2);
const CONCURRENCY = 3; // D1 HTTP API rate-limits bursty writers — stay gentle
const MAX_SQL_LEN = 60_000; // cap per INSERT statement (no multi-statement batches)
const RETRYABLE = /account is not valid|not authorized|too many requests|error 429|5\d\d|fetch failed|ECONN|ETIMEDOUT|socket/i;
const has = (f) => args.includes(f);
const argOf = (f) => {
	const i = args.indexOf(f);
	return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const LOCAL_SQLITE = argOf('--local-sqlite');
const DRY = has('--dry-run');
const VERIFY = has('--verify');
const DROP = has('--drop-existing');

/** Live token (refreshed if the OAuth grant lapsed) — see scripts/lib/cf-token.mjs. */
async function getToken() {
	return loadCfToken();
}

/** One D1 HTTP request = exactly ONE SQL statement (verified empirically: the API
 * rejects multi-statement scripts with a parse error at the second statement).
 * The remote error /account is not valid|not authorized/ is a soft rate-limit
 * response and recovers after a pause — callers retry it with backoff. */
async function postOne(sql) {
	const res = await fetch(`${BASE}/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ sql }),
	});
	const json = await res.json();
	if (!json.success) {
		throw new Error(
			`D1 request failed (HTTP ${res.status}): ${JSON.stringify(json.errors ?? json).slice(0, 300)}\nSQL: ${sql.slice(0, 200)}`,
		);
	}
	const first = json.result?.[0];
	if (first?.success === false) {
		throw new Error(`D1 statement errored: ${JSON.stringify(first.error ?? first).slice(0, 300)}\nSQL: ${sql.slice(0, 200)}`);
	}
	return first;
}

/** Execute an ordered list of statements, one HTTP request each, with a small
 * concurrency pool and exponential-backoff retries on transient failures. */
async function runStatements(sqls, label) {
	if (sqls.length === 0) return;
	if (DRY) return;
	console.log(`  ${label}: ${sqls.length} statement${sqls.length === 1 ? '' : 's'}`);
	let next = 0;
	let failed = null;
	let done = 0;
	const total = sqls.length;
	async function worker() {
		for (;;) {
			if (failed) return;
			const i = next++;
			if (i >= total) return;
			const sql = sqls[i];
			for (let attempt = 0; ; attempt++) {
				try {
					await postOne(sql);
					break;
				} catch (err) {
					if (failed) return;
					const retryable = RETRYABLE.test(err.message) && !/SQLITE_ERROR/.test(err.message);
					if (!retryable || attempt >= 8) {
						failed = err;
						console.error(`  ${label}: statement ${i + 1}/${total} failed`);
						return;
					}
					const wait = Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
					console.error(`  ${label}: transient error, retry ${attempt + 1} in ${Math.round(wait / 1000)}s (${err.message.slice(0, 80)})`);
					await new Promise((r) => setTimeout(r, wait));
				}
			}
			if (++done === total) console.log(`  ${label}: done`);
		}
	}
	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()));
	if (failed) throw failed;
}

function sqlIdent(name) {
	return `"${name.replace(/"/g, '""')}"`;
}

function sqlQuote(value) {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
	if (typeof value === 'bigint') return String(value);
	if (typeof value === 'boolean') return value ? '1' : '0';
	if (value instanceof Uint8Array) {
		return `X'${Buffer.from(value).toString('hex')}'`;
	}
	return `'${String(value).replace(/'/g, "''")}'`;
}

function findLocalSqlite() {
	if (LOCAL_SQLITE) return LOCAL_SQLITE;
	const dir = path.resolve(process.cwd(), 'apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
	if (!fs.existsSync(dir)) throw new Error(`No local D1 state at ${dir} — run the API locally first (pnpm dev).`);
	const files = fs
		.readdirSync(dir)
		.filter((f) => f.endsWith('.sqlite') && !f.startsWith('metadata'))
		.map((f) => ({ f, stat: fs.statSync(path.join(dir, f)) }))
		.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
	if (files.length === 0) throw new Error(`No local D1 sqlite under ${dir}`);
	return path.join(dir, files[0].f);
}

async function remoteTables() {
	const res = await fetch(`${BASE}/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			sql: `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`,
		}),
	});
	const json = await res.json();
	const first = json.result?.[0];
	if (!first?.success) throw new Error(`Remote listing failed: ${JSON.stringify(json.errors ?? first).slice(0, 300)}`);
	return (first.results ?? []).map((r) => r.name);
}

const SKIP = (name) => name.startsWith('sqlite_') || name.startsWith('_cf_');

function openLocal(file) {
	return new DatabaseSync(file, { readOnly: true });
}

function schemaStatements(db) {
	const create = [];
	const indexes = [];
	const names = new Set();
	for (const row of db.prepare(`SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL AND type='table' ORDER BY name`).all()) {
		if (SKIP(row.name)) continue;
		names.add(row.name);
		create.push(row.sql);
	}
	for (const row of db.prepare(`SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL AND type='index' ORDER BY name`).all()) {
		if (SKIP(row.name)) continue;
		indexes.push(row.sql);
	}
	return { create, indexes, names };
}

async function runSelects(sqls) {
	if (sqls.length === 0) return [];
	if (DRY) return [];
	let next = 0;
	let failed = null;
	const out = [];
	async function worker() {
		for (;;) {
			if (failed) return;
			const i = next++;
			if (i >= sqls.length) return;
			for (let attempt = 0; ; attempt++) {
				try {
					const res = await postOne(sqls[i]);
					out.push(...(res.results ?? []));
					break;
				} catch (err) {
					if (failed) return;
					const retryable = RETRYABLE.test(err.message) && !/SQLITE_ERROR/.test(err.message);
					if (!retryable || attempt >= 8) {
						failed = err;
						return;
					}
					const wait = Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
					await new Promise((r) => setTimeout(r, wait));
				}
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sqls.length) }, () => worker()));
	if (failed) throw failed;
	return out;
}

async function tableCountsRemote(names) {
	const rows = await runSelects(names.map((name) => `SELECT '${name.replace(/'/g, "''")}' AS t, count(*) AS n FROM ${sqlIdent(name)}`));
	const out = {};
	for (const r of rows) out[r.t] = Number(r.n);
	return out;
}

/** Group a table's rows into single INSERT statements with multiple VALUES
 * tuples, keeping each statement under MAX_SQL_LEN chars (the D1 HTTP API takes
 * exactly one statement per request, so fewer, bigger inserts = fewer calls). */
function chunkInserts(name, cols, rows) {
	const colList = cols.map(sqlIdent).join(', ');
	const head = `INSERT INTO ${sqlIdent(name)} (${colList}) VALUES `;
	const chunks = [];
	let cur = head;
	let n = 0;
	const flush = () => {
		if (n) chunks.push(cur);
		cur = head;
		n = 0;
	};
	for (const row of rows) {
		const tuple = `(${cols.map((c) => sqlQuote(row[c])).join(', ')})`;
		if (n && cur.length + tuple.length + 1 > MAX_SQL_LEN) flush();
		cur += (n ? ',' : '') + tuple;
		n++;
	}
	flush();
	return chunks;
}

async function main() {
	const sqliteFile = findLocalSqlite();
	const db = openLocal(sqliteFile);
	const { create, indexes, names } = schemaStatements(db);
	console.log(`Local: ${sqliteFile}`);
	console.log(`Local schema: ${names.size} tables, ${indexes.length} indexes`);

	if (VERIFY) {
		const remote = await remoteTables();
		console.log(`Remote tables: ${remote.length}`);
		const localCounts = {};
		for (const name of names) localCounts[name] = db.prepare(`SELECT count(*) AS n FROM ${sqlIdent(name)}`).get().n;
		const remoteCounts = await tableCountsRemote(remote.filter((n) => names.has(n)));
		let diff = 0;
		for (const name of names) {
			const l = localCounts[name];
			const r = remoteCounts[name];
			if (Number(r ?? -1) !== Number(l)) {
				console.log(`  DIFF ${name}: local=${l} remote=${r ?? 'MISSING'}`);
				diff++;
			}
		}
		for (const name of remote) {
			if (!names.has(name)) {
				console.log(`  REMOTE-ONLY ${name} (not in local — will be dropped on --drop-existing)`);
				diff++;
			}
		}
		console.log(diff === 0 ? '✅ local ↔ remote identical' : `⚠️ ${diff} differences`);
		process.exit(diff === 0 ? 0 : 1);
	}

	const remote = await remoteTables();
	if (DROP) {
		console.log(`Dropping ${remote.length} remote tables…`);
		await runStatements(
			remote.map((n) => `DROP TABLE IF EXISTS ${sqlIdent(n)}`),
			'drop',
		);
	} else if (remote.length > 0) {
		console.error(`Remote already has ${remote.length} tables — re-run with --drop-existing to replace them (or --verify to compare).`);
		process.exit(1);
	}

	console.log('Creating tables…');
	await runStatements(create, 'create');

	console.log('Inserting rows…');
	let inserted = 0;
	for (const name of names) {
		const rows = db.prepare(`SELECT * FROM ${sqlIdent(name)}`).all();
		if (rows.length === 0) continue;
		const cols = db
			.prepare(`PRAGMA table_info(${sqlIdent(name)})`)
			.all()
			.map((c) => c.name);
		const chunks = chunkInserts(name, cols, rows);
		await runStatements(chunks, `insert ${name} (${rows.length})`);
		inserted += rows.length;
		console.log(`  ${name}: ${rows.length}`);
	}

	console.log('Creating indexes…');
	await runStatements(indexes, 'index');

	// Admin re-bootstrap (see header doc): the imported hash was minted with the
	// LOCAL ADMIN_PASSWORD pepper; production never re-syncs an existing admin.
	if (!DRY) {
		await runStatements([`DELETE FROM ${sqlIdent('_users')} WHERE email = '${ADMIN_EMAIL}'`], 'admin self-heal');
		console.log(
			`Deleted imported admin row (${ADMIN_EMAIL}) — next password login re-creates it from the production ADMIN_PASSWORD secret.`,
		);
	}

	console.log(`✅ Pushed ${inserted} rows across ${names.size} tables (dry-run: ${DRY})`);
	db.close();
}

main().catch((err) => {
	console.error(`❌ ${err.message}`);
	process.exit(1);
});
