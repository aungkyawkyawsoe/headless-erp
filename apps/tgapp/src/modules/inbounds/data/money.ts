import type { MroDocStatus } from '@/shared/mro';

import type { InboundPaymentStatus } from './payments';

/**
 * The receipt's money state as the VIEW derives it from the engine's mirror
 * columns (`totalAmount` / `paidAmount` / `paymentStatus`).
 *
 * PURE and shared — the card's strip and the payment sheet's summary read the SAME
 * object, so "how much is left" and "how full is the bar" cannot disagree between
 * the row and the sheet that row opens. The engine remains the sole author of the
 * underlying figures (its denorm hook derives them from the live ledger); this is
 * presentation arithmetic on top of them, nothing more.
 */
export interface MoneyState {
	/** The receipt's total, or null when it is absent / not a positive number. */
	total: number | null;
	/** Paid so far (0 when unset). */
	paid: number;
	/** Still owed, clamped at 0 — null when there is no total to compare against. */
	left: number | null;
	/** 0–100, clamped; 0 when there is no total. */
	percent: number;
	/** Whether a total exists at all (an unpriced/draft receipt has none). */
	hasTotal: boolean;
	/** `payment_status === 'paid'` — i.e. the ledger has cleared the total. */
	settled: boolean;
}

/** Derive the display money state from a receipt header's mirror columns. */
export function moneyStateOf(input: {
	totalAmount: number | null;
	paidAmount: number | null;
	paymentStatus: InboundPaymentStatus | null;
}): MoneyState {
	const raw = input.totalAmount;
	const hasTotal = raw != null && Number.isFinite(raw) && raw > 0;
	const total = hasTotal ? raw : null;
	const paid = input.paidAmount ?? 0;
	// Rounded to satang-free cents so a float sum (`0.1 + 0.2`) never renders as a
	// long tail, and clamped because an over-payment is legal (it settles the doc).
	const left = total != null ? Math.max(0, Math.round((total - paid) * 100) / 100) : null;
	const percent = total != null ? Math.min(100, Math.max(0, Math.round((paid / total) * 100))) : 0;
	return { total, paid, left, percent, hasTotal, settled: input.paymentStatus === 'paid' };
}

/**
 * Whether a payment may be recorded against this receipt AT ALL — the ledger's own
 * precondition, which the server enforces too: the document must be CONFIRMED
 * (never a draft, never a cancelled one) and PRICED. One rule, because three
 * surfaces ask it — the list row, the detail page's card, and the sheet they open
 * — so none of them can offer a payment the engine would refuse.
 */
export function canPayOf(input: {
	docStatus: MroDocStatus;
	totalAmount: number | null;
	paidAmount: number | null;
	paymentStatus: InboundPaymentStatus | null;
}): boolean {
	const settledDoc = input.docStatus !== 'draft' && input.docStatus !== 'cancelled';
	return settledDoc && moneyStateOf(input).hasTotal;
}

/**
 * Whether the app still ASKS for a payment — the narrow reading of the rule above,
 * and what every "record a payment" affordance is gated on.
 *
 * `canPayOf` answers what the LEDGER accepts, and the ledger accepts a payment on a
 * settled receipt (`paid ≥ total` settles it; the money is immutable once filed, so
 * refusing the extra instalment would push a real payment into a corner it cannot
 * be recorded in). But once nothing is OWED, asking again is noise: the reader gets
 * a form whose every answer is "no", and the receipt's story is its history. So the
 * mini app stops asking — the generic API stays open for a deliberate over-payment
 * from Studio / the CLI, which is the only caller that can mean it.
 *
 * Kept apart from `canPayOf` on purpose: a settled receipt still shows its money
 * face and still opens its sheet (the ledger is there to be REVIEWED, and a wrong
 * entry removed) — only the form goes.
 */
export function expectsPaymentOf(input: {
	docStatus: MroDocStatus;
	totalAmount: number | null;
	paidAmount: number | null;
	paymentStatus: InboundPaymentStatus | null;
}): boolean {
	return canPayOf(input) && !moneyStateOf(input).settled;
}

/**
 * The progress bar's fill tone for the CARD's strip (the list row and the detail
 * page it opens onto): settled is emerald, partially paid amber, untouched a
 * neutral grey. The payment SHEET draws a deliberately NEUTRAL bar — it opens the
 * one receipt the reader asked about, so there the figure carries the state and a
 * hue beside it would only repeat it.
 */
export function barTone(status: InboundPaymentStatus | null): string {
	return status === 'paid' ? 'bg-status-success' : status === 'partial' ? 'bg-status-warning' : 'bg-muted-foreground/30';
}
