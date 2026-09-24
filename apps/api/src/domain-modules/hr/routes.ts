/**
 * HR Routes — /api/hr
 *
 * Meeting-task operations that must run server-side (not the generic entity
 * CRUD), mirroring the store module's "business logic on the worker" pattern:
 *
 *   POST /api/hr/tasks/:id/complete — the sanctioned "done" transition:
 *       1. load the task (must exist)
 *       2. only the assignee or the creator may complete (403 otherwise)
 *       3. set status = done + completed_at
 *       4. notify the creator (assigner) instantly — "✅ …ပြီးပြီ"
 *       5. idempotent: completing a done task returns already_done, no spam
 *
 *   POST /api/hr/tasks/digest — admin-only manual trigger of the morning
 *       digest (testing / ops). The daily 08:30 cron calls the same service.
 *
 * Actor tg_id resolution: Telegram-provisioned JWTs carry the email
 * `tg-<id>@telegram.local` (see routes/auth-telegram.ts); admins (dev-token)
 * may pass an explicit `actorTgId` in the body for tests/ops.
 */

import { Hono, type Context } from 'hono';
import { D1Client, QueryBuilder, SchemaBuilder, invalidateCollectionReads } from '@mmbix/core';
import { ConflictError, isAppError } from '@mmbix/utils';
import { DAY_MS, dayOf, mmtWindowStartIso, toMmtDate } from '@mmbix/utils';
import { requireAuth } from '@/routes/auth';
import { PermissionEvaluator } from '@/lib/services/permission-evaluator';
import { success, fail } from '@/lib/api/response';
import { collectionTable } from '@/lib/utils/table-name';
import type { AuthContext } from '@/lib/services/auth.service';
import { SmartCollectionService } from '@/lib/services/smart-collection.service';
import { completeTask, runTaskDigest } from '@/domain-modules/hr/task-engine.service';
import { notifyRequestDecided } from '@/domain-modules/hr/request-notify';
import { clampPageSize, DEFAULT_PAGE_SIZE } from '@/lib/api/page-size';
import { idempotencyMiddleware } from '@/plugins/idempotency/plugin';

type HrBindings = {
	Bindings: { DB: D1Database; [key: string]: unknown };
	Variables: { auth: AuthContext };
};

const app = new Hono<HrBindings>();
app.use('*', requireAuth);
// Stripe-style Idempotency-Key: keyed retries never duplicate; unkeyed pass through.
app.use('/tasks/:id/comments', idempotencyMiddleware());
// A keyed punch retry (offline replay / double-tap) never creates a second row.
app.use('/attendances/punch', idempotencyMiddleware());

/** tg_id from a Telegram-provisioned JWT user (email `tg-<id>@telegram.local`). */
function tgIdFromAuth(auth: AuthContext): string | null {
	const m = /^tg-([^@]+)@telegram\.local$/.exec(auth.email ?? '');
	return m ? m[1] : null;
}

/** Whether a read failed because the collection simply is NOT PROVISIONED on
 *  this deploy — the deterministic, config-level absence (`_entity_schemas` has no
 *  such slug, or its table was never created). ONLY that absence may degrade to
 *  "nothing here": a D1 blip, a timeout or any other failure is a real error and
 *  must surface (5xx), never masquerade as an empty queue or, worse, as "you are
 *  not an employee" (the 403 this used to paint over a transient DB failure). */
function isCollectionAbsent(err: unknown): boolean {
	if (isAppError(err) && err.code === 'NOT_FOUND') return true;
	const message = err instanceof Error ? err.message : String(err);
	return message.includes('no such table');
}

/* ── HR request feed (server-scoped reads) ──────────────────────────────
 * The three native request collections are read through ONE server-scoped
 * endpoint instead of client-built entity filters. The scope is resolved from
 * the SIGNED session and the reporting graph on the server, so a tampered
 * client can never widen it — this is the "self OR subordinate" scope a
 * single-table role row filter cannot express, and the same rule the decision
 * enforces below. */

/** Request kind → its native collection slug. */
const HR_REQUEST_TYPES = {
	leave: 'hrm_leaves',
	ot: 'hrm_overtimes',
	early: 'hrm_early_leaves',
} as const;
type HrRequestKind = keyof typeof HR_REQUEST_TYPES;

function isHrRequestKind(value: string): value is HrRequestKind {
	return value === 'leave' || value === 'ot' || value === 'early';
}

/** The app's status chips → the engine's system `doc_status` values. */
const HR_STATUS_TO_DOC: Record<string, string> = {
	pending: 'pending_review',
	approved: 'approved',
	rejected: 'rejected',
	cancelled: 'cancelled',
};

/** The applicant display projection — the EXACT `employee` fields the tgapp row
 *  mappers consume (`expandedEmployee`). Least privilege: the feed runs
 *  privileged, so an explicit projection is what stops an approver seeing the
 *  applicant's WHOLE directory row. */
const EMPLOYEE_REF = 'employee.id,employee.name_en,employee.name_mm,employee.eid,employee.etg_id,employee.avatar';
const RELIEVER_REF = 'reliever_to.id,reliever_to.name_en,reliever_to.name_mm';

/** Per-kind read projection — the fields the client renders, so the rows map to
 *  the same `HrRequest` shape. Listing a m2o path makes the engine expand it. */
const HR_REQUEST_FIELDS: Record<HrRequestKind, string> = {
	leave: [
		'id,doc_status,reason,superior_comment,created_at,updated_at',
		'start_date,end_date,leave_duration_type,half_day_session,start_day_session,end_day_session,total_days',
		EMPLOYEE_REF,
		RELIEVER_REF,
	].join(','),
	ot: 'id,doc_status,reason,superior_comment,created_at,updated_at,date,start_time,end_time,type,total_hours,' + EMPLOYEE_REF,
	early: 'id,doc_status,reason,superior_comment,created_at,updated_at,date_time,location,' + EMPLOYEE_REF,
};

/** The acting employee's directory id from the signed session's tg_id. A MISSING
 *  row is a legitimate "no employee link" (`null`); a FAILED read is not — it
 *  propagates, so a DB outage answers 5xx instead of the misleading 403 "you are
 *  not an employee" the old swallow produced. */
async function employeeIdByEtg(db: D1Client, etg: string): Promise<string | null> {
	try {
		const row = await db.first<{ id?: unknown }>(
			QueryBuilder.from(collectionTable('hrm_employees')).select('id').where('etg_id', etg).toSelect(),
		);
		return typeof row?.id === 'string' ? row.id : null;
	} catch (err) {
		if (isCollectionAbsent(err)) return null;
		throw err;
	}
}

