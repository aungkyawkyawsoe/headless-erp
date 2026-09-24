import { STALE_MS } from '@/shared/api/invalidation';
import { MASTER_STALE_MS } from '@/shared/constants';
import type { HrRequestStatus, HrRequestType } from './types';

/** Work days of punch history the fallback list renders (today + this many before). */
export const HISTORY_DAYS = 2;

/** The attendance-summary read window — the history span plus margin so the
 *  server's midnight-based window always covers the 4 AM work-day boundary.
 *  Shared by the page AND the launcher's dashboard prefetch so both build the
 *  exact same query key (a mismatch would silently defeat the prefetch). */
export const SUMMARY_DAYS = HISTORY_DAYS + 2;

/**
 * TanStack Query key factory — the single source of truth for the attendance
 * module's cache identity. Reads keyed under `['hr', ...]` share ONE cache
 * across pages, so navigating away and back never refetches within the
 * staleTime (60 s module tier below, 5 min for identity reads).
 *
 * Invalidate by PREFIX: `qk.requestsAll()` (`['hr','requests']`) refreshes
 * every request list in one call; `qk.approvalsAll()` (`['hr','approvals']`)
 * refreshes the approval center list in one call.
 */

/** Identity reads (tg_id + employee row) change rarely — the shared master
 *  tier (`MASTER_STALE_MS`, single source in shared/constants). */
export const IDENTITY_STALE_MS = MASTER_STALE_MS;

/** Attendance summary + shift reads — punches invalidate them write-through on
 *  every confirm, so the shared read-only-feed tier (`STALE_MS.module`) only
 *  guards against needless refetches on a re-mount. */
export const ATTENDANCE_STALE_MS = STALE_MS.module;

export const qk = {
	/** The acting tg_id — shared by every page (cached 5 min). Read only when the
	 *  session does NOT name its employee (`/auth/me.employee_id`), i.e. the
	 *  fallback identity path; a WEB sign-in never reads it. */
	tgId: () => ['tg-id'] as const,
	/** The acting employee's directory row (header name/eid/photo). Keyed on
	 *  WHICHEVER identity resolved it — the session's `employee_id`, or the tg id
	 *  on the fallback path — so the two paths can never share a cache entry. */
	actingEmployee: (identity: string) => ['hr', 'acting-employee', identity] as const,
	/** Punches + (optionally) approved leaves — resolved from the `hrm_attendances`
	 *  and `hrm_leaves` reads in `data/api.ts` (2-day window so the 4 AM work day
	 *  always fits). `withLeaves` is part of the KEY because it changes what the
	 *  read contains: the fallback history view needs the leaves, the task-feed
	 *  view does not, and the two must never serve each other's (shallower or
	 *  deeper) payload out of one cache entry. */
	attendanceSummary: (days = 2, withLeaves = false) => ['hr', 'attendance', 'summary', days, withLeaves] as const,
	/** Prefix for EVERY summary variant — the punch write-through invalidates this,
	 *  so both the shallow (task-feed) and deep (history + leaves) reads refresh
	 *  in one call. Using a concrete `attendanceSummary(days)` key here is WRONG:
	 *  the default arg makes it `…,false`, which prefix-matches the task-feed
	 *  variant but NOT the fallback history's `…,true` one, so a punch recorded
	 *  while Projects is unavailable left the visible history stale until a
	 *  reload. Pinned by `query-keys.spec.ts`. */
	attendanceSummaryAll: () => ['hr', 'attendance', 'summary'] as const,
	/** The current user's requests — one type, or all (`all`). */
	// NOTE: no identity in the key. The read is scoped SERVER-side from the signed
	// session (`GET /api/hr/requests?scope=own`), so a client-supplied tg id is
	// ignored by the fetcher; carrying it only churned the cache (`''` → real id)
	// and forced one extra render pass (an extra ROUND TRIP on a cold identity).
	requests: (requestType: HrRequestType | 'all') => ['hr', 'requests', { requestType }] as const,
	/** A single request row — the `/:id/edit` page's read. Lives under the
	 *  `['hr','requests']` prefix, so `requestsAll()` invalidation refreshes it too. */
	request: (id: string) => ['hr', 'requests', 'detail', id] as const,
	/** Prefix for every request list (invalidate after creating a request). */
	requestsAll: () => ['hr', 'requests'] as const,
	/** The approval center list for ONE type tab × status chip — each scope
	 *  reads its own collection slice under a distinct key, so switching tabs or
	 *  chips refetches just that scope (kept under the `['hr','approvals']`
	 *  prefix so decisions invalidate the active scope's read). */
	// Likewise session-scoped server-side (`scope=approve`) — the tg id was unused
	// by the fetcher (see `requests` above).
	approvalRequests: (type: HrRequestType | 'all', status: HrRequestStatus) => ['hr', 'approvals', 'list', { type, status }] as const,
	/** Prefix for the approval center list (invalidate after deciding). */
	approvalsAll: () => ['hr', 'approvals'] as const,
	/** The acting employee's shift assignments (the punch sheet's selector), keyed on
	 *  the `hrm_employees` ID — never the tg id, which a web session does not have. */
	shifts: (employeeId: string) => ['hr', 'shifts', employeeId] as const,
	/** The Team Tracking roster — the session's direct reports (admin: everyone),
	 *  loaded whole and rendered straight away (no term in the key). */
	teamRoster: () => ['hr', 'attendance', 'team'] as const,
	/** ONE employee's Team Tracking week — identity + bounded punches/leaves.
	 *  `days` is part of the key because it changes the read's window. */
	employeeWeek: (employeeId: string, days: number) => ['hr', 'attendance', 'employee', employeeId, days] as const,
};
