/**
 * Attendance dashboard data prefetch.
 *
 * The dashboard is the app's primary destination (it is a pinned launcher app),
 * so on a slow connection the tap used to pay a full round trip — employee row +
 * punches — before any content appeared. Warming its reads while the launcher is
 * still on screen means the tap renders straight from the TanStack cache.
 *
 * This only starts requests the page would itself ask for (same query keys +
 * functions, same `withLeaves` gate), so a tap dedupes onto the in-flight
 * prefetch instead of issuing a second one. Idempotent per page load.
 */
import { queryClient } from '@/shared/api/query-client';
import { isAppAllowed } from '@/shared/app-access';
import { getCachedMe } from '@/shared/auth';
import { fetchMyTasks } from '@/modules/projects/data/api';
import { PROJECTS_STALE_MS, qk as projectQk } from '@/modules/projects/data/query-keys';

import { fetchAttendanceSummary, fetchCurrentEmployee, fetchCurrentTgId } from './data/api';
import { ATTENDANCE_STALE_MS, IDENTITY_STALE_MS, SUMMARY_DAYS, qk } from './data/query-keys';

let started = false;

/** True when the Projects task feed will be shown on the dashboard — it also
 *  decides whether the summary read needs the leaves (`withLeaves`). Must match
 *  `attendance-page.tsx`'s `!showTasks` or the prefetch would populate the OTHER
 *  query-key variant and the page would still fetch. */
function projectsVisible(): boolean {
	const me = getCachedMe();
	return me ? isAppAllowed(me, 'projects') : false;
}

/** Warm the dashboard's reads for a known employee id. */
function warm(employeeId: string, withTasks: boolean): void {
	void queryClient.prefetchQuery({
		queryKey: qk.attendanceSummary(SUMMARY_DAYS, !withTasks),
		queryFn: () => fetchAttendanceSummary(SUMMARY_DAYS, employeeId, undefined, !withTasks),
		staleTime: ATTENDANCE_STALE_MS,
	});
	if (withTasks) {
		void queryClient.prefetchQuery({
			queryKey: projectQk.myTasks(employeeId),
			queryFn: () => fetchMyTasks(employeeId),
			staleTime: PROJECTS_STALE_MS,
		});
	}
}

/**
 * Fire the dashboard's reads once, in the background. Safe to call from the
 * launcher on mount and from a tile's touch intent — the guard collapses the
 * calls into one warm-up per page load, and a failure re-arms it for a retry.
 */
export function prefetchAttendanceDashboard(): void {
	if (started) return;
	started = true;

	const withTasks = projectsVisible();
	// `/auth/me` carries the acting employee id, so the common path — a WEB sign-in
	// and any linked Telegram one — needs no identity round trip at all: warm the
	// SAME identity key the pages read, then the summary.
	const sessionEmployeeId = getCachedMe()?.employee_id ?? null;
	if (sessionEmployeeId) {
		void queryClient.prefetchQuery({
			queryKey: qk.actingEmployee(sessionEmployeeId),
			queryFn: fetchCurrentEmployee,
			staleTime: IDENTITY_STALE_MS,
		});
		warm(sessionEmployeeId, withTasks);
		return;
	}

	// Cold identity (plain-browser dev / a Telegram session with no link): resolve
	// the SAME two hops the pages do, then warm.
	void queryClient
		.fetchQuery({ queryKey: qk.tgId(), queryFn: fetchCurrentTgId, staleTime: IDENTITY_STALE_MS })
		.then(async (tgId) => {
			if (!tgId) return;
			const employee = await queryClient.fetchQuery({
				queryKey: qk.actingEmployee(tgId),
				queryFn: fetchCurrentEmployee,
				staleTime: IDENTITY_STALE_MS,
			});
			if (employee?.id) warm(employee.id, withTasks);
		})
		.catch(() => {
			// A prefetch is a hint, never a requirement — allow a later retry.
			started = false;
		});
}