/** The acting employee's directory id — resolved from the SIGNED session ONLY:
 *  `auth.employee_id` when the JWT carries it, else the session's Telegram id via
 *  `hrm_employees.etg_id`. `''` = the session has no employee row. ONE helper, so
 *  the feed, its counts, the team scope and the decision can never disagree about
 *  who is acting (they previously spelled the precedence out ~5 times). */
async function actorEmployeeId(db: D1Client, auth: AuthContext, tgId: string | null): Promise<string> {
	if (auth.employee_id) return auth.employee_id;
	return tgId ? ((await employeeIdByEtg(db, tgId)) ?? '') : '';
}

/** The employee uuids who report DIRECTLY to `superiorId` (`hrm_employee_links`).
 *  An unprovisioned reporting table means there IS no reporting line (`[]`); a
 *  FAILED read propagates — an outage must never render an approver's queue (or
 *  their decided scope) empty. */
async function subordinateIds(db: D1Client, superiorId: string): Promise<string[]> {
	try {
		const links = await db.all<{ subordinate?: unknown }>(
			QueryBuilder.from(collectionTable('hrm_employee_links')).select('subordinate').where('superior', superiorId).toSelect(),
		);
		return [...new Set(links.map((l) => (typeof l.subordinate === 'string' ? l.subordinate : '')).filter(Boolean))];
	} catch (err) {
		if (isCollectionAbsent(err)) return [];
		throw err;
	}
}

/** Whether `actorId` is a recorded superior of `employeeId` — the SAME reporting
 *  edge the feed scopes by, so the list can never offer a request the decision
 *  would then refuse. */
async function isSuperiorOf(db: D1Client, actorId: string, employeeId: string): Promise<boolean> {
	if (!actorId || !employeeId) return false;
	try {
		const row = await db.first<{ id?: unknown }>(
			QueryBuilder.from(collectionTable('hrm_employee_links'))
				.select('id')
				.where('superior', actorId)
				.where('subordinate', employeeId)
				.toSelect(),
		);
		return Boolean(row?.id);
	} catch {
		// Deliberately fail-CLOSED: an unreadable reporting line is never proof of
		// authority, so the decision below answers 403 rather than risking a write.
		return false;
	}
}

app.post('/tasks/:id/complete', async (c: Context<HrBindings>) => {
	const auth = c.get('auth');
	const db = new D1Client(c.env.DB);

	// ── Gate: write permission on the tasks collection (admin bypasses) ──
	if (!auth.is_admin) {
		const allowed = await PermissionEvaluator.checkBusiness(db, auth, 'hr_tasks', 'write');
		if (!allowed) return fail(c, 'You do not have "write" permission on "hr_tasks"', 403);
	}

	const body = (await c.req.json().catch(() => null)) as { actorTgId?: string } | null;
	const actorTgId = tgIdFromAuth(auth) ?? (auth.is_admin && body?.actorTgId ? String(body.actorTgId) : null);
	if (!actorTgId) return fail(c, 'Could not resolve your Telegram identity — complete via the mini app', 403);

	const taskId = c.req.param('id') ?? '';
	let result: Awaited<ReturnType<typeof completeTask>>;
	try {
		result = await completeTask(c.env, db, taskId, actorTgId);
	} catch (err) {
		console.error('[hr] completeTask failed:', err instanceof Error ? err.message : String(err));
		throw err;
	}
	switch (result.status) {
		case 'not_found':
			return fail(c, 'Task not found', 404);
		case 'forbidden':
			return fail(c, 'Only the assignee or the assigner can complete this task', 403);
		case 'already_done':
			return success(c, { taskId, status: 'done', alreadyDone: true });
		case 'checklist_incomplete':
			return fail(c, 'Checklist is not complete — tick off every subtask before completing this task', 409);
		case 'done':
			return success(c, {
				taskId,
				status: 'done',
				notifiedTgId: result.notifiedTgId ?? null,
				nextTaskId: result.nextTaskId ?? null,
				nextDue: result.nextDue ?? null,
			});
	}
});

/** Best-effort display name for a tg_id (fallback to the raw id). Genuinely
 *  OPTIONAL: the name is a denormalized convenience on the comment row, so a
 *  failed lookup must not fail the author's write — the comment still saves. */
async function resolveAuthorName(db: D1Client, tgId: string): Promise<string | null> {
	try {
		const emp = await db.first<{ name_mm?: unknown; name_en?: unknown }>(
			QueryBuilder.from(collectionTable('hr_employees')).select('name_mm', 'name_en').where('tg_id', tgId).toSelect(),
		);
		return String(emp?.name_mm ?? emp?.name_en ?? '') || null;
	} catch {
		return null;
	}
}

/** List a task's comments (newest last) — read gate like the task viewer. */
app.get('/tasks/:id/comments', async (c: Context<HrBindings>) => {
	const auth = c.get('auth');
	const db = new D1Client(c.env.DB);
	if (!auth.is_admin) {
		const allowed = await PermissionEvaluator.checkBusiness(db, auth, 'hr_tasks', 'read');
		if (!allowed) return fail(c, 'You do not have "read" permission on "hr_tasks"', 403);
	}
	const taskId = c.req.param('id') ?? '';
	const table = collectionTable('hr_task_comments');
	try {
		const rows = await db.all<Record<string, unknown>>(
			QueryBuilder.from(table)
				.select('*')
				.where('task_id', taskId)
				.whereNull('deleted_at')
				// `id` breaks the tie for two comments saved in the same millisecond —
				// without it the thread's order is engine-defined (the reader then sees
				// the same two comments swap places between loads).
				.orderBy('created_at', 'asc')
				.orderBy('id', 'asc')
				.toSelect(),
		);
		return success(c, rows);
	} catch (err) {
		// Comments not provisioned on this deploy — degrade to an empty thread. Any
		// OTHER failure (a D1 blip) must surface: "no comments" and "could not read
		// the comments" are different answers, and only one of them is true.
		if (isCollectionAbsent(err)) return success(c, []);
		throw err;
	}
});

