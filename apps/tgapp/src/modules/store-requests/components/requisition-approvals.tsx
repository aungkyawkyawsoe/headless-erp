import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';

import { approveRequisition, fetchRequisitionApprovalPage, fetchRequisitionApprovalSearch, rejectRequisition } from '../data/api';
import { qk, REQUISITIONS_STALE_MS } from '../data/query-keys';
import { REQUISITION_CLOSE_REASONS } from '../data/status';
import type { MroRequisitionCardModel } from '../data/types';
import { StoreRequestCard } from './store-request-card';
import { fetchCurrentEmployee } from '@/modules/attendance/data/api';
import { ApprovalStatusFilter, APPROVAL_STATUS_META, type ApprovalStatusFilterValue } from '@/shared/components/approval-status-filter';
import { BottomActionBar } from '@/shared/components/bottom-action-bar';
import { ConfirmSheet } from '@/shared/components/confirm-sheet';
import { EmptyState } from '@/shared/components/empty-state';
import { PageError } from '@/shared/components/page-error';
import { LoadMoreSentinel } from '@/shared/components/load-more-sentinel';
import { SearchResultsList } from '@/shared/components/search-results-list';
import { ListSkeleton } from '@/shared/components/skeletons';
import { useBarSearch } from '@/shared/hooks/use-bar-search';
import { useCursorList } from '@/shared/hooks/use-cursor-list';
import { hapticImpact } from '@/shared/platform/haptics';
import { notifySaved } from '@/shared/save-feedback';

/** A decision awaiting the confirmation sheet. */
interface PendingDecision {
	row: MroRequisitionCardModel;
	action: 'approve' | 'reject';
}

/** The "nothing in this chip" copy — one entry per decision chip, rendered by the
 *  SHARED `EmptyState` so every approval list's blank body looks the same. */
const EMPTY_COPY: Record<ApprovalStatusFilterValue, { title: string; hint: string }> = {
	pending: { title: 'No requests to approve', hint: 'Store requisitions awaiting a decision appear here.' },
	approved: { title: 'No approved requests', hint: 'Requisitions already decided appear here.' },
	rejected: { title: 'No rejected requests', hint: 'Requisitions closed by the store appear here.' },
};

/**
 * The approval center's REQUISITION panel — the store-requisition (တောင်းခံလွှာ)
 * queue, decided INLINE: each card shows the request HEADER (who · store · truck ·
 * total · lifecycle) plus Approve / Reject buttons that flip the lifecycle without
 * leaving the queue. The requested line items are NOT read here — a tap on the row
 * opens `/app/store-requests/:id`, which shows the lines AND owns the ISSUE (stock
 * moves there).
 *
 * The one thing this panel must not do is decide a request it would 403 on: the
 * server requires the approver to DIFFER from the requester, so on a card whose
 * `requestedBy` is the signed-in employee the Approve verb renders DISABLED WITH
 * ITS REASON (the keeper cannot approve their own requisition) — never hidden
 * (Poka-Yoke). Closing the request stays available. Everything else the confirm
 * route allows is offered here, mirroring `AssetApprovals`.
 *
 * The status chip maps onto the requisition lifecycle, not the registry's list
 * tabs: To Approve = `requested` (+ still-open drafts), Approved = approved /
 * partially issued / fulfilled (everything decided and not refused, so an issued
 * request never vanishes), Rejected = `cancelled` — a refusal CLOSES the doc, the
 * workflow never writes a `rejected` status. See `RequisitionApprovalStatus`.
 */
