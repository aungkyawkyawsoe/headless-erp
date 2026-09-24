import { memo, useState } from 'react';
import { ArrowRightLeft, Check } from 'lucide-react';

import { ConfirmSheet } from '@/shared/components/confirm-sheet';
import { DocActionsMenu } from '@/shared/components/doc-actions-menu';
import { ErpRow, type ErpRowMeta } from '@/shared/components/erp-row';
import { cancelCopyOf, useDocCancel } from '@/shared/hooks/use-doc-cancel';
import { hapticSelection } from '@/shared/platform/haptics';
import { MRO_DOC_STATUS_META } from '@/shared/mro';
import { qk } from '../data/query-keys';
import { useTransferConfirm } from '../data/use-transfer-confirm';
import type { TransferCardModel } from '../data/types';

/** "1,200" / "1,200.5" — count display, no trailing zeros. */
function formatCount(value: number | null): string {
	if (value == null || !Number.isFinite(value)) return '—';
	return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** "5 Sep 2026" — the transfer date in English, '—' when unset. */
function dateLabel(date: string | null): string {
	if (!date) return '—';
	const day = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(day.getTime())) return '—';
	return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(day);
}

interface TransferCardProps {
	doc: TransferCardModel;
	/** Tapped the summary — the owning list page opens this doc's FULL-SCREEN
	 *  detail page (the former items bottom sheet is a real route now). */
	onOpen?: (doc: TransferCardModel) => void;
}

/**
 * Transfer row — ONE `mro_transfers` record in the dense ERP grid.
 *
 *   TRF-00007              ← L1 anchor             [Draft] ← status, top-right
 *   Store A → Store B      ← L2 route                    ⋮ ← actions
 *   5 Sep 2026 · 3 items   ← L3                            ⌄
 *
 * The two-role audit trail is behind the disclosure toggle; the draft Confirm
 * control keeps its row action slot (already double-gated by ConfirmSheet). A
 * POSTED move offers the SAME cancel/reverse the other stock documents do — behind
 * the top-right ⋮, one deliberate gesture away from the confirm — and a `cancelled`
 * move offers nothing at all (the engine holds it frozen and final, and the shared
 * menu renders no ⋮ when there is nothing behind it). The moved qty is already the
 * leading tile, so the header does not repeat it.
 */
export const TransferCard = memo(function TransferCard({ doc, onOpen }: TransferCardProps) {
	// The draft confirm — the SAME hook the full-screen detail page uses, so a
	// confirm from either surface refreshes exactly the same caches. Gated behind
	// the shared ConfirmSheet; a success closes it.
	const [confirmOpen, setConfirmOpen] = useState(false);
	const { busy, error, confirm } = useTransferConfirm(doc.id, () => setConfirmOpen(false));
	// The SAME cancel the document page mounts (`@/shared/hooks/use-doc-cancel`) — one
	// verb whose behaviour the DOCUMENT decides, so the list row and the page it opens
	// onto can never promise different things. A posted move's cancel REVERSES it, so
	// the sheet's copy (and the refresh set) come from the shared derivation rather
	// than being re-worded here.
	const [cancelOpen, setCancelOpen] = useState(false);
	const { busy: cancelBusy, error: cancelError, cancel } = useDocCancel({
		kind: 'transfers',
		docId: doc.id,
		docStatus: doc.docStatus,
		listKey: qk.transfersAll(),
		onCancelled: () => setCancelOpen(false),
	});
	const cancelCopy = cancelCopyOf('transfers', doc.docStatus);

	const statusMeta = MRO_DOC_STATUS_META[doc.docStatus] ?? MRO_DOC_STATUS_META.draft;
	const isDraft = doc.docStatus === 'draft';
	// A cancelled move is final — it offers no action at all, only its record.
	const isCancelled = doc.docStatus === 'cancelled';
	const confirmed = doc.docStatus === 'confirmed';
	const dateLabelText = dateLabel(doc.transferDate);
	const itemCount = doc.lineCount ?? doc.totalQty;
	const itemText = `${itemCount != null && Number.isFinite(itemCount) ? itemCount : '—'} ${itemCount === 1 ? 'item' : 'items'}`;
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
				// The route is the identity of a transfer — from → to on one line.
				secondary={
					<span className="inline-flex min-w-0 items-center gap-1">
						<span className="truncate">{doc.fromLabel ?? '—'}</span>
						<ArrowRightLeft className="size-3 shrink-0" aria-hidden />
						<span className="truncate">{doc.toLabel ?? '—'}</span>
					</span>
				}
				tertiary={[dateLabelText, itemText].filter(Boolean).join(' · ')}
				status={{ label: statusMeta.label, className: statusMeta.className }}
				leading={
					<span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-sm font-extrabold tabular-nums text-primary">
						{qtyText ?? '—'}
					</span>
				}
				meta={details}
				onOpen={open}
				// The row's bottom strip is the DRAFT's job (Confirm). The ONE cancel — which
				// REVERSES a posted move — is a deliberate second gesture, in the top-right ⋮.
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
							{error && <p className="text-center text-meta font-medium leading-myanmar text-destructive">{error}</p>}
							{cancelError && <p className="text-center text-meta font-medium leading-myanmar text-destructive">{cancelError}</p>}
						</div>
					)
				}
				menu={
					// The SAME cancel the document page mounts (`@/shared/hooks/use-doc-cancel`) —
					// one verb whose behaviour the DOCUMENT decides, so the list row and the page it
					// opens onto can never promise different things.
					isCancelled ? undefined : (
						<DocActionsMenu
							docNumber={doc.displayNumber}
							noun="this transfer"
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
				title="Confirm this transfer?"
				description="Confirming moves the stock between the two stores. A posted move can still be reversed by cancelling it — the stock goes back to the source store."
				busy={busy}
				error={error}
				onConfirm={() => void confirm()}
				onClose={() => setConfirmOpen(false)}
			/>

			{/* ONE cancel sheet for a draft AND a posted move — the same copy derivation
			 *  the document page uses, because the server's answer is the same verb. */}
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
