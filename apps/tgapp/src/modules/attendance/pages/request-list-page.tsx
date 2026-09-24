import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';

import { BottomActionBar, GLASS_PRIMARY_BUTTON } from '@/shared/components/bottom-action-bar';
import { EmptyState, FilteredEmptyState } from '@/shared/components/empty-state';
import { LoadMoreSentinel } from '@/shared/components/load-more-sentinel';
import { ModuleShell } from '@/shared/components/module-shell';
import { PageError } from '@/shared/components/page-error';
import { SearchResultsList } from '@/shared/components/search-results-list';
import { ListSkeleton } from '@/shared/components/skeletons';
import { hapticImpact } from '@/shared/platform/haptics';
import { useBarSearch } from '@/shared/hooks/use-bar-search';
import { useCursorList } from '@/shared/hooks/use-cursor-list';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';
import { fetchRequestsPage, fetchRequestsSearch, updateRequestStatus } from '../data/api';
import { qk } from '../data/query-keys';
import { EDITABLE_REQUEST_TYPES, REQUEST_LIST_ROUTE, REQUEST_META, REQUEST_TYPE_LABELS, STATUS_META } from '../data/request-meta';
import { RequestCard } from '../components/request-card';
import { RequestStatusFilter, type RequestStatusFilterValue } from '../components/request-status-filter';
import type { HrRequest, HrRequestStatus, HrRequestType } from '../data/types';

/** The request destinations this page serves — every type plus the all-types inbox. */
export type RequestListType = HrRequestType | 'all';

/**
 * A list row — an `hr_requests` row whose applicant avatar rides along inline
 * (`applicant_avatar`, from the expanded `employee` m2o).
 */
type CardRow = HrRequest;

/**
 * A request-type list page (Leave / Overtime / Early Leave) plus the
 * all-types Requests page — one component, four routes. Lists the current
 * user's native request collections (newest first) as enterprise cards with a
 * status filter in the fixed bottom action bar. The bar's + button opens the
 * `/+` create page (hidden on the read-only inbox); the bar disappears
 * automatically when navigating away.
 */

// URL-driven status filter — `?status=` survives reloads and the leave-page
// round-trip (list → edit → back); nuqs `replace` (default) keeps taps out of
// history. `'all'` shows every status.
const REQUEST_STATUS_FILTER = enumParam<RequestStatusFilterValue>(
	['all', ...Object.keys(STATUS_META)] as RequestStatusFilterValue[],
	'all',
);

/** The request list's whole URL view state — the status filter, in one container. */
const REQUEST_LIST_VIEW = {
	[URL_PARAM.status]: REQUEST_STATUS_FILTER,
} as const;

