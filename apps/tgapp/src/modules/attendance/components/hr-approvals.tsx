import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';
import { Textarea } from '@mmbix/design-system/textarea';

import { fetchApprovalRequestsPage, fetchApprovalRequestsSearch, updateRequestStatus } from '../data/api';
import { qk } from '../data/query-keys';
import { REQUEST_TYPE_LABELS } from '../data/request-meta';
import type { HrRequest, HrRequestStatus, HrRequestType } from '../data/types';
import { RequestCard } from './request-card';
import { ApprovalStatusFilter, APPROVAL_STATUS_META, type ApprovalStatusFilterValue } from '@/shared/components/approval-status-filter';
import { BottomActionBar } from '@/shared/components/bottom-action-bar';
import { EmptyState, FilteredEmptyState } from '@/shared/components/empty-state';
import { PageError } from '@/shared/components/page-error';
import { LoadMoreSentinel } from '@/shared/components/load-more-sentinel';
import { SearchResultsList } from '@/shared/components/search-results-list';
import { ListSkeleton } from '@/shared/components/skeletons';
import { useBarSearch } from '@/shared/hooks/use-bar-search';
import { useCursorList } from '@/shared/hooks/use-cursor-list';
import { hapticImpact } from '@/shared/platform/haptics';
import { notifySaved } from '@/shared/save-feedback';

/** A decision awaiting the confirmation dialog. */
interface PendingDecision {
	request: HrRequest;
	action: 'approved' | 'rejected';
}

/** The "nothing in this chip" copy — one entry per status chip. Rendered by the
 *  SHARED `EmptyState`, so every list's blank body looks the same. */
const EMPTY_COPY: Record<ApprovalStatusFilterValue, { title: string; hint: string }> = {
	pending: { title: 'No requests to approve', hint: 'Everything has been decided.' },
	approved: { title: 'No approved requests', hint: 'Approved requests will appear here.' },
	rejected: { title: 'No rejected requests', hint: 'Rejected requests will appear here.' },
};

/**
 * The approval center's HR REQUEST panel — the three request kinds (Early Leave
 * / Leave / Overtime) routed to THIS user (`superior_tg_id` = me).
 *
 * Cards are the approval variant of the enterprise RequestCard: the colored
 * status pill top-right, the facts as flat dotted-leader rows, then the reason
 * quote, then the ✓ Approve / ✗ Reject icon buttons and the submitted stamp.
 * Each decision is confirmed in the bottom sheet before it flips the status via
 * the entity engine (pending → approved/rejected).
 *
 * Each TYPE tab × STATUS chip is its own server read of ONE collection slice:
 * only the focused scope is fetched (never all three routes at once), filtered
 * by the chip's `doc_status` server-side, so the payload always matches the
 * cards on screen — a decision invalidates the whole `['hr','approvals']` prefix
 * (the active scope list + the dashboard badge count).
 */