/** Add a comment to a task — the author writes through the same auth path. */
app.post('/tasks/:id/comments', async (c: Context<HrBindings>) => {
	const auth = c.get('auth');
	const db = new D1Client(c.env.DB);
	if (!auth.is_admin) {
		const allowed = await PermissionEvaluator.checkBusiness(db, auth, 'hr_tasks', 'write');
		if (!allowed) return fail(c, 'You do not have "write" permission on "hr_tasks"', 403);
	}

	const actorTgId = tgIdFromAuth(auth) ?? (auth.is_admin ? 'admin' : null);
	if (!actorTgId) return fail(c, 'Could not resolve your Telegram identity — comment via the mini app', 403);

	const body = (await c.req.json().catch(() => null)) as { body?: unknown } | null;
	const text = typeof body?.body === 'string' ? body.body.trim() : '';
	if (!text) return fail(c, 'Comment cannot be empty', 422);

	const taskId = c.req.param('id') ?? '';
	const now = new Date().toISOString();
	const id = crypto.randomUUID();
	const authorName = await resolveAuthorName(db, actorTgId);
	try {
		await db.run(
			QueryBuilder.from(collectionTable('hr_task_comments')).toInsert({
				id,
				task_id: taskId,
				author_tg_id: actorTgId,
				author_name: authorName,
				body: text,
				_meta: '{}',
				created_at: now,
				updated_at: now,
			}),
		);
		invalidateCollectionReads('hr_task_comments');
	} catch (err) {
		// Same two-answer discipline as the READ above: "comments are not provisioned
		// on this deploy" and "the write failed" are different answers, and only one
		// of them is true. A bare catch reported every failure as the first one, so a
		// D1 blip or a constraint violation sent the operator looking at provisioning.
		if (isCollectionAbsent(err)) {
			return fail(c, 'Comment could not be saved — comments may not be enabled yet', 500);
		}
		throw err;
	}
	return success(c, {
		id,
		task_id: taskId,
		author_tg_id: actorTgId,
		author_name: authorName,
		body: text,
		created_at: now,
	});
});

app.post('/tasks/digest', async (c: Context<HrBindings>) => {
	const auth = c.get('auth');
	if (!auth.is_admin) return fail(c, 'Admin only', 403);
	const db = new D1Client(c.env.DB);
	const result = await runTaskDigest(c.env, db);
	return success(c, result);
});

/**
 * GET /api/hr/attendance/summary — the attendance view's ENTIRE dataset in ONE
 * round trip: the staff member's punches (`hr_attendance`, newest first, within
 * the last `days` MMT days) + their approved leaves (`hr_requests`, type=leave,
 * overlapping the same window). The actor's tg_id is resolved SERVER-SIDE from
 * the JWT (`tg-<id>@telegram.local` — admins may pass `?tg_id=` for ops), so
 * the client never supplies a filterable identity and one HTTP request replaces
 * the two entity queries the page used to fire per visit.
 *
 * Params mirror the client's fetchers: `days` (default 7), `limit` (default 25;
 * the desktop table passes 200×365). Both reads go through the entity engine
 * (same lean projection, RBAC field filters + row filters as /api/entities).
 */
app.get('/attendance/summary', async (c: Context<HrBindings>) => {
	const auth = c.get('auth');
	const db = new D1Client(c.env.DB);

	const tgId = tgIdFromAuth(auth) ?? (auth.is_admin ? (c.req.query('tg_id') ?? null) : null);
	if (!tgId) return fail(c, 'Could not resolve your Telegram identity — open the attendance view from the mini app', 403);
	if (!auth.is_admin) {
		const canAttendance = await PermissionEvaluator.checkBusiness(db, auth, 'hr_attendance', 'read');
		const canRequests = await PermissionEvaluator.checkBusiness(db, auth, 'hr_requests', 'read');
		if (!canAttendance || !canRequests) return fail(c, 'You do not have "read" permission on the attendance data', 403);
	}

	// The MMT window math lives in ONE place (@mmbix/utils) so the server window
	// and the client's own date math can never disagree: the window opens at MMT
	// midnight of (today - days); the leave overlap starts (days - 1) back.
	const days = Math.min(Math.max(Number(c.req.query('days') ?? 7) || 7, 1), 365);
	// Page-size policy (enterprise): default 25, max 100 (page-size.ts) — the
	// attendance summary is bounded like every other row endpoint.
	const limit = clampPageSize(Number(c.req.query('limit') ?? '') || DEFAULT_PAGE_SIZE);
	const windowStart = mmtWindowStartIso(days);
	const leaveFrom = toMmtDate(Date.now() - (days - 1) * DAY_MS);

	// Both queries go through the entity engine (CollectionService) with the SAME
	// lean projections the client used — relations stay out, payloads stay small.
	const svc = new SmartCollectionService(db, auth);
	await svc.ensureMigrations();
	const attendanceUrl = new URL(
		`http://internal/hr/attendance?limit=${limit}&sort=-timestamp&fields=type,timestamp,location,shift,shift_id,note,status,created_at` +
			`&filter[employee_tg_id][_eq]=${encodeURIComponent(tgId)}&filter[timestamp][_gte]=${encodeURIComponent(windowStart)}`,
	);
	const leavesUrl = new URL(
		`http://internal/hr/leaves?limit=20&sort=-from_date&fields=from_date,to_date,leave_type,reason,status,request_type` +
			`&filter[employee_tg_id][_eq]=${encodeURIComponent(tgId)}&filter[request_type][_eq]=leave&filter[status][_eq]=approved` +
			`&filter[to_date][_gte]=${leaveFrom}`,
	);
	const [attendance, leaves] = await Promise.all([svc.listItems('hr_attendance', attendanceUrl), svc.listItems('hr_requests', leavesUrl)]);
	return success(c, { attendance: attendance.data, leaves: leaves.data });
});

/**
 * GET /api/hr/my-tasks — an employee's task feed (the Projects board's rows) in
 * ONE round trip. Serves BOTH the attendance dashboard's "my tasks" section and
 * the employee profile's Tasks / Projects tabs.
 *
 * Replaces the client's whole-collection walk: `hrm_tasks` has an m2m `assignee`
 * that the entity URL filter syntax cannot express, so the mini app used to page
 * through EVERY task (100/page) and filter in the browser — a cost that grows with
 * the whole table, not with the caller's own tasks, and the read that made the
 * profile's task tabs time out on a slow connection. Here the m2m is resolved
 * server-side through its junction table (`_jt_{tasks}_{employees}`): one indexed
 * lookup of the assigned task ids, then one engine read of just those rows, so the
 * caller gets the same RBAC field/row filters + lean projection as /api/entities.
 *
 * Identity: an explicit `?employee_id=` targets THAT employee (the profile page
 * views someone other than the caller); absent, the acting employee is resolved
 * from the JWT's tg_id (`hrm_employees.etg_id`) so a normal session defaults to
 * its OWN feed. Honouring the parameter for any caller is deliberately NOT a
 * widening: the non-admin gate below already requires read on `hrm_tasks`, and
 * that grant lets the role list the whole collection through /api/entities — the
 * engine read still applies the role's row filters, so scoping a request to one
 * assignee only NARROWS what comes back. Ignoring it instead (the old admin-only
 * behaviour) would paint a colleague's profile with the CALLER's tasks. Admins
 * bypass the gate as everywhere.
 *
 * Returns `{ tasks: [] }` (never an error) when the employee link or the m2m
 * junction is not provisioned — the dashboard degrades to an empty feed.
 *
 * Query: `?employee_id=` (target, default = the signed session) · `?limit=`
 * (optional cap; the walk stops at the first page that satisfies it).
 */
