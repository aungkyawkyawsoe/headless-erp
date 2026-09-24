#!/usr/bin/env node
/**
 * One-time migration: legacy `mex-hr-db.users` → this repo's `mff-sys-db`
 * `cms_hrm_employees` (+ the reporting-line table `cms_hrm_employee_links` and
 * the shift m2m junction `_jt_cms_hrm_employees_cms_hrm_shifts`).
 *
 * Why a script (not SQL): the source and target are TWO different REMOTE D1
 * databases. SQLite cannot `ATTACH` across two Cloudflare D1 instances, and the
 * legacy rows carry JSON blobs (`superiors`/`subordinates`/`shifts`) that the
 * new normalized schema splits into link rows + a junction. So we read both
 * through the D1 HTTP API (api.cloudflare.com only — the same reliable path as
 * push-local-d1/d1-export-via-api) and transform in JS.
 *
 * Identity: the legacy `users.db_id` (UUID, unique + never null) becomes the new
 * `cms_hrm_employees.id`, so the reporting lines references stay stable.
 * Name-keyed maps (department/designation/shift) are built from the LIVE target
 * tables — legacy `department_id` is NOT reused: it is a different system's UUID
 * space and is null for most rows.
 *
 * Idempotent: every row is written with `INSERT OR REPLACE` and the link /
 * junction rows use a deterministic UUID derived from the natural pair key, so a
 * re-run updates in place instead of duplicating.
 *
 * ── Field mapping ────────────────────────────────────────────────────────────
 *   id          ← users.db_id
 *   etg_id      ← users.tg_id ('' when the legacy row has no Telegram id)
 *   eid         ← users.eid
 *   name_en/mm  ← users.name_en / name_mm
 *   avatar      ← users.avatar
 *   department  ← users.department (name) → cms_hrm_departments.id
 *   designation ← users.designation (name) → cms_hrm_designations.id
 *   role        ← 'Employee' (default; Storekeeper/Administrator set later)
 *   gender      ← 'male' (legacy has no gender — field now optional)
 *   doj/dob     ← '' (legacy has no source — fields now optional)
 *   active      ← 1
 *
 * Usage:
 *   node scripts/migrate-legacy-hr.mjs --dry-run     # report only, no writes
 *   node scripts/migrate-legacy-hr.mjs               # apply
 *
 * Env overrides: CLOUDFLARE_ACCOUNT_ID, D1_ID (target), LEGACY_D1_ID.
 * Target ids come from infra/env.prod; the legacy db is resolved by name.
 */
import crypto from 'node:crypto';
import { loadEnvFile } from './gen-wrangler.mjs';
import { loadCfToken } from './lib/cf-token.mjs';

const INFRA = loadEnvFile('prod');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || INFRA.CF_ACCOUNT_ID;
const TARGET_DB_ID = process.env.D1_ID || INFRA.D1_ID;
const LEGACY_DB_ID_OVERRIDE = process.env.LEGACY_D1_ID || null;
const LEGACY_DB_NAME = 'mex-hr-db';
const BASE = 'https://api.cloudflare.com/client/v4';

const ARGS = process.argv.slice(2);
const DRY = ARGS.includes('--dry-run');

const CONCURRENCY = 3;
const MAX_SQL_LEN = 60_000;
const RETRYABLE = /account is not valid|not authorized|too many requests|error 429|5\d\d|fetch failed|ECONN|ETIMEDOUT|socket/i;

/** Name-keyed department overrides for legacy rows whose text lists two
 * departments (`Vehicle, HR & Admin`) — pick the primary one. */
const DEPARTMENT_NAME_OVERRIDES = { 'Vehicle, HR & Admin': 'Vehicle' };

const crypto_ = crypto;
const uuid = () => crypto_.randomUUID();

/** Deterministic UUID (v5-shaped) for a natural key, so link/junction rows are idempotent. */
function detUuid(key) {
	const h = crypto_.createHash('sha1').update(key).digest();
	const b = Buffer.from(h.subarray(0, 16));
	// v4-shaped (the engine's validators.uuid accepts ONLY version 4).
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const hex = b.toString('hex');
	const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	// Self-check (Poka-Yoke): the engine's validators.uuid accepts ONLY v4, so a
	// future edit that changes the version nibble fails HERE, at author time,
	// instead of after a seed when the Studio refuses to update the row.
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
		throw new Error(`detUuid produced a non-v4 id: ${id}`);
	}
	return id;
}

