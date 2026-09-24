import { useQuery } from '@tanstack/react-query';

import { getCachedMe } from '@/shared/auth';

import { fetchCurrentEmployee, fetchCurrentTgId, type CurrentEmployee } from '../data/api';
import { IDENTITY_STALE_MS, qk } from '../data/query-keys';

/**
 * Who the signed session acts as — the ONE identity read the attendance module
 * mounts.
 *
 * The dashboard header (name / eid / photo), the punch sheet's shift selector and
 * the request forms' applicant all ask this same question, so it is answered in
 * ONE place. Two hops, in the order of AUTHORITY (the same order
 * `fetchCurrentEmployee` uses, and the same answer `/auth/me` gives):
 *
 *   1. the session's OWN `employee_id` — `/auth/me` names the employee a WEB
 *      sign-in acts as (`_users.employee_id`) and re-validates it on every
 *      request, so it is authoritative and needs no directory walk;
 *   2. the Telegram id → `etg_id` directory hop, for a Telegram session whose
 *      account carries no employee link.
 *
 * The order is the whole point, and building it the other way round is what broke
 * the rollout: a chain that STARTED at the Telegram id resolved every WEB sign-in
 * as nobody — `----` where the dashboard's name belongs, an empty shift picker,
 * and a request form whose submit button could never enable, because a browser
 * session has no Telegram id at all.
 *
 * The tg-id read is skipped entirely once the session names its employee, so the
 * common path costs ONE directory read and no identity round trip.
 */
export interface ActingEmployee {
	/** The directory row, for the screens that render identity. null ⇒ nobody. */
	employee: CurrentEmployee | null;
	/** The `hrm_employees` uuid the session acts as — the session's own answer, or
	 *  the resolved row's id. null ⇒ this session acts as nobody (the bootstrap
	 *  admin, an unlinked password account). */
	employeeId: string | null;
	/** The identity is still resolving — show a skeleton, not "nobody". */
	loading: boolean;
	/** Identity SETTLED and named nobody — a real state, to be said out loud. */
	hasNoEmployee: boolean;
}

export function useActingEmployee(enabled = true): ActingEmployee {
	// A synchronous peek: the AuthGate's boot awaits `/auth/me` before any route
	// mounts, so the session's answer is already known on the FIRST render.
	const sessionEmployeeId = getCachedMe()?.employee_id ?? null;

	const tgId = useQuery({
		queryKey: qk.tgId(),
		queryFn: fetchCurrentTgId,
		// Only a session that does not name its employee needs the Telegram id.
		enabled: enabled && sessionEmployeeId === null,
		staleTime: IDENTITY_STALE_MS,
	});
	const tgIdValue = tgId.data ?? null;

	// `fetchCurrentEmployee` resolves the same two hops internally (and memoizes the
	// answer per identity), so this is a cache read of the module's ONE resolver
	// rather than a second implementation of it.
	const lookup = useQuery({
		queryKey: qk.actingEmployee(sessionEmployeeId ?? tgIdValue ?? ''),
		queryFn: fetchCurrentEmployee,
		enabled: enabled && (sessionEmployeeId !== null || tgIdValue !== null),
		staleTime: IDENTITY_STALE_MS,
	});

	// `enabled: false` leaves a TanStack query `isPending` forever, so resolution is
	// tracked explicitly: either a source named nobody (settled, no employee), or the
	// lookup finished. Without this the header shimmers for a session that will never
	// resolve.
	const noSource = sessionEmployeeId === null && tgId.isSuccess && tgIdValue === null;
	const settled = !enabled || noSource || lookup.isSuccess || lookup.isError;

	const employee = lookup.data ?? null;
	return {
		employee,
		employeeId: employee?.id ?? sessionEmployeeId ?? null,
		loading: !settled,
		// Nobody is named only when NEITHER source did — a session that named an
		// employee keeps that answer even if the row read for display fields failed.
		hasNoEmployee: settled && enabled && sessionEmployeeId === null && employee === null,
	};
}
