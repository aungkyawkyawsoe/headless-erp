import type { MroDocStatus, MroLocation, MroTracking } from '@/shared/mro';
import type { InboundPaymentStatus } from './payments';

/**
 * Row shapes for the MRO INBOUND document flow — header (`mro_inbounds`) +
 * child lines (`mro_inbound_lines`) + the supplier + item-model masters.
 *
 * Deliberately LOCAL interfaces, not `SchemaRow`: the generated headless schema
 * knows no `mro_*` collections, so the အဝင်စာရင်း screens type their reads
 * against the verified wire contract (mirror of
 * `apps/api/src/domain-modules/mro/schema-defs.json`) instead.
 */

/**
 * `mro_inbounds.type` — what the inbound document represents:
 *
 * - `purchase` — goods bought from a supplier (a GRN); new lots / serials;
 * - `legacy`   — opening stock that existed before the system (same stock
 *                effect as purchase, no supplier relationship implied);
 * - `return`   — previously-issued units coming back (serials are re-instocked,
 *                never duplicated).
 */
export type InboundType = 'purchase' | 'legacy' | 'return';

/** `mro_suppliers` — the supplier directory the create form's picker reads. */
export interface MroSupplierRow {
	id: string;
	name?: string | null;
}

/** `mro_item_model` — the MRO SKU master the line pickers + badges read. */
export interface MroItemModelRow {
	id: string;
	/** English display name — the picker's label line. */
	name_en?: string | null;
	/** Burmese display name — the picker's secondary line. */
	name_mm?: string | null;
	/** `standard` | `batch` | `serial` — see `MRO_TRACKING` in `shared/mro`.
	 *  Set on the PICKER directory rows (flattened there); an expanded line
	 *  relation carries it nested under `item_name` instead — read it with
	 *  `policyOfModel` and never off this field alone. */
	tracking?: string | null;
	/** The expanded parent item NAME (a dotted `item_model.item_name.tracking`
	 *  read) — where the stock policy actually lives. */
	item_name?: { tracking?: string | null } | null;
	expiry_alert_days?: number | null;
}

/** `mro_inbounds` — one inbound document header (list reads project these). */
export interface MroInboundRow {
	id: string;
	/** `INB-00001` — engine naming-series number. */
	display_number?: string | null;
	/** `draft` | `confirmed` | `cancelled` ('' treated as draft by the engine). */
	doc_status?: MroDocStatus | null;
	/** ENGINE-MAINTAINED money state (derived from `mro_inbound_payments`): the sum
	 *  of the live ledger, the settlement status, and the day it settled. */
	paid_amount?: number | null;
	payment_status?: InboundPaymentStatus | null;
	fully_paid_on?: string | null;
	/** m2o to `mro_suppliers` — a bare id or an expanded `{ id, name }` row.
	 *  Set by a `purchase` only (the vendor it was bought from). */
	supplier?: string | { id: string; name?: string | null } | null;
	/** m2o to `hrm_employees` — a bare id or an expanded `{ id, name_en }` row.
	 *  The EMPLOYEE counterparty of a vendor-less kind: who returned the goods
	 *  (`return`) or who handed the opening stock over (`legacy`). */
	handed_by?: string | { id: string; name_en?: string | null } | null;
	/** `YYYY-MM-DD` — the purchase / receipt date. */
	purchase_date?: string | null;
	/** `purchase` | `legacy` | `return`. */
	type?: string | null;
	/** One of `MRO_LOCATIONS` — the store receiving the stock. */
	location?: string | null;
	note?: string | null;
	total_qty?: number | null;
	line_count?: number | null;
	total_amount?: number | null;
	/** Inbound only: the draft asked for the money to be recorded at confirm
	 *  (`paid_at_receipt`), which files ONE ledger payment for the line total. */
	paid_at_receipt?: boolean | null;
	confirmed_at?: string | null;
	created_at?: string | null;
}

/** One line the create form sends (nested under the header's `lines`). */
export interface InboundLineDraft {
	item_model: string;
	qty: number;
	/** Optional per-unit cost — the confirm batch writes `total_amount`. */
	unit_price?: number;
	/** Batch models only — blank lets confirm auto-name the lot. */
	batch_no?: string;
	/** Batch models only — `YYYY-MM-DD`, optional. */
	expiry_date?: string;
	/** Serial models only — the exact units (engine 409s when length ≠ qty). */
	serials?: string[];
}

/** The create payload — `POST /api/entities/mro_inbounds` with nested lines. */
export interface CreateInboundDraft {
	/** The VENDOR — required for `type: 'purchase'`, omitted for the other kinds. */
	supplier?: string;
	/** The EMPLOYEE counterparty — required for `legacy` / `return`, omitted for a
	 *  purchase (see `INBOUND_TYPE_META[type].party`, mirrored by the engine's
	 *  `required_if` rules on the collection). */
	handed_by?: string;
	/** `YYYY-MM-DD`. */
	purchase_date: string;
	type: InboundType;
	location: string;
	note?: string;
	/** The money came WITH the goods: confirming records ONE payment equal to the
	 *  line total, dated the receipt date, so the receipt arrives settled (no
	 *  balance left to pay). Purchases only, and only with a positive total — the
	 *  confirm refuses it otherwise. */
	paid_at_receipt?: boolean;
	lines: InboundLineDraft[];
}

