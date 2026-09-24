/**
 * Telegram role provisioning — the config-owned grants for the role every
 * approved Telegram user gets (`cfg.telegram.roleName`, default `Employee`).
 *
 * Why this exists as a SERVICE, not a login-only helper: the grant list
 * (`cfg.telegram.roleCollections`) is DESIRED STATE — a collection joining the
 * list must reach the live `_role_permissions` rows of every deployment, not
 * only deployments that happen to sign a user in afterwards. It used to run only
 * in `POST /auth/telegram`, so a long-lived miniapp session (the JWT does not
 * expire on every app load, and the WebView persists it) never re-ran it: a
 * grant added by a deploy stayed absent from the DB and the affected screen kept
 * rendering its read-error state ("Couldn't read the stock balances" was exactly
 * this — `mro_inventory` granted in config, never written for the existing
 * session's role). `GET /auth/me`, which the miniapp calls on EVERY load/resume,
 * now re-applies it too.
 *
 * Both entry points share this module so the login and the session check can
 * never drift. Applying it is idempotent and cheap: a fully-provisioned role is
 * one role lookup + ONE bulk permission read (+ the row-filter checks), and
 * writes happen only for a slug that is missing or zeroed.
 */
import { cache, D1Client, QueryBuilder } from '@mmbix/core';
import type { AppConfig } from '@mmbix/config';
import type { AuthContext } from '@mmbix/types';
import { PermissionEvaluator } from './permission-evaluator';
import { authzVersion, invalidateAuthzVersion, withAuthzVersion } from './authz-version';

/** Collections whose review decision (doc_status → approved) the Employee
 *  telegram role may make — the HR requests the approval center routes (a
 *  superior approves a subordinate's leave/OT/early-leave request) and the
 *  fleet-care `veh_fluid_fills` whose Pending row the recording operator
 *  finalizes with the app's Confirm button (record + confirm by the same
 *  mobile operator; the veh_fleets care columns denormalize on any write, so
 *  Confirm is a finalize marker, not a stock-release gate). The engine gates a
 *  `doc_status → approved` write behind `can_approve` (admin bypasses). */
const APPROVE_COLLECTIONS = new Set(['hrm_leaves', 'hrm_overtimes', 'hrm_early_leaves', 'veh_fluid_fills']);

/** Row-level scoping the Telegram role must carry (PoLP). Attendance has no
 *  cross-employee screen and no cross-employee decision: an employee may only
 *  read or close their OWN day row. Without this the Employee role reads every
 *  employee's punches AND can `check_out` any open day — the engine runs its
 *  write paths through `checkRowFilterAccess`, so this ONE filter guards reads,
 *  updates and deletes alike. `$CURRENT_USER.employee_id` resolves to the signed
 *  session's directory row (see `DataFilterService`).
 *
 *  The three request collections ALSO get a self-only filter: a generic
 *  `/api/entities` read must never expose a colleague's request (the personal
 *  `reason`). The "self OR my direct subordinates" scope a manager needs is NOT
 *  expressible as a single-table row filter (and a self filter would block an
 *  approver's WRITE), so that scope lives in the server feeds instead:
 *  `GET /api/hr/requests` (list + search) and
 *  `POST /api/hr/requests/:kind/:id/decide` — both of which read/write
 *  privileged and enforce the reporting line themselves. */
const SELF_ROW_FILTER = JSON.stringify({
	combiner: 'and',
	conditions: [{ field: 'employee', op: 'eq', value: '$CURRENT_USER.employee_id' }],
});

/** The transfer-request filter — a holder sees and edits only their OWN
 *  `mro_asset_requests` rows. The request is FILED through the generic API (so
 *  the role needs the grant) but a generic read/update must never reach another
 *  employee's request; the approver's feed + decision run through the privileged
 *  `/api/mro/asset-requests` routes, which this filter does not touch. */
const SELF_REQUESTER_FILTER = JSON.stringify({
	combiner: 'and',
	conditions: [{ field: 'requested_by', op: 'eq', value: '$CURRENT_USER.employee_id' }],
});

