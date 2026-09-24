#!/usr/bin/env node
/**
 * Reconcile read access for the tgapp's "Employee"-role screens against the REAL
 * engine collections the Mini App reads directly via `.items(...)` (entities).
 *
 * Background: the Mini App reads entity collections THROUGH the authenticated
 * user's role — `PermissionEvaluator.checkBusiness` DENIES any collection that
 * has no `_role_permissions` row for that role (a row must exist OR the user is
 * admin). When a new engine collection is added to the tgapp (or one is omitted
 * from a role's grant), the affected screen turns into its EMPTY state with a
 * console 403 ("You do not have read permission on …") — e.g. the တာယာ /app/tyres
 * register silently showed no rows until `mro_stock_serials` was granted.
 *
 * This is idempotent: for every role named `Employee` it reads that role's
 * `_role_permissions` and, for the tgapp-facing collections below that LACK a
 * row, grants `can_read` via the SAME admin endpoint the Studio uses
 * (`POST /api/users/permissions`); the collections the Mini App WRITES
 * (`TGAPP_WRITABLE_COLLECTIONS`) get read + write + create + submit, and an
 * existing read-only row on one of them is upgraded. Rows already carrying the
 * needed rights are left untouched (no privilege beyond what the app surface uses).
 *
 *   node scripts/reconcile-tgapp-role-permissions.mjs [baseUrl] [bearerToken]
 *
 * Defaults: baseUrl http://localhost:8788 · token `dev-token`.
 */
const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function api(method, path, body) {
	const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
	const json = await res.json().catch(() => null);
	return { status: res.status, ok: res.ok, json };
}

/**
 * The engine collections the tgapp Mini App reads DIRECTLY (entity `.items()`)
 * that a fresh/mid-migration "Employee" role grant may have missed. This is the
 * audited inventory derived from the module reads (see the tyres register + the
 * stock/control screens) — NOT a broad sweep: only surfaces that back a live
 * screen belong here.
 */
const TGAPP_ENTITY_COLLECTIONS = [
	// The tyre / batch-stock register + its stock-trace siblings (tyre units).
	'mro_stock_serials',
	'mro_stock_lots',
	// Immutable per-serial lifecycle history feed rendered on the tyre detail view.
	'mro_serial_events',
	// Purchase-receipt payment ledger — the inbound card's money strip + the payment
	// sheet's history list (the receipt's own paid/left mirror lives on the header).
	'mro_inbound_payments',
	// Vehicle + accident/permit/insurance record directories.
	'veh_fleets',
	'veh_incidents',
	'veh_permits',
	'veh_insurances',
	// Fleet care — daily ODO month buckets + engine/gear oil fills (read-side km due).
	'veh_odo_months',
	'veh_fluid_fills',
	// Vehicle maintenance — the issue-type master + the per-truck maintenance log
	// the ပြင်ဆင် app reads AND writes (`/app/maintenances`).
	'veh_issue_types',
	'veh_maintenance_logs',
];

/**
 * Of the above, the collections the Mini App WRITES (not just reads) — they get
 * the same read + write + create + submit grant the Telegram role provisioning
 * gives a writable screen, so an in-app create/edit is not 403'd. A role row that
 * already exists with read-only (as the maintenance app found) is upgraded here.
 */
const TGAPP_WRITABLE_COLLECTIONS = ['veh_issue_types', 'veh_maintenance_logs'];

const READ_GRANT = { can_read: true };
const WRITE_GRANT = { can_read: true, can_write: true, can_create: true, can_submit: true };

let failures = 0;
const log = [];

async function roleGrantMissing(role) {
	const perms = await api('GET', `/api/users/permissions/${role.id}`);
	if (!perms.ok) {
		log.push(`FAIL  read permissions for role ${role.name}: HTTP ${perms.status} ${perms.json?.error ?? ''}`);
		failures += 1;
		return null;
	}
	const bySlug = new Map((perms.json?.data ?? []).map((p) => [p.collection_slug, p]));
	const missing = [];
	for (const slug of TGAPP_ENTITY_COLLECTIONS) {
		const row = bySlug.get(slug);
		if (!row) {
			missing.push(slug);
			continue;
		}
		// A writable screen whose row is read-only (a legacy grant) is upgraded too.
		if (TGAPP_WRITABLE_COLLECTIONS.includes(slug) && !row.can_write) missing.push(slug);
	}
	log.push(`role "${role.name}": ${bySlug.size} grants · needs ${missing.length ? missing.join(', ') : '(nothing)'}`);
	return missing;
}

const run = async () => {
	const roles = await api('GET', '/api/users/roles');
	if (!roles.ok) {
		console.error(`Could not read roles: HTTP ${roles.status} ${roles.json?.error ?? ''}`);
		process.exit(1);
	}
	const employees = (roles.json?.data ?? []).filter((r) => /employee/i.test(r.name ?? ''));
	if (employees.length === 0) {
		console.log(roles.json != null ? roles.json : 'roles endpoint body missing');
		console.error('No "Employee"-role found to reconcile — nothing to do.');
		process.exit(0);
	}

	for (const role of employees) {
		const missing = await roleGrantMissing(role);
		if (!missing) continue;
		for (const slug of missing) {
			const grant = await api('POST', '/api/users/permissions', {
				role_id: role.id,
				collection_slug: slug,
				...(TGAPP_WRITABLE_COLLECTIONS.includes(slug) ? WRITE_GRANT : READ_GRANT),
			});
			if (grant.ok)
				log.push(`grant  ${slug} → ${TGAPP_WRITABLE_COLLECTIONS.includes(slug) ? 'read/write/create' : 'read'} (role ${role.name})`);
			else {
				log.push(`FAIL  grant ${slug} for role ${role.name}: HTTP ${grant.status} ${grant.json?.error ?? ''}`);
				failures += 1;
			}
		}
	}

	console.log(log.join('\n'));
	console.log(failures === 0 ? '\nReconcile: OK ✅' : `\nReconcile: ${failures} FAILURE(S) ❌`);
	process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => {
	console.error('RECONCILE ABORTED:', err);
	process.exit(2);
});
