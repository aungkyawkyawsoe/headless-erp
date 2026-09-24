import { memo, useState } from 'react';
import { Check } from 'lucide-react';

import { ConfirmSheet } from '@/shared/components/confirm-sheet';
import { DocActionsMenu } from '@/shared/components/doc-actions-menu';
import { ErpRow, type ErpRowMeta } from '@/shared/components/erp-row';
import { cancelCopyOf, useDocCancel } from '@/shared/hooks/use-doc-cancel';
import { hapticSelection } from '@/shared/platform/haptics';
import { MRO_DOC_STATUS_META } from '@/shared/mro';
import { qk } from '../data/query-keys';
import { useAdjustmentApprove } from '../data/use-adjustment-approve';
import type { AdjustmentCardModel } from '../data/types';

/** "1,200" / "1,200.5" — count display, no trailing zeros. */
function formatCount(value: number | null): string {
	if (value == null || !Number.isFinite(value)) return '—';
	return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** "5 Sep 2026" — the adjustment date in English, '—' when unset. */
function dateLabel(date: string | null): string {
	if (!date) return '—';
	const day = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(day.getTime())) return '—';
	return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(day);
}

interface AdjustmentCardProps {
	doc: AdjustmentCardModel;
	/** Tapped the summary — the owning list page opens this doc's FULL-SCREEN
	 *  detail page (the former items bottom sheet is a real route now). */
	onOpen?: (doc: AdjustmentCardModel) => void;
}

/**
 * Adjustment row — ONE `mro_adjustments` record in the dense ERP grid.
 *
 *   AJT-00012          ← L1 anchor                [Confirmed] ← status, top-right
 *   Main Store         ← L2 identity                        ⋮ ← actions
 *   5 Sep 2026 · 3 items ← L3                                 ⌄
 *
 * The two-person audit trail moves behind the disclosure toggle; the draft
 * Approve control (already double-gated by ConfirmSheet) rides the row's action
 * slot so a stock manager can clear the queue without opening each document. The
 * top-right corner is the LIFECYCLE — status + the cancel's ⋮ — and the moved qty
 * is already the leading tile, so it is not repeated in the header.
 */