/** The personal inbox filter — an employee reads (and marks read) ONLY their own
 *  `hr_notifications` rows, matched by the session's Telegram id (derived on the
 *  auth context from the `tg-<id>@telegram.local` email). Without it the shared
 *  inbox collection would surface every colleague's notifications through the
 *  generic entity read. */
const SELF_NOTIFICATION_FILTER = JSON.stringify({
	combiner: 'and',
	conditions: [{ field: 'tg_id', op: 'eq', value: '$CURRENT_USER.tg_id' }],
});
const ROLE_ROW_FILTERS: Record<string, string> = {
	hrm_attendances: SELF_ROW_FILTER,
	hrm_leaves: SELF_ROW_FILTER,
	hrm_overtimes: SELF_ROW_FILTER,
	hrm_early_leaves: SELF_ROW_FILTER,
	mro_asset_requests: SELF_REQUESTER_FILTER,
	hr_notifications: SELF_NOTIFICATION_FILTER,
};

/**
 * A role's permission row, as read by the ONE bulk pre-fetch in
 * `ensureProvisionedTelegramRole`. Carrying the full row lets BOTH healers below
 * work from it instead of issuing their own `SELECT`s — `/auth/me` runs this on
 * every app load/resume, and the row-filter healer used to pay one round trip
 * per scoped collection (five on the live config) for values already in hand.
 */
interface RolePermRow {
	id: string;
	collection_slug: string;
	can_read: number;
	can_write: number;
	can_create: number;
	can_submit: number;
	can_approve: number;
	row_filters: string | null;
}

/** Set a role's row filter for a collection ONLY when none is configured — an
 *  admin's hand-tuned filter is never clobbered (unlike the grant healing, which
 *  the config list owns). Idempotent; returns true when it wrote. */
async function ensureRoleRowFilters(db: D1Client, roleId: string, slugs: string[], known?: Map<string, RolePermRow>): Promise<boolean> {
	let changed = false;
	for (const slug of slugs) {
		const want = ROLE_ROW_FILTERS[slug];
		if (!want) continue;
		// Prefer the already-read row (a missing entry means the role genuinely has
		// no row for this slug — the pre-fetch reads them all).
		const row = known
			? (known.get(slug) ?? null)
			: await db.first<{ row_filters: string | null }>(
					QueryBuilder.from('_role_permissions').select('row_filters').where('role_id', roleId).where('collection_slug', slug).toSelect(),
				);
		if (!row || row.row_filters != null) continue;
		await db.run(
			QueryBuilder.from('_role_permissions').where('role_id', roleId).where('collection_slug', slug).toUpdate({ row_filters: want }),
		);
		changed = true;
	}
	return changed;
}

/** Grant read/write/create permissions for a collection list (idempotent
 *  UPSERT). Missing slugs are inserted with the standard grant set; existing
 *  rows whose grants are zeroed are healed to the same set — so a role that was
 *  provisioned before a collection joined the config list recovers on the next
 *  login without manual SQL. `field_restrictions` / `row_filters` are never
 *  touched. Returns true when anything changed (callers invalidate the cache). */
