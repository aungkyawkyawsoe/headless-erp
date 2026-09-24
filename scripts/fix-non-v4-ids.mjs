#!/usr/bin/env node
/**
 * Rekey rows whose `id` is NOT a v4 UUID — the "id must be a valid UUID v4"
 * error the Studio raises on EVERY update of such a row.
 *
 * Why they exist: the ops seed scripts (`seed-mro-catalog-items`,
 * `amend-mro-categories`, `migrate-legacy-hr`) minted DETERMINISTIC ids from a
 * SHA-1 hash and shaped them as UUID v5. The engine's `validators.uuid` accepts
 * ONLY `UUID_V4_RE` (version nibble 4, variant 8), so those rows read fine but
 * any `PUT /api/entities/<slug>/:id` — the Studio's table editor included —
 * fails validation before the write starts. The scripts now emit v4-shaped ids;
 * this one repairs the rows they already wrote.
 *
 * For each rekeyed table the script discovers its REFERENCING columns from the
 * live schema (`_entity_schemas`): every collection's `m2o` field pointing at the
 * table, plus each `m2m` field's junction `source_id`. The id is then UPDATEd in
 * place (no copy/delete — the id is the row's identity) and every reference
 * follows, so nothing is stranded. Rewrites are deterministic
 * (`v4From(table:oldId)`) and idempotent: a valid row is skipped, so a re-run is
 * a no-op.
 *
 * Usage:
 *   node scripts/fix-non-v4-ids.mjs --dry-run
 *   node scripts/fix-non-v4-ids.mjs --apply
 *
 * Env overrides: CLOUDFLARE_ACCOUNT_ID, D1_ID (target).
 */
import crypto from 'node:crypto';
import { loadEnvFile } from './gen-wrangler.mjs';
import { loadCfToken, reloadCfToken } from './lib/cf-token.mjs';

const INFRA = loadEnvFile('prod');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || INFRA.CF_ACCOUNT_ID;
const DB_ID = process.env.D1_ID || INFRA.D1_ID;
const BASE = 'https://api.cloudflare.com/client/v4';
const APPLY = process.argv.includes('--apply');

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The tables the seed scripts wrote with derived ids (slug drives discovery). */
const TARGETS = [
	{ slug: 'mro_item_categories', table: 'cms_mro_item_categories' },
	{ slug: 'mro_item_name', table: 'cms_mro_item_name' },
	{ slug: 'hrm_employee_links', table: 'cms_hrm_employee_links' },
	{ slug: null, table: '_jt_cms_hrm_employees_cms_hrm_shifts' },
];

/** A v4-SHAPED uuid derived from a stable key — deterministic across re-runs. */
function v4From(key) {
	const h = crypto.createHash('sha1').update(key).digest();
	const b = Buffer.from(h.subarray(0, 16));
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
	return `'${String(value).replace(/'/g, "''")}'`;
}

const RETRYABLE = /account is not valid|not authorized|too many requests|error 429|5\d\d|fetch failed|ECONN|ETIMEDOUT|socket|Unexpected end of JSON|aborted/i;

/** One D1 request, retried on transient failures — a flaky link must never
 *  leave the repair half-done (the heal pass below can also resume it). */
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
			if (!RETRYABLE.test(message) || /SQLITE_ERROR/.test(message) || attempt >= 6) throw err;
			await new Promise((r) => setTimeout(r, Math.min(20_000, 800 * 2 ** attempt)));
		}
	}
}

