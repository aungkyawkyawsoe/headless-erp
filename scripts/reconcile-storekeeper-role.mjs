#!/usr/bin/env node
/**
 * Provision the "Storekeeper" role — the operational MRO + workshop access
 * profile that the broad "Employee" role deliberately does NOT hold.
 *
 * Background / least-privilege reasoning
 * --------------------------------------
 * The Mini App's MRO confirm routes gate on a `write` grant to the affected
 * doc header:
 *   - /api/mro/{inbounds,outbounds,transfers,adjustments,requisitions}/:id/confirm
 *     → `PermissionEvaluator.checkBusiness(..., <header>, 'write')`
 *   - /api/mro/serials/:id/check  +  /api/mro/serials/:id/position  (tyre
 *     inspect / move-to-position) → gate on `mro_stock_serials` write.
 *
 * Human Resources "Employee" keeps read (and its own light write) but is NOT
 * granted serial write — so a plain employee turning storekeeper actions gets
 * a 403 on tyre check/fit / doc confirm. That is correct defence-in-depth.
 * A storekeeper is a real operator who approves requisitions, confirms issues
 * & adjustments & transfers, and runs the serial tyre checks — so give ONLY a
 * dedicated role that surface.
 *
 * This script is idempotent. For each grant it PATCH-UPSErts the permission via
 * the same admin endpoint Studio uses (`POST /api/users/permissions`). Existing
 * rows that already carry the needed can_write/can_read are re-asserted (safe).
 * It NEVER touches the "Employee" or "Administrator" roles.
 *
 *   node scripts/reconcile-storekeeper-role.mjs [baseUrl] [bearerToken]
 *
 * Defaults: baseUrl http://localhost:8788 · token `dev-token`.
 */
const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const ROLE_NAME = 'Storekeeper';
const ROLE_DESC = 'MRO operator + workshop — approve requests, confirm issues/adjust/transfers, tyre serial ops';

/**
 * Bind these directory employees (by `etg_id` — the Telegram identity on
 * `hrm_employees`) to the Storekeeper ROLE by pointing their `_users.role_id`
 * at it (the SINGLE effective role the permission engine reads). Use an empty
 * array to leave role assignment untouched. Employees with no `_users` row yet
 * (never logged in) are skipped with a hint — log them in once, then re-run.
 */
const BIND_EMPLOYEES_BY_ETG = process.argv.includes('--bind')
	? // e.g. node scripts/reconcile-storekeeper-role.mjs http://localhost:8788 dev-token \
		//        --bind demo-tg-06 demo-tg-08
		process.argv.slice(5).filter((a) => !a.startsWith('--'))
	: [];

/**
 * Operational write surface. `write` is the flag the MRO confirm + serial slash
 * routes evaluate (and the tgapp doc forms mutate via generic entity writes),
 * so a role that may draft, confirm and act needs can_write on each header it
 * operates and can_write on the serial registers the tyre ops live against.
 *
 * Kept deliberate — not a blanket sweep over every catalog/dl-master collection
 * (which stay read-only for the storekeeper).
 */
const WRITE_COLLECTIONS = {
	// Doc headers a storekeeper creates + confirms.
	mro_inbounds: { can_write: true },
	mro_inbound_lines: { can_write: true },
	mro_outbounds: { can_write: true },
	mro_outbound_lines: { can_write: true },
	mro_transfers: { can_write: true },
	mro_transfer_lines: { can_write: true },
	mro_adjustments: { can_write: true },
	mro_adjustment_lines: { can_write: true },
	mro_requisitions: { can_write: true },
	mro_requisition_lines: { can_write: true },
	// Serial + lot registers a storekeeper's tyre/lot lifecycle ops advance.
	// (/api/mro/serials/:id/check & /position read this write flag directly.)
	mro_stock_serials: { can_write: true },
	mro_stock_lots: { can_write: true },
	mro_serial_events: { can_write: true },
};

/**
 * Full grant set, keyed by slug — union of the operational WRITE surface + the
 * read-only catalog/trace a storekeeper must see. Read-only slugs get
 * can_write:false explicitly SO THAT the single upsert below never downgrades a
 * write grant: `setPermission` defaults any omitted boolean to false, so we
 * must send the COMPLETE desired flag set in the ONE call per (role, slug) or a
 * later pass would silently clobber an earlier write back to false.
 */
const READ_ONLY_SLUGS = [
	'mro_inventory',
	// The purchase-receipt payment ledger is READ-ONLY for the storekeeper: filing a
	// payment goes through POST /api/mro/inbounds/:id/payments and removing one
	// through DELETE /api/mro/inbounds/:id/payments/:paymentId, which both gate on
	// the `mro_inbounds` write above — the ledger collection itself needs no write
	// grant (and must NOT get `can_delete`, which is what the generic DELETE would
	// require: that is why the mini app never uses it).
	'mro_inbound_payments',
	'mro_outbound_lots',
	'mro_outbound_serials',
	'mro_transfer_lots',
	'mro_transfer_serials',
	'mro_item_model',
	'mro_item_name',
	'mro_item_categories',
	'mro_suppliers',
	'veh_fleets',
];

const ALL_GRANTS = {
	...Object.fromEntries(Object.keys(WRITE_COLLECTIONS).map((k) => [k, { can_write: true }])),
	...Object.fromEntries(READ_ONLY_SLUGS.map((k) => [k, { can_write: false }])),
};