function sqlQuote(value) {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
	if (typeof value === 'bigint') return String(value);
	if (typeof value === 'boolean') return value ? '1' : '0';
	return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlIdent(name) {
	return `"${name.replace(/"/g, '""')}"`;
}

async function d1(dbId, sql) {
	const res = await fetch(`${BASE}/accounts/${ACCOUNT}/d1/database/${dbId}/query`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${await loadCfToken()}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ sql }),
	});
	const json = await res.json();
	if (!json.success) {
		throw new Error(`D1 request failed (HTTP ${res.status}) [${dbId}]: ${JSON.stringify(json.errors ?? json).slice(0, 300)}\nSQL: ${sql.slice(0, 200)}`);
	}
	const first = json.result?.[0];
	if (first?.success === false) {
		throw new Error(`D1 statement errored [${dbId}]: ${JSON.stringify(first.error ?? first).slice(0, 300)}\nSQL: ${sql.slice(0, 200)}`);
	}
	return first?.results ?? [];
}

/** Execute an ordered list of statements, one HTTP request each, gentle pool + backoff. */
async function runStatements(sqls, label) {
	if (sqls.length === 0) return;
	if (DRY) {
		console.log(`  ${label}: ${sqls.length} statement(s) (dry-run — not executed)`);
		return;
	}
	console.log(`  ${label}: ${sqls.length} statement(s)`);
	const total = sqls.length;
	let next = 0;
	let failed = null;
	let done = 0;
	async function worker() {
		for (;;) {
			if (failed) return;
			const i = next++;
			if (i >= total) return;
			for (let attempt = 0; ; attempt++) {
				try {
					await d1(TARGET_DB_ID, sqls[i]);
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

/** Chunked `INSERT OR REPLACE INTO <table> (cols) VALUES (...),(...)` statements. */
function buildInserts(table, columns, rows) {
	const out = [];
	if (rows.length === 0) return out;
	const prefix = `INSERT OR REPLACE INTO ${sqlIdent(table)} (${columns.map(sqlIdent).join(', ')}) VALUES `;
	let batch = [];
	let batchLen = prefix.length;
	const flush = () => {
		if (!batch.length) return;
		out.push(prefix + batch.join(', '));
		batch = [];
		batchLen = prefix.length;
	};
	for (const row of rows) {
		const tuple = `(${columns.map((c) => sqlQuote(row[c])).join(', ')})`;
		if (batch.length && batchLen + tuple.length + 2 > MAX_SQL_LEN) flush();
		batch.push(tuple);
		batchLen += tuple.length + 2;
	}
	flush();
	return out;
}

function safeJson(value) {
	if (!value) return null;
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === 'object' ? parsed : null;
	} catch {
		return null;
	}
}

function normName(value) {
	return typeof value === 'string' ? value.trim() : '';
}

/** Parse a legacy timestamp to ISO, or fall back to now (columns are NOT NULL). */
function isoOrNow(value) {
	if (value) {
		const t = Date.parse(String(value).replace(' ', 'T'));
		if (!Number.isNaN(t)) return new Date(t).toISOString();
	}
	return new Date().toISOString();
}

function hhmm(value) {
	const m = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ''));
	return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

async function resolveLegacyDbId() {
	if (LEGACY_DB_ID_OVERRIDE) return LEGACY_DB_ID_OVERRIDE;
	const res = await fetch(`${BASE}/accounts/${ACCOUNT}/d1/database?per_page=100`, {
		headers: { Authorization: `Bearer ${await loadCfToken()}` },
	});
	const json = await res.json();
	const match = (json.result ?? []).find((db) => db.name === LEGACY_DB_NAME);
	if (!match) throw new Error(`Could not find D1 database named "${LEGACY_DB_NAME}" in account ${ACCOUNT}`);
	return match.uuid;
}

async function main() {
	await loadCfToken();
	console.log(`\nLegacy HR migration${DRY ? '  [DRY-RUN]' : ''}`);
	console.log(`  account: ${ACCOUNT}`);
	console.log(`  target : ${TARGET_DB_ID}`);

	const legacyDbId = await resolveLegacyDbId();
	console.log(`  legacy : ${legacyDbId} (${LEGACY_DB_NAME})\n`);

	// ── 1. Read the legacy users ──────────────────────────────────────────────
	const users = await d1(legacyDbId, 'SELECT * FROM users');
	console.log(`Read ${users.length} legacy users`);

	// ── 2. Read the target maps (name-keyed) ─────────────────────────────────
	const [departments, designations, shifts, existingEmployees] = await Promise.all([
		d1(TARGET_DB_ID, 'SELECT id, name FROM cms_hrm_departments'),
		d1(TARGET_DB_ID, 'SELECT id, name FROM cms_hrm_designations'),
		d1(TARGET_DB_ID, 'SELECT id, name FROM cms_hrm_shifts'),
		d1(TARGET_DB_ID, 'SELECT id FROM cms_hrm_employees'),
	]);
	const deptByName = new Map(departments.map((d) => [normName(d.name), d.id]));
	const desigByName = new Map(designations.map((d) => [normName(d.name), d.id]));
	const shiftByName = new Map(shifts.map((s) => [normName(s.name), s.id]));
	const existingIds = new Set(existingEmployees.map((e) => e.id));
	console.log(`Target: ${departments.length} departments, ${designations.length} designations, ${shifts.length} shifts, ${existingIds.size} existing employees\n`);

	// ── 3. Resolve lookup maps for reporting-line counterparts ───────────────
	const byTg = new Map();
	const byEid = new Map();
	const byName = new Map();
	for (const u of users) {
		const id = u.db_id;
		if (u.tg_id && String(u.tg_id).trim()) byTg.set(String(u.tg_id).trim(), id);
		if (u.eid && String(u.eid).trim()) byEid.set(String(u.eid).trim(), id);
		for (const n of [u.name_en, u.name_mm]) if (normName(n)) byName.set(normName(n), id);
	}
	const resolvePerson = (entry) => {
		if (!entry || typeof entry !== 'object') return null;
		if (entry.tg_id && byTg.has(String(entry.tg_id).trim())) return byTg.get(String(entry.tg_id).trim());
		if (entry.eid && byEid.has(String(entry.eid).trim())) return byEid.get(String(entry.eid).trim());
		if (normName(entry.name_en) && byName.has(normName(entry.name_en))) return byName.get(normName(entry.name_en));
		if (normName(entry.name_mm) && byName.has(normName(entry.name_mm))) return byName.get(normName(entry.name_mm));
		return null;
	};

	// ── 4. Transform ─────────────────────────────────────────────────────────
	const employeeRows = [];
	const linkRows = new Map(); // pairKey -> row
	const junctionRows = new Map(); // pairKey -> row
	const newShiftRows = new Map(); // shift name -> row
	const unmatchedDept = new Set();
	const unmatchedDesig = new Set();
	const unresolvedLinks = [];
	const claimedTg = new Map();
	let noTelegram = 0;

	for (const u of users) {
		const id = u.db_id;
		if (!id) {
			console.warn(`  ! legacy user id=${u.id} has no db_id — skipped`);
			continue;
		}
		const tg = u.tg_id && String(u.tg_id).trim() ? String(u.tg_id).trim() : '';
		if (!tg) noTelegram += 1;
		else if (claimedTg.has(tg)) console.warn(`  ! duplicate tg_id ${tg} (${u.name_en}) also on ${claimedTg.get(tg)}`);
		else claimedTg.set(tg, u.name_en);

		// department
		let deptName = normName(u.department);
		if (DEPARTMENT_NAME_OVERRIDES[deptName]) deptName = DEPARTMENT_NAME_OVERRIDES[deptName];
		let department = null;
		if (deptName) {
			if (deptByName.has(deptName)) department = deptByName.get(deptName);
			else unmatchedDept.add(deptName);
		}

		// designation
		const desigName = normName(u.designation);
		let designation = null;
		if (desigName) {
			if (desigByName.has(desigName)) designation = desigByName.get(desigName);
			else unmatchedDesig.add(desigName);
		}

		employeeRows.push({
			id,
			etg_id: tg,
			eid: u.eid ?? '',
			name_en: u.name_en ?? '',
			name_mm: u.name_mm ?? '',
			gender: 'male',
			active: u.active === 0 ? 0 : 1,
			doj: '',
			dob: '',
			avatar: u.avatar ?? null,
			department,
			designation,
			role: 'Employee',
			created_at: isoOrNow(u.created_at),
			updated_at: isoOrNow(u.updated_at),
		});

		// reporting lines
		const superiors = safeJson(u.superiors);
		if (Array.isArray(superiors)) {
			for (const entry of superiors) {
				const other = resolvePerson(entry);
				if (!other) {
					unresolvedLinks.push(`superior of ${u.name_en} (${entry?.eid ?? entry?.name_en ?? '?'})`);
					continue;
				}
				const key = `${other}|${id}`; // superior|subordinate
				linkRows.set(key, { id: detUuid(`link:${key}`), superior: other, subordinate: id });
			}
		}
		const subordinates = safeJson(u.subordinates);
		if (Array.isArray(subordinates)) {
			for (const entry of subordinates) {
				const other = resolvePerson(entry);
				if (!other) {
					unresolvedLinks.push(`subordinate of ${u.name_en} (${entry?.eid ?? entry?.name_en ?? '?'})`);
					continue;
				}
				const key = `${id}|${other}`; // superior|subordinate
				linkRows.set(key, { id: detUuid(`link:${key}`), superior: id, subordinate: other });
			}
		}

		// shifts (m2m via junction)
		const shiftList = safeJson(u.shifts);
		if (Array.isArray(shiftList)) {
			for (const s of shiftList) {
				if (!s || typeof s !== 'object') continue;
				const sName = normName(s.name);
				if (!sName) continue;
				let shiftId = shiftByName.get(sName);
				if (!shiftId) {
					shiftId = newShiftRows.get(sName)?.id ?? uuid();
					if (!newShiftRows.has(sName)) {
						newShiftRows.set(sName, {
							id: shiftId,
							name: sName,
							time_in: hhmm(s.in),
							working_hours: Number.parseFloat(s.working_hours) || 0,
							in_grace_period: Number(s.in_grace_period) || 0,
							out_grace_period: Number(s.out_grace_period) || 0,
						});
					}
				}
				const key = `${id}|${shiftId}`;
				junctionRows.set(key, { id: detUuid(`junc:${key}`), source_id: id, target_id: shiftId });
			}
		}
	}

	// ── 5. Build SQL ─────────────────────────────────────────────────────────
	const shiftSql = buildInserts(
		'cms_hrm_shifts',
		['id', 'name', 'time_in', 'working_hours', 'in_grace_period', 'out_grace_period'],
		[...newShiftRows.values()],
	);
	const employeeSql = buildInserts(
		'cms_hrm_employees',
		['id', 'etg_id', 'eid', 'name_en', 'name_mm', 'gender', 'active', 'doj', 'dob', 'avatar', 'department', 'designation', 'role', 'created_at', 'updated_at'],
		employeeRows,
	);
	const linkSql = buildInserts('cms_hrm_employee_links', ['id', 'superior', 'subordinate'], [...linkRows.values()]);
	const junctionSql = buildInserts('_jt_cms_hrm_employees_cms_hrm_shifts', ['id', 'source_id', 'target_id'], [...junctionRows.values()]);

	// ── 6. Report ────────────────────────────────────────────────────────────
	console.log('Transform summary');
	console.log(`  employees          : ${employeeRows.length} (${employeeRows.length - noTelegram} with etg_id, ${noTelegram} without)`);
	console.log(`  employee_links     : ${linkRows.size}${unresolvedLinks.length ? ` (${unresolvedLinks.length} unresolved)` : ''}`);
	console.log(`  shift junctions    : ${junctionRows.size}`);
	console.log(`  new shifts to create: ${newShiftRows.size}${newShiftRows.size ? ` → ${[...newShiftRows.keys()].join(', ')}` : ''}`);
	console.log(`  unmatched depts    : ${unmatchedDept.size ? [...unmatchedDept].join(', ') : 'none'}`);
	console.log(`  unmatched desigs   : ${unmatchedDesig.size ? [...unmatchedDesig].join(', ') : 'none'}`);
	if (unresolvedLinks.length) {
		console.log(`  unresolved links (first 10):`);
		for (const l of unresolvedLinks.slice(0, 10)) console.log(`    - ${l}`);
	}

	console.log('\nWrites');
	await runStatements(shiftSql, 'shifts');
	await runStatements(employeeSql, 'employees');
	await runStatements(linkSql, 'employee_links');
	await runStatements(junctionSql, 'shift junction');

	console.log(DRY ? '\nDry-run complete. Re-run without --dry-run to apply.' : '\nMigration complete.');
	console.log('Note: raw SQL bypasses the engine response cache — new rows may take until TTL expiry to appear in already-cached reads.\n');
}

main().catch((err) => {
	console.error(`\nMIGRATION FAILED: ${err.message}`);
	process.exit(1);
});
