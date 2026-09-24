#!/usr/bin/env node
/**
 * Migrate the HR request collections onto the engine's system `doc_status`.
 *
 * The hrm_* request collections (`hrm_leaves`, `hrm_overtimes`,
 * `hrm_early_leaves`) used to carry a redundant custom `status` select
 * (`pending/approved/rejected/cancelled`) next to the engine's system
 * `doc_status` column (which stayed `draft` forever). The app now drives the
 * request lifecycle purely through `doc_status`
 * (draft → pending_review → approved / rejected / cancelled):
 *
 *   1. Backfill `doc_status` from the legacy `status` values (the engine
 *      validates transitions, so approved/rejected rows hop
 *      draft → pending_review → approved/rejected).
 *   2. Drop the redundant `status` field from the collections (schema + column).
 *   3. Grant the Employee telegram role `can_approve` on the request
 *      collections — the engine gates a `doc_status → approved` write behind
 *      `can_approve`, and the approval center's superiors are Employee-role
 *      users (admins bypass the check regardless).
 *
 * Idempotent — safe to re-run.
 *
 * Usage:
 *   cd apps/api && node scripts/migrate-hr-doc-status.mjs
 *
 * Env overrides: PROVISION_API (default http://127.0.0.1:8788),
 *                PROVISION_TOKEN (default dev-token)
 */
const BASE = process.env.PROVISION_API || 'http://127.0.0.1:8788';
const TOKEN = process.env.PROVISION_TOKEN || 'dev-token';
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

const COLLECTIONS = ['hrm_leaves', 'hrm_overtimes', 'hrm_early_leaves'];

const log = (...a) => console.log(...a);
let failures = 0;

async function call(path, opts = {}) {
	const res = await fetch(`${BASE}${path}`, { headers: HEADERS, ...opts });
	const text = await res.text();
	if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`);
	if (!text) return null;
	try {
		const body = JSON.parse(text);
		return body && typeof body === 'object' && 'data' in body ? body.data : body;
	} catch {
		return text;
	}
}

const api = (method, path, body) => call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

/**
 * doc_status → status ladder derived from the engine's VALID_TRANSITIONS
 * (packages/core field-utils). The old rows all sit on `draft` (the engine
 * default), so approved/rejected need the intermediate `pending_review` hop.
 */
function ladderFor(legacyStatus) {
	const s = String(legacyStatus ?? '').toLowerCase();
	if (s === 'approved') return ['pending_review', 'approved'];
	if (s === 'rejected') return ['pending_review', 'rejected'];
	if (s === 'cancelled') return ['cancelled'];
	// 'pending' / null / '' / anything unknown → the review queue.
	return ['pending_review'];
}

async function backfill(collection) {
	const rows = await call(`/api/entities/${collection}?limit=100&sort=created_at&fields=id,status,doc_status`);
	if (!Array.isArray(rows)) {
		log(`  = ${collection}: no rows readable (${JSON.stringify(rows).slice(0, 120)})`);
		return;
	}
	log(`  ${collection}: ${rows.length} row(s)`);
	for (const row of rows) {
		const id = row?.id;
		if (!id) continue;
		const current = String(row?.doc_status ?? '').toLowerCase();
		const ladder = ladderFor(row?.status).filter((hop) => hop !== current);
		for (const hop of ladder) {
			await api('PUT', `/api/entities/${collection}/${id}`, { doc_status: hop });
		}
		if (ladder.length > 0) {
			log(`    ✓ ${id.slice(0, 8)}…  status=${String(row?.status ?? '∅')}  doc_status: ${current || '∅'} → ${ladder.join(' → ')}`);
		} else {
			log(`    = ${id.slice(0, 8)}…  already on doc_status=${current || '∅'} (status=${String(row?.status ?? '∅')}) — no hop needed`);
		}
	}
}

/** Drop the custom `status` field from a collection (schema_json + physical column). */
async function dropStatusField(collection) {
	const cur = await call(`/api/collections/${collection}`);
	const raw = (cur?.schema_json?.fields ?? []).filter((f) => f && typeof f.name === 'string');
	const kept = raw.filter((f) => f.name !== 'status');
	if (kept.length === raw.length) {
		log(`  = ${collection}: custom 'status' field already gone`);
		return;
	}
	await api('PUT', `/api/collections/${collection}`, { fields: kept });
	log(`  ✓ ${collection}: dropped the redundant custom 'status' field (${raw.length} → ${kept.length} fields)`);
}

/** Grant the Employee telegram role can_approve on the request collections. */
async function grantApprove() {
	const roles = await call('/api/users/roles');
	const role = (roles ?? []).find((r) => /^employee$/i.test(String(r?.name ?? '')));
	if (!role?.id) {
		log('✗ No "Employee" role found — skipping the can_approve grant (admins bypass engine RBAC anyway).');
		failures += 1;
		return;
	}
	const perms = (await call(`/api/users/permissions/${role.id}`)) ?? [];
	for (const slug of COLLECTIONS) {
		const p = perms.find((x) => x.collection_slug === slug);
		await api('POST', '/api/users/permissions', {
			role_id: role.id,
			collection_slug: slug,
			can_read: p ? !!p.can_read : true,
			can_write: p ? !!p.can_write : true,
			can_create: p ? !!p.can_create : true,
			can_delete: p ? !!p.can_delete : false,
			can_approve: true,
			can_submit: p ? !!p.can_submit : true,
			...(p?.field_restrictions ? { field_restrictions: p.field_restrictions } : {}),
			...(p?.row_filters ? { row_filters: p.row_filters } : {}),
		});
		log(`  ✓ ${slug}: Employee role can_approve = true`);
	}
}

async function main() {
	log(`Migrating HR request collections against ${BASE} (token: ${TOKEN === 'dev-token' ? 'dev-token' : '***'})\n`);
	log('Step 1 — backfill doc_status from the legacy status column…');
	for (const slug of COLLECTIONS) {
		try {
			await backfill(slug);
		} catch (err) {
			log(`✗ ${slug} backfill failed: ${err.message}`);
			failures += 1;
		}
	}
	log('');
	log('Step 2 — drop the redundant custom status field…');
	for (const slug of COLLECTIONS) {
		try {
			await dropStatusField(slug);
		} catch (err) {
			log(`✗ ${slug} field drop failed: ${err.message}`);
			failures += 1;
		}
	}
	log('');
	log('Step 3 — grant the Employee role can_approve…');
	try {
		await grantApprove();
	} catch (err) {
		log(`✗ can_approve grant failed: ${err.message}`);
		failures += 1;
	}
	log('');
	log(failures === 0 ? 'Migration complete ✅' : `Migration finished with ${failures} failure(s) ❌`);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error('MIGRATION ABORTED:', err);
	process.exit(2);
});