app.get('/my-tasks', async (c: Context<HrBindings>) => {
	const auth = c.get('auth');
	const db = new D1Client(c.env.DB);
	if (!auth.is_admin) {
		const allowed = await PermissionEvaluator.checkBusiness(db, auth, 'hrm_tasks', 'read');
		if (!allowed) return fail(c, 'You do not have "read" permission on "hrm_tasks"', 403);
	}

	const svc = new SmartCollectionService(db, auth);
	await svc.ensureMigrations();

	// ── Resolve the target employee id ─────────────────────────────────────
	// Explicit `employee_id` wins (any caller past the gate — see the doc above);
	// otherwise the acting employee is pinned to the signed session, never a
	// client-supplied identity.
	let employeeId = (c.req.query('employee_id') ?? '').trim();
	if (!employeeId) employeeId = await actorEmployeeId(db, auth, tgIdFromAuth(auth));
	if (!employeeId) return success(c, { tasks: [] });
	if (!employeeId) return success(c, { tasks: [] });

	// ── Resolve the m2m `assignee` junction → the caller's task ids ────────
	let taskIds: string[] = [];
	try {
		const info = await svc.getCollection('hrm_tasks');
		const assignee = info.schemaFields.find((f) => f.type === 'm2m' && f.related_collection && f.name === 'assignee');
		if (!assignee?.related_collection) return success(c, { tasks: [] });
		const target = await svc.getCollection(assignee.related_collection);
		const { table: junction } = new SchemaBuilder().createJunctionTable(info.table_name, target.table_name);
		const links = await db.all<{ source_id?: unknown }>(
			QueryBuilder.from(junction).select('source_id').where('target_id', employeeId).toSelect(),
		);
		taskIds = links.map((r) => (typeof r.source_id === 'string' ? r.source_id : '')).filter(Boolean);
	} catch (err) {
		// Collection or junction not provisioned — empty feed, never a 500. A
		// genuine read failure still surfaces (the feed is not "no tasks").
		if (isCollectionAbsent(err)) return success(c, { tasks: [] });
		throw err;
	}
	if (taskIds.length === 0) return success(c, { tasks: [] });

	// ── Read just the assigned rows through the engine (RBAC + projection) ──
	// Cursor page in case an employee holds more than one page of tasks; the
	// loop is bounded so a pathological set can never spin forever. An OPTIONAL
	// `?limit=` (clamped ≤ 100/page cap) stops the walk as soon as enough rows
	// exist — a small feed (the mini app's to-do widget) then pays ONE page, not
	// the whole list. Omitted ⇒ the historical walk (dashboard / profile tabs).
	const TASK_FIELDS = 'id,name,priority,state,due_date,display_number,project.name,assignee.name_en,assignee.name_mm,assignee.avatar';
	const rawLimit = Number(c.req.query('limit') ?? '');
	const want = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 1000) : null;
	const tasks: Record<string, unknown>[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < 10; page++) {
		// End the walk once the caller's bound is met (offset 0 semantics: the
		// feed is created_at-desc, so the first page IS the newest slice).
		if (want !== null && tasks.length >= want) break;
		const pageLimit = want === null ? 100 : Math.min(100, want - tasks.length);
		const url = new URL('http://internal/hrm_tasks');
		url.searchParams.set('limit', String(pageLimit));
		url.searchParams.set('sort', '-created_at');
		url.searchParams.set('fields', TASK_FIELDS);
		url.searchParams.set('filter[id][_in]', taskIds.join(','));
		if (cursor) url.searchParams.set('cursor', cursor);
		const result = await svc.listItems('hrm_tasks', url);
		tasks.push(...(result.data as Record<string, unknown>[]));
		const next = result.meta.next_cursor;
		if (!result.meta.has_more || typeof next !== 'string' || !next) break;
		cursor = next;
	}
	return success(c, { tasks });
});

/** The SERVER-resolved row scope of a request feed — ONE resolver shared by the
 *  feed (`/requests`) and its badge counts (`/requests/counts`), so a tab and the
 *  badge labelling it can never disagree about who may decide what:
 *    `null`    → every row (an admin's decide feed);
 *    `'empty'` → nothing to show (no session employee, or no recorded reports);
 *    an object → the `_eq` (own) / `_in` (direct subordinates) employee filter.
 *  A failed reporting-graph read THROWS (see `subordinateIds`) instead of
 *  collapsing to `'empty'` — an outage must not look like a quiet queue. */
async function resolveRequestScope(
	db: D1Client,
	auth: AuthContext,
	scope: 'own' | 'approve',
	actorId: string,
): Promise<{ op: '_eq' | '_in'; value: string } | null | 'empty'> {
	if (scope === 'approve') {
		if (auth.is_admin) return null;
		const ids = actorId ? await subordinateIds(db, actorId) : [];
		return ids.length === 0 ? 'empty' : { op: '_in', value: ids.join(',') };
	}
	return actorId ? { op: '_eq', value: actorId } : 'empty';
}

/**
 * GET /api/hr/requests — the ONE server-scoped HR request feed (list + toolbar
 * search for both the requester's inbox and the approver's decision queue).
 *
 * Query:
 *   type   = leave | ot | early | all            (default all)
 *   scope  = own | approve                       (default own)
 *   status = pending,approved,rejected,cancelled (comma list, optional)
 *   search = free text (optional) · employee_id = admin-only own-override
 *
 * Scope (never client-supplied):
 *   own     → rows whose `employee` is the SESSION employee
 *   approve → admin: every row; else rows of the session employee's recorded
 *             direct subordinates (`hrm_employee_links`); no reporting line ⇒
 *             an empty feed, never an error.
 *
 * The read itself runs privileged (the scope above is the gate), so a role row
 * filter can never shrink — or a client widen — what the scope allows. Rows are
 * raw engine rows (applicant expanded) tagged `_kind`, exactly what the app's
 * row mappers expect.
 */

