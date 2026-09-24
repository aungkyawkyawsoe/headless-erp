import { isSdkError, type MmbixClient } from '@mmbix/sdk';
import type { QueryClient } from '@tanstack/react-query';

import type { CursorPage } from '@/shared/hooks/use-cursor-list';
import { SEARCH_LIMIT } from '@/shared/constants';
import { sdk } from '@/shared/api/sdk';
import { fetchMe, getDevDevice } from '@/shared/auth';
import { getLiveInitDataUnsafe } from '@/shared/platform/telegram';
import { DAY_MS, MMT_OFFSET_MS, toMmtDate } from '@/shared/time/myanmar';
import type { AttendancePunch, EmployeeRow, HrRequest, HrRequestStatus, HrRequestType } from './types';

/**
 * Row shapes for the REAL engine collections the ရုံးတက် HOME reads: the
 * module-prefixed `hrm_*` collections (physical `cms_hrm_*` tables) that
 * replaced both the legacy `hr_*` schema and the pre-prefix slugs
 * (`employees` → `hrm_employees`, table `cms_hrm_employees`).
 */

/** `hrm_employees` (table `cms_hrm_employees`) — looked up by `etg_id`, not any tg_id. */
interface EmployeeDirectoryRow {
	id: string;
	name_mm?: string | null;
	name_en?: string | null;
	eid?: string | null;
	/** The same value the acting Telegram id resolves to (`tg-<id>@telegram.local`). */
	etg_id?: string | null;
	/** Image field → `/api/media/...` when populated. */
	avatar?: string | null;
	/** m2m junction to `hrm_shifts` — expands to an array when dotted fields are requested. */
	shifts?: unknown;
}

/** `hrm_attendances` (table `cms_hrm_attendances`) — ONE row per work day. */
interface AttendanceDayRow {
	id: string;
	/** m2o to `hrm_employees` (bare name — the engine expands it to the full employee row). */
	employee?: unknown;
	/** Timestamp (required) — the day's check-in. */
	check_in?: string | null;
	/** Timestamp (optional) — the day's check-out. */
	check_out?: string | null;
	/** m2o to `hrm_shifts` (required on create) — expands to the related shift row. */
	shift?: unknown;
	geo_in?: string | null;
	geo_out?: string | null;
}

/*
 * The REAL native per-type request collections (`hrm_leaves`, `hrm_overtimes`,
 * `hrm_early_leaves`; physical tables `cms_hrm_leaves`, `cms_hrm_overtimes`,
 * `cms_hrm_early_leaves`) + the reporting junction `hrm_employee_links` (table
 * `cms_hrm_employee_links`). These are the collections the request & approval
 * flows must target now — the legacy `hr_requests`/`hr_employees` rows this
 * module was originally built around do NOT exist on this backend.
 *
 * Each request row carries its applicant as an m2o `employee` -> `hrm_employees`
 * uuid (NOT a denormalized tg_id/name/eid) and a per-type date/time/fact shape.
 * The request LIFECYCLE is the engine's system `doc_status` (create drafts the
 * row, submit moves it to `pending_review`, a decision approves / rejects /
 * cancels it) — the redundant custom `status` select these collections used to
 * carry was removed. `hrm_employee_links` is the reporting graph approvals
 * route through (`superior` o2m "who approves me").
 */

/** `hrm_leaves` (cms_hrm_leaves) — an employee's leave request row. */
interface RequestLeaveRow {
	id: string;
	/** m2o -> hrm_employees (the applicant). */
	employee?: unknown;
	start_date?: string | null;
	end_date?: string | null;
	/** `half_day` | `full_day` | `multi_day` (native enum). */
	leave_duration_type?: string | null;
	/** `morning` | `afternoon` — a single half-day's session. */
	half_day_session?: string | null;
	start_day_session?: string | null;
	end_day_session?: string | null;
	/** m2o -> hrm_employees — the colleague handed over to during the leave. */
	reliever_to?: unknown;
	/** System lifecycle — `draft` | `pending_review` | `approved` | `rejected` | `cancelled`. */
	doc_status?: string | null;
	total_days?: number | null;
	reason?: string | null;
	superior_comment?: string | null;
	approved_by?: unknown;
	created_at?: string | null;
	updated_at?: string | null;
}

/** `hrm_overtimes` (cms_hrm_overtimes) — an OT request row. */
interface RequestOvertimeRow {
	id: string;
	employee?: unknown;
	date?: string | null;
	start_time?: string | null;
	end_time?: string | null;
	/** `normal` | `sunday` | `holiday` | `thingyan` (native enum). */
	type?: string | null;
	/** Computed OT span (native formula column) — hours, 2dp. */
	total_hours?: number | null;
	reason?: string | null;
	/** System lifecycle — `draft` | `pending_review` | `approved` | `rejected` | `cancelled`. */
	doc_status?: string | null;
	approved_by?: unknown;
	superior_comment?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
}

/** `hrm_early_leaves` (cms_hrm_early_leaves) — an early-leave request row. */
interface RequestEarlyLeaveRow {
	id: string;
	employee?: unknown;
	/** Timestamp (required) — combined exit date+time, e.g. `2026-09-02T16:00`. */
	date_time?: string | null;
	/** Location (required). */
	location?: string | null;
	reason?: string | null;
	/** System lifecycle — `draft` | `pending_review` | `approved` | `rejected` | `cancelled`. */
	doc_status?: string | null;
	approved_by?: unknown;
	superior_comment?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
}

/** `hrm_employee_links` (cms_hrm_employee_links) — one superior→subordinate edge. */
interface EmployeeLinkRow {
	id: string;
	/** o2m-ish m2o -> hrm_employees: the chain-of-command superior. */
	superior: unknown;
	/** m2o -> hrm_employees: the reporting employee. */
	subordinate: unknown;
}

/** Every native request row shares these identity/status/approve columns. */
type NativeRequestBase = {
	employee?: unknown;
	doc_status?: string | null;
	approved_by?: unknown;
	superior_comment?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
};

/**
 * The attendance module's typed client.
 *
 * The app-wide client is typed against the placeholder `Schema = {}`, so entity
 * reads/writes here go through a locally-typed view of the same instance —
 * runtime transport (auth, retries, page-size policy, replay-safe writes) stays
 * the app's single SDK client.
 *
 * The ရုံးတက် HOME + the request & approval flows read the REAL engine
 * collections that exist on this backend (NOT the legacy `hr_*` rows):
 * `hrm_employees` (lookup by `etg_id`), `hrm_attendances` (ONE row per work
 * day), and the per-type request stores `hrm_leaves` / `hrm_overtimes` /
 * `hrm_early_leaves`, routed through the `hrm_employee_links` reporting graph
 * for approvals.
 */
