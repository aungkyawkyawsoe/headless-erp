/**
 * Fluid fill status vocabulary — the engine's system `doc_status` surfaced as
 * the card badges + confirm affordance. Every `veh_fluid_fills` row carries
 * `doc_status` (default `draft` at create; the engine validates every
 * transition server-side: draft → pending_review → approved / cancelled).
 * Fills recorded before this surfaced the column never left `draft` — they
 * read as `pending` until confirmed.
 */

export type FillStatus = 'pending' | 'confirmed' | 'cancelled';

/** Badge copy + tone per UI status (English — the fluid screens' copy). */
export const FILL_STATUS_META: Record<FillStatus, { label: string; className: string }> = {
	pending: { label: 'Pending', className: 'bg-status-warning-soft text-status-warning' },
	confirmed: { label: 'Confirmed', className: 'bg-status-success-soft text-status-success' },
	cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
};

/** System `doc_status` → the card's UI status.
 *  - `approved` / MRO-style `confirmed` / `approved_l{n}` → Confirmed
 *  - `cancelled` / `rejected` → Cancelled
 *  - everything else (`''` / null / `draft` / `submitted` / `pending_review`)
 *    → Pending — the review queue. */
export function fillStatusOf(docStatus: string | null | undefined): FillStatus {
	const s = String(docStatus ?? '').toLowerCase();
	if (s === 'approved' || s === 'confirmed' || s.startsWith('approved_l')) return 'confirmed';
	if (s === 'cancelled' || s === 'rejected') return 'cancelled';
	return 'pending';
}

/** Whether a pending row can be CONFIRMED from the app — the engine's legal
 *  ladder reaches `approved` from every one of these (`draft → pending_review
 *  → approved`, `submitted/pending_review → approved`). Cancelled/rejected
 *  rows are terminal in the app (the engine only lets them reopen to draft). */
export function canConfirmFill(docStatus: string | null | undefined): boolean {
	const s = String(docStatus ?? '').toLowerCase();
	return s === '' || s === 'draft' || s === 'submitted' || s === 'pending_review';
}

/**
 * Whether a fill may be CORRECTED — only a row that has NOT been posted yet.
 * A CONFIRMED fill is a posted service fact (it moved the truck's care state);
 * editing it would rewrite history, so its correction path is a NEW fill, not an
 * edit. A cancelled row is terminal too. The ONE rule every surface reads: the
 * history card hides its Edit action and the edit page refuses a non-newest or
 * already-posted row.
 */
export function canEditFill(docStatus: string | null | undefined): boolean {
	return fillStatusOf(docStatus) === 'pending';
}