async function ensureRolePermissions(db: D1Client, roleId: string, slugs: string[], known?: Map<string, RolePermRow>): Promise<boolean> {
	let changed = false;
	for (const slug of slugs) {
		// APPROVE_COLLECTIONS need `can_approve` for the doc_status → approved
		// decision (engine RBAC); every other role collection stays as before and
		// its (possibly manually-granted) can_approve is never touched.
		const approve = APPROVE_COLLECTIONS.has(slug);
		const core = { can_read: 1, can_write: 1, can_create: 1, can_delete: 0, can_submit: 1 } as const;
		// The bulk pre-fetch already read every permission row for this role, so a
		// present entry needs no re-read and an absent one is genuinely missing.
		const existing = known
			? (known.get(slug) ?? null)
			: await db.first<{
					id: string;
					can_read: number;
					can_write: number;
					can_create: number;
					can_submit: number;
					can_approve: number;
				}>(
					QueryBuilder.from('_role_permissions')
						.select('id', 'can_read', 'can_write', 'can_create', 'can_submit', 'can_approve')
						.where('role_id', roleId)
						.where('collection_slug', slug)
						.toSelect(),
				);
		if (!existing) {
			await db.run(
				QueryBuilder.from('_role_permissions').toInsert({
					id: crypto.randomUUID(),
					role_id: roleId,
					collection_slug: slug,
					...core,
					can_approve: approve ? 1 : 0,
				}),
			);
			changed = true;
			continue;
		}
		// Heal stale rows — a zeroed grant (old provisioning or a manual toggle)
		// would otherwise deny the picker reads forever despite the config list.
		const healCore = !existing.can_read || !existing.can_write || !existing.can_create || !existing.can_submit;
		const healApprove = approve && !existing.can_approve;
		if (healCore || healApprove) {
			await db.run(
				QueryBuilder.from('_role_permissions')
					.where('role_id', roleId)
					.where('collection_slug', slug)
					.toUpdate(approve && healApprove ? { ...core, can_approve: 1 } : { ...core }),
			);
			changed = true;
		}
	}
	return changed;
}

/** Ensure the configured Telegram role + its permissions exist. Idempotent and
 *  CHEAP for returning users: the existing permission set is fetched in ONE
 *  bulk query, then only the missing/zeroed slugs are repaired — a
 *  fully-provisioned login costs 2 queries instead of ~50. The role + permission
 *  list come from config (TELEGRAM_ROLE_NAME / TELEGRAM_ROLE_COLLECTIONS —
 *  default 'Employee' + the hr/vehicle/store set); an empty list provisions the
 *  role WITHOUT permissions. */
export async function ensureProvisionedTelegramRole(db: D1Client, cfg: AppConfig): Promise<{ id: string; name: string }> {
	const role = await db.first<{ id: string }>(QueryBuilder.from('_roles').select('id').where('name', cfg.telegram.roleName).toSelect());
	if (role) {
		// ONE bulk query — then only the slugs that need work (missing OR zeroed
		// grants) are repaired; a fully-provisioned login stays at 2 queries.
		const existing = await db.all<RolePermRow>(
			QueryBuilder.from('_role_permissions')
				.select('id', 'collection_slug', 'can_read', 'can_write', 'can_create', 'can_submit', 'can_approve', 'row_filters')
				.where('role_id', role.id)
				.toSelect(),
		);
		const bySlug = new Map(existing.map((p) => [p.collection_slug, p]));
		const needsWork = cfg.telegram.roleCollections.filter((slug) => {
			const row = bySlug.get(slug);
			return (
				!row ||
				!row.can_read ||
				!row.can_write ||
				!row.can_create ||
				!row.can_submit ||
				// Approve-capable collections also require the approve grant (see APPROVE_COLLECTIONS).
				(APPROVE_COLLECTIONS.has(slug) && !row.can_approve)
			);
		});
		// Both healers read from the rows already in hand — no per-collection
		// re-read. The row-filter healer used to pay one round trip per scoped
		// collection on EVERY `/auth/me`, i.e. on every app load.
		const changed = await ensureRolePermissions(db, role.id, needsWork, bySlug);
		const filtered = await ensureRoleRowFilters(db, role.id, cfg.telegram.roleCollections, bySlug);
		// Fresh/healed grants must not be masked by a stale cached denial —
		// checkBusiness caches `perm:<role>:<slug>:<action>` for 60s, so without
		// this a 403 seen earlier in the isolate would keep failing the picker.
		if (changed || filtered) PermissionEvaluator.invalidateBusinessCache(role.id);
		return { id: role.id, name: cfg.telegram.roleName };
	}

	const roleId = crypto.randomUUID();
	await db.run(
		QueryBuilder.from('_roles').toInsert({
			id: roleId,
			name: cfg.telegram.roleName,
			description: 'HR staff — submits requests, views own records',
			is_system: 0,
		}),
	);
	if (cfg.telegram.roleCollections.length > 0) await ensureRolePermissions(db, roleId, cfg.telegram.roleCollections);
	await ensureRoleRowFilters(db, roleId, cfg.telegram.roleCollections);
	return { id: roleId, name: cfg.telegram.roleName };
}