/**
 * GET /api/hr/requests/counts — the PENDING queue size per request kind for the
 * approver feed (`scope=approve`) or the requester's own open requests
 * (`scope=own`, the default).
 *
 * The approval centre shows several tabs; without a count an approver must open
 * every one to discover where the work is. A badge must be TRUTHFUL, so this is
 * a real `COUNT(*)` per collection under the SAME server-resolved scope as the
 * feed — never a capped page length (which would under-report a large queue).
 *
 * Registered BEFORE `/requests` so the literal path is unambiguous.
 */
app.get('/requests/counts', async (c: Context<HrBindings>) => {
	const auth = c.get('auth');
	const db = new D1Client(c.env.DB);
	const scope: 'own' | 'approve' = c.req.query('scope') === 'approve' ? 'approve' : 'own';
	const kinds: HrRequestKind[] = ['leave', 'ot', 'early'];

	// PoLP, but PARTIAL: a role that can read only some kinds gets badges for
	// those and 0 for the rest — the badge row must not 403 the whole page just
	// because one tab is ungranted (its tab renders an empty feed anyway).
	const readable = new Set<HrRequestKind>();
	if (auth.is_admin) {
		for (const kind of kinds) readable.add(kind);
	} else {
		for (const kind of kinds) {
			if (await PermissionEvaluator.checkBusiness(db, auth, HR_REQUEST_TYPES[kind], 'read')) readable.add(kind);
		}
	}

	const actorId = await actorEmployeeId(db, auth, tgIdFromAuth(auth));
	const empty = { leave: 0, ot: 0, early: 0 };
	const employeeFilter = await resolveRequestScope(db, auth, scope, actorId);
	if (employeeFilter === 'empty') return success(c, empty);

	const svc = new SmartCollectionService(db, { ...auth, is_admin: true });
	await svc.ensureMigrations();
	const entries = await Promise.all(
		kinds.map(async (kind) => {
			if (!readable.has(kind)) return [kind, 0] as const;
			const coll = HR_REQUEST_TYPES[kind];
			// `count_only` returns just `meta.total` — no page SELECT, no per-row
			// enrichment (relation resolution, decryption) for a number we discard rows for.
			const url = new URL(`http://internal/${coll}`);
			url.searchParams.set('limit', '1');
			url.searchParams.set('count_only', 'true');
			url.searchParams.set('filter[doc_status][_eq]', HR_STATUS_TO_DOC.pending);
			if (employeeFilter) url.searchParams.set(`filter[employee][${employeeFilter.op}]`, employeeFilter.value);
			try {
				const result = await svc.listItems(coll, url);
				return [kind, Number((result.meta as { total?: number } | undefined)?.total ?? 0)] as const;
			} catch (err) {
				// A collection genuinely absent on this deploy counts as 0, exactly like
				// its feed. Any other failure must NOT: a badge silently reading 0 is an
				// approver's queue hidden behind an outage.
				if (!isCollectionAbsent(err)) throw err;
				console.warn(`[hr] ${kind} count unavailable (collection not provisioned):`, err instanceof Error ? err.message : String(err));
				return [kind, 0] as const;
			}
		}),
	);
	return success(c, Object.fromEntries(entries));
});

app.get('/requests', async (c: Context<HrBindings>) => {
	const auth = c.get('auth');
	const db = new D1Client(c.env.DB);
	const typeParam = (c.req.query('type') ?? 'all').trim().toLowerCase();
	const scope: 'own' | 'approve' = c.req.query('scope') === 'approve' ? 'approve' : 'own';
	const kinds: HrRequestKind[] = typeParam === 'all' ? ['leave', 'ot', 'early'] : isHrRequestKind(typeParam) ? [typeParam] : [];
	if (kinds.length === 0) return fail(c, 'Unknown request type — use leave, ot, early or all', 400);

	// PoLP: the caller must hold read on every collection the feed touches.
	if (!auth.is_admin) {
		for (const kind of kinds) {
			const allowed = await PermissionEvaluator.checkBusiness(db, auth, HR_REQUEST_TYPES[kind], 'read');
			if (!allowed) return fail(c, `You do not have "read" permission on "${HR_REQUEST_TYPES[kind]}"`, 403);
		}
	}

	// Identity comes from the SIGNED session (admins may pin an employee for ops).
	const overrideId = auth.is_admin ? (c.req.query('employee_id') ?? '').trim() : '';
	const actorId = overrideId || (await actorEmployeeId(db, auth, tgIdFromAuth(auth)));

	// Server-computed scope — the SAME resolver the counts route uses.
	const employeeFilter = await resolveRequestScope(db, auth, scope, actorId);
	if (employeeFilter === 'empty') return success(c, { rows: [], hasMore: false, nextCursor: null });

	const docStatuses = (c.req.query('status') ?? '')
		.split(',')
		.map((s) => HR_STATUS_TO_DOC[s.trim().toLowerCase()])
		.filter((s): s is string => Boolean(s));
	const search = (c.req.query('search') ?? '').trim();
	const limit = clampPageSize(Number(c.req.query('limit') ?? '') || DEFAULT_PAGE_SIZE);

	const svc = new SmartCollectionService(db, { ...auth, is_admin: true });
	await svc.ensureMigrations();
	const pages = await Promise.all(
		kinds.map(async (kind) => {
			const coll = HR_REQUEST_TYPES[kind];
			const url = new URL(`http://internal/${coll}`);
			url.searchParams.set('limit', String(limit));
			url.searchParams.set('sort', '-created_at');
			url.searchParams.set('fields', HR_REQUEST_FIELDS[kind]);
			if (employeeFilter) url.searchParams.set(`filter[employee][${employeeFilter.op}]`, employeeFilter.value);
			if (docStatuses.length === 1) url.searchParams.set('filter[doc_status][_eq]', docStatuses[0]);
			else if (docStatuses.length > 1) url.searchParams.set('filter[doc_status][_in]', docStatuses.join(','));
			if (search) url.searchParams.set('search', search);
			try {
				const result = await svc.listItems(coll, url);
				return {
					rows: (result.data as Record<string, unknown>[]).map((row) => ({ ...row, _kind: kind }) as Record<string, unknown>),
					// The engine probes `limit + 1` and reports the overflow — per-collection
					// truth about whether this kind held more rows than its slice.
					truncated: result.meta.has_more === true,
				};
			} catch (err) {
				// A collection genuinely absent on this deploy degrades to its empty slice
				// rather than failing the whole inbox (the old client-side policy, now
				// server-side). A real read failure must NOT: an empty inbox reads as
				// "nothing to approve", which is the worst possible lie to tell an approver.
				if (!isCollectionAbsent(err)) throw err;
				console.warn(`[hr] ${kind} feed unavailable (collection not provisioned):`, err instanceof Error ? err.message : String(err));
				return { rows: [] as Record<string, unknown>[], truncated: false };
			}
		}),
	);

	// ── Merge the per-kind slices into ONE globally-ordered page ─────────────
	// Each kind was read `sort=-created_at` and capped at `limit`, so nothing the
	// merged page can contain was dropped from a kind's slice: a row outside a
	// kind's newest `limit` already has `limit` newer rows IN ITS OWN collection,
	// i.e. a global rank worse than `limit`. Sorting the union by the SAME total
	// order the engine used (`created_at` desc, `id` desc — the engine appends the
	// id tie-breaker to every sort) therefore yields the true global page.
	const merged = pages
		.flatMap((p) => p.rows)
		.sort(
			(a, b) =>
				String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) || String(b.id ?? '').localeCompare(String(a.id ?? '')),
		);
	// Honest truncation: a kind that overflowed its slice, or a union longer than the
	// requested page, means rows exist beyond what is returned. Previously the route
	// capped each kind and still answered `hasMore: false`, so a >`limit` queue was
	// silently short and the client had no way to tell. `nextCursor` stays null —
	// this feed has no keyset to continue on, so a caller seeing `hasMore` narrows
	// with `status`/`search` instead (the badge counts are the uncapped truth).
	const hasMore = pages.some((p) => p.truncated) || merged.length > limit;
	return success(c, { rows: merged.slice(0, limit), hasMore, nextCursor: null });
});

