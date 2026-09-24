import { useState } from 'react';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';
import { Textarea } from '@mmbix/design-system/textarea';

import { approveAssetTransfer, executeAssetTransfer, fetchTransferPage, fetchTransferSearch, rejectAssetTransfer } from '../data/api';
import { qk, TRANSFERS_STALE_MS } from '../data/query-keys';
import { requestKindOf, type AssetRequestKind, type AssetTransferRow } from '../data/types';
import { MRO_LOCATION_LABELS, type MroLocation } from '@/shared/mro';
import { fetchCurrentEmployee } from '@/modules/attendance/data/api';
import { invalidateDomain } from '@/shared/api/invalidation';
import { BottomActionBar } from '@/shared/components/bottom-action-bar';
import { ConfirmSheet } from '@/shared/components/confirm-sheet';
import { EmptyState } from '@/shared/components/empty-state';
import { PageError } from '@/shared/components/page-error';
import { LoadMoreSentinel } from '@/shared/components/load-more-sentinel';
import { SearchResultsList } from '@/shared/components/search-results-list';
import { ListSkeleton } from '@/shared/components/skeletons';
import { ApprovalStatusFilter, APPROVAL_STATUS_META, type ApprovalStatusFilterValue } from '@/shared/components/approval-status-filter';
import { useBarSearch } from '@/shared/hooks/use-bar-search';
import { useCursorList } from '@/shared/hooks/use-cursor-list';
import { hapticImpact } from '@/shared/platform/haptics';
import { notifySaved } from '@/shared/save-feedback';
import { TransferCard } from './transfer-card';

/** A decision awaiting the confirmation sheet. */
interface PendingDecision {
	row: AssetTransferRow;
	action: 'approve' | 'reject';
}

const EMPTY_COPY: Record<ApprovalStatusFilterValue, { title: string; hint: string }> = {
	pending: { title: 'No transfers to approve', hint: 'Moves, store returns and write-offs filed by your team appear here.' },
	approved: { title: 'No approved requests', hint: 'Approved requests waiting to be executed appear here.' },
	rejected: { title: 'No rejected requests', hint: 'Rejected requests appear here.' },
};

/**
 * What the execute is about to DO, per request kind — the same three shapes the
 * engine dispatches on (`requestKindOf`). An approver must know which change they
 * are authorising: a move relocates the unit, a return puts it back in a store,
 * and a write-off destroys it, so the sheet's copy and its button differ.
 */
const EXECUTE_COPY: Record<AssetRequestKind, { title: string; label: string; describe: (row: AssetTransferRow) => string }> = {
	transfer: {
		title: 'Execute this transfer?',
		label: 'Execute move',
		describe: (row) =>
			`${row.serial_no ?? 'The asset'} will move to ${row.to_plate ?? row.to_employee_name ?? 'the requested holder'}${
				row.to_slot ? ` · ${row.to_slot}` : ''
			}. If the unit has left its recorded source since approval, the move is refused — nothing is relocated silently.`,
	},
	return: {
		title: 'Return this unit to store?',
		label: 'Execute return',
		describe: (row) =>
			`${row.serial_no ?? 'The asset'} goes back into ${
				MRO_LOCATION_LABELS[row.to_location as MroLocation] ?? row.to_location ?? 'the requested store'
			} as in-stock and leaves its holder. If it has left its recorded source since approval, the return is refused.`,
	},
	'write-off': {
		title: 'Write this unit off?',
		label: 'Execute write-off',
		describe: (row) =>
			`${row.serial_no ?? 'The asset'} is scrapped where it sits — it leaves ${
				row.from_plate ?? row.from_employee_name ?? 'its holder'
			} for good and no store balance moves. This cannot be undone, and a unit that has left its recorded source since approval is refused.`,
	},
};

/**
 * The approval center's ASSET tab — the asset-request (ATR) queue.
 *
 * The counterpart of the HR request panel, over a different domain: a governed
 * asset change is filed as a request by the holder (`mro_asset_requests`), decided
 * by a recorded superior, then executed. ONE feed serves all three shapes the
 * table carries — a truck→truck (or person→person) move, a store RETURN, and a
 * WRITE-OFF of a worn-out unit — and each card names the one it is (their buttons
 * differ: "Execute move" ≠ "Execute return" ≠ "Execute write-off"). The feed is
 * APPROVER-SCOPED server-side (`GET /api/mro/asset-requests` — the same rule the
 * decide routes enforce), so this panel can never show a request the decision
 * would 403 on.
 *
 * The status chip maps onto the request lifecycle: To Approve = `requested`,
 * Approved = `approved`+`executed` (the tracking view), Rejected = `rejected`.
 * Approve ≠ execute: the sign-off changes nothing; Execute performs the ONE atomic
 * change pinned to the request's recorded source (a unit that moved since approval
 * is refused, never silently changed) — which is why the execute sits behind a
 * confirmation sheet, while the sign-off uses the reject-reason sheet.
 */