type OpsSchema = {
	// The real module-prefixed collections behind the ရုံးတက် HOME (the legacy
	// `hr_*` rows this module was originally built around do not exist).
	hrm_employees: EmployeeDirectoryRow;
	hrm_attendances: AttendanceDayRow;
	hrm_leaves: RequestLeaveRow;
	hrm_overtimes: RequestOvertimeRow;
	hrm_early_leaves: RequestEarlyLeaveRow;
	hrm_employee_links: EmployeeLinkRow;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/**
 * True when the failure means the HR module isn't mounted on this backend
 * (its collection / route is missing → 404 `NOT_FOUND`) — the ONE failure the
 * dashboard degrades on. Every other error is rethrown so an outage surfaces
 * instead of masquerading as "no punches yet" / "no shift assigned".
 */
function isMissingHrModule(error: unknown): boolean {
	return isSdkError(error) && (error.status === 404 || error.code === 'NOT_FOUND');
}

/**
 * The acting tg_id, resolved the SAME way the server does it: Telegram-provisioned
 * JWTs carry the email `tg-<id>@telegram.local` (see `hr/routes.ts`). Falls back
 * to the live initData user id (covers setups where the email differs).
 *
 * Plain-browser dev sessions (e.g. the documented `dev-token` admin, whose email
 * is `dev` — not `tg-<id>@telegram.local`) have neither: without a further
 * fallback the tg id is null, every identity-gated query below stays DISABLED
 * (`enabled: false`), and a disabled TanStack query reports `isPending === true`
 * forever — the attendance page then shimmers indefinitely and never fires its
 * `hrm_employees` read. So in dev builds fall back to THIS browser's persisted
 * dev identity (`getDevDevice`) — the very id `telegramLogin` / DevLoginScreen
 * register as the employee's `etg_id`. Production never reaches this branch.
 */
export async function fetchCurrentTgId(): Promise<string | null> {
	const me = await fetchMe().catch(() => null);
	const fromEmail = me?.email ? /^tg-([^@]+)@telegram\.local$/.exec(me.email)?.[1] : undefined;
	if (fromEmail) return fromEmail;
	const unsafe = getLiveInitDataUnsafe();
	if (unsafe.user?.id != null) return String(unsafe.user.id);
	return import.meta.env.DEV ? String(getDevDevice().id) : null;
}

/* ── acting employee-id memo (etg → hrm_employees.id) ──────────────────
 * The mapping from the acting Telegram id (`etg_id`) to the matching
 * `hrm_employees.id` (uuid) is IDEMPOTENT per session, but `findEmployeeIdByEtg`
 * used to hit the `/api/entities/hrm_employees?...etg_id` collection on EVERY
 * call — i.e.
 * once per approval load, per request list + search, per create/update/punch.
 * That repeat read is cached here in `sessionStorage` (per-tab scope, survives
 * a hard reload the way `shared/platform/telegram.ts` restores initData), so a
 * session performs the lookup ONCE per freshness window instead of per screen.
 *
 * Correctness guards:
 *   - keyed BY etg: an account switch (log out → new dev id in the same tab)
 *     has a different etg, so it naturally misses instead of stealing the
 *     previous user's uuid.
 *   - bounded by a 5-min TTL: a row whose tg link was removed is
 *     never served past the window; the next read refetches and returns null.
 *   - coalesced in-flight: StrictMode/HMR double-mounts dedupe to ONE request
 *     (same pattern as fetchMe / useEmployeeLookup). ──────────────────── */

const ETG_ID_STORAGE_KEY = 'tgapp-attendance-etg-id';
const ETG_ID_MEMO_MS = 5 * 60 * 1000; // same identity freshness window as qk identity reads
/** In-flight lookups keyed by etg — StrictMode/HMR double-callers SHARE one
 *  fetch instead of stacking duplicates (cleared in `finally`). */
const etgInflight = new Map<string, Promise<string | null>>();

/** The recorded etg→uuid + when it was written (monotonic epoch ms). */
function readEtgIdCache(): { etg: string; id: string; at: number } | null {
	try {
		const raw = sessionStorage.getItem(ETG_ID_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { etg?: unknown; id?: unknown; at?: unknown };
		if (typeof parsed.etg === 'string' && typeof parsed.id === 'string' && typeof parsed.at === 'number') {
			return { etg: parsed.etg, id: parsed.id, at: parsed.at };
		}
	} catch {
		// Unparsable/corrupt — ignore and refetch once.
	}
	return null;
}

/** Persist the etg→uuid mapping for this tab/session. */
function writeEtgIdCache(etg: string, id: string): void {
	try {
		sessionStorage.setItem(ETG_ID_STORAGE_KEY, JSON.stringify({ etg, id, at: Date.now() }));
	} catch {
		// Storage full/blocked — best-effort; the module fallback (network) still works.
	}
}

/**
 * The acting etg value → the matching `hrm_employees.id` (uuid), by filtering
 * the real `hrm_employees` collection on `etg_id` (NOT `tg_id` — that column
 * doesn't exist; `etg_id` is the REQUIRED/unique link the Telegram id maps to).
 * Returns null when no employee row matches (unregistered account).
 *
 * Backed by sessionStorage so only the acting etg is resolved over the network
 * ONCE per 5-min window per tab (see the memo note above).
 */
async function findEmployeeIdByEtg(etg: string | null | undefined): Promise<string | null> {
	if (!etg) return null;
	const now = Date.now();
	const cached = readEtgIdCache();
	if (cached && cached.etg === etg && now - cached.at < ETG_ID_MEMO_MS) {
		return cached.id;
	}
	// Coalesce concurrent first callers into ONE lookup (StrictMode/HMR mounts).
	const pending = etgInflight.get(etg);
	if (pending) return pending;
	const lookup = (async () => {
		const res = await ops.items('hrm_employees').list({ filter: { etg_id: { _eq: etg } }, fields: ['id'], limit: 1 });
		return res.data[0]?.id ?? null;
	})()
		.then((id) => {
			// Only cache a FOUND mapping — a missing row is rechecked on the next call
			// (its tg link may be added later), bounded naturally by the TTL on a hit.
			if (id) writeEtgIdCache(etg, id);
			return id;
		})
		.finally(() => {
			etgInflight.delete(etg);
		});
	etgInflight.set(etg, lookup);
	return lookup;
}

/**
 * The employee directory row for the current user (header name / eid / photo).
 * The real `hrm_employees` collection has no `photo_url` column — the avatar
 * image field is `avatar` — so that column is mapped onto `photo_url` at this
 * data boundary exactly like the request-card enrichments expect.
 */
export async function fetchEmployee(tgId: string): Promise<EmployeeRow | null> {
	const res = await ops.items('hrm_employees').list({
		filter: { etg_id: { _eq: tgId } },
		fields: ['id', 'name_mm', 'name_en', 'eid', 'avatar'],
		limit: 1,
	});
	const row = res.data[0];
	if (!row) return null;
	const nameMm = typeof row.name_mm === 'string' && row.name_mm ? row.name_mm : null;
	const nameEn = typeof row.name_en === 'string' && row.name_en ? row.name_en : null;
	const eid = typeof row.eid === 'string' && row.eid ? row.eid : null;
	const avatar = typeof row.avatar === 'string' && row.avatar ? row.avatar : null;
	return {
		id: row.id,
		name_mm: nameMm,
		name_en: nameEn,
		eid: eid ?? null,
		photo_url: avatar,
	};
}

/**
 * The employee row for a KNOWN id — the session-`employee_id` counterpart of
 * `fetchEmployee`'s `etg_id` lookup. Used when the signed session already names
 * the employee (`/auth/me.employee_id`), so no directory search is needed and the
 * resolved id can never disagree with the actor the server stamps on a write.
 */
export async function fetchEmployeeById(employeeId: string): Promise<EmployeeRow | null> {
	const res = await ops.items('hrm_employees').list({
		filter: { id: { _eq: employeeId } },
		fields: ['id', 'name_mm', 'name_en', 'eid', 'avatar'],
		limit: 1,
	});
	const row = res.data[0];
	if (!row) return null;
	const nameMm = typeof row.name_mm === 'string' && row.name_mm ? row.name_mm : null;
	const nameEn = typeof row.name_en === 'string' && row.name_en ? row.name_en : null;
	const eid = typeof row.eid === 'string' && row.eid ? row.eid : null;
	const avatar = typeof row.avatar === 'string' && row.avatar ? row.avatar : null;
	return { id: row.id, name_mm: nameMm, name_en: nameEn, eid: eid ?? null, photo_url: avatar };
}

/** A resolved "current employee" — the acting user's `hrm_employees` row, as much
 *  of it as any screen renders.
 *
 * `name` is the English-first display name MRO / fleet screens attribute a doc
 * with. The row's own columns ride along because the ရုံးတက် dashboard header
 * leads with the BURMESE name and also shows the eid + photo — and it must render
 * the SAME row this resolver already read, not issue a second directory read for
 * three more columns. */
export interface CurrentEmployee {
	id: string;
	/** English-first display name — `name_en`, falling back to `name_mm`. */
	name: string;
	/** Burmese name (the header's first choice), or null. */
	name_mm: string | null;
	/** English name, or null. */
	name_en: string | null;
	/** The employee id shown under the name (e.g. "MFF-009"), or null. */
	eid: string | null;
	/** Directory photo URL (`/api/media/...`), or null. */
	photo_url: string | null;
}

/**
 * An `EmployeeRow` as the `CurrentEmployee` every caller expects — the ONE
 * English-first name derivation. BOTH resolution paths below go through it, so
 * they can never disagree about the name (and a caller reading `.name` never
 * falls back to rendering a bare uuid): an `EmployeeRow` carries `name_en` /
 * `name_mm`, NOT `name`, so handing one straight back would type as
 * `Cannot read 'name' of undefined` at the call site.
 */
function toCurrentEmployee(row: EmployeeRow | null): CurrentEmployee | null {
	if (!row) return null;
	return {
		id: row.id,
		name: row.name_en?.trim() || row.name_mm?.trim() || '',
		name_mm: row.name_mm ?? null,
		name_en: row.name_en ?? null,
		eid: row.eid ?? null,
		photo_url: row.photo_url ?? null,
	};
}

/* ── current-employee memo (per acting tg id, coalesced in-flight) ─────────
 * The tg→employee mapping is IDEMPOTENT per session, but the five MRO/record
 * modules used to resolve it with TWO entity reads (tg id → employee row) on
 * EVERY mount / confirm tap. The mapping is memoized here keyed BY THE TG ID
 * (an account switch has a different id, so it naturally misses instead of
 * stealing the previous user's row) and coalesced in-flight, so StrictMode /
 * HMR double-callers share ONE request. A `null` (no employee linked) is
 * cached for the tab's lifetime — linking is an admin action that needs a
 * reload to take effect anywhere else anyway. ─────────────────────────────── */
const employeeByIdentity = new Map<string, CurrentEmployee | null>();
const employeeInflight = new Map<string, Promise<CurrentEmployee | null>>();

/** The CURRENT logged-in user's employee row (null when the session has no
 *  linked `hrm_employees` row) — the ONE implementation every module uses.
 *
 * TWO resolution paths, in order of authority:
 *
 *   1. `/auth/me`'s OWN `employee_id` — the signed session's answer to exactly
 *      this question, so it needs no directory walk and cannot disagree with what
 *      the server will stamp as the actor. This is the path for BOTH a Telegram
 *      employee and a WEB one (`_users.employee_id`, bound at login and
 *      re-validated server-side on every request), and the one a plain-browser
 *      dev session (the documented `dev-token` admin, whose email is `dev`) has
 *      no alternative to — without it every actor-bearing write 400s on `The
 *      deciding employee is required`.
 *   2. the tg→`etg_id` lookup, for a Telegram session whose JWT carries no
 *      `employee_id` but whose `hrm_employees` row is linked by `etg_id`.
 *
 * Path 1 is tried first because it is authoritative and cheap; path 2 remains the
 * fallback it always was. THE AUTHORITY also has to be the order every READ uses:
 * a chain that started at the tg id left a WEB sign-in (which has no Telegram id
 * at all) permanently resolved as nobody — the `----` where the dashboard's name
 * belongs. `useActingEmployee` wraps this same function so no page can rebuild
 * the two hops in a different order. */
export function fetchCurrentEmployee(): Promise<CurrentEmployee | null> {
	// Resolve the tg id inside the memo body so StrictMode double-mounts that
	// reach here together share the whole lookup, not just the employee read.
	const run = async (): Promise<CurrentEmployee | null> => {
		// ── 1. The session's own employee id (authoritative, and the dev path). ──
		const me = await fetchMe().catch(() => null);
		const sessionEmployeeId = typeof me?.employee_id === 'string' && me.employee_id ? me.employee_id : null;
		if (sessionEmployeeId) {
			const key = `id:${sessionEmployeeId}`;
			const cached = employeeByIdentity.get(key);
			if (cached !== undefined) return cached;
			const pending = employeeInflight.get(key);
			if (pending) return pending;
			const lookup = fetchEmployeeById(sessionEmployeeId)
				.then((row) => {
					// Map through the SAME derivation path 2 uses — this path is the
					// AUTHORITATIVE one (the session's own id), so a raw row leaking out
					// here would leave every `.name` caller on the most common path.
					const value = toCurrentEmployee(row);
					employeeByIdentity.set(key, value);
					return value;
				})
				.finally(() => {
					employeeInflight.delete(key);
				});
			employeeInflight.set(key, lookup);
			return lookup;
		}

		// ── 2. Fall back to the tg → etg_id directory lookup. ──
		const tg = await fetchCurrentTgId();
		if (!tg) return null;
		const cached = employeeByIdentity.get(tg);
		if (cached !== undefined) return cached;
		const pending = employeeInflight.get(tg);
		if (pending) return pending;
		const lookup = (async () => {
			const row = await fetchEmployee(tg);
			return toCurrentEmployee(row);
		})()
			.then((value) => {
				employeeByIdentity.set(tg, value);
				return value;
			})
			.finally(() => {
				employeeInflight.delete(tg);
			});
		employeeInflight.set(tg, lookup);
		return lookup;
	};
	return run();
}

/**
 * The ရုံးတက် HOME summary — the punch rows + approved leaves the cards, the
 * history list and the utils consume. There is NO `GET /api/hr/attendance/summary`
 * any more (that domain route read a removed `hr_*` schema), so this is resolved
 * from the REAL `hrm_attendances` / `hrm_leaves` collections below.
 */
export interface AttendanceSummary {
	/**
	 * Synthetic punch rows: each `attendances` day row fans out into a check-in
	 * punch (always — `check_in` is required) and a check-out punch (only when
	 * `check_out` is present). Newest work day first so the cards/history pick
	 * each day's latest punch by first-match.
	 */
	attendance: AttendancePunch[];
	/**
	 * Approved leaves mapped onto the shape the history reads — the Leave badge
	 * overlaying the last few work days. EMPTY unless `withLeaves` was set: the
	 * leave read is the fallback history view's alone (see the fetcher's doc).
	 */
	leaves: HrRequest[];
}

/** A trimmed string, else null (the wire is `unknown`). */
function asString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null;
}

/** Fan raw `hrm_attendances` day rows into the synthetic punch pair the cards
 *  and the history list consume (newest-first input stays newest-first). Shared
 *  by the home summary and the team week read so BOTH derive punches the same
 *  way — one mapping, no drift. */
function toAttendancePunches(rows: readonly unknown[]): AttendancePunch[] {
	const attendance: AttendancePunch[] = [];
	for (const raw of rows) {
		if (!raw || typeof raw !== 'object') continue;
		const day = raw as { id?: unknown; check_in?: unknown; check_out?: unknown; shift?: unknown; geo_in?: unknown; geo_out?: unknown };
		// `shift.id` resolves the relation to just `{ shift: { id } }` — enough to
		// restore the check-out dialog's shift lock without the full row.
		const shiftRow = day.shift && typeof day.shift === 'object' ? (day.shift as { id?: unknown }) : null;
		const shiftId = shiftRow && typeof shiftRow.id === 'string' ? shiftRow.id : null;
		const id = typeof day.id === 'string' ? day.id : '';
		const geoIn = typeof day.geo_in === 'string' && day.geo_in ? day.geo_in : null;
		const geoOut = typeof day.geo_out === 'string' && day.geo_out ? day.geo_out : null;
		if (typeof day.check_in === 'string' && day.check_in) {
			attendance.push({ id, type: 'check-in', timestamp: day.check_in, shift_id: shiftId, location: geoIn });
		}
		if (typeof day.check_out === 'string' && day.check_out) {
			attendance.push({ id, type: 'check-out', timestamp: day.check_out, location: geoOut });
		}
	}
	return attendance;
}

/** Raw `hrm_leaves` rows → the approved-leave overlay the history list badges.
 *  Only the engine's `approved` lifecycle state counts. */
function toApprovedLeaves(rows: readonly unknown[]): HrRequest[] {
	const leaves: HrRequest[] = [];
	for (const raw of rows) {
		if (!raw || typeof raw !== 'object') continue;
		const l = raw as { id?: unknown; start_date?: unknown; end_date?: unknown; doc_status?: unknown };
		const docStatus = typeof l.doc_status === 'string' ? l.doc_status.toLowerCase() : '';
		if (docStatus !== 'approved') continue;
		if (typeof l.start_date !== 'string' || typeof l.end_date !== 'string') continue;
		leaves.push({
			id: typeof l.id === 'string' ? l.id : '',
			status: 'approved',
			from_date: l.start_date.slice(0, 10),
			to_date: l.end_date.slice(0, 10),
		});
	}
	return leaves;
}

/** One employee the team roster may show — the detail header's identity. */
export interface TeamEmployeeHit {
	id: string;
	nameEn: string | null;
	nameMm: string | null;
	eid: string | null;
	avatar: string | null;
	departmentName: string | null;
	designationName: string | null;
}

/** One roster row → the hit shape (null when it has no id). */
function teamEmployeeOf(value: unknown): TeamEmployeeHit | null {
	if (!value || typeof value !== 'object') return null;
	const row = value as Record<string, unknown>;
	const id = typeof row.id === 'string' ? row.id : '';
	if (!id) return null;
	return {
		id,
		nameEn: asString(row.name_en),
		nameMm: asString(row.name_mm),
		eid: asString(row.eid),
		avatar: asString(row.avatar),
		departmentName: asString(row.department_name),
		designationName: asString(row.designation_name),
	};
}

/**
 * The home dashboard's summary read. The acting employee's uuid is passed in
 * by the call site (the page already has it from its directory/shift fetches), so
 * this fetcher does NOT re-resolve identity via an extra `/auth/me` + employees
 * lookup — that was the redundant work this used to duplicate.
 *
 * The `hrm_leaves` read is OPT-IN (`withLeaves`): approved leaves paint ONE
 * thing — the Leave badge on the fallback history list — and the dashboard shows
 * that list only when the task feed is NOT (see `AttendancePage`). So the caller
 * that owns that decision passes whether it will actually read `leaves`; the
 * card view skips the collection entirely instead of downloading rows it drops.
 * (Whether to offer a "time-off now" signal ON the cards is a product call, not
 * a read to fire speculatively — when that ships, it belongs here as an explicit
 * flag rather than a standing round-trip.)
 *
 * Policy on errors/empties:
 *   - no matching employee (unregistered account)  → `{ attendance: [], leaves: [] }`
 *   - no attendance rows yet                        → `{ attendance: [], leaves: [] }`
 *   - the collections are absent (schema not ready) → `{ attendance: [], leaves: [] }`
 *   - anything else (genuine network/server outage) → rethrown, so the page's
 *     --:-- is never mistaken for a real outage (and an outage is never shown
 *     as an empty attendance).
 */
export async function fetchAttendanceSummary(
	_days = 2,
	empId: string | null,
	limit = 25,
	/** Whether the caller renders the approved leaves (the fallback history's Leave
	 *  badge). False skips the `hrm_leaves` read — see the doc above. */
	withLeaves = false,
): Promise<AttendanceSummary> {
	if (!empId) return { attendance: [], leaves: [] };

	// The history list only ever renders the RECENT rolled-up window (today's 4 AM
	// work date + the ~3 before it), so BOTH reads below are bounded to that window
	// BY DATE FILTERS — never the employee's ENTIRE punch + leave history (that was
	// the old behaviour: `limit 100` with no date bounds pulled every punch/leave
	// the engine would return). The 4 MMT-calendar-day lookback comfortably spans
	// the ≤4 work dates the list shows (work dates drift ≤1 calendar day around MMT
	// today, and a multi-day leave can straddle the window), so the window holds at
	// most a handful of rows per employee — one `hrm_attendances` row per work day
	// plus the overlapping approved leaves. `limit` (the app's default page size,
	// 25) is therefore just a safety cap; asking for 100 rows per read made every
	// response echo `meta.limit = 100` for ~3 rendered days of data. The component
	// still buckets/filters strictly by work date, so a few boundary stragglers
	// fetched here are dropped there — never the reverse.
	const LEAVE_LOOKBACK_DAYS = 4;
	const nowMs = Date.now();
	const today = toMmtDate(nowMs);
	const windowStart = toMmtDate(nowMs - LEAVE_LOOKBACK_DAYS * DAY_MS);
	// A punch's WORK date labels the instant shifted 4 h back (00:00–03:59 MMT
	// belongs to the previous work day). Cut the punches read at 00:00 MMT of
	// `windowStart` minus that 4-hour lead, so no punch of the earliest visible work
	// date is trimmed (stragglers the component buckets to an older, unshown date
	// are dropped harmlessly by its own work-date filter).
	const WORK_DAY_LEAD_MS = 4 * 3_600_000;
	const punchCutoff = new Date(Date.parse(`${windowStart}T00:00:00Z`) - MMT_OFFSET_MS - WORK_DAY_LEAD_MS).toISOString();

	try {
		// Both reads are independent — start them TOGETHER so the fallback history
		// pays ONE round-trip latency, not two. `withLeaves` is known up front, so a
		// caller that will not render the leaves never issues that read at all.
		const [attrsPage, leavesPage] = await Promise.all([
			ops.items('hrm_attendances').list({
				filter: { employee: { _eq: empId }, check_in: { _gte: punchCutoff } },
				// Only the shift's ID is needed (the check-out sheet locks to the
				// shift picked at check-in). `shift.id` pulls just that scalar instead
				// of the bare `shift` m2o, which would expand to the ENTIRE related
				// `shifts` row for every punch — a bloated relation read this page
				// never rendered (cards + history show times only).
				fields: ['id', 'check_in', 'check_out', 'shift.id', 'geo_in', 'geo_out'],
				// Newest work day first.
				sort: '-check_in',
				limit,
			}),
			withLeaves
				? ops.items('hrm_leaves').list({
						filter: { employee: { _eq: empId }, start_date: { _lte: today }, end_date: { _gte: windowStart } },
						fields: ['id', 'start_date', 'end_date', 'doc_status'],
						limit,
					})
				: Promise.resolve(null),
		]);

		// Both raw reads go through the SAME mappers the Team Tracking week read
		// uses, so a punch/leave is derived identically on either surface.
		return {
			attendance: toAttendancePunches(attrsPage.data),
			leaves: toApprovedLeaves(leavesPage?.data ?? []),
		};
	} catch (error) {
		// Collections absent (schema not yet provisioned) → degrade to empty. Any
		// genuine outage still surfaces (see the policy doc above).
		if (isMissingHrModule(error)) return { attendance: [], leaves: [] };
		throw error;
	}
}

/* ── Team Tracking (server-scoped attendance reads) ──────────────────────
 * A supervisor views the attendance of their direct reports through the TWO
 * server-scoped routes (`/api/hr/attendances/team` + `/attendances/employee/:id`).
 * The generic `hrm_attendances` read is SELF-only (a role row filter), so these
 * routes are the ONLY way to see a colleague's punches — and the server, not
 * this client, decides who may be viewed. Nothing here supplies an identity or
 * a scope. */

/** The Team Tracking roster — the signed session's direct reports (an admin:
 *  every employee), name-sorted. Loaded whole, straight away, so the Team view
 *  opens on a list rather than a search box; the session's own row is not
 *  included (the personal view covers self). Scope is resolved server-side. */
export async function fetchTeamRoster(): Promise<TeamEmployeeHit[]> {
	const data = await sdk.request<{ rows?: unknown[] }>('/hr/attendances/team');
	return (data?.rows ?? []).map(teamEmployeeOf).filter((hit): hit is TeamEmployeeHit => hit !== null);
}

/** One employee's identity + their attendance/leaves over the last `days` MMT
 *  days — the Team Tracking detail read. The window is bounded server-side; the
 *  client buckets the returned rows into work days (same as the home history). */
export interface TeamEmployeeAttendance {
	employee: TeamEmployeeHit;
	attendance: AttendancePunch[];
	leaves: HrRequest[];
}

export const TEAM_WEEK_DAYS = 7;

export async function fetchEmployeeAttendanceWeek(employeeId: string, days = TEAM_WEEK_DAYS): Promise<TeamEmployeeAttendance> {
	const qs = new URLSearchParams();
	qs.set('days', String(days));
	const data = await sdk.request<{ employee?: unknown; attendance?: unknown[]; leaves?: unknown[] }>(
		`/hr/attendances/employee/${encodeURIComponent(employeeId)}`,
		{ query: qs },
	);
	const employee = teamEmployeeOf(data?.employee);
	if (!employee) throw new Error('Employee not found');
	return {
		employee,
		attendance: toAttendancePunches(data?.attendance ?? []),
		leaves: toApprovedLeaves(data?.leaves ?? []),
	};
}

/* ═══════════════════════════════════════════════════════════════════════╗
 * NATIVE REQUEST/APPROVAL DATA LAYER
 * Requests now live in the REAL per-type collections `leaves` / `overtimes` /
 * `early_leaves` (tables `cms_*`), each row carrying its applicant as an m2o
 * `employee` -> employees uuid (NOT the legacy denormalized `hr_requests`
 * shape). `employee_links` is the sole reporting graph the approval center
 * routes through: I may approve the pending requests of employees who report
 * to me (subordinate edge), and an Administrator approves everything.
 * ═══════════════════════════════════════════════════════════════════════╝ */

/** Request type -> its native collection slug. */
const REQUEST_COLLECTION: Partial<Record<HrRequestType, 'hrm_leaves' | 'hrm_overtimes' | 'hrm_early_leaves'>> = {
	leave: 'hrm_leaves',
	ot: 'hrm_overtimes',
	early: 'hrm_early_leaves',
};

/** Native leaf enum `half_day` sessions map to the display 'morning'/'evening'. */
const SESSION_TO_Hr: Record<string, 'morning' | 'evening'> = { morning: 'morning', afternoon: 'evening' };

/* The expanded applicant (`employee` m2o) when the engine returns a full row. */
function expandedEmployee(
	ref: unknown,
): { id?: string; nameEn?: string; nameMm?: string; eid?: string; etg?: string; avatar?: string } | null {
	if (typeof ref === 'string') return ref ? { id: ref } : null;
	if (ref && typeof ref === 'object') {
		const row = ref as { id?: unknown; name_en?: unknown; name_mm?: unknown; eid?: unknown; etg_id?: unknown; avatar?: unknown };
		const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
		return {
			id: str(row.id),
			nameEn: str(row.name_en),
			nameMm: str(row.name_mm),
			eid: str(row.eid),
			etg: str(row.etg_id),
			avatar: str(row.avatar),
		};
	}
	return null;
}

/** The applicant uuid of a native row (`employee` m2o => employees.id). */
function rowEmployeeId(row: NativeRequestBase): string | null {
	return expandedEmployee(row.employee)?.id ?? null;
}

/** Native system `doc_status` → the UI status (null/empty/draft/submitted/
 *  pending_review all read as `pending` — the review queue the list + approval
 *  center show). The engine never leaves a row in `draft` past submit, but the
 *  fallback keeps reads of pre-submit rows honest instead of dropping them. */
function nativeStatus(docStatus: string | null | undefined): HrRequestStatus {
	const s = String(docStatus ?? '').toLowerCase();
	return s === 'approved' || s === 'rejected' || s === 'cancelled' ? (s as HrRequestStatus) : 'pending';
}

/** `approved`/`rejected` native statuses carry the review note in `superior_comment`. */
function rejectReasonOf(status: HrRequestStatus, superiorComment: string | null | undefined): string | undefined {
	return status === 'rejected' && superiorComment && superiorComment.trim() !== '' ? superiorComment : undefined;
}

/* ── native → store HrRequest (presentation) ─────────────────────────── */
/** Map a native `leaves` row onto the UI store shape the cards/shell read. */
function toLeaveRow(row: RequestLeaveRow): HrRequest {
	const applicant = expandedEmployee(row.employee)?.id ? expandedEmployee(row.employee) : null;
	const status = nativeStatus(row.doc_status);
	const from = row.start_date ?? null;
	const to = row.end_date ?? null;
	const dur = row.leave_duration_type ?? null;
	const single = from != null && to != null && to === from;
	// Recompute the legacy single-day leave_type the cards/forms understand.
	let leave_type: string | undefined;
	if (single) {
		if (dur === 'half_day') {
			const session = row.half_day_session ?? null;
			leave_type = session === 'afternoon' ? 'half_day_afternoon' : session === 'morning' ? 'half_day_morning' : 'half_day';
		} else {
			leave_type = 'full_day';
		}
	}
	const startPeriod = single ? undefined : (SESSION_TO_Hr[row.start_day_session ?? ''] ?? (row.start_day_session ? 'morning' : undefined));
	const endPeriod = single ? undefined : (SESSION_TO_Hr[row.end_day_session ?? ''] ?? (row.end_day_session ? 'evening' : undefined));
	const reliever = expandedEmployee(row.reliever_to);
	return {
		id: row.id,
		request_type: 'leave',
		status,
		employee_name: applicant?.nameMm ?? applicant?.nameEn ?? null,
		employee_eid: applicant?.eid ?? null,
		employee_tg_id: applicant?.etg ?? null,
		applicant_avatar: applicant?.avatar ?? null,
		reliever_name: reliever?.nameMm ?? reliever?.nameEn ?? null,
		reliever_id: reliever?.id ?? null,
		reason: row.reason ?? null,
		from_date: from,
		to_date: to,
		leave_type,
		days_count: typeof row.total_days === 'number' ? row.total_days : undefined,
		start_period: startPeriod ?? null,
		end_period: endPeriod ?? null,
		superior_comment: row.superior_comment ?? null,
		reject_reason: rejectReasonOf(status, row.superior_comment),
		created_at: row.created_at ?? null,
		updated_at: row.updated_at ?? null,
	};
}

/** Map a native `overtimes` row onto the store shape. */
function toOvertimeRow(row: RequestOvertimeRow): HrRequest {
	const applicant = expandedEmployee(row.employee)?.id ? expandedEmployee(row.employee) : null;
	const status = nativeStatus(row.doc_status);
	// Native `type` => the legacy ot_type the create form displays.
	const otTypeMap: Record<string, HrRequest['ot_type']> = {
		normal: 'weekday',
		sunday: 'weekend',
		holiday: 'holiday',
		thingyan: 'thingyan',
	};
	const ot_type = row.type ? (otTypeMap[row.type] ?? (row.type as HrRequest['ot_type'])) : undefined;
	const totalHours = typeof row.total_hours === 'number' ? row.total_hours : undefined;
	return {
		id: row.id,
		request_type: 'ot',
		status,
		employee_name: applicant?.nameMm ?? applicant?.nameEn ?? null,
		employee_eid: applicant?.eid ?? null,
		employee_tg_id: applicant?.etg ?? null,
		applicant_avatar: applicant?.avatar ?? null,
		reason: row.reason ?? null,
		ot_date: row.date ?? null,
		start_time: row.start_time ?? null,
		end_time: row.end_time ?? null,
		ot_type,
		hours_count: totalHours,
		total_hours: totalHours,
		superior_comment: row.superior_comment ?? null,
		reject_reason: rejectReasonOf(status, row.superior_comment),
		created_at: row.created_at ?? null,
		updated_at: row.updated_at ?? null,
	};
}

/** Map a native `early_leaves` row onto the store shape (split date_time). */
function toEarlyLeaveRow(row: RequestEarlyLeaveRow): HrRequest {
	const applicant = expandedEmployee(row.employee)?.id ? expandedEmployee(row.employee) : null;
	const status = nativeStatus(row.doc_status);
	const dateTime = row.date_time ?? '';
	const earlyDate = dateTime.slice(0, 10) || null;
	const leaveTime = dateTime.length >= 16 ? dateTime.slice(11, 16) : null;
	return {
		id: row.id,
		request_type: 'early',
		status,
		employee_name: applicant?.nameMm ?? applicant?.nameEn ?? null,
		employee_eid: applicant?.eid ?? null,
		employee_tg_id: applicant?.etg ?? null,
		applicant_avatar: applicant?.avatar ?? null,
		reason: row.reason ?? null,
		early_date: earlyDate,
		leave_time: leaveTime,
		superior_comment: row.superior_comment ?? null,
		reject_reason: rejectReasonOf(status, row.superior_comment),
		created_at: row.created_at ?? null,
		updated_at: row.updated_at ?? null,
	};
}

/** Long-format a native row of any supported type into the store shape. */
function toRequest(row: unknown, type: HrRequestType): HrRequest | null {
	if (type === 'leave') return toLeaveRow(row as RequestLeaveRow);
	if (type === 'ot') return toOvertimeRow(row as RequestOvertimeRow);
	if (type === 'early') return toEarlyLeaveRow(row as RequestEarlyLeaveRow);
	return null;
}

/** Common write fields to request when reading native rows (m2o `employee` expands).
 *  The lifecycle column is the system `doc_status` — the custom `status` select
 *  was removed from these collections. */
function requestFields(type: HrRequestType): string[] {
	const base = ['id', 'doc_status', 'employee', 'reason', 'superior_comment', 'created_at', 'updated_at'];
	if (type === 'leave')
		return [
			...base,
			'start_date',
			'end_date',
			'leave_duration_type',
			'half_day_session',
			'start_day_session',
			'end_day_session',
			'reliever_to',
			'total_days',
		];
	if (type === 'ot') return [...base, 'date', 'start_time', 'end_time', 'type', 'total_hours'];
	if (type === 'early') return [...base, 'date_time', 'location'];
	return base;
}

/** Translate a `hr` ot_type into the native `overtimes.type` enum. */
function nativeOtType(legacy: 'weekday' | 'weekend' | 'holiday' | 'thingyan' | undefined): string | undefined {
	if (!legacy) return undefined;
	if (legacy === 'weekday') return 'normal';
	if (legacy === 'weekend') return 'sunday';
	return legacy; // holiday | thingyan already match the native enum
}

/** Whether a leave input is a multi-day range. */
function isRangeLeave(input: CreateRequestInput): boolean {
	return Boolean(input.from_date && input.to_date && input.to_date !== input.from_date);
}

/** Native `leaves` write payload (create). */
async function nativeLeavePayload(empId: string, input: CreateRequestInput): Promise<Record<string, unknown>> {
	const from = input.from_date ?? '';
	const to = input.to_date ?? from;
	// Encode the chosen leave type into the native enum + sessions.
	let leave_duration_type = 'full_day';
	let half_day_session: 'morning' | 'afternoon' | undefined;
	const lt = input.leave_type ?? input.disposition;
	if (isRangeLeave(input)) {
		leave_duration_type = 'multi_day';
	} else if (lt === 'half_day_morning' || lt === 'half_day' || input.disposition === 'half_day') {
		leave_duration_type = 'half_day';
		half_day_session = lt === 'half_day_afternoon' ? 'afternoon' : 'morning';
	}
	const start_session = input.start_period === 'evening' ? 'afternoon' : 'morning';
	const end_session = input.end_period === 'morning' ? 'morning' : 'afternoon';
	const payload: Record<string, unknown> = {
		employee: empId,
		start_date: from,
		end_date: to,
		leave_duration_type,
		reason: input.reason ?? undefined,
	};
	if (leave_duration_type === 'multi_day') {
		payload.start_day_session = start_session;
		payload.end_day_session = end_session;
	} else if (half_day_session) {
		payload.half_day_session = half_day_session;
	}
	// The reliever link is the uuid captured when the picker row was tapped
	// (`reliever_id`) — never a name→id lookup here (that would re-walk the whole
	// `hrm_employees` directory on every submit).
	if (input.reliever_id) payload.reliever_to = input.reliever_id;
	return payload;
}

/** Native `overtimes` write payload (create). */
function nativeOvertimePayload(empId: string, input: CreateRequestInput): Record<string, unknown> {
	return {
		employee: empId,
		date: input.ot_date ?? undefined,
		start_time: input.start_time ?? undefined,
		end_time: input.end_time ?? undefined,
		type: nativeOtType(input.ot_type),
		reason: input.reason ?? undefined,
	};
}

/** Native `early_leaves` write payload (create). */
function nativeEarlyPayload(empId: string, input: CreateRequestInput): Record<string, unknown> {
	const time = input.leave_time && input.leave_time.trim() !== '' ? input.leave_time.trim() : '16:00';
	const date = input.early_date && input.early_date.trim() !== '' ? input.early_date.trim().slice(0, 10) : '';
	return {
		employee: empId,
		date_time: date && time ? `${date}T${time}` : undefined,
		location: input.location ?? '',
		reason: input.reason ?? undefined,
	};
}

/* ── server-scoped request feed ────────────────────────────────────────
 * Every request/approval read goes through ONE server endpoint
 * (`GET /api/hr/requests`) whose scope is resolved from the SIGNED session and
 * the reporting graph — never from a client-supplied identity. `own` = my
 * requests; `approve` = requests of my recorded direct subordinates (admins:
 * everything). The endpoint returns raw engine rows tagged `_kind`, which the
 * row mappers above turn into the same `HrRequest` card shape as before. */

/** Read the server-scoped HR request feed and map its rows to the store shape.
 *  `type` may be one kind or `all`; `statusFilter`/`searchFor` narrow further. */
async function readFeed(
	scope: 'own' | 'approve',
	type: HrRequestType | 'all',
	statusFilter?: HrRequestStatus | 'all',
	searchFor?: string,
): Promise<HrRequest[]> {
	const qs = new URLSearchParams();
	qs.set('type', type);
	qs.set('scope', scope);
	if (statusFilter && statusFilter !== 'all') qs.set('status', statusFilter);
	if (searchFor && searchFor.trim()) qs.set('search', searchFor.trim());
	qs.set('limit', String(SEARCH_LIMIT));
	const data = await sdk.request<{ rows?: unknown[] }>('/hr/requests', { query: qs });
	const rows = data?.rows ?? [];
	const mapped: HrRequest[] = [];
	for (const row of rows) {
		const kind = ((row as Record<string, unknown>)._kind as HrRequestType | undefined) ?? (type === 'all' ? undefined : type);
		if (!kind) continue;
		const request = toRequest(row, kind);
		if (request) mapped.push(request);
	}
	mapped.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
	return mapped;
}

/* ── single-page list readers (small per-employee volumes; no server paging) ─ */
/** Read ONE native request row by id and map it to the store shape. */
async function readOneNativeRow(type: HrRequestType, id: string): Promise<HrRequest | null> {
	const coll = REQUEST_COLLECTION[type];
	if (!coll) return null;
	const res = await ops.items(coll).list({ filter: { id: { _eq: id } }, fields: requestFields(type), limit: 1 });
	const row = res.data[0];
	return row ? toRequest(row, type) : null;
}

/** A single request row — the edit page's read. Router state covers the card tap; this covers deep links / refreshes. */
export async function fetchRequest(id: string): Promise<HrRequest | null> {
	for (const type of ['leave', 'ot', 'early'] as HrRequestType[]) {
		const found = await readOneNativeRow(type, id);
		if (found) return found;
	}
	return null;
}

/** The current user's requests — one type, or all types (`all` = တောင်းခံချက်).
 *  Server-scoped to the SESSION employee (`scope=own`), one round trip. */
export async function fetchRequestsPage(
	_tgId: string,
	requestType: HrRequestType | 'all',
	_cursor?: string,
): Promise<CursorPage<HrRequest>> {
	const rows = await readFeed('own', requestType);
	return { rows, nextCursor: null, hasMore: false };
}

/**
 * The requests I may approve of ONE type for the ACTIVE status chip (the
 * အတည်ပြုချက် approval center). Scoped SERVER-side by the reporting graph
 * (`scope=approve`: my direct subordinates — everything for an admin) and by the
 * chip's `doc_status`, so the payload always matches exactly what the chip
 * renders (the decide queue never carries already-decided or withdrawn rows).
 */
export async function fetchApprovalRequestsPage(
	_tgId: string,
	type: HrRequestType,
	status: HrRequestStatus,
	_cursor?: string,
): Promise<CursorPage<HrRequest>> {
	const rows = await readFeed('approve', type, status);
	return { rows, nextCursor: null, hasMore: false };
}

/** Everything a new request needs — type-specific date/time fields + reason. */
export interface CreateRequestInput {
	request_type: HrRequestType;
	/** The applicant — the `hrm_employees` uuid the session acts as. Preferred over
	 *  `employee_tg_id` when both are present: it is what `/auth/me` names, so it
	 *  needs no directory walk and works for a WEB sign-in (which has no tg id). */
	employee_id?: string;
	/** Legacy Telegram-id form of the applicant — still accepted so an older client
	 *  keeps filing; resolved to the uuid through the `etg_id` directory link. */
	employee_tg_id?: string;
	employee_name?: string;
	employee_eid?: string;
	reason?: string;
	from_date?: string;
	to_date?: string;
	/** ခွင့် type — `full_day` | `half_day_morning` | `half_day_afternoon` (verified enum). */
	leave_type?: string;
	/** ခွင့် disposition — `half_day` | `full_day` (verified enum). */
	disposition?: string;
	/** Computed leave days — 1 for a full single day, 0.5 for a half day. */
	days_count?: number;
	/** Range leave only — the first day's work window (မနက် → ညနေ). */
	start_period?: 'morning' | 'evening';
	/** Range leave only — the last day's work window (မနက် → ညနေ). */
	end_period?: 'morning' | 'evening';
	/** တာဝန်လွှဲအပ်မည့်သူ — the colleague handed over to during the leave. */
	reliever_name?: string;
	/** The chosen reliever's `hrm_employees` uuid — captured when the picker row is
	 *  tapped (or from the edited row's `reliever_to`) and sent straight to the
	 *  native m2o, so submitting never needs a name→id directory walk. */
	reliever_id?: string;
	early_date?: string;
	leave_time?: string;
	ot_date?: string;
	start_time?: string;
	end_time?: string;
	/** အချိန်ပို type — VERIFIED enum: `weekday | weekend | holiday | thingyan`. */
	ot_type?: 'weekday' | 'weekend' | 'holiday' | 'thingyan';
	/** Computed OT span — stored on both `hours_count` and `total_hours`. */
	hours_count?: number;
	total_hours?: number;
	/** The reporter-request location — persisted on `early_leaves.location`. */
	location?: string;
}

/** Build the native write payload for a create on the caller's type. */
function toNativeCreate(
	type: HrRequestType,
	empId: string,
	input: CreateRequestInput,
): Promise<Record<string, unknown>> | Record<string, unknown> {
	if (type === 'leave') return nativeLeavePayload(empId, input);
	if (type === 'ot') return nativeOvertimePayload(empId, input);
	if (type === 'early') return nativeEarlyPayload(empId, input);
	throw new Error('Unsupported request type for native create');
}

/** Create + submit a request (engine `doc_status`: draft → pending_review) —
 *  replay-safe via the SDK client. */
export async function createRequest(input: CreateRequestInput): Promise<HrRequest> {
	const type = input.request_type;
	const coll = REQUEST_COLLECTION[type];
	// The applicant — the acting employee's uuid. The session's own id short-circuits
	// the directory walk (`/auth/me.employee_id`, the SAME answer the server stamps as
	// the actor); the tg-id form remains the fallback for an older client.
	const applicantId = input.employee_id ?? (input.employee_tg_id ? await findEmployeeIdByEtg(input.employee_tg_id) : null);
	if (!coll) throw new Error('Unsupported request type for create');
	if (!applicantId) throw new Error('Employee record not found — this account is not registered as an employee.');
	const native = await toNativeCreate(type, applicantId, input);
	const created = await ops.items(coll).create({ ...native });
	// The engine always materializes a new row with `doc_status = 'draft'`, so the
	// submit-to-review step is a second write: draft → pending_review. (The old
	// custom `status: 'pending'` collapsed create + submit into one payload; the
	// engine's doc_status lifecycle does not allow that.) If that submit write
	// fails, the row is retired as `cancelled` so a stranded `draft` can never
	// masquerade as a pending request in the review queue.
	try {
		await ops.items(coll).update(created.id, { doc_status: 'pending_review' } as never);
	} catch (submitError) {
		// Compensate: retire the stranded row so it can never masquerade as a live
		// request. One retry — the cancel is a plain doc_status write and the common
		// failure is a transient blip; if it still fails the ORIGINAL submit error is
		// what surfaces (the row stays a harmless draft, never shown in the queue).
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				await ops.items(coll).update(created.id, { doc_status: 'cancelled' } as never);
				break;
			} catch {
				// swallowed — the submit error below is authoritative
			}
		}
		throw submitError;
	}
	const row = created as unknown as NativeRequestBase;
	return {
		id: created.id,
		request_type: type,
		status: 'pending',
		employee_name: input.employee_name ?? null,
		employee_eid: input.employee_eid ?? null,
		employee_tg_id: input.employee_tg_id ?? null,
		reason: input.reason ?? null,
		created_at: row.created_at ?? null,
		updated_at: row.updated_at ?? null,
	};
}