/** Split an array into fixed-size chunks. */
function chunksOf(items, size) {
	const out = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

/** `UPDATE t SET col = CASE col WHEN old THEN new … END WHERE col IN (…)`. */
function caseUpdate(table, column, keyColumn, pairs) {
	const cases = pairs.map(({ old, next }) => `WHEN ${sqlQuote(old)} THEN ${sqlQuote(next)}`).join(' ');
	const keys = pairs.map(({ old }) => sqlQuote(old)).join(', ');
	return `UPDATE ${table} SET ${column} = CASE ${keyColumn} ${cases} END WHERE ${keyColumn} IN (${keys})`;
}

async function main() {
	await loadCfToken();
	console.log(`\nFix non-v4 ids → ${DB_ID}${APPLY ? '' : '  [DRY-RUN]'}\n`);

	// The live schema is the reference map's source (no hand-maintained FK list).
	const schemas = await d1('SELECT slug, table_name, schema_json FROM _entity_schemas');
	const parsed = schemas.map((row) => {
		let fields = [];
		try {
			fields = JSON.parse(String(row.schema_json ?? '{}')).fields ?? [];
		} catch {
			fields = [];
		}
		return { slug: String(row.slug), table: String(row.table_name), fields };
	});

	let totalBad = 0;
	const statements = [];

	for (const target of TARGETS) {
		const rows = await d1(`SELECT id FROM ${target.table}`);
		const bad = rows.filter((row) => !UUID_V4_RE.test(String(row.id)));
		console.log(`${target.table}: ${rows.length} rows · non-v4 ${bad.length}`);
		if (bad.length === 0) continue;
		totalBad += bad.length;

		// Referring (table, column) pairs — m2o fields + m2m junctions.
		const refs = [];
		if (target.slug) {
			for (const schema of parsed) {
				for (const field of schema.fields) {
					if (field?.related_collection !== target.slug) continue;
					if (field.type === 'm2o') refs.push({ table: schema.table, column: field.name });
					if (field.type === 'm2m') refs.push({ table: `_jt_${schema.table}_${target.table}`, column: 'source_id' });
				}
			}
		}
		for (const { table, column } of refs) {
			const count = await d1(`SELECT COUNT(*) n FROM ${table} WHERE ${column} IS NOT NULL`);
			console.log(`  ↳ referenced by ${table}.${column} (${count[0]?.n ?? 0} values)`);
		}

		// One CASE-mapped UPDATE per chunk of rows instead of one per row: 509 rows
		// become ~15 round trips, so a short-lived token can no longer expire in
		// the middle of the repair (and the whole thing is far faster).
		const pairs = bad.map((row) => ({ old: String(row.id), next: v4From(`${target.table}:${row.id}`) }));
		for (const chunk of chunksOf(pairs, 40)) {
			statements.push(caseUpdate(target.table, 'id', 'id', chunk));
			for (const { table, column } of refs) statements.push(caseUpdate(table, column, column, chunk));
		}
	}

	console.log(`\nRows to rekey: ${totalBad} · statements: ${statements.length}`);
	if (!APPLY) {
		console.log('Dry-run — re-run with --apply.\n');
		return;
	}
	let done = 0;
	for (const sql of statements) {
		await d1(sql);
		if (++done % 100 === 0) console.log(`  … ${done}/${statements.length}`);
	}

	// ── Heal pass ────────────────────────────────────────────────────────────
	// A run interrupted between "rekey the row" and "repoint its references"
	// leaves references pointing at an id that no longer exists. Because the new
	// id is DETERMINISTIC (`v4From(table:oldId)`), such a stale reference is
	// recoverable: if `v4From(value)` exists in the target table, that value is
	// an old id → repoint it. Genuine orphans (an id the table never had) are
	// reported, never invented.
	console.log('\nHeal pass — repointing references whose row was rekeyed without them:');
	let healed = 0;
	const orphans = [];
	for (const target of TARGETS) {
		if (!target.slug) continue;
		const refs = [];
		for (const schema of parsed) {
			for (const field of schema.fields) {
				if (field?.related_collection !== target.slug) continue;
				if (field.type === 'm2o') refs.push({ table: schema.table, column: field.name });
				if (field.type === 'm2m') refs.push({ table: `_jt_${schema.table}_${target.table}`, column: 'source_id' });
			}
		}
		const live = new Set((await d1(`SELECT id FROM ${target.table}`)).map((r) => String(r.id)));
		for (const { table, column } of refs) {
			const values = await d1(`SELECT DISTINCT ${column} v FROM ${table} WHERE ${column} IS NOT NULL`);
			for (const row of values) {
				const value = String(row.v);
				if (live.has(value)) continue;
				const candidate = v4From(`${target.table}:${value}`);
				if (!live.has(candidate)) {
					orphans.push(`${table}.${column} = ${value}`);
					continue;
				}
				await d1(`UPDATE ${table} SET ${column} = ${sqlQuote(candidate)} WHERE ${column} = ${sqlQuote(value)}`);
				healed += 1;
			}
		}
	}
	console.log(`  repointed ${healed} stale reference value(s)`);
	if (orphans.length > 0) console.log(`  ⚠ genuine orphans (no matching row — left as-is): ${orphans.slice(0, 10).join(', ')}${orphans.length > 10 ? ` … +${orphans.length - 10}` : ''}`);

	console.log('\nAfter:');
	for (const target of TARGETS) {
		const rows = await d1(`SELECT id FROM ${target.table}`);
		const bad = rows.filter((row) => !UUID_V4_RE.test(String(row.id)));
		console.log(`  ${target.table}: ${rows.length} rows · non-v4 ${bad.length}`);
	}
	console.log('\nRepair complete.\n');
}

main().catch((err) => {
	console.error(`\nREPAIR FAILED: ${err.message}\n`);
	process.exit(1);
});
