/** `mro_inbound_payments` — ONE payment made against a purchase receipt.
 *
 *  The ledger is the TRUTH for "how much has been paid": the receipt header's
 *  `paid_amount` / `payment_status` / `fully_paid_on` are derived from it by a
 *  compiled denorm hook on every write, so the card can show money state from the
 *  list read alone.
 *
 *  The mini app asks for the only two facts an operator filing a payment actually
 *  knows: WHEN the money went out and HOW MUCH. `method` / `reference` remain on
 *  the collection — Studio, the CLI and imports file through the generic API and
 *  use them — and `method` is schema-required, so the engine fills its own declared
 *  default (`cash`) when this client omits it. A picker here would have collected a
 *  noisy, unverifiable answer (whatever chip happened to be left selected) on every
 *  single payment, for a field nobody down this flow reads. */
export interface MroInboundPaymentRow {
	id: string;
	/** The receipt (`mro_inbounds`) this payment belongs to. */
	parent_id?: string | null;
	/** `YYYY-MM-DD` — the day the money went out. */
	paid_on?: string | null;
	amount?: number | null;
	/** `cash` | `bank` | `cheque` | `other` — ENGINE-filled from the schema default
	 *  when the mini app omits it. Never sent nor rendered by this client. */
	method?: string | null;
	/** Cheque no / bank ref — free text (Studio/CLI filers only). */
	reference?: string | null;
	note?: string | null;
	/** m2o to `hrm_employees` — session-stamped; a bare id or an expanded row. */
	recorded_by?: string | { id: string; name_en?: string | null } | null;
	created_at?: string | null;
}

/** One ledger entry as the payment sheet renders it (recorder name resolved). */
export interface InboundPaymentModel {
	id: string;
	/** `YYYY-MM-DD` — the day the money went out; the row's date stamp. */
	paidOn: string | null;
	amount: number;
	/** Free text a Studio/CLI filer may have added — shown when present. */
	note: string | null;
	recordedByName: string | null;
}

/** The receipt's payment state, replicated on the header by the denorm hook. */
export type InboundPaymentStatus = 'unpaid' | 'partial' | 'paid';

/** The payment-status pill meta (label + tone) — one map for card and detail page. */
export const INBOUND_PAYMENT_STATUS_META: Record<InboundPaymentStatus, { label: string; className: string }> = {
	unpaid: { label: 'Unpaid', className: 'bg-status-danger-soft text-status-danger' },
	partial: { label: 'Partially paid', className: 'bg-status-warning-soft text-status-warning' },
	paid: { label: 'Paid', className: 'bg-status-success-soft text-status-success' },
};