/**
 * Update a PENDING request's fillable fields (the `/:id/edit` page). Keeps the
 * row in the review queue (doc_status stays `pending_review`) — only the
 * date/time/reason fields change. Optimistic concurrency on `updated_at`: a 409
 * surfaces when the row moved meanwhile. `previous` is the store row being
 * edited — its immutable display fields (applicant name/avatar, created_at)
 * survive the write without a follow-up re-read.
 */
export async function updateRequest(
	id: string,
	input: Partial<CreateRequestInput>,
	ifMatch?: string | null,
	previous?: HrRequest | null,
): Promise<HrRequest> {
	const type = input.request_type ?? ((await typeOfRequestId(id)) as HrRequestType | null) ?? 'leave';
	const coll = REQUEST_COLLECTION[type];
	if (!coll) throw new Error('Unsupported request type for update');
	// Editing applies to OWN pending rows — the acting employee's uuid resolves the
	// applicant (session id first, then the etg link), falling back to the row's
	// stored `employee`.
	let empId = input.employee_id ?? (input.employee_tg_id ? await findEmployeeIdByEtg(input.employee_tg_id) : null);
	if (!empId) {
		const cur = await ops.items(coll).list({ filter: { id: { _eq: id } }, fields: ['employee'], limit: 1 });
		empId = rowEmployeeId(cur.data[0] as NativeRequestBase) ?? null;
	}
	if (!empId) throw new Error('Employee record not found.');
	// Rebuild the full native content from the edited form (fields the engine only
	// merges are fine — the editable rows are always `pending` and self-owned).
	const content = await toNativeCreate(type, empId, input as CreateRequestInput);
	// The PUT response carries the full row but m2o FKs (applicant / reliever)
	// arrive as bare uuids — no expansions. Map it and overlay the display fields
	// from `input`/`previous` INSTEAD of re-reading the row: an own-pending edit
	// never changes the applicant or status, and the edited fields are already in
	// `saved`/`input`, so the follow-up read would only cost a request.
	const saved = (await ops.items(coll).update(id, content, { ifMatch: ifMatch ?? undefined })) as unknown as Record<string, unknown>;
	const mapped = toRequest({ id, ...saved }, type);
	if (!mapped) return { id, request_type: type } as HrRequest;
	return {
		...mapped,
		employee_name: input.employee_name ?? previous?.employee_name ?? mapped.employee_name,
		employee_eid: input.employee_eid ?? previous?.employee_eid ?? mapped.employee_eid,
		employee_tg_id: input.employee_tg_id ?? previous?.employee_tg_id ?? mapped.employee_tg_id,
		applicant_avatar: previous?.applicant_avatar ?? mapped.applicant_avatar,
		reliever_name: input.reliever_name ?? previous?.reliever_name ?? mapped.reliever_name,
		reliever_id: input.reliever_id ?? previous?.reliever_id ?? mapped.reliever_id,
	};
}