export const AdjustmentCard = memo(function AdjustmentCard({ doc, onOpen }: AdjustmentCardProps) {
	// The draft approve — the SAME hook the full-screen detail page uses, so an
	// approve from either surface refreshes exactly the same caches. Gated behind
	// the shared ConfirmSheet; a success closes it.
	const [approveOpen, setApproveOpen] = useState(false);
	const [cancelOpen, setCancelOpen] = useState(false);
	const { busy, error, approve } = useAdjustmentApprove(doc.id, () => setApproveOpen(false));
	// The shared cancel (`@/shared/hooks/use-doc-cancel`): a draft flips, an APPROVED
	// correction is REVERSED (an added lot taken back whole, removed stock restored,
	// un-stocked units back on the shelf) — the same action at both ends of the
	// lifecycle, because the DOCUMENT decides which one applies.
	const { busy: cancelBusy, error: cancelError, cancel } = useDocCancel({
		kind: 'adjustments',
		docId: doc.id,
		docStatus: doc.docStatus,
		listKey: qk.adjustmentsAll(),
		onCancelled: () => setCancelOpen(false),
	});
	const cancelCopy = cancelCopyOf('adjustments', doc.docStatus);

	const statusMeta = MRO_DOC_STATUS_META[doc.docStatus] ?? MRO_DOC_STATUS_META.draft;
	const isDraft = doc.docStatus === 'draft';
	const confirmed = doc.docStatus === 'confirmed';
	// A cancelled correction is final — no actions at all, only its record.
	const isCancelled = doc.docStatus === 'cancelled';

	const storeLabel = doc.locationLabel ?? doc.location ?? '—';
	const dateLabelText = dateLabel(doc.adjustmentDate);
	const itemCount = doc.lineCount ?? doc.totalQty;
	const itemText = itemCount != null && Number.isFinite(itemCount) ? `${itemCount} ${itemCount === 1 ? 'item' : 'items'}` : null;
	const qtyText = doc.totalQty != null && Number.isFinite(doc.totalQty) ? formatCount(doc.totalQty) : null;

	const reporter = doc.reported;
	const approver = confirmed ? doc.approved : null;

	const details: ErpRowMeta[] = [
		{ label: 'Reported', value: reporter.name ?? '—' },
		approver ? { label: 'Approved', value: approver.name ?? '—' } : { label: 'Second sign-off', value: 'Awaiting' },
		{ label: 'Date', value: dateLabelText },
	];

	const open = () => {
		hapticSelection();
		onOpen?.(doc);
	};

	return (
		<>
			<ErpRow
				anchor={doc.displayNumber ?? '—'}
				secondary={storeLabel}
				tertiary={[dateLabelText, itemText].filter(Boolean).join(' · ')}
				status={{ label: statusMeta.label, className: statusMeta.className }}
				leading={
					<span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-sm font-extrabold tabular-nums text-primary">
						{qtyText ?? '—'}
					</span>
				}
				meta={details}
				onOpen={open}
				// The row's bottom strip carries the DRAFT's Approve only (that is the stock
				// manager's queue-clearing job). The ONE cancel — which REVERSES an applied
				// correction — lives behind the top-right ⋮, not beside the Approve.
				actions={
					isCancelled || !isDraft ? undefined : (
						<div className="flex w-full flex-col gap-1.5">
							<button
								type="button"
								disabled={busy}
								onClick={() => setApproveOpen(true)}
								className="flex w-full items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sub font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95 disabled:opacity-50 disabled:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								<Check className="size-3.5" strokeWidth={2.4} aria-hidden />
								{busy ? 'Approving…' : 'Approve'}
							</button>
							{error && <p className="text-center text-meta font-medium leading-myanmar text-destructive">{error}</p>}
							{cancelError && <p className="text-center text-meta font-medium leading-myanmar text-destructive">{cancelError}</p>}
						</div>
					)
				}
				menu={
					// The shared cancel (`@/shared/hooks/use-doc-cancel`): a draft flips, an
					// APPROVED correction is REVERSED (an added lot taken back whole, removed stock
					// restored, un-stocked units back on the shelf) — the same action at both ends
					// of the lifecycle, because the DOCUMENT decides which one applies.
					isCancelled ? undefined : (
						<DocActionsMenu
							docNumber={doc.displayNumber}
							noun="this adjustment"
							primary={isDraft ? { label: 'Approve', onSelect: () => setApproveOpen(true), disabled: busy } : null}
							cancel={{ label: cancelCopy.label, onSelect: () => setCancelOpen(true), disabled: cancelBusy }}
						/>
					)
				}
			>
				{doc.description ? (
					<p className="line-clamp-2 border-l-2 border-border pl-2.5 text-meta leading-myanmar text-muted-foreground">{doc.description}</p>
				) : null}
			</ErpRow>

			{/* The confirm sheet portals to <body>, so it lives OUTSIDE the <li> —
			    no phantom margin inside the row, and the list stays a list. */}
			<ConfirmSheet
				open={approveOpen}
				title="Approve this adjustment?"
				description="Approving applies the ± corrections to stock. An approved adjustment can be reversed later by cancelling it."
				confirmLabel="Approve"
				busy={busy}
				error={error}
				onConfirm={() => void approve()}
				onClose={() => setApproveOpen(false)}
			/>

			<ConfirmSheet
				open={cancelOpen}
				title={cancelCopy.title}
				description={cancelCopy.description}
				confirmLabel={cancelCopy.label}
				cancelLabel="Keep it"
				tone="destructive"
				busy={cancelBusy}
				error={cancelError}
				onConfirm={() => void cancel()}
				onClose={() => setCancelOpen(false)}
			/>
		</>
	);
});
