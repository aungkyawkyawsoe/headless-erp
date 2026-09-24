import { useCallback, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ModuleShell } from '@/shared/components/module-shell';
import { FormSubmitBar } from '@/shared/components/form-submit';
import { ListSkeleton } from '@/shared/components/skeletons';
import { hapticImpact } from '@/shared/platform/haptics';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';
import { STALE_MS } from '@/shared/api/invalidation';
import { fetchRequest } from '../data/api';
import { qk } from '../data/query-keys';
import { REQUEST_EDIT_TITLE, REQUEST_LIST_ROUTE, REQUEST_UPDATE_LABEL } from '../data/request-meta';
import { LeaveFormBody } from '../components/leave-form-body';
import { EarlyLeaveFormBody } from '../components/early-leave-form-body';
import { RequestFormBody } from '../components/request-form-body';
import { useActingEmployee } from '../hooks/use-acting-employee';
import { DEFAULT_FORM_STATE, type FormState } from '@/shared/components/form-state';
import type { HrRequest, HrRequestType } from '../data/types';

/**
 * The edit-request page at `.../:id/edit` (Leave / Early Leave / Overtime) — one
 * component, three routes. Reached by TAPPING a PENDING request card on the list
 * page; back (native BackButton or the browser pill) returns to the list.
 *
 * Only `pending` rows can be edited — the list page never links approved /
 * rejected rows, and this page re-checks the fetched row (a deep link to a
 * decided request lands on a "This request can no longer be edited" notice
 * instead of a form).
 *
 * State management for the filled data: the tapped card hands the row over via
 * React Router location state (`{ request }`) so the form renders pre-filled
 * with ZERO extra requests; the row is also keyed into the TanStack Query cache
 * (`qk.request(id)`), which covers deep links / refreshes with a real fetch.
 * The same type-specific form bodies as the create page own the fields — they
 * just initialize from the row and call `updateRequest` instead of `createRequest`.
 */