/** Which native request collection owns `id` (a uuid may live in any one). */
async function typeOfRequestId(id: string): Promise<HrRequestType | null> {
	for (const type of ['leave', 'ot', 'early'] as HrRequestType[]) {
		const coll = REQUEST_COLLECTION[type];
		if (!coll) continue;
		const res = await ops.items(coll).list({ filter: { id: { _eq: id } }, fields: ['id'], limit: 1 });
		if (res.data.length > 0) return type;
	}
	return null;
}

/**
 * Decide a request — approve / reject / cancel — through the server's sanctioned
 * endpoint. The reporting-line authorisation (a recorded superior, or an admin)
 * is enforced ON THE WORKER, so the client can never name itself an approver.
 * Optimistic concurrency: a stale `updated_at` yields a 409 that surfaces here.
 */
export async function updateRequestStatus(
	type: HrRequestType,
	id: string,
	status: HrRequestStatus,
	ifMatch?: string | null,
	rejectReason?: string,
): Promise<HrRequest> {
	if (status === 'pending') throw new Error('pending is not a decision — approve, reject or cancel a request');
	const body: { action: string; reason?: string; expectUpdatedAt?: string | null } = { action: status };
	if (status === 'rejected' && rejectReason && rejectReason.trim() !== '') body.reason = rejectReason.trim();
	if (ifMatch) body.expectUpdatedAt = ifMatch;
	const res = await sdk.request<{
		id: string;
		request_type: HrRequestType;
		status: HrRequestStatus;
		superior_comment?: string | null;
		updated_at?: string | null;
	}>(`/hr/requests/${type}/${id}/decide`, { method: 'POST', body });
	const comment = res?.superior_comment ?? null;
	return {
		id,
		request_type: type,
		status,
		superior_comment: comment,
		reject_reason: rejectReasonOf(status, comment),
		updated_at: res?.updated_at ?? null,
	} as HrRequest;
}

