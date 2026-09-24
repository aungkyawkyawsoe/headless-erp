import { memo, useState } from 'react';
import { Check, Truck } from 'lucide-react';

import { ConfirmSheet } from '@/shared/components/confirm-sheet';
import { DocActionsMenu } from '@/shared/components/doc-actions-menu';
import { cancelCopyOf, useDocCancel } from '@/shared/hooks/use-doc-cancel';
import { MRO_DOC_STATUS_META } from '@/shared/mro';
import { hapticSelection } from '@/shared/platform/haptics';
import { dateLabel, money } from '../data/display';
import { INBOUND_TYPE_META } from '../data/meta';
import { canPayOf, expectsPaymentOf, moneyStateOf } from '../data/money';
import { qk } from '../data/query-keys';
import { useInboundConfirm } from '../data/use-inbound-confirm';
import { InboundMoneyStrip, paymentCaption } from './inbound-money-strip';
import { InboundPaymentSheet } from './inbound-payment-sheet';
import type { InboundCardModel } from '../data/types';

/**
 * The PURCHASE receipt card — the money-first face of an inbound (GRN) row on
 * the inbounds LIST, and the document page's money block opener.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ [🚚]  INB-00031                       [ ⋮ ]  │ ← number + vendor + menu
 *   │       Yangon Supplier Co.                    │
 *   │                                              │
 *   │ Total cost                     1,500,000 Ks  │ ← the figure that matters
 *   │ ──────────────────────────────────────────── │
 *   │ Purchase • 20 Sep 2026 • 3 items  [Confirmed]│ ← meta + doc lifecycle pill
 *   │ ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░  (tap → payments)     │ ← how far the money got
 *   │ ┌──────────────────┬─────────────────────┐   │
 *   │ │ Paid             │ Left                │   │ ← what the header does not say
 *   │ │ 1,000,000 Ks     │ 500,000 Ks          │   │
 *   │ └──────────────────┴─────────────────────┘   │
 *   │ Fully paid on 12 Sep 2026 / 500,000 Ks left  │
 *   └──────────────────────────────────────────────┘
 *
 * Three deliberate choices:
 *  - **Money leads, and its state is legible at a glance** — the amount is the top
 *    figure, the bar + the Paid/Left row + the caption all read from the SAME
 *    engine-derived `paid_amount` / `payment_status` / `fully_paid_on`, so a glance
 *    answers "settled? how much left? when did it settle?" without opening anything
 *    (preattentive: a rose Left figure vs an emerald one). The strip deliberately
 *    does NOT repeat the total: it sits ten pixels under `Total cost`, and one
 *    number read twice is ink without information (data-ink ratio).
 *  - **The row stays a LIST ROW** — the flush `divide-y` frame is kept (the list
 *    owns the surface) instead of the reference's floating per-order card, because
 *    a receipt list is scanned in dozens, not one at a time; only the padding and
 *    hierarchy come from the reference.
 *  - **One tap target per intent** (poka-yoke): the row body opens the document,
 *    the money strip opens the PAYMENT sheet, and every state-changing action
 *    (confirm / cancel / record a payment) sits behind the ⋮ menu or an explicit
 *    labelled sheet button — nothing irreversible is implicit in a tap.
 *
 * The document PAGE does not use this card: it renders the receipt as its form
 * (`InboundDocForm`) and mounts `InboundMoneyStrip` directly for the money face,
 * so the fields can be edited there while the money — a derived fact — stays a
 * separate, tappable block.
 */