/**
 * POST /api/hr/requests/:kind/:id/decide — the sanctioned request decision
 * (`{ action: 'approved' | 'rejected' | 'cancelled', reason?, expectUpdatedAt? }`).
 *
 * Authorisation (deny-by-default, checked BEFORE any write):
 *   approved / rejected → an admin, or a recorded direct superior of the
 *     requester who also holds `approve` on the collection;
 *   cancelled           → the requester themself (or an admin).
 *
 * The write runs through the entity engine's transition validator (only a
 * pending request can be decided, and `approved → rejected` is terminal) but
 * privileged, so the reporting-line check above — not a single-table row filter —
 * is what authorises the approver. `expectUpdatedAt` keeps the optimistic
 * concurrency contract (409 on a stale decision).
 */
app.post('/requests/:kind/:id/decide', async (c: Context<HrBindings>) => {
	const auth = c.get('auth');
	const db = new D1Client(c.env.DB);
	const kind = (c.req.param('kind') ?? '').trim().toLowerCase();
	const id = c.req.param('id') ?? '';
	if (!isHrRequestKind(kind)) return fail(c, 'Unknown request type — use leave, ot or early', 400);
	if (!id) return fail(c, 'Request id is required', 400);
	const coll = HR_REQUEST_TYPES[kind];

	const body = (await c.req.json().catch(() => null)) as { action?: unknown; reason?: unknown; expectUpdatedAt?: unknown } | null;
	const action = String(body?.action ?? '').trim();
	if (action !== 'approved' && action !== 'rejected' && action !== 'cancelled') {
		return fail(c, 'action must be approved, rejected or cancelled', 422);
	}
	const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
	if (action === 'rejected' && !reason) return fail(c, 'A rejection reason is required', 422);

	const svc = new SmartCollectionService(db, { ...auth, is_admin: true });
	await svc.ensureMigrations();

	// Privileged read of the target — the decision target is not necessarily the
	// caller's OWN row, so a role row filter must not hide it. (Raw read: the
	// engine's lean detail shape drops relation keys, and `employee` IS the owner.)
	const target = await db.first<{ employee?: unknown }>(
		QueryBuilder.from(collectionTable(coll)).select('employee').where('id', id).whereNull('deleted_at').toSelect(),
	);
	if (!target) return fail(c, 'Request not found', 404);
	const ownerId = typeof target.employee === 'string' ? target.employee : '';

	// The acting employee, from the SIGNED session (the SAME resolver the feed and
	// the team scope use — one precedence, so "who may decide" cannot drift from
	// "whose requests I see").
	const actorId = await actorEmployeeId(db, auth, tgIdFromAuth(auth));

	if (!auth.is_admin) {
		if (action === 'cancelled') {
			if (!actorId || ownerId !== actorId) return fail(c, 'Only the requester can cancel this request', 403);
		} else {
			const canApprove = await PermissionEvaluator.checkBusiness(db, auth, coll, 'approve');
			if (!canApprove) return fail(c, `You do not have "approve" permission on "${coll}"`, 403);
			if (!(await isSuperiorOf(db, actorId, ownerId))) {
				return fail(c, 'Only a recorded superior of the requester can decide this request', 403);
			}
		}
	}

	const patch: Record<string, unknown> = { doc_status: action };
	if (action === 'approved' || action === 'rejected') patch.approved_by = actorId || null;
	if (action === 'rejected') patch.superior_comment = reason;

	const expectedUpdatedAt = typeof body?.expectUpdatedAt === 'string' ? body.expectUpdatedAt : null;
	try {
		const updated = await svc.updateItem(coll, id, patch, undefined, expectedUpdatedAt);
		// Tell the requester the outcome (cancelled = their own action, no-op).
		// Awaited so the durable row exists before the response; it never throws.
		await notifyRequestDecided(db, coll, ownerId, action, reason, id);
		return success(c, {
			id,
			request_type: kind,
			status: action,
			doc_status: updated.doc_status ?? action,
			superior_comment: updated.superior_comment ?? null,
			updated_at: updated.updated_at ?? null,
		});
	} catch (err) {
		if (isAppError(err)) return fail(c, err.message, err.statusCode);
		throw err;
	}
});

/* ── Team Tracking (server-scoped attendance reads) ─────────────────────
 * A supervisor may view the attendance of their DIRECT reports; an admin sees
 * everyone. `hrm_attendances` carries a SELF-only role row filter (see
 * `telegram-role.service.ts`), so a generic entity read can NEVER surface a
 * colleague's punches — the only door to that scope is here, on the server,
 * where the reporting line (not a client filter) decides. Mirrors the
 * `/requests?scope=approve` doctrine: privileged read, scope resolved from the
 * SIGNED session, explicit projection so a viewer never sees a whole directory
 * row. */