/**
 * The toolbar search over the user's OWN requests — a server-side `?search=` read
 * SCOPED to the current user + the page's type (`scope=own`), so the results
 * render the SAME card as the list (an unscoped read used to surface OT/Early
 * rows on the Leave page under a different card variant). `'all'` spans every
 * type.
 */
export async function fetchRequestsSearch(_tgId: string, requestType: HrRequestType | 'all', query: string): Promise<HrRequest[]> {
	const search = query.trim();
	if (!search) return [];
	return readFeed('own', requestType, undefined, search);
}

/**
 * The toolbar search over the requests the user must APPROVE — the same
 * server-scoped reporting-line routing as the approval center's list.
 */
export async function fetchApprovalRequestsSearch(_tgId: string, type: HrRequestType, query: string): Promise<HrRequest[]> {
	const search = query.trim();
	if (!search) return [];
	return readFeed('approve', type, undefined, search);
}
/** Coordinates + optional shift sent with a punch. */
export interface PunchInput {
	lat: number;
	lng: number;
	accuracy: number;
	/** Selected shift from the punch dialog's shift card (default = first shift). */
	shiftId?: string;
}

/**
 * Check-in — the server stamps the time (`POST /api/hr/attendances/punch`), so a
 * client can never backdate a punch; only the GPS coordinates ride in from the
 * device. The row is a new `attendances` day row (`employee` + `check_in` +
 * `shift`); `etg_id`/`eid`/`in_status`/`out_status` are server-computed formulas.
 *
 * A punch needs a shift (`attendances.shift` is REQUIRED): this throws a clear
 * error rather than sending a broken row. Keyed retries are idempotent.
 */