export function AssetApprovals({
	status,
	onStatusChange,
}: {
	status: ApprovalStatusFilterValue;
	onStatusChange: (value: ApprovalStatusFilterValue) => void;
}) {
	const queryClient = useQueryClient();
	const [decision, setDecision] = useState<PendingDecision | null>(null);
	const [rejectReason, setRejectReason] = useState('');
	const [executeRow, setExecuteRow] = useState<AssetTransferRow | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// One query per status chip — the server scopes the slice, so switching the
	// chip reads exactly what is shown (no fetched row is ever hidden client-side).
	const list = useCursorList({
		queryKey: qk.transfers(status),
		fetcher: (cursor) => fetchTransferPage(status, cursor),
		staleTime: TRANSFERS_STALE_MS,
	});

	// Toolbar search across EVERY status the approver may see — the "track it" read
	// (a serial / plate / ATR number resolves a request wherever it is).
	const search = useBarSearch('Search serial / plate / ATR', (query) => fetchTransferSearch(query));

	// A decided request leaves its chip AND (on execute) moves the asset: refresh
	// the feed and the tyre/asset registers the move rewrote.
	const refresh = async () => {
		await queryClient.invalidateQueries({ queryKey: qk.transfersAll() });
		await invalidateDomain(queryClient, 'tyres');
	};

	const openDecision = (row: AssetTransferRow, action: 'approve' | 'reject') => {
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
			// The approver is bound to the SESSION server-side; the id is only used
			// when an admin decides on someone's behalf.
			const me = await fetchCurrentEmployee();
			if (action === 'approve') await approveAssetTransfer(row.id, me?.id);
			else await rejectAssetTransfer(row.id, reason, me?.id);
			hapticImpact('medium');
			// Confirm the decision before the list refetch — see hr-approvals.
			const kind = requestKindOf(row);
			const noun = kind === 'write-off' ? 'Write-off' : kind === 'return' ? 'Return' : 'Transfer';
			notifySaved(action === 'approve' ? `${noun} approved` : `${noun} rejected`, row.serial_no ?? undefined);
			setDecision(null);
			setRejectReason('');
			void refresh();
		} catch (err) {
			hapticImpact('light');
			console.error('[asset-transfers] decision failed', err);
			setError(err instanceof Error && err.message ? err.message : 'Something went wrong — try again.');
		} finally {
			setBusyId(null);
		}
	};

	const confirmExecute = async () => {
		if (!executeRow || busyId) return;
		setBusyId(executeRow.id);
		setError(null);
		try {
			const me = await fetchCurrentEmployee();
			await executeAssetTransfer(executeRow.id, me?.id);
			hapticImpact('medium');
			notifySaved('Move executed', executeRow.serial_no ?? undefined);
			setExecuteRow(null);
			void refresh();
		} catch (err) {
			hapticImpact('light');
			console.error('[asset-transfers] execute failed', err);
			setError(err instanceof Error && err.message ? err.message : 'Could not execute the move — refresh and try again.');
		} finally {
			setBusyId(null);
		}
	};

	const renderCard = (row: AssetTransferRow) => (
		<TransferCard
			key={row.id}
			row={row}
			busy={busyId === row.id}
			onApprove={(target) => openDecision(target, 'approve')}
			onReject={(target) => openDecision(target, 'reject')}
			onExecute={(target) => {
				hapticImpact('light');
				setError(null);
				setExecuteRow(target);
			}}
		/>
	);

	const dialogRow = decision?.row ?? null;

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
						<ListSkeleton variant="approval" />
					) : list.isError && list.rows.length === 0 ? (
						/* A failed read must never read as "no transfers to decide". */
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

			{/* Decision sheet — approve confirms; reject requires a reason. */}
			<Sheet
				open={decision !== null}
				onOpenChange={(open) => {
					if (!open) closeDecision();
				}}
			>
				<SheetContent side="bottom" showCloseButton={false} className="rounded-t-3xl">
					<SheetHeader className="flex-row items-center justify-between gap-3 pb-1">
						<SheetTitle className="leading-myanmar">
							{decision?.action === 'approve' ? 'Approve this transfer?' : 'Reject this transfer?'}
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

					<div className="max-h-[62dvh] overflow-y-auto overscroll-contain px-4">
						{dialogRow ? (
							<p className="text-sm leading-myanmar text-muted-foreground">
								<span className="font-semibold text-foreground">{dialogRow.serial_no ?? 'This asset'}</span>
								{dialogRow.display_number ? ` · ${dialogRow.display_number}` : ''} will be{' '}
								{decision?.action === 'approve' ? 'approved (the change is executed separately)' : 'rejected'}. Continue?
							</p>
						) : null}

						{decision?.action === 'reject' ? (
							<div className="mt-4">
								<label htmlFor="atr-reject-reason" className="text-sm font-semibold leading-myanmar text-foreground">
									Rejection Reason <span className="text-status-danger">*</span>
								</label>
								<Textarea
									id="atr-reject-reason"
									value={rejectReason}
									onChange={(event) => setRejectReason(event.target.value)}
									rows={3}
									placeholder="Why is this request refused?"
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
							disabled={busyId !== null || (decision?.action === 'reject' && rejectReason.trim() === '')}
							onClick={() => void confirmDecision()}
							className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-bold leading-myanmar shadow-sm transition-transform duration-150 active:scale-95 disabled:opacity-40 disabled:active:scale-100 ${
								decision?.action === 'approve' ? 'bg-primary text-primary-foreground' : 'bg-status-danger text-white'
							}`}
						>
							{busyId !== null ? 'Submitting…' : decision?.action === 'approve' ? 'Approve' : 'Reject'}
						</button>
					</div>
				</SheetContent>
			</Sheet>

			{/* Execute — the irreversible change (pin-guarded server-side), named after
			    the kind the row actually is. */}
			<ConfirmSheet
				open={executeRow !== null}
				title={executeRow ? EXECUTE_COPY[requestKindOf(executeRow)].title : 'Execute this request?'}
				description={executeRow ? EXECUTE_COPY[requestKindOf(executeRow)].describe(executeRow) : ''}
				confirmLabel={executeRow ? EXECUTE_COPY[requestKindOf(executeRow)].label : 'Execute'}
				busy={busyId !== null}
				error={error}
				onConfirm={() => void confirmExecute()}
				onClose={() => {
					if (busyId) return;
					setExecuteRow(null);
					setError(null);
				}}
			/>
		</div>
	);
}
