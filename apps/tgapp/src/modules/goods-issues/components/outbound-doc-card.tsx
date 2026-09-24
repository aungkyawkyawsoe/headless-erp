import { memo, useState } from 'react';
import { Check, PackageMinus } from 'lucide-react';

import { ConfirmSheet } from '@/shared/components/confirm-sheet';
import { DocActionsMenu } from '@/shared/components/doc-actions-menu';
import { ErpRow, type ErpRowMeta } from '@/shared/components/erp-row';
import { cancelCopyOf, useDocCancel } from '@/shared/hooks/use-doc-cancel';
import { hapticSelection } from '@/shared/platform/haptics';
import { MRO_DOC_STATUS_META } from '@/shared/mro';
import { dateLabel, formatCount, sourceRequestClosedReason } from '../data/display';
import { OUTBOUND_TYPE_META } from '../data/meta';
import { qk } from '../data/query-keys';
import { useOutboundConfirm } from '../data/use-outbound-confirm';
import { REQUISITION_STATUS_META, REQUISITION_STATUS_VALUES } from '@/modules/store-requests/data/status';
import type { RequisitionStatus } from '@/modules/store-requests/data/types';
import type { OutboundCardModel } from '../data/types';

interface OutboundDocCardProps {
	doc: OutboundCardModel;
	/** Tapped the summary — the owning list page opens this doc's FULL-SCREEN
	 *  detail page (the former items bottom sheet is a real route now). */
	onOpen?: (doc: OutboundCardModel) => void;
}

/**
 * Outbound (goods issue) row — ONE `mro_outbounds` record in the dense ERP grid,
 * shared by the three outbound screens (ထုတ်ပေးမှု / ပယ်ဖျက် / ချို့ယွင်း-စွန့်ပစ်;
 * only the `type` filter differs).
 *
 *   OUT-00018              ← L1 anchor              [Confirmed] ← status, top-right
 *   Main Store             ← L2 identity                     ⋮ ← actions
 *   Issue · 5 Sep · 3 items · → TRK-X ← L3                    ⌄
 *
 * The destination (`to_vehicle` / `to_employee`) rides the L3 scan line and the
 * disclosure: on a goods issue it is the decisive fact — WHERE the units went —
 * so a holder's name is never buried one tap deep. The linked source requisition
 * and the issuer move behind the disclosure toggle, and the draft Confirm control
 * keeps its row action slot.
 *
 * The header carries NO money: the top-right corner is the LIFECYCLE — the status
 * pill and the document's ⋮ — because that is what a scan of this list is deciding
 * (draft vs posted, and what can still be done about it). The total rides the
 * disclosure facts instead of being read twice in two registers.
 */