export function RequisitionApprovals({
	status,
	onStatusChange,
}: {
	status: ApprovalStatusFilterValue;
	onStatusChange: (value: ApprovalStatusFilterValue) => void;
}) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [decision, setDecision] = useState<PendingDecision | null>(null);
	const [rejectReason, setRejectReason] = useState('');
	const [busyId, setBusyId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// The signed-in employee — used ONLY to withhold decision actions on one's own
	// request (the server 409s a self-approval). Memoized/coalesced upstream.
	const me = useQuery({ queryKey: ['current-employee'], queryFn: fetchCurrentEmployee, staleTime: 60_000 });
	const myId = me.data?.id ?? null;

	// One query per decision chip — the SERVER scopes the slice AND attaches the
	// items, so switching the chip reads exactly what is shown.
	const list = useCursorList({
		queryKey: qk.approvalRequisitions(status),
		fetcher: (cursor) => fetchRequisitionApprovalPage(status, cursor),
		staleTime: REQUISITIONS_STALE_MS,
	});

	// Toolbar search across the SAME decision scope — number / note, rendered with
	// the same card so a result is indistinguishable from the list.
	const search = useBarSearch('Search number / note', (query) => fetchRequisitionApprovalSearch(status, query));

	const refresh = async () => {
		// A decision flips the lifecycle — refresh every status group the requester
		// may return to, so a card's pill is current wherever it remounts.
		await queryClient.invalidateQueries({ queryKey: qk.requisitionsAll(), refetchType: 'active' });
	};

	const openDecision = (row: MroRequisitionCardModel, action: 'approve' | 'reject') => {
		hapticImpact('light');
		setError(null);
		setRejectReason('');
		setDecision({ row, action });
	};

	const closeDecision = () => {
		if (busyId) return;
		setDecision(null);
		setRejectReason('');
		setError(null);
	};

	const confirmDecision = async () => {
		if (!decision || busyId) return;
		const { row, action } = decision;
		const reason = action === 'reject' ? rejectReason.trim() : '';
		if (action === 'reject' && !reason) return;
		setBusyId(row.id);
		setError(null);
		try {
			const current = await fetchCurrentEmployee();
			if (!current) throw new Error('No employee account is linked to this session — someone else must decide this request.');
			// The approver is bound to the SESSION server-side; the id only matters
			// when an admin decides on someone's behalf.
			if (action === 'approve') await approveRequisition(row.id, current.id);
			else await rejectRequisition(row.id, reason);
			hapticImpact('medium');
			notifySaved(action === 'approve' ? 'Request approved' : 'Request closed', row.displayNumber ?? undefined);
			setDecision(null);
			setRejectReason('');
			void refresh();
		} catch (err) {
			hapticImpact('light');
			console.error('[store-requests] decision failed', err);
			setError(err instanceof Error && err.message ? err.message : 'Something went wrong — try again.');
		} finally {
			setBusyId(null);
		}
	};

	// Tap → the request's detail page (which owns ISSUE). The card is HEADER ONLY;
	// its actions row carries the decision verbs. A request can NEVER be approved by
	// its own requester (the server's two-person rule), so the Approve verb renders
	// DISABLED WITH ITS REASON rather than disappearing (Poka-Yoke) — closing the
	// request stays available.
	const renderCard = (request: MroRequisitionCardModel) => {
		const own = myId != null && request.requestedBy.id === myId;
		const pending = status === 'pending';
		return (
			<StoreRequestCard
				key={request.id}
				request={request}
				onOpen={() => navigate(`/app/store-requests/${request.id}`)}
				actions={
					pending ? (
						<div className="flex flex-col items-end gap-1">
							<div className="flex items-center gap-1.5">
								<button
									type="button"
									disabled={busyId !== null}
									onClick={() => openDecision(request, 'reject')}
									className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95 disabled:opacity-40"
								>
									<X className="size-3.5" strokeWidth={2.4} aria-hidden />
									Reject
								</button>
								<button
									type="button"
									disabled={busyId !== null || own}
									onClick={() => openDecision(request, 'approve')}
									title={own ? 'A different employee must approve this request' : undefined}
									className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-bold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95 disabled:opacity-40 disabled:active:scale-100"
								>
									<Check className="size-3.5" strokeWidth={2.6} aria-hidden />
									Approve
								</button>
							</div>
							{own ? (
								<span className="text-meta leading-myanmar text-muted-foreground">Two-person rule — another employee must approve.</span>
							) : null}
						</div>
					) : null
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
					{list.isPending ? (
						<ListSkeleton variant="store-request" />
					) : list.isError && list.rows.length === 0 ? (
						/* A failed read must never read as "nothing to approve". */
						<PageError onRetry={() => void list.refetch()} fill />
					) : (
						/* The list slot GROWS to the body's height, so an empty chip renders its
						   empty state as the whole body instead of a card over a half-empty page. */
						<div className="flex flex-1 flex-col">
							{list.rows.length === 0 ? (
								<EmptyState {...EMPTY_COPY[status]} fill />
							) : (
								<ul className="flex flex-col gap-2.5">{list.rows.map(renderCard)}</ul>
							)}
						</div>
					)}

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

			{/* Approve — a plain confirmation (the decision moves no stock). */}
			<ConfirmSheet
				open={decision?.action === 'approve'}
				title="Approve this request?"
				description={
					decision ? `${decision.row.displayNumber ?? 'This request'} will be approved — the store can then issue stock against it.` : ''
				}
				confirmLabel="Approve"
				busy={busyId !== null}
				error={error}
				onConfirm={() => void confirmDecision()}
				onClose={closeDecision}
			/>

			{/* Reject — a close intent is required (mirrors the detail page's sheet). */}
			<Sheet
				open={decision?.action === 'reject'}
				onOpenChange={(open) => {
					if (!open) closeDecision();
				}}
			>
				<SheetContent side="bottom">
					<SheetHeader className="pb-1">
						<SheetTitle className="leading-myanmar">Close this request?</SheetTitle>
					</SheetHeader>
					<div className="flex flex-col gap-2 px-4 pb-safe">
						{REQUISITION_CLOSE_REASONS.map((option) => (
							<button
								key={option.value}
								type="button"
								disabled={busyId !== null}
								onClick={() => setRejectReason(option.value)}
								className={`flex-1 rounded-xl border px-3 py-2.5 text-left transition-transform duration-150 active:scale-95 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
									rejectReason === option.value ? 'border-primary bg-primary/8' : 'border-border/70 bg-muted/25'
								}`}
							>
								<span className="block text-sm font-medium leading-myanmar text-foreground">{option.label}</span>
								<span className="mt-0.5 block text-xs leading-myanmar text-muted-foreground">{option.hint}</span>
							</button>
						))}
						{error && (
							<p className="rounded-md bg-status-danger-soft px-3 py-2 text-xs font-medium leading-myanmar text-status-danger">{error}</p>
						)}
						<button
							type="button"
							disabled={busyId !== null || rejectReason.trim() === ''}
							onClick={() => void confirmDecision()}
							className="mt-1 w-full rounded-full bg-status-danger px-4 py-2.5 text-sm font-bold leading-myanmar text-white shadow-sm transition-transform duration-150 active:scale-95 disabled:opacity-40 disabled:active:scale-100"
						>
							{busyId !== null ? 'Closing…' : 'Close request'}
						</button>
					</div>
				</SheetContent>
			</Sheet>
		</div>
	);
}