/** Rows the roster/detail header render — scalars + the two m2o names, nothing
 *  else. Listing a bare m2o name expands it, so department/designation resolve
 *  to their related rows. */
const TEAM_EMPLOYEE_FIELDS = 'id,name_en,name_mm,eid,avatar,department,designation';
const TEAM_ROSTER_LIMIT = 100;
const TEAM_WEEK_DAYS_DEFAULT = 7;
const TEAM_WEEK_DAYS_MAX = 31;

/** A bare m2o relation → its display name (`name_mm` preferred, name_en/name
 *  fallback); a plain id string or absent relation yields null. */
function relationName(value: unknown): string | null {
	if (!value || typeof value !== 'object') return null;
	const row = value as { name_mm?: unknown; name_en?: unknown; name?: unknown };
	const name = String(row.name_mm ?? row.name_en ?? row.name ?? '').trim();
	return name || null;
}

/** The identity projection the team roster + detail header consume. */
function teamEmployeeRow(row: Record<string, unknown>) {
	return {
		id: typeof row.id === 'string' ? row.id : '',
		name_en: typeof row.name_en === 'string' && row.name_en ? row.name_en : null,
		name_mm: typeof row.name_mm === 'string' && row.name_mm ? row.name_mm : null,
		eid: typeof row.eid === 'string' && row.eid ? row.eid : null,
		avatar: typeof row.avatar === 'string' && row.avatar ? row.avatar : null,
		department_name: relationName(row.department),
		designation_name: relationName(row.designation),
	};
}

/** The acting employee's id + the employee ids the session may view.
 *  `scopeIds === null` means EVERY row (the admin case); an array is the
 *  self-plus-direct-subordinates allow-list (empty ⇒ nothing). */
async function viewableEmployeeScope(db: D1Client, auth: AuthContext): Promise<{ actorId: string; scopeIds: string[] | null }> {
	const actorId = await actorEmployeeId(db, auth, tgIdFromAuth(auth));
	if (auth.is_admin) return { actorId, scopeIds: null };
	const subs = actorId ? await subordinateIds(db, actorId) : [];
	return { actorId, scopeIds: [...new Set([...(actorId ? [actorId] : []), ...subs])] };
}

/**
 * GET /api/hr/attendances/team — the Team Tracking roster.
 *
 * Returns the SIGNED session's DIRECT reports (name-sorted) — the list the
 * attendance Team view renders straight away. An admin sees EVERY employee
 * instead. The session's OWN row is deliberately NOT included: this is the team
 * list, and the personal view already covers self.
 *
 * Scope is server-resolved, never client-supplied; every row here is one the
 * detail route below will authorise, so a card can never open a page the viewer
 * may not see.
 */
app.get('/attendances/team', async (c: Context<HrBindings>) => {
	const auth = c.get('auth');
	const db = new D1Client(c.env.DB);

	if (!auth.is_admin) {
		const allowed = await PermissionEvaluator.checkBusiness(db, auth, 'hrm_employees', 'read');
		if (!allowed) return fail(c, 'You do not have "read" permission on "hrm_employees"', 403);
	}

	// Reports only (self excluded); an admin sees everyone.
	const actorId = await actorEmployeeId(db, auth, tgIdFromAuth(auth));
	const reportIds = auth.is_admin ? null : actorId ? await subordinateIds(db, actorId) : [];
	// No reporting line (and not an admin) ⇒ an empty roster, never an error.
	if (reportIds !== null && reportIds.length === 0) return success(c, { rows: [] });

	const svc = new SmartCollectionService(db, { ...auth, is_admin: true });
	await svc.ensureMigrations();
	const url = new URL('http://internal/hrm_employees');
	url.searchParams.set('limit', String(TEAM_ROSTER_LIMIT));
	url.searchParams.set('sort', 'name_en');
	url.searchParams.set('fields', TEAM_EMPLOYEE_FIELDS);
	if (reportIds !== null) url.searchParams.set('filter[id][_in]', reportIds.join(','));
	try {
		const result = await svc.listItems('hrm_employees', url);
		return success(c, { rows: (result.data as Record<string, unknown>[]).map(teamEmployeeRow) });
	} catch (err) {
		// Employees not provisioned on this deploy ⇒ an empty roster; any other
		// failure surfaces — "no team" must never be a lie told by an outage.
		if (!isCollectionAbsent(err)) throw err;
		console.warn('[hr] team roster unavailable (collection not provisioned):', err instanceof Error ? err.message : String(err));
		return success(c, { rows: [] });
	}
});

/**
 * GET /api/hr/attendances/employee/:id?days=7 — one employee's identity + a
 * bounded window of their day rows + the approved leaves overlapping it.
 *
 * Authorisation (deny-by-default): an admin, or the session employee viewing
 * themself, or a recorded direct superior of them. Anything else is 403. The
 * read is privileged so the SELF-only role row filter can't shrink the target's
 * rows; the explicit projection means a viewer sees punches + minimal identity,
 * never a whole directory row.
 *
 * The window is `days` MMT calendar days back from today (default 7, capped 31),
 * deliberately generous around the client's 4 AM work-date boundary; the client
 * buckets the returned rows into its own work days. Rows are raw engine rows
 * (`shift.id` only, no full shift expansion) — exactly what the app's summary
 * mappers already consume.
 */