export const OutboundDocCard = memo(function OutboundDocCard({ doc, onOpen }: OutboundDocCardProps) {
	// The draft confirm — the SAME hook the full-screen detail page uses, so a
	// confirm from either surface refreshes exactly the same caches. Gated behind
	// the shared ConfirmSheet; a success closes it.
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [cancelOpen, setCancelOpen] = useState(false);
	const { busy, error, confirm } = useOutboundConfirm(doc.id, () => setConfirmOpen(false));
	// The shared cancel (`@/shared/hooks/use-doc-cancel`): for a POSTED issue this
	// REVERSES it — every unit back to the store, the source request's fulfilment
	// recomputed — so the same action serves both ends of the lifecycle and the copy
	// says which one is about to happen.
	const { busy: cancelBusy, error: cancelError, cancel } = useDocCancel({
		kind: 'outbounds',
		docId: doc.id,
		docStatus: doc.docStatus,
		listKey: qk.outboundsAll(),
		touchesStoreRequests: true,
		onCancelled: () => setCancelOpen(false),
	});
	const cancelCopy = cancelCopyOf('outbounds', doc.docStatus);

	const statusMeta = MRO_DOC_STATUS_META[doc.docStatus] ?? MRO_DOC_STATUS_META.draft;
	const typeMeta = OUTBOUND_TYPE_META[doc.type];
	const isDraft = doc.docStatus === 'draft';
	// A cancelled document is final — no actions at all, only its record.
	const isCancelled = doc.docStatus === 'cancelled';

	const storeLabel = doc.locationLabel ?? doc.location ?? '—';
	const dateLabelText = dateLabel(doc.effectiveDate);
	const amountText = doc.totalAmount != null && Number.isFinite(doc.totalAmount) ? `${formatCount(doc.totalAmount)}` : null;
	const itemCount = doc.lineCount ?? doc.totalQty;
	const itemText = itemCount != null && Number.isFinite(itemCount) ? `${itemCount} ${itemCount === 1 ? 'item' : 'items'}` : null;

	// The linked source requisition — shown on a goods-issue that references one.
	const requestLabel = doc.requestRef?.label ?? null;
	const rawStatus = doc.requestRef?.requisitionStatus ?? null;
	const requestStatus = rawStatus
		? (REQUISITION_STATUS_VALUES as readonly string[]).includes(rawStatus)
			? (rawStatus as RequisitionStatus)
			: null
		: null;
	const requestMeta = requestStatus ? REQUISITION_STATUS_META[requestStatus] : null;
	const issuedByName = doc.issuedBy.name?.trim() || null;

	// A draft whose SOURCE REQUEST is already closed can never confirm (the server
	// refuses) — disable Confirm with the reason instead of failing on submit.
	const blockedReason = sourceRequestClosedReason(requestStatus, requestLabel);

	const details: ErpRowMeta[] = [
		{ label: 'Type', value: typeMeta.tagLabel },
		{ label: 'Date', value: dateLabelText },
		{ label: 'Total', value: amountText ? `${amountText} Ks` : '—' },
		// Where the item-by-item units went — the truck's inventory or a person's
		// custody. Absent (not a dash) when the doc names no holder, so a write-off
		// reads without a meaningless row.
		...(doc.destination ? [{ label: 'Issued to', value: doc.destination }] : []),
		...(requestLabel ? [{ label: 'From request', value: `${requestLabel}${requestMeta ? ` · ${requestMeta.label}` : ''}` }] : []),
		...(issuedByName ? [{ label: 'Issued by', value: issuedByName }] : []),
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
				tertiary={[typeMeta.tagLabel, dateLabelText, itemText, doc.destination ? `→ ${doc.destination}` : null].filter(Boolean).join(' · ')}
				status={{ label: statusMeta.label, className: statusMeta.className }}
				leading={
					<span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<PackageMinus className="size-4" strokeWidth={2} aria-hidden />
					</span>
				}
				meta={details}
				onOpen={open}
				// The row's bottom strip is the DRAFT's job only: confirm (or, when its source
				// request is closed, the reason it cannot). The ONE cancel is not a neighbour of
				// the confirm — a posted issue's cancel REVERSES the move — so it sits behind the
				// top-right ⋮, one deliberate gesture away.
				actions={
					isCancelled || !isDraft ? undefined : (
						<div className="flex w-full flex-col gap-1.5">
							{/* A live draft's job is the confirm … */}
							{!blockedReason && (
								<button
									type="button"
									disabled={busy}
									onClick={() => setConfirmOpen(true)}
									className="flex w-full items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sub font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95 disabled:opacity-50 disabled:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									<Check className="size-3.5" strokeWidth={2.4} aria-hidden />
									{busy ? 'Confirming…' : 'Confirm'}
								</button>
							)}
							{/* … and a DEAD draft (its source request is closed) has ONE sensible action:
							    clear it. No disabled Confirm button — just the reason and the way out. */}
							{blockedReason && <p className="text-center text-meta leading-myanmar text-status-warning">{blockedReason}</p>}
							{error && <p className="text-center text-meta font-medium leading-myanmar text-destructive">{error}</p>}
							{cancelError && <p className="text-center text-meta font-medium leading-myanmar text-destructive">{cancelError}</p>}
						</div>
					)
				}
				menu={
					// The shared cancel (`@/shared/hooks/use-doc-cancel`): for a POSTED issue this
					// REVERSES it — every unit back to the store, the source request's fulfilment
					// recomputed — so the same action serves both ends of the lifecycle, and the
					// menu's label (the shared `cancelCopyOf` derivation) says which one happens.
					isCancelled ? undefined : (
						<DocActionsMenu
							docNumber={doc.displayNumber}
							noun="this issue"
							primary={isDraft && !blockedReason ? { label: 'Confirm', onSelect: () => setConfirmOpen(true), disabled: busy } : null}
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
				title="Confirm this issue?"
				description="Confirming issues these items out of stock. A posted issue can be reversed later by cancelling it — the units come back to the store."
				busy={busy}
				error={error}
				onConfirm={() => void confirm()}
				onClose={() => setConfirmOpen(false)}
			/>

			{/* ONE cancel sheet for a draft AND a posted issue — the server's answer is the
			 *  same verb either way, so the copy comes from the shared derivation. */}
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
