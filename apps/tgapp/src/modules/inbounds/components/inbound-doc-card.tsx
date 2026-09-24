import { memo, useState } from 'react';
import { Check, Truck } from 'lucide-react';

import { ConfirmSheet } from '@/shared/components/confirm-sheet';
import { DocActionsMenu } from '@/shared/components/doc-actions-menu';
import { ErpRow, type ErpRowMeta } from '@/shared/components/erp-row';
import { hapticSelection } from '@/shared/platform/haptics';
import { MRO_DOC_STATUS_META } from '@/shared/mro';
import { cancelCopyOf, useDocCancel } from '@/shared/hooks/use-doc-cancel';
import { dateLabel, formatCount } from '../data/display';
import { INBOUND_TYPE_META } from '../data/meta';
import { qk } from '../data/query-keys';
import { useInboundConfirm } from '../data/use-inbound-confirm';
import { InboundPurchaseCard } from './inbound-purchase-card';
import type { InboundCardModel } from '../data/types';

interface InboundDocCardProps {
	doc: InboundCardModel;
	/** Tapped the summary — the owning list page opens this doc's FULL-SCREEN
	 *  detail page (the former items bottom sheet is a real route now). */
	onOpen?: (doc: InboundCardModel) => void;
}

/**
 * Inbound (GRN) row — ONE `mro_inbounds` record in the dense ERP grid.
 *
 *   INB-00031                ← L1 anchor        [Confirmed] ← status, top-right
 *   Yangon Supplier Co.      ← L2 party                    ⋮ ← actions
 *   Purchase · 5 Sep · 3 items ← L3                          ⌄
 *
 * The top-right corner is the LIFECYCLE — the status pill and the document's ⋮ (the
 * ONE cancel, which REVERSES a posted receipt rather than merely flipping a draft) —
 * because that is what a scan of this list is deciding, and a destructive, final
 * reversal does not belong one fat-finger away from the confirm just pressed. The
 * total rides the disclosure facts; the row carries no money of its own. The draft
 * Confirm control keeps its row action slot.
 */
export const InboundDocCard = memo(function InboundDocCard({ doc, onOpen }: InboundDocCardProps) {
	// PURCHASE receipts get the money-first face (payment state + its own sheet);
	// an opening balance / return owes nobody, so it keeps the dense row — the same
	// per-kind split the create form and the engine's own rules follow.
	if (doc.type === 'purchase') return <InboundPurchaseCard doc={doc} onOpen={onOpen} />;

	return <InboundHandoffCard doc={doc} onOpen={onOpen} />;
});