export default function RequestEditPage({ requestType }: { requestType: HrRequestType }) {
	const { id } = useParams<{ id: string }>();
	const location = useLocation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const title = REQUEST_EDIT_TITLE[requestType];
	const listRoute = REQUEST_LIST_ROUTE[requestType];
	const updateLabel = REQUEST_UPDATE_LABEL[requestType];

	// Who the session acts as — the SAME one identity read every attendance page
	// shares (the session's `employee_id` first, the Telegram id as the fallback),
	// so an edit re-writes the applicant a web sign-in can actually name.
	const identity = useActingEmployee();

	// The tapped card's row arrives via router state — use IT directly (no fetch),
	// and crucially prefer it over any cached `qk.request(id)` entry. Mixing the
	// two was a stale-page bug: re-editing the same row handed a FRESH row through
	// state, but the query's cache from the previous edit kept the OLD value and
	// `initialData` only seeds a query with NO cache entry — so the form re-opened
	// with the previous reason until a reload. Deep links / refreshes carry no
	// state, so they fetch the row by id.
	const fromState = (location.state as { request?: HrRequest } | null)?.request ?? null;
	const requestQuery = useQuery({
		queryKey: qk.request(id ?? ''),
		queryFn: () => fetchRequest(id as string),
		// Only fetch when there's no routed row (deep link / refresh).
		enabled: id != null && fromState == null,
		// Deep links/refreshes seed the form — always refetch on entry (the
		// app-wide default 30s staleTime would serve a cached pre-edit row).
		staleTime: STALE_MS.live,
	});
	// Routed state always wins; the fetched row backs deep links/refreshes.
	const request = fromState ?? requestQuery.data ?? null;

	// The body reports submit/validity/loading to this page (drives the submit
	// button). Resets only via a fresh mount — `key={request.id}` below forces
	// one per edited row.
	const [formState, setFormState] = useState<FormState>(DEFAULT_FORM_STATE);
	const onReady = useCallback((state: FormState) => setFormState(state), []);

	// Successful update → refresh every request list (this type + Requests +
	// the detail row under the same `['hr','requests']` prefix), then land back
	// on the list. `refetchType: 'active'` refetches the MOUNTED lists here;
	// unmounted ones (deeper cached pages / the all-types inbox) are stale-marked
	// and refetch once on the next visit, so the edited row shows on return
	// without a manual reload — and no background burst re-reads every cached
	// page for screens that aren't open. Pop (not push) — same rule as the
	// create page. The edited row's `detail` entry is excluded: the form already
	// seeded it via `reflectEditedRow` (setQueryData), so refetching it after
	// every submit is a wasted single-row request.
	const handleDone = useCallback(() => {
		hapticImpact('medium');
		void queryClient.invalidateQueries({
			queryKey: qk.requestsAll(),
			refetchType: 'active',
			predicate: (query) => !query.queryKey.includes('detail'),
		});
		notifySaved('Request updated');
		popBack(navigate, listRoute);
	}, [queryClient, navigate, listRoute]);

	// The submit affordance: the native MainButton on Android/Desktop Telegram,
	// the in-page button everywhere else — never both (same rule as create).
	const isMainButton = useTelegramMainButton({
		text: formState.submitting ? 'Submitting…' : updateLabel,
		onClick: () => formState.submit(),
		visible: !formState.hideMainButton,
		disabled: !formState.canSubmit,
		loading: formState.submitting,
	});

	// Loading / not-found — the deep-link path (the tap path has `request` from
	// state immediately).
	if (request == null) {
		return (
			<ModuleShell title={title} backTo={listRoute}>
				{requestQuery.isPending ? (
					<ListSkeleton />
				) : (
					<div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border px-4 py-10 text-center">
						<p className="text-sm font-medium leading-myanmar text-foreground">Request not found</p>
					</div>
				)}
			</ModuleShell>
		);
	}

	// Only `pending` rows are editable — a stale deep link to an approved /
	// rejected / cancelled row lands here instead of a form.
	if ((request.status ?? 'pending') !== 'pending' || (request.request_type != null && request.request_type !== requestType)) {
		return (
			<ModuleShell title={title} backTo={listRoute}>
				<div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border px-4 py-10 text-center">
					<p className="text-sm font-medium leading-myanmar text-foreground">This request can no longer be edited</p>
					<p className="text-xs leading-myanmar text-muted-foreground">Only Pending requests can be edited.</p>
				</div>
			</ModuleShell>
		);
	}

	return (
		<ModuleShell title={title} backTo={listRoute}>
			<div className="flex flex-1 flex-col gap-5 pt-2">
				{requestType === 'leave' && (
					<LeaveFormBody
						key={request.id}
						employeeId={identity.employeeId}
						employeeName={identity.employee?.name_mm ?? identity.employee?.name_en ?? null}
						employeeEid={identity.employee?.eid ?? null}
						initial={request}
						onReady={onReady}
						onDone={handleDone}
					/>
				)}
				{requestType === 'early' && (
					<EarlyLeaveFormBody
						key={request.id}
						employeeId={identity.employeeId}
						employeeName={identity.employee?.name_mm ?? identity.employee?.name_en ?? null}
						employeeEid={identity.employee?.eid ?? null}
						initial={request}
						onReady={onReady}
						onDone={handleDone}
					/>
				)}
				{requestType === 'ot' && (
					<RequestFormBody
						key={request.id}
						employeeId={identity.employeeId}
						employeeName={identity.employee?.name_mm ?? identity.employee?.name_en ?? null}
						employeeEid={identity.employee?.eid ?? null}
						initial={request}
						onReady={onReady}
						onDone={handleDone}
					/>
				)}

				<FormSubmitBar
					label={updateLabel}
					isMainButton={isMainButton}
					disabled={!formState.canSubmit}
					submitting={formState.submitting}
					submittingLabel="Submitting…"
					onSubmit={() => formState.submit()}
				/>
			</div>
		</ModuleShell>
	);
}