let failures = 0;
const log = [];
const logL = (s) => log.push(s);

async function api(method, path, body) {
	const res = await fetch(`${baseUrl}${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const json = await res.json().catch(() => null);
	return { status: res.status, ok: res.ok, json };
}

async function ensureRole() {
	const roles = await api('GET', '/api/users/roles');
	if (!roles.ok) throw new Error(`read roles → HTTP ${roles.status} ${roles.json?.error ?? ''}`);
	const existing = (roles.json?.data ?? []).find((r) => (r.name ?? '').toLowerCase() === ROLE_NAME.toLowerCase());
	if (existing) {
		logL(`role "${ROLE_NAME}" exists (${existing.id})`);
		return existing.id;
	}
	const created = await api('POST', '/api/users/roles', { name: ROLE_NAME, description: ROLE_DESC });
	if (!created.ok) throw new Error(`create role → HTTP ${created.status} ${created.json?.error ?? ''}`);
	logL(`created role "${ROLE_NAME}" (${created.json.data.id})`);
	return created.json.data.id;
}

/** Assert one collection grant with its FULL desired flag set (single upsert per slug). */
async function upsertPermission(roleId, collectionSlug, canWrite) {
	const res = await api('POST', '/api/users/permissions', {
		role_id: roleId,
		collection_slug: collectionSlug,
		can_read: true,
		can_create: canWrite,
		can_write: canWrite,
		can_delete: canWrite,
		can_approve: canWrite,
		can_submit: canWrite,
	});
	if (res.ok) return;
	throw new Error(`grant ${collectionSlug} → HTTP ${res.status} ${res.json?.error ?? ''}`);
}
const STOREKEEPER_APP_ACCESS = [
	// The role→app board (Design-B: `_roles.app_access`, surfaced on /auth/me as
	// `apps`). Storekeepers run the store + workshop boards — not HR admin/leaves.
	'attendance',
	'approval',
	'vehicles',
	'maintenance',
	'tyres',
	'store-requests',
	'item-categories',
	'reports',
	'outbounds',
	'inbounds',
	'stock-moves',
	'adjustments',
	'settings',
];

async function bindEmployees(roleId) {
	if (!BIND_EMPLOYEES_BY_ETG.length) {
		logL('no --bind etg ids → role assignment untouched');
		return;
	}
	// List the directory employees to map etg → auth email.
	const res = await fetch(`${baseUrl}/api/entities/hrm_employees?limit=100&fields=id,etg_id,name_en`, { headers });
	const body = await res.json().catch(() => null);
	const employees = (body?.data ?? []).filter((e) => BIND_EMPLOYEES_BY_ETG.includes(String(e.etg_id)));
	for (const etg of BIND_EMPLOYEES_BY_ETG) {
		const emp = employees.find((e) => String(e.etg_id) === etg);
		if (!emp) {
			logL(`  ✗ etg ${etg} → no hrm_employees row `);
			continue;
		}
		const email = `tg-${etg}@telegram.local`;
		const users = await api('GET', '/api/users');
		const userRow = (users.json?.data ?? []).find((u) => u.email === email);
		if (!userRow) {
			logL(`  ✗ etg ${etg} (${emp.name_en}) → no auth user yet; log the employee in once then re-run`);
			continue;
		}
		if (userRow.role_id === roleId) {
			logL(`  · etg ${etg} (${emp.name_en}) → already ${ROLE_NAME}`);
		} else {
			const upd = await api('PUT', `/api/users/${userRow.id}`, { role_id: roleId });
			if (upd.ok) logL(`  ✓ etg ${etg} (${emp.name_en}) → bound to ${ROLE_NAME}`);
			else {
				logL(`  ✗ etg ${etg} → HTTP ${upd.status} ${upd.json?.error ?? ''}`);
				failures += 1;
			}
		}
	}
}

async function main() {
	const roleId = await ensureRole();

	// One upsert per slug carries the FULL flag set (avoids a later read pass
	// clobbering a write back to false — see ALL_GRANTS note). The server
	// invalidates the role's PermissionEvaluator cache on each POST.
	logL(`applying ${Object.keys(ALL_GRANTS).length} grants…`);
	for (const [slug, flags] of Object.entries(ALL_GRANTS)) {
		try {
			await upsertPermission(roleId, slug, flags.can_write === true);
			logL(`  ✓ ${slug} → ${flags.can_write ? 'write' : 'read'}`);
		} catch (err) {
			logL(`  ✗ ${slug} → ${err.message}`);
			failures += 1;
		}
	}

	// Curate the role's launcher board (`_roles.app_access`).
	logL(`curating ${ROLE_NAME} app_access…`);
	const curate = await api('PUT', `/api/users/roles/${roleId}`, { app_access: STOREKEEPER_APP_ACCESS });
	if (curate.ok) logL(`  ✓ ${STOREKEEPER_APP_ACCESS.length} board apps`);
	else {
		logL(`  ✗ app_access → HTTP ${curate.status} ${curate.json?.error ?? ''}`);
		failures += 1;
	}

	await bindEmployees(roleId);

	console.log(log.join('\n'));
	console.log(failures === 0 ? `\nStorekeeper reconcile: OK ✅` : `\nStorekeeper reconcile: ${failures} FAILURE(S) ❌`);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error('STOREKEEPER RECONCILE ABORTED:', err);
	process.exit(2);
});