/** `mro_inbound_lines` — one child line of an inbound document. */
export interface MroInboundLineRow {
	id: string;
	/** The owning header (`mro_inbounds`) — used to filter a doc's own lines. */
	parent_id?: string | null;
	/** m2o to `mro_item_model` — a bare id OR the expanded `{ id, name_en, name_mm,
	 *  tracking }` row (direct table reads resolve it). */
	item_model?: string | MroItemModelRow | null;
	qty?: number | null;
	/** Optional per-unit cost — echoed from the create form. */
	unit_price?: number | null;
	/** The received store — absent = the doc header's default location. */
	location?: string | null;
	/** Batch models only — the lot no (blank = the engine auto-named it). */
	batch_no?: string | null;
	/** Batch models only — `YYYY-MM-DD`. */
	expiry_date?: string | null;
	/** Serial models only — the exact units (JSON array). */
	serials?: string | string[] | null;
	note?: string | null;
}

/** The list card model — one header row resolved for display (no lines). */
export interface InboundCardModel {
	id: string;
	displayNumber: string | null;
	docStatus: MroDocStatus;
	type: InboundType;
	location: string | null;
	/** `MRO_LOCATION_LABELS[location]` — null-safe. */
	locationLabel: string | null;
	/** `YYYY-MM-DD` (the purchase / receipt date). */
	purchaseDate: string | null;
	/** The VENDOR's display name — null when the doc is not a supplier buy
	 *  (`legacy` / `return` docs carry none). */
	supplierName: string | null;
	/** The EMPLOYEE counterparty's display name — set instead of `supplierName` on
	 *  a `return` (who handed the goods back) or a `legacy` opening balance. */
	handedByName: string | null;
	/** Free-text operator note, trimmed — may be null. */
	note: string | null;
	totalQty: number | null;
	lineCount: number | null;
	/** The doc's sum (Ks) — written at confirm from per-line unit prices; null while
	 *  unit prices are unset. The card's Total Cost. */
	totalAmount: number | null;
	/** Money state (a purchase only; null on any other kind): paid so far, the
	 *  settlement status and the day it settled — all three engine-maintained. */
	paidAmount: number | null;
	paymentStatus: InboundPaymentStatus | null;
	fullyPaidOn: string | null;
}

/** One line of an EDIT seed — a STORED line as the form's own row state. */
export interface InboundLineSeed {
	/** The stored `mro_item_model` id. */
	modelId: string;
	/** The stored line's SKU name. Carried because the form's label reads the
	 *  shared SKU directory, which is a cached master read that may still be in
	 *  flight: without this an edit would paint `Select item` on a line that
	 *  plainly HAS an item. */
	modelName: string | null;
	/** The tracking policy the line was captured under — a batch/serial row keeps
	 *  its lot / expiry / serial inputs visible before the directory lands. */
	tracking: MroTracking;
	qty: number;
	unitPrice: number | null;
	/** Batch models only — the stored lot no ('' when the engine auto-named it). */
	batchNo: string;
	/** Batch models only — `YYYY-MM-DD`, or '' when the lot carries no expiry. */
	expiryDate: string;
	/** Serial models only — the stored units. */
	serials: string[];
}

/**
 * The seed an EXISTING document hands the form — the very fields the create form
 * collects, read back off the wire, so ONE form serves create AND edit. The
 * document's status (not the caller) decides the mode: see `isInboundEditable`.
 * Absent ⇒ create mode.
 */
export interface InboundFormSeed {
	/** The row this form SAVES to (`PUT /api/entities/mro_inbounds/:id`). */
	id: string;
	type: InboundType;
	/** `YYYY-MM-DD`. */
	purchaseDate: string | null;
	/** The counterparty id — the vendor on a purchase, the employee otherwise. */
	partyId: string | null;
	/** Its display name, off the same expanded relation: the picker trigger reads
	 *  it until the directory read resolves (never the raw id). */
	partyName: string | null;
	location: MroLocation;
	note: string;
	paidAtReceipt: boolean;
	lines: InboundLineSeed[];
	/** `draft` | `confirmed` | `cancelled` — the lifecycle status that decides
	 *  whether the form edits or merely reads. */
	docStatus: MroDocStatus;
}

/**
 * The update payload — `PUT /api/entities/mro_inbounds/:id` with nested lines.
 *
 * Differs from a create in exactly ONE way, and it matters: the counterparty and
 * the optional text/flag columns may be sent as `null`/`false` to CLEAR them.
 * An edit can change a draft's KIND (purchase ⇄ return ⇄ opening), and the
 * schema's one-or-the-other rule (`required_if` on `supplier` / `handed_by`) is
 * per-field — so the column the new kind does not use has to be emptied
 * explicitly, or the row would keep a stale vendor beside the new employee.
 */
export type UpdateInboundDraft = Omit<CreateInboundDraft, 'supplier' | 'handed_by' | 'note'> & {
	supplier?: string | null;
	handed_by?: string | null;
	note?: string | null;
};