app.get('/attendances/employee/:id', async (c: Context<HrBindings>) => {
	const auth = c.get('auth');
	const db = new D1Client(c.env.DB);
	const employeeId = c.req.param('id') ?? '';
	if (!employeeId) return fail(c, 'Employee id is required', 400);

	const rawDays = Number(c.req.query('days') ?? '') || TEAM_WEEK_DAYS_DEFAULT;
	const days = Math.min(Math.max(Math.trunc(rawDays), 1), TEAM_WEEK_DAYS_MAX);

	if (!auth.is_admin) {
		const canRead = await PermissionEvaluator.checkBusiness(db, auth, 'hrm_employees', 'read');
		if (!canRead) return fail(c, 'You do not have "read" permission on "hrm_employees"', 403);
		const { scopeIds } = await viewableEmployeeScope(db, auth);
		if (scopeIds === null || !scopeIds.includes(employeeId)) {
			return fail(c, 'You can only view the attendance of your direct reports', 403);
		}
	}

	const svc = new SmartCollectionService(db, { ...auth, is_admin: true });
	await svc.ensureMigrations();

	// Identity — the header's name / eid / avatar / department / designation.
	const idUrl = new URL('http://internal/hrm_employees');
	idUrl.searchParams.set('limit', '1');
	idUrl.searchParams.set('fields', TEAM_EMPLOYEE_FIELDS);
	idUrl.searchParams.set('filter[id][_eq]', employeeId);
	const idResult = await svc.listItems('hrm_employees', idUrl);
	const identityRow = (idResult.data as Record<string, unknown>[])[0];
	if (!identityRow) return fail(c, 'Employee not found', 404);

	// The window start (00:00 MMT, `days + 1` back — one extra day of slack for
	// the 4 AM work-date drift) shared by the punches and the leave overlap.
	const windowStart = mmtWindowStartIso(days + 1);
	const today = toMmtDate(Date.now());
	const windowStartDate = dayOf(windowStart);

	const attUrl = new URL('http://internal/hrm_attendances');
	attUrl.searchParams.set('limit', String(days * 3 + 5));
	attUrl.searchParams.set('sort', '-check_in');
	attUrl.searchParams.set('fields', 'id,check_in,check_out,shift.id,geo_in,geo_out');
	attUrl.searchParams.set('filter[employee][_eq]', employeeId);
	attUrl.searchParams.set('filter[check_in][_gte]', windowStart);

	const leaveUrl = new URL('http://internal/hrm_leaves');
	leaveUrl.searchParams.set('limit', '25');
	leaveUrl.searchParams.set('fields', 'id,start_date,end_date,doc_status');
	leaveUrl.searchParams.set('filter[employee][_eq]', employeeId);
	leaveUrl.searchParams.set('filter[start_date][_lte]', today);
	leaveUrl.searchParams.set('filter[end_date][_gte]', windowStartDate);

	const [attResult, leaveResult] = await Promise.all([
		svc.listItems('hrm_attendances', attUrl),
		// An unprovisioned leaves collection degrades to no leave badges (not a 500);
		// a FAILED read surfaces — "no approved leave" and "leave could not be read"
		// must not render as the same badge.
		svc.listItems('hrm_leaves', leaveUrl).catch((err: unknown) => {
			if (!isCollectionAbsent(err)) throw err;
			return { data: [] as Record<string, unknown>[], meta: {} };
		}),
	]);

	return success(c, {
		employee: teamEmployeeRow(identityRow),
		attendance: attResult.data as Record<string, unknown>[],
		leaves: leaveResult.data as Record<string, unknown>[],
	});
});

/**
 * POST /api/hr/attendances/punch — the app's punch entry point. The acting
 * employee is resolved from the SIGNED session (never the body), the open day row
 * is closed on check-out without a client-supplied id, and the punch TIME is
 * server-owned end-to-end — this endpoint stamps it and the compiled attendance
 * time lock re-stamps every other write path too. Only the GPS coordinates ride
 * in from the device (a browser must supply those).
 *
 * Body: `{ kind: 'in' | 'out', shiftId?, lat?, lng? }` (`employee_id` allowed for
 * an admin back-fill). Keyed retries are idempotent (the SDK sends an
 * Idempotency-Key on every write).
 */
app.post('/attendances/punch', async (c: Context<HrBindings>) => {
	const auth = c.get('auth');
	const db = new D1Client(c.env.DB);
	const body = (await c.req.json().catch(() => null)) as {
		kind?: unknown;
		shiftId?: unknown;
		lat?: unknown;
		lng?: unknown;
		employee_id?: unknown;
	} | null;
	const kind: 'in' | 'out' = body?.kind === 'out' ? 'out' : 'in';

	if (!auth.is_admin) {
		const allowed = await PermissionEvaluator.checkBusiness(db, auth, 'hrm_attendances', 'write');
		if (!allowed) return fail(c, 'You do not have "write" permission on "hrm_attendances"', 403);
	}

	// Identity: the session's directory row (an admin may back-fill for an employee).
	const actorId = auth.is_admin
		? (typeof body?.employee_id === 'string' && body.employee_id) || auth.employee_id || null
		: auth.employee_id;
	if (!actorId) return fail(c, 'Could not resolve your employee record — punch from the mini app', 403);

	const now = new Date().toISOString();
	const geo = typeof body?.lat === 'number' && typeof body?.lng === 'number' ? `${body.lat},${body.lng}` : null;
	const table = collectionTable('hrm_attendances');
	// The punch runs through the entity engine with the CALLER's auth. The time is
	// still server-owned: the compiled attendance time lock re-stamps
	// `check_in`/`check_out` on every write (see `hr/attendance-time-lock.ts`), so
	// this endpoint only adds the server-resolved identity + geo handling.
	const svc = new SmartCollectionService(db, auth);
	await svc.ensureMigrations();

	try {
		if (kind === 'in') {
			const shiftId = typeof body?.shiftId === 'string' && body.shiftId ? body.shiftId : null;
			if (!shiftId) return fail(c, 'Check-in needs a shift — pick one in the punch dialog', 422);
			const created = await svc.createItem('hrm_attendances', { employee: actorId, check_in: now, shift: shiftId, geo_in: geo });
			return success(c, { id: created.id, type: 'check-in', timestamp: created.check_in ?? now, shift_id: shiftId });
		}

		// Check-out closes the employee's open day row (newest first) — never a second row.
		// The read also carries the row's `updated_at`, handed back as `expectedUpdatedAt`:
		// two concurrent check-outs (a double-tap, two devices) then cannot both "close"
		// the same row — the loser's write is stale and answers 409 instead of silently
		// overwriting the winner's timestamp + `geo_out`.
		const open = await db.first<{ id?: unknown; updated_at?: unknown }>(
			QueryBuilder.from(table)
				.select('id', 'updated_at')
				.where('employee', actorId)
				.whereNull('check_out')
				.orderBy('check_in', 'desc')
				.toSelect(),
		);
		if (!open?.id) return fail(c, 'Check-out failed — no open record for today.', 409);
		const updated = await svc.updateItem(
			'hrm_attendances',
			String(open.id),
			{ check_out: now, geo_out: geo },
			undefined,
			typeof open.updated_at === 'string' ? open.updated_at : null,
		);
		return success(c, { id: updated.id ?? open.id, type: 'check-out', timestamp: updated.check_out ?? now });
	} catch (err) {
		// The optimistic-concurrency loser (see the check-out above) arrives here as a
		// ConflictError — answer with the punch screen's own wording rather than the
		// generic "re-apply your changes" copy, which describes an edit that never was.
		if (err instanceof ConflictError)
			return fail(c, 'Check-out failed — this record was already closed elsewhere. Refresh and try again.', 409);
		if (isAppError(err)) return fail(c, err.message, err.statusCode);
		throw err;
	}
});

export const hrRoutes = app;