export default function RequestListPage({ requestType }: { requestType: RequestListType }) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const meta = REQUEST_META[requestType];
	// No identity gate: `fetchRequestsPage` is scoped SERVER-side from the signed
	// session (it ignores its tg-id argument), so waiting for `/auth/me` first only
	// added a render pass — and a whole round trip on a cold identity.
	const list = useCursorList({
		queryKey: qk.requests(requestType),
		fetcher: (cursor) => fetchRequestsPage('', requestType, cursor),
	});

	// Cancel flow — the ✗ button on PENDING cards (like the approval center's
	// reject button) opens a confirm sheet, then flips the row to `cancelled`.
	const [cancelTarget, setCancelTarget] = useState<CardRow | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [cancelError, setCancelError] = useState<string | null>(null);

	const [view, setView] = useViewState(REQUEST_LIST_VIEW);
	const { status: statusFilter } = view;

	// Requests (all types) is a read-only inbox — a new request always
	// starts from a specific type page, so the create affordance is hidden there.
	const canCreate = requestType !== 'all';
	// The + button's destination — `.../+` on the same type's list route
	// (narrowed: `canCreate` guarantees `requestType` is a create-able type).
	const createRoute = canCreate ? `${REQUEST_LIST_ROUTE[requestType]}/+` : null;

	// The list read is session-scoped SERVER-side, so there is no identity to wait
	// for — the skeleton tracks the read itself.
	const listLoading = list.isPending;

	// Status filter — client-side over the rows loaded so far (instant, no
	// extra requests; further pages stream in via the sentinel).
	const sourceRequests: CardRow[] = list.rows;

	/* LIVE native request rows carry the applicant photo inline (`applicant_avatar`,
	 * from the expanded `employee` m2o) — no separate directory lookup is needed,
	 * so the cards render avatars without an `employees` GET per row. */
	const search = useBarSearch('Search name / reason', (query) => fetchRequestsSearch('', requestType, query));

	const effectiveStatus = (request: CardRow): HrRequestStatus => request.status ?? 'pending';

	const visibleRequests = sourceRequests.filter((request) => statusFilter === 'all' || effectiveStatus(request) === statusFilter);
	const isFilteredEmpty = sourceRequests.length > 0 && visibleRequests.length === 0;
	const activeFilterLabel = statusFilter === 'all' ? null : (STATUS_META[statusFilter]?.label ?? null);

	const openCancel = (request: CardRow) => {
		hapticImpact('light');
		setCancelTarget(request);
		setCancelError(null);
	};

	const closeCancel = () => {
		if (busyId) return;
		setCancelTarget(null);
		setCancelError(null);
	};

	const confirmCancel = async () => {
		if (!cancelTarget || busyId) return;
		const target = cancelTarget;
		setBusyId(target.id);
		setCancelError(null);
		try {
			const type = target.request_type ?? (requestType === 'all' ? null : requestType);
			if (!type) throw new Error('Request type is unknown — reload the list and try again.');
			await updateRequestStatus(type, target.id, 'cancelled', target.updated_at);
			hapticImpact('medium');
			// Refresh the request lists AND the approvals (badge count) together.
			await queryClient.invalidateQueries({ queryKey: qk.requestsAll() });
			await queryClient.invalidateQueries({ queryKey: qk.approvalsAll() });
			setCancelTarget(null);
		} catch (err) {
			console.error('[attendance] cancel failed', err);
			setCancelError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusyId(null);
		}
	};

	const cancelTypeLabel = cancelTarget?.request_type ? (REQUEST_TYPE_LABELS[cancelTarget.request_type] ?? cancelTarget.request_type) : null;

	// The list, its search and the all-types inbox are all SERVER-scoped to the
	// signed-in employee (`scope=own`), so every row is the user's own — a
	// single-type list drops the applicant identity, the all-types inbox keeps it
	// (the same card the seeker scanned).
	const cardVariant: 'self' | 'other' = requestType === 'all' ? 'other' : 'self';

	// ONE card renderer shared by the list AND the toolbar search. The search used
	// to hardcode `variant="other"` and drop `onEdit`/`actions`, so a result was a
	// visibly different card from the list it replaced; scoping the search to the
	// page's own type (see `fetchRequestsSearch`) makes the SAME card correct here.
	const renderCard = (request: CardRow) => {
		const status = effectiveStatus(request);
		const isPending = status === 'pending';
		// Only PENDING rows of editable types (Leave / Early Leave / Overtime) link
		// to the edit page — approved / rejected / cancelled rows stay plain cards.
		// The tapped row rides along via router state so the edit form renders
		// pre-filled without a refetch.
		const editable = isPending && request.request_type != null && EDITABLE_REQUEST_TYPES.has(request.request_type);
		const editRoute = editable && request.request_type != null ? `${REQUEST_LIST_ROUTE[request.request_type]}/${request.id}/edit` : null;
		// A Leave with NEITHER a reliever NOR a reason is a bare card — its fact
		// block runs straight to the footer stamp with no rule and no Cancel (✗)
		// button (the shell already suppresses its border).
		const bareLeave = request.request_type === 'leave' && !request.reliever_name && !request.reason;
		return (
			<RequestCard
				key={request.id}
				request={request}
				photoUrl={request.applicant_avatar ?? null}
				variant={cardVariant}
				onEdit={editRoute ? () => navigate(editRoute, { state: { request } }) : undefined}
				actions={
					isPending && !bareLeave ? (
						// Cancel — the same ✗ button style as the approval center's
						// reject control. stopPropagation keeps the whole-card edit
						// tap from firing while pressing it.
						<button
							type="button"
							disabled={busyId !== null}
							aria-label="Cancel request"
							onClick={(event) => {
								event.stopPropagation();
								openCancel(request);
							}}
							className="flex size-9 items-center justify-center rounded-full border border-border bg-background text-foreground transition-transform duration-150 active:scale-95 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							<X className="size-4" strokeWidth={2.2} aria-hidden />
						</button>
					) : undefined
				}
			/>
		);
	};

	return (
		<ModuleShell title={meta.title} backTo="/app/attendance">
			{search.open && search.query ? (
				<SearchResultsList
					query={search.query}
					searching={search.searching}
					results={search.results}
					error={search.error}
					onClear={search.clear}
					renderItem={renderCard}
				/>
			) : (
				<>
					{listLoading ? (
						<ListSkeleton />
					) : list.isError && sourceRequests.length === 0 ? (
						<PageError onRetry={() => void list.refetch()} fill />
					) : (
						<ul className={`flex flex-col gap-3 ${visibleRequests.length === 0 ? 'min-h-0 flex-1' : ''}`}>
							{visibleRequests.map(renderCard)}
							{sourceRequests.length === 0 && (
								<EmptyState
									title={`No ${meta.title} yet`}
									hint={canCreate ? 'Use the + button below to create one.' : 'Check back later.'}
									fill
								/>
							)}
							{isFilteredEmpty && (
								<FilteredEmptyState
									title="No results match this filter"
									fill
									onClear={() => {
										setView({ status: 'all' });
										search.clear();
									}}
								/>
							)}
						</ul>
					)}

					{/* Next page — streams in as the sentinel nears the viewport (throttled). */}
					<LoadMoreSentinel hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onLoadMore={() => void list.fetchNextPage()} />
				</>
			)}

			{/* Room for the fixed bottom bar when the list is fully scrolled. */}
			<div className="h-24" aria-hidden />

			<BottomActionBar
				left={<RequestStatusFilter value={statusFilter} onChange={(value) => setView({ status: value })} />}
				center={activeFilterLabel}
				panel={search.panel}
				panelOpen={search.open}
				right={
					<div className="flex items-center gap-1.5">
						{search.button}
						{canCreate && createRoute ? (
							<button type="button" onClick={() => navigate(createRoute)} aria-label={`New ${meta.title}`} className={GLASS_PRIMARY_BUTTON}>
								<Plus className="size-5" aria-hidden />
							</button>
						) : null}
					</div>
				}
			/>

			{/* Cancel confirm — the same bottom-sheet style as the approval center's
				decision sheet: a short summary + the two rounded-full pills. */}
			<Sheet
				open={cancelTarget !== null}
				onOpenChange={(open) => {
					if (!open) closeCancel();
				}}
			>
				<SheetContent side="bottom" showCloseButton={false} className="rounded-t-3xl">
					<SheetHeader className="flex-row items-center justify-between gap-3 pb-1">
						<SheetTitle className="leading-myanmar">Cancel this request?</SheetTitle>
						<button
							type="button"
							onClick={closeCancel}
							aria-label="Close"
							className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground active:scale-90"
						>
							<X className="size-4" aria-hidden />
						</button>
					</SheetHeader>

					<div className="max-h-[62dvh] overflow-y-auto overscroll-contain px-4">
						{cancelTarget ? (
							<p className="text-sm leading-myanmar text-muted-foreground">
								{cancelTypeLabel ? `${cancelTypeLabel} ` : ''}request will be cancelled. Continue?
							</p>
						) : null}
						{cancelError && (
							<p className="mt-3 rounded-md bg-status-danger-soft px-3 py-2 text-xs font-medium leading-myanmar text-status-danger">
								{cancelError}
							</p>
						)}
					</div>

					<div className="flex items-center gap-3 px-4 pt-1 pb-safe">
						<button
							type="button"
							onClick={closeCancel}
							disabled={busyId !== null}
							className="flex-1 rounded-full border border-border bg-background px-4 py-2.5 text-sm font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95 disabled:opacity-50"
						>
							Keep it
						</button>
						<button
							type="button"
							disabled={busyId !== null}
							onClick={() => void confirmCancel()}
							className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-status-danger px-4 py-2.5 text-sm font-bold leading-myanmar text-white shadow-sm transition-transform duration-150 active:scale-95 disabled:opacity-40 disabled:active:scale-100"
						>
							{busyId !== null ? 'Submitting…' : 'Cancel Request'}
						</button>
					</div>
				</SheetContent>
			</Sheet>
		</ModuleShell>
	);
}