export async function checkIn(input: PunchInput): Promise<AttendancePunch> {
	const shiftId = input.shiftId ?? null;
	if (!shiftId) throw new Error('Check-in failed — no shift selected.');
	const res = await sdk.request<{ id: string; type: string; timestamp?: string | null; shift_id?: string | null }>(
		'/hr/attendances/punch',
		{ method: 'POST', body: { kind: 'in', shiftId, lat: input.lat, lng: input.lng } },
	);
	return { id: res.id, type: 'check-in', timestamp: res.timestamp ?? null, shift_id: res.shift_id ?? shiftId };
}

/**
 * Check-out — closes TODAY's day row on the server (the one stamped at check-in):
 * `check_out` + `geo_out` are set on the employee's open row, with the time
 * stamped server-side. It never creates a second row.
 */
export async function checkOut(input: PunchInput): Promise<AttendancePunch> {
	const res = await sdk.request<{ id: string; type: string; timestamp?: string | null }>('/hr/attendances/punch', {
		method: 'POST',
		body: { kind: 'out', lat: input.lat, lng: input.lng },
	});
	return { id: res.id, type: 'check-out', timestamp: res.timestamp ?? null };
}

/**
 * Fold a just-recorded punch into EVERY cached attendance summary — the punch
 * response IS the server's own answer (row id + stamped TIMESTAMP), so the
 * Check In / Check Out cards can paint the time the instant the dialog closes
 * instead of one summarizing-refetch round trip later (the "pressed punch but
 * the board keeps reading `--:--`" lag). The refetch behind it (the page's
 * invalidate below) stays the source of truth — ordering, id and the leaves in
 * the deep variant come from the server as always; the folded row just costs
 * the cards no latency.
 *
 * Matches by prefix against `qk.attendanceSummaryAll()`, so BOTH summary
 * variants (the task-feed's shallow read and the fallback history's
 * `withLeaves` read) fold — never one stale serving of "--:--".
 */