export function HrApprovals({
	type,
	status,
	onStatusChange,
}: {
	type: HrRequestType;
	status: ApprovalStatusFilterValue;
	onStatusChange: (value: ApprovalStatusFilterValue) => void;
}) {
	const queryClient = useQueryClient();
	const [decision, setDecision] = useState<PendingDecision | null>(null);
	const [rejectReason, setRejectReason] = useState('');
	const [busyId, setBusyId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Toolbar search — server-side across the requests awaiting the user's
	// decision (reason / applicant name/eid), scoped like the list to the ACTIVE
	// type tab — results render the same card.
	const search = useBarSearch('Search name / reason', (query) => fetchApprovalRequestsSearch('', type, query));

	const list = useCursorList({
		// One query per type tab × status chip — switching either refetches only
		// that exact scope. The read is scoped to the chip's status SERVER-side
		// (`filter[doc_status][_eq]=…`), so the API payload always matches the card
		// list — no fetched row is ever hidden by the chip. The scope is ALSO
		// resolved server-side from the session, so no identity belongs in the key
		// (the fetcher ignores its tg-id argument).
		queryKey: qk.approvalRequests(type, status),
		fetcher: (cursor) => fetchApprovalRequestsPage('', type, status, cursor),
	});

	const listLoading = list.isPending;

	const sourceRequests: HrRequest[] = list.rows;

	const effectiveStatus = (request: HrRequest): HrRequestStatus => request.status ?? 'pending';
	const visibleRequests = sourceRequests.filter((request) => effectiveStatus(request) === status);

	const openDecision = (request: HrRequest, action: 'approved' | 'rejected') => {
		hapticImpact('light');
		setDecision({ request, action });
		setRejectReason('');
		setError(null);
	};

	const closeDecision = () => {
		if (busyId) return;
		setDecision(null);
		setRejectReason('');
		setError(null);
	};

	const confirmDecision = async () => {
		if (!decision || busyId) return;
		const { request, action } = decision;
		// Reject requires a reason — the confirm pill stays disabled without one.
		const reason = action === 'rejected' ? rejectReason.trim() : undefined;
		if (action === 'rejected' && !reason) return;
		setBusyId(request.id);
		setError(null);
		try {
			await updateRequestStatus(request.request_type ?? type, request.id, action, request.updated_at, reason);
			hapticImpact('medium');
			// Confirm to the approver BEFORE the refetch: a row that just disappears
			// is ambiguous (approved? or did the filter drop it?), and awaiting the
			// list refetch on a slow link reads as a hang exactly at the decision.
			notifySaved(
				action === 'approved' ? 'Request approved' : 'Request rejected',
				request.employee_name || request.employee_eid || undefined,
			);
			setDecision(null);
			setRejectReason('');
			// Refresh this list AND the dashboard badge count in one call — background.
			void queryClient.invalidateQueries({ queryKey: qk.approvalsAll() });
		} catch (err) {
			console.error('[attendance] decision failed', err);
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusyId(null);
		}
	};

	const dialogRequest = decision?.request ?? null;
	const dialogTypeLabel = dialogRequest?.request_type
		? (REQUEST_TYPE_LABELS[dialogRequest.request_type] ?? dialogRequest.request_type)
		: null;
	const dialogSubject = dialogRequest ? dialogRequest.employee_name || dialogRequest.employee_eid || '—' : null;

	// ONE card renderer shared by the list AND the toolbar search — a search result
	// must offer the SAME decision controls as the list (it used to render a bare
	// card with no approve/reject buttons).
	const renderCard = (request: HrRequest) => {
		const busy = busyId === request.id;
		const isPending = effectiveStatus(request) === 'pending';
		return (
			<RequestCard
				key={request.id}
				request={{ ...request, status: effectiveStatus(request), reject_reason: request.reject_reason }}
				photoUrl={request.applicant_avatar ?? null}
				variant="other"
				actions={
					isPending ? (
						<>
							{/* Both decisions are LABELLED, not icon-only: this is the most
							    consequential tap in the app (irreversible), so the words — and
							    the wider, better-separated targets they give — are worth the
							    row width. Icon-only ✓/✗ 6px apart invited mis-taps. */}
							<button
								type="button"
								disabled={busy}
								onClick={() => openDecision(request, 'rejected')}
								className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								<X className="size-3.5" strokeWidth={2.2} aria-hidden />
								Reject
							</button>
							<button
								type="button"
								disabled={busy}
								onClick={() => openDecision(request, 'approved')}
								className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								<Check className="size-3.5" strokeWidth={2.2} aria-hidden />
								Approve
							</button>
						</>
					) : undefined
				}
			/>
		);
	};

	return (
		<div className="flex flex-1 flex-col">
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
						<ListSkeleton variant="approval" />
					) : list.isError && sourceRequests.length === 0 ? (
						/* A failed read must never read as "no requests to approve". */
						<PageError onRetry={() => void list.refetch()} fill />
					) : (
						/* The list slot GROWS to the body's height, so a blank chip renders its
						   empty state as the whole body instead of a card over a half-empty page. */
						<div className="flex flex-1 flex-col">
							{sourceRequests.length === 0 ? (
								<EmptyState {...EMPTY_COPY[status]} fill />
							) : visibleRequests.length === 0 ? (
								<FilteredEmptyState
									title="No results match this filter"
									onClear={() => {
										onStatusChange('pending');
										search.clear();
									}}
									fill
								/>
							) : (
								<ul className="flex flex-col gap-2.5">{visibleRequests.map(renderCard)}</ul>
							)}
						</div>
					)}

					{/* Next page — streams in as the sentinel nears the viewport (throttled). */}
					<LoadMoreSentinel hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onLoadMore={() => void list.fetchNextPage()} />
				</>
			)}

			{/* Room for the fixed bottom bar when the list is fully scrolled. */}
			<div className="h-24" aria-hidden />

			<BottomActionBar
				left={<ApprovalStatusFilter value={status} onChange={onStatusChange} />}
				center={APPROVAL_STATUS_META[status].label}
				panel={search.panel}
				panelOpen={search.open}
				right={search.button}
			/>

			{/* Decision sheet — the check-in/out style bottom sheet: a short
				request summary, a REQUIRED reason field when rejecting, and the two
				rounded-full action pills pinned above the safe area. */}
			<Sheet
				open={decision !== null}
				onOpenChange={(open) => {
					if (!open) closeDecision();
				}}
			>
				<SheetContent side="bottom" showCloseButton={false} className="rounded-t-3xl">
					{/* Header row — title (left) + circular close button (right) */}
					<SheetHeader className="flex-row items-center justify-between gap-3 pb-1">
						<SheetTitle className="leading-myanmar">
							{decision?.action === 'approved' ? 'Approve this request?' : 'Reject this request?'}
						</SheetTitle>
						<button
							type="button"
							onClick={closeDecision}
							aria-label="Close"
							className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground active:scale-90"
						>
							<X className="size-4" aria-hidden />
						</button>
					</SheetHeader>

					{/* Body — the request being decided + the reject reason field */}
					<div className="max-h-[62dvh] overflow-y-auto overscroll-contain px-4">
						{dialogSubject && dialogRequest ? (
							<p className="text-sm leading-myanmar text-muted-foreground">
								<span className="font-semibold text-foreground">{dialogSubject}</span>'s {dialogTypeLabel ? `${dialogTypeLabel} ` : ''}
								request will be {decision?.action === 'approved' ? 'approved' : 'rejected'}. Continue?
							</p>
						) : null}

						{decision?.action === 'rejected' ? (
							<div className="mt-4">
								<label htmlFor="reject-reason" className="text-sm font-semibold leading-myanmar text-foreground">
									Rejection Reason <span className="text-status-danger">*</span>
								</label>
								<Textarea
									id="reject-reason"
									value={rejectReason}
									onChange={(event) => setRejectReason(event.target.value)}
									rows={3}
									placeholder="Type a reason…"
									className="mt-2 w-full resize-none rounded-xl border border-input bg-card px-3 py-2.5 text-sm leading-myanmar text-foreground outline-none placeholder:text-muted-foreground focus:border-ring/60"
								/>
							</div>
						) : null}

						{error && (
							<p className="mt-3 rounded-md bg-status-danger-soft px-3 py-2 text-xs font-medium leading-myanmar text-status-danger">
								{error}
							</p>
						)}
					</div>

					{/* Actions — the check-in/out style rounded-full pills, pinned at the bottom */}
					<div className="flex items-center gap-3 px-4 pt-1 pb-safe">
						<button
							type="button"
							onClick={closeDecision}
							disabled={busyId !== null}
							className="flex-1 rounded-full border border-border bg-background px-4 py-2.5 text-sm font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95 disabled:opacity-50"
						>
							Keep it
						</button>
						<button
							type="button"
							disabled={busyId !== null || (decision?.action === 'rejected' && rejectReason.trim() === '')}
							onClick={() => void confirmDecision()}
							className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-bold leading-myanmar shadow-sm transition-transform duration-150 active:scale-95 disabled:opacity-40 disabled:active:scale-100 ${
								decision?.action === 'approved' ? 'bg-primary text-primary-foreground' : 'bg-status-danger text-white'
							}`}
						>
							{busyId !== null ? 'Submitting…' : decision?.action === 'approved' ? 'Approve' : 'Reject'}
						</button>
					</div>
				</SheetContent>
			</Sheet>
		</div>
	);
}