/** The opening-balance / return row — no money, so the dense ERP row stands. */
const InboundHandoffCard = memo(function InboundHandoffCard({ doc, onOpen }: InboundDocCardProps) {
	// The draft confirm — the SAME hook the full-screen detail page uses, so a
	// confirm from either surface refreshes exactly the same caches. Gated behind
	// the shared ConfirmSheet; a success closes it.
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [cancelOpen, setCancelOpen] = useState(false);
	const { busy, error, confirm } = useInboundConfirm(doc.id, () => setConfirmOpen(false));
	// The shared cancel (`@/shared/hooks/use-doc-cancel`) — a draft flips, a posted
	// opening balance / return is REVERSED, a replay is a no-op. A serial RETURN is
	// the one shape the server refuses to reverse (the units' prior holder is no
	// longer recorded) and it says exactly that, so the row still offers the action:
	// the refusal is the instruction ("re-issue them from the store instead").
	const { busy: cancelBusy, error: cancelError, cancel } = useDocCancel({
		kind: 'inbounds',
		docId: doc.id,
		docStatus: doc.docStatus,
		listKey: qk.inboundsAll(),
		onCancelled: () => setCancelOpen(false),
	});
	const cancelCopy = cancelCopyOf('inbounds', doc.docStatus);

	const statusMeta = MRO_DOC_STATUS_META[doc.docStatus] ?? MRO_DOC_STATUS_META.draft;
	const typeMeta = INBOUND_TYPE_META[doc.type];
	const isDraft = doc.docStatus === 'draft';
	// A cancelled document is final — no actions at all, only its record.
	const isCancelled = doc.docStatus === 'cancelled';

	// The identity line under the doc number — the counterparty of the receipt:
	// the vendor for a purchase, the EMPLOYEE for a return (who handed the goods
	// back) or an opening balance (who handed the stock over); a doc with neither
	// falls back to the receiving store.
	const partyLabel = doc.supplierName ?? doc.handedByName ?? doc.locationLabel ?? doc.location ?? '—';
	const dateLabelText = dateLabel(doc.purchaseDate);
	const amountText = doc.totalAmount != null && Number.isFinite(doc.totalAmount) ? `${formatCount(doc.totalAmount)}` : null;
	const itemCount = doc.lineCount ?? doc.totalQty;
	const itemText = itemCount != null && Number.isFinite(itemCount) ? `${itemCount} ${itemCount === 1 ? 'item' : 'items'}` : null;

	const details: ErpRowMeta[] = [
		{ label: 'Type', value: typeMeta.tagLabel },
		{ label: 'Date', value: dateLabelText },
		{ label: 'Total', value: amountText ? `${amountText} Ks` : '—' },
		{ label: 'Items', value: itemText ?? '—' },
	];

	const open = () => {
		hapticSelection();
		onOpen?.(doc);
	};

	return (
		<>
			<ErpRow
				anchor={doc.displayNumber ?? '—'}
				secondary={partyLabel}
				tertiary={[typeMeta.tagLabel, dateLabelText, itemText].filter(Boolean).join(' · ')}
				status={{ label: statusMeta.label, className: statusMeta.className }}
				leading={
					<span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<Truck className="size-4" strokeWidth={2} aria-hidden />
					</span>
				}
				meta={details}
				onOpen={open}
				// The ROW keeps the draft's Confirm (that IS a draft's job) and nothing else:
				// the cancel is destructive and final, so it lives behind the ⋮ instead of
				// beside the button the operator may have just pressed.
				actions={
					isCancelled || !isDraft ? undefined : (
						<div className="flex w-full flex-col gap-1.5">
							<button
								type="button"
								disabled={busy}
								onClick={() => setConfirmOpen(true)}
								className="flex w-full items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sub font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95 disabled:opacity-50 disabled:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								<Check className="size-3.5" strokeWidth={2.4} aria-hidden />
								{busy ? 'Confirming…' : 'Confirm'}
							</button>
							{error && <p className="text-center text-meta font-medium leading-myanmar text-status-danger">{error}</p>}
							{cancelError && <p className="text-center text-meta font-medium leading-myanmar text-status-danger">{cancelError}</p>}
						</div>
					)
				}
				menu={
					isCancelled ? undefined : (
						// The ONE cancel (`@/shared/hooks/use-doc-cancel`) — a draft flips, a posted
						// opening balance / return is REVERSED, a replay is a no-op. A serial RETURN is
						// the one shape the server refuses to reverse (the units' prior holder is no
						// longer recorded) and it says exactly that, so the entry still stands: the
						// refusal is the instruction ("re-issue them from the store instead").
						<DocActionsMenu
							docNumber={doc.displayNumber}
							noun="this receipt"
							primary={isDraft ? { label: 'Confirm', onSelect: () => setConfirmOpen(true), disabled: busy } : null}
							cancel={{ label: cancelCopy.label, onSelect: () => setCancelOpen(true), disabled: cancelBusy }}
						/>
					)
				}
			>
				{doc.note ? (
					<p className="line-clamp-2 border-l-2 border-border pl-2.5 text-meta leading-myanmar text-muted-foreground">{doc.note}</p>
				) : null}
			</ErpRow>

			<ConfirmSheet
				open={confirmOpen}
				title="Confirm this receipt?"
				description="Confirming posts these items into stock. A posted receipt can be reversed later by cancelling it — the stock comes back out."
				busy={busy}
				error={error}
				onConfirm={() => void confirm()}
				onClose={() => setConfirmOpen(false)}
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