export function foldPunchIntoSummary(
	queryClient: QueryClient,
	punch: { id: string; type: 'check-in' | 'check-out'; timestamp: string | null; shift_id?: string | null },
): void {
	const updater = (entry: AttendanceSummary | undefined): AttendanceSummary | undefined => {
		if (!entry || !punch.timestamp) return entry;
		// The punch's server response already carries the exact shape the cards
		// read — replace any old copy of the row and append it newest-first.
		const withoutStale = entry.attendance.filter((row) => !(row.id === punch.id && row.type === punch.type));
		const folded: AttendancePunch = {
			id: punch.id,
			type: punch.type,
			timestamp: punch.timestamp,
			shift_id: punch.shift_id ?? null,
		};
		return { ...entry, attendance: [folded, ...withoutStale] };
	};
	queryClient.setQueriesData<AttendanceSummary>({ queryKey: ['hr', 'attendance', 'summary'] }, updater);
}

/** Employee shift assignments for the current user — drives the ShiftsCard. */
export interface EmployeeShift {
	id: string;
	shift_id?: string | null;
	shift_name?: string | null;
	start_time?: string | null;
	end_time?: string | null;
	location_name?: string | null;
	lat?: number | null;
	lng?: number | null;
	radius?: number | null;
}

/** `"09:00"` + 480 → `"17:00"` — add minutes to an `HH:MM` time (24-hour wrap for overnight shifts). */
function addMinutes(hhmm: string, minutes: number): string {
	const [hRaw, mRaw] = hhmm.split(':').map(Number);
	const total = (hRaw * 60 + (mRaw ?? 0) + minutes) % (24 * 60);
	const h = Math.floor(total / 60);
	const m = total % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Fetch the current user's shift assignments from the REAL module: the
 * `employees.shifts` m2m junction (same `cms_` link the admin edit form writes),
 * found by the acting employee's `hrm_employees` ID.
 *
 * Keyed on the employee id — NOT the Telegram id: the id is what the session
 * names (`/auth/me.employee_id`, resolving the same way for a web and a Telegram
 * sign-in), so a WEB session's punch sheet offers the same shifts a Telegram one
 * does. Filtering by `etg_id` left that sheet empty for every web sign-in.
 *
 * The dotted expansion returns an ARRAY of the related `shifts` rows — `name` /
 * `time_in` / `working_hours` are the columns that exist. End time = `time_in` +
 * `working_hours`.
 *
 * `employees.shifts` has NO geofence columns (no location / lat / lng / radius),
 * so they stay unset — the punch dialog's map marker + radius chip simply don't
 * render, and the punch proceeds on location-free grounds.
 */
export async function fetchEmployeeShifts(employeeId: string): Promise<EmployeeShift[]> {
	try {
		const res = await ops.items('hrm_employees').list({
			filter: { id: { _eq: employeeId } },
			fields: ['shifts.id', 'shifts.name', 'shifts.time_in', 'shifts.working_hours'],
			limit: 1,
		});
		const row = res.data[0];
		const raw = Array.isArray(row?.shifts) ? (row.shifts as Array<Record<string, unknown>>) : [];
		return raw.map((s) => {
			// The m2m expansion returns the shift ROW itself — its id IS the shift id.
			const id = typeof s.id === 'string' && s.id ? s.id : '';
			const timeIn = typeof s.time_in === 'string' && s.time_in ? s.time_in.slice(0, 5) : null;
			const workingHours = typeof s.working_hours === 'number' ? s.working_hours : null;
			return {
				id,
				shift_id: id || null,
				shift_name: typeof s.name === 'string' && s.name ? s.name : null,
				start_time: timeIn,
				end_time: timeIn && workingHours != null ? addMinutes(timeIn, Math.round(workingHours * 60)) : null,
			};
		});
	} catch (error) {
		// No employee row / collection absent → no shift assignments (the dialog
		// falls back to a shift-less punch). A genuine outage must still surface.
		if (isMissingHrModule(error)) return [];
		throw error;
	}
}