/**
 * Resolve a directory `role` value to a `_roles` row. The value is a role NAME
 * (what the `hrm_employees.role` select stores) or a role id; names match
 * exactly first, then case-insensitively. Blank/unknown ⇒ null so the caller
 * falls back to the configured default role. Roles are few, so one read of the
 * (id, name) list is cheaper and safer than SQL collation tricks.
 */
export async function resolveDirectoryRole(
	db: D1Client,
	raw: string | null | undefined,
): Promise<{ id: string; name: string; isSystem: boolean } | null> {
	const value = (raw ?? '').trim();
	if (!value) return null;
	// Tiny table, but this runs on EVERY `/auth/me` (every app load/resume). Keyed
	// by the authz version stamp — which watches `_roles.updated_at` — so a role
	// create/rename still lands on the very next read (same ~1s freshness as every
	// other authz lookup) while a steady session costs zero reads. `authzVersion`
	// is already cached in this request (the pre-auth token verification read it),
	// so this adds no query of its own.
	const version = await authzVersion(db);
	const cacheKey = withAuthzVersion('tg:roles', version);
	let roles = cache.get<{ id: string; name: string; is_system?: number | null }[]>(cacheKey);
	if (!roles) {
		roles = await db.all<{ id: string; name: string; is_system?: number | null }>(
			QueryBuilder.from('_roles').select('id', 'name', 'is_system').toSelect(),
		);
		cache.set(cacheKey, roles, 60_000);
	}
	const found =
		roles.find((r) => r.id === value) ??
		roles.find((r) => r.name === value) ??
		roles.find((r) => r.name.toLowerCase() === value.toLowerCase());
	return found ? { id: found.id, name: found.name, isSystem: found.is_system === 1 } : null;
}

/**
 * Keep the SESSION'S EFFECTIVE ROLE in step with the directory — the write half
 * of the directory↔RBAC contract.
 *
 * The `hrm_employees.role` value is the operator's single authority for "who
 * this person is" (an admin edits it in the Studio or with raw SQL), but the
 * permission engine reads `_users.role_id`. Login used to be the ONLY place the
 * two met, so a role changed while a WebView held its long-lived token never
 * reached the app: the launcher kept painting the OLD role's tiles (the
 * "changed the role but Projects is still missing" report). `/auth/me` runs on
 * every load/resume, so it re-syncs here — and because the authz version stamp
 * watches `_users.updated_at`, every OTHER isolate retires its cached user row
 * on the next read too.
 *
 * Returns the effective role (directory role, else the configured default) plus
 * whether `_users` actually changed.
 */
export async function syncDirectoryRole(
	db: D1Client,
	auth: Pick<AuthContext, 'user_id' | 'role_id'>,
	directoryRole: string | null | undefined,
	cfg: AppConfig,
): Promise<{ id: string; name: string; isSystem: boolean; changed: boolean }> {
	const directory = await resolveDirectoryRole(db, directoryRole);
	const defaultRole = directory ? null : await ensureProvisionedTelegramRole(db, cfg);
	const resolved = directory ?? { id: defaultRole!.id, name: defaultRole!.name, isSystem: false };
	if (!auth.user_id || auth.role_id === resolved.id) return { ...resolved, changed: false };
	await db.run(
		QueryBuilder.from('_users').where('id', auth.user_id).toUpdate({ role_id: resolved.id, updated_at: new Date().toISOString() }),
	);
	// The user row just moved: drop the local stamp so THIS isolate re-reads it
	// immediately (other isolates converge as their 1s stamp window lapses).
	invalidateAuthzVersion();
	return { ...resolved, changed: true };
}