export const InboundPurchaseCard = memo(function InboundPurchaseCard({
	doc,
	onOpen,
}: {
	doc: InboundCardModel;
	/** Tap the card body to open the document. */
	onOpen?: (doc: InboundCardModel) => void;
}) {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [cancelOpen, setCancelOpen] = useState(false);
	const [paymentsOpen, setPaymentsOpen] = useState(false);
	const { busy, error, confirm } = useInboundConfirm(doc.id, () => setConfirmOpen(false));
	// The SAME cancel the document page mounts (`@/shared/hooks/use-doc-cancel`) — one
	// verb whose behaviour the DOCUMENT decides, so the list row and the page it opens
	// onto can never promise different things. A posted receipt's cancel REVERSES its
	// stock, which is why the sheet's copy (and the refresh set) come from the shared
	// derivation rather than being re-worded here.
	const { busy: cancelBusy, error: cancelError, cancel } = useDocCancel({
		kind: 'inbounds',
		docId: doc.id,
		docStatus: doc.docStatus,
		listKey: qk.inboundsAll(),
		onCancelled: () => setCancelOpen(false),
	});
	const cancelCopy = cancelCopyOf('inbounds', doc.docStatus);

	const statusMeta = MRO_DOC_STATUS_META[doc.docStatus] ?? MRO_DOC_STATUS_META.draft;
	const typeMeta = INBOUND_TYPE_META.purchase;
	const isDraft = doc.docStatus === 'draft';
	// A cancelled receipt is VOID and final — it offers no action at all, only its
	// record (the engine holds it frozen: no reopen, no delete, no money).
	const isCancelled = doc.docStatus === 'cancelled';
	// The counterparty of a receipt: the vendor for a purchase (falls back to the
	// receiving store when a legacy row has none).
	const partyLabel = doc.supplierName ?? doc.locationLabel ?? doc.location ?? '—';
	const itemCount = doc.lineCount ?? doc.totalQty;
	const itemText = itemCount != null && Number.isFinite(itemCount) ? `${itemCount} ${itemCount === 1 ? 'item' : 'items'}` : null;

	// Money state — one shared derivation (`data/money.ts`) the money strip and the
	// payment sheet read too, so no two surfaces can disagree. Two questions, kept
	// apart: `canPayOf` decides whether the money face exists at all (a settled
	// receipt still shows Paid/Left and still opens its ledger), and
	// `expectsPaymentOf` decides whether anything still ASKS for money — the ⋮
	// entry, so a fully paid receipt never offers a menu item with no form behind it.
	const { total, left, hasTotal: hasMoney } = moneyStateOf(doc);
	const canPay = canPayOf(doc);
	const expectsPayment = expectsPaymentOf(doc);
	const open = () => {
		hapticSelection();
		onOpen?.(doc);
	};
	const openPayments = () => {
		hapticSelection();
		setPaymentsOpen(true);
	};

	// The row floats its content over an absolutely-positioned tap button, so each
	// block owns its pointer-events / z order.
	const over = 'pointer-events-none relative z-10 ';
	const overOwn = 'relative z-10 ';

	// Identity: kind icon, number, counterparty, actions.
	const head = (
		<div className={`${over}flex items-start justify-between gap-2`}>
			<div className="flex min-w-0 items-center gap-3">
				<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
					<Truck className="size-5" strokeWidth={2} aria-hidden />
				</span>
				<span className="min-w-0">
					<span className="block truncate text-key font-bold leading-tight tracking-tight text-foreground">{doc.displayNumber ?? '—'}</span>
					<span className="block truncate text-meta leading-myanmar text-muted-foreground">{partyLabel}</span>
				</span>
			</div>

			<DocActionsMenu
				docNumber={doc.displayNumber}
				noun="this receipt"
				extra={expectsPayment ? [{ label: 'Record payment', onSelect: () => setPaymentsOpen(true) }] : []}
				primary={isDraft ? { label: 'Confirm receipt', onSelect: () => setConfirmOpen(true) } : null}
				cancel={isCancelled ? null : { label: cancelCopy.label, onSelect: () => setCancelOpen(true) }}
			/>
		</div>
	);

	// Total cost — the figure the card exists for.
	const headline = (
		<div className={`${over}mt-2.5 flex items-baseline justify-between gap-3`}>
			<span className="text-xs font-medium leading-myanmar text-muted-foreground">Total cost</span>
			<span className="text-lg font-extrabold leading-none tracking-tight text-foreground">{hasMoney ? money(total) : '—'}</span>
		</div>
	);

	// Lifecycle: kind • date • size, and the document's own status pill.
	const factLine = (
		<div className={`${over}flex items-center justify-between gap-2`}>
			<span className="truncate text-meta leading-myanmar text-muted-foreground">
				{[typeMeta.tagLabel, dateLabel(doc.purchaseDate), itemText].filter(Boolean).join(' • ')}
			</span>
			<span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-myanmar ${statusMeta.className}`}>
				{statusMeta.label}
			</span>
		</div>
	);

	// The money face IS the payment sheet's opener: a tap on the figures shows the
	// figures' history, never the document.
	const moneyFace = canPay ? (
		<button
			type="button"
			onClick={openPayments}
			aria-label={`Payments for ${doc.displayNumber ?? 'this receipt'}: ${paymentCaption(doc, left)}`}
			className={`${overOwn}mt-2.5 block w-full rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
		>
			<InboundMoneyStrip doc={doc} />
		</button>
	) : null;

	// A draft's whole job is the confirm — kept as an explicit label on the row; the
	// document page renders its own footer off the same hook instead, so one action
	// is never offered twice in two voices on one screen.
	const draftConfirm = isDraft ? (
		<div className="relative z-10 mt-2.5 flex flex-col gap-1.5">
			<button
				type="button"
				disabled={busy}
				onClick={() => setConfirmOpen(true)}
				className="pointer-events-auto flex w-full items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sub font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:active:scale-100"
			>
				<Check className="size-3.5" strokeWidth={2.4} aria-hidden />
				{busy ? 'Confirming…' : 'Confirm receipt'}
			</button>
			{error && <p className="text-center text-meta font-medium leading-myanmar text-status-danger">{error}</p>}
		</div>
	) : null;

	// The doc's note, when it has one (the reason a receipt exists).
	const noteLine = doc.note ? (
		<p className={`${over}mt-2.5 line-clamp-2 border-l-2 border-border pl-2.5 text-meta leading-myanmar text-muted-foreground`}>
			{doc.note}
		</p>
	) : null;

	// The gates this card can open — ONE definition, so every entry point (the ⋮
	// menu, the money strip's tap, the draft's confirm button) opens the same sheet.
	const sheets = (
		<>
			<ConfirmSheet
				open={confirmOpen}
				title="Confirm this receipt?"
				description={`Confirming posts ${itemText ?? 'these items'} into stock. A posted receipt can be reversed later by cancelling it — the stock comes back out.`}
				busy={busy}
				error={error}
				onConfirm={() => void confirm()}
				onClose={() => setConfirmOpen(false)}
			/>

			{/* ONE cancel sheet for a draft AND a posted receipt — the same copy
			 *  derivation the document page uses, because the server's answer is the
			 *  same verb either way. */}
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

			<InboundPaymentSheet doc={doc} open={paymentsOpen} onOpenChange={setPaymentsOpen} />
		</>
	);

	return (
		<>
			<li className="relative isolate px-3.5 py-3">
				{/* The row's tap target — the whole card opens the document; the ⋮ menu
				 *  and the money strip sit ABOVE it, so each keeps its own intent. */}
				<button
					type="button"
					aria-label={`Open ${doc.displayNumber ?? 'receipt'}`}
					onClick={open}
					className="absolute inset-0 z-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>

				{head}

				{headline}

				<hr className="my-2.5 border-border/60" />

				{factLine}

				{moneyFace}

				{draftConfirm}

				{noteLine}
			</li>

			{sheets}
		</>
	);
});
