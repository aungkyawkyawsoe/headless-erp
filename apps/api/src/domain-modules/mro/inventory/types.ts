/** Business error — mapped to a `fail()` envelope by the route. */
export class MroError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(message);
		this.name = 'MroError';
	}
}

export type MroTracking = 'standard' | 'batch' | 'serial';
export type MroLocation = 'main_store' | 'admin_store' | 'mandalay_store' | 'safety_store' | 'vehicle_store';
export type MroOutboundType = 'goods_issue' | 'write_offs' | 'defects_missing';
export type MroInboundType = 'purchase' | 'legacy' | 'return';

/** The wear/condition reading of an asset unit — the equipment counterpart of a
 *  tyre's tread_mm/psi. Stored on `mro_stock_serials.condition`. */
export type MroAssetCondition = 'good' | 'fair' | 'poor' | 'damaged';
export const MRO_ASSET_CONDITIONS: MroAssetCondition[] = ['good', 'fair', 'poor', 'damaged'];

export const MRO_LOCATIONS: MroLocation[] = ['main_store', 'admin_store', 'mandalay_store', 'safety_store', 'vehicle_store'];
export const MRO_OUTBOUND_TYPES: MroOutboundType[] = ['goods_issue', 'write_offs', 'defects_missing'];
export const MRO_INBOUND_TYPES: MroInboundType[] = ['purchase', 'legacy', 'return'];

/** The parts-movement ledger — Screen 2/3 segmented direction tabs + query filter. */
export type MroMovementDirection = 'all' | 'in' | 'out' | 'trf';
export const MRO_MOVEMENT_DIRECTIONS: MroMovementDirection[] = ['all', 'in', 'out', 'trf'];
/** Confirmed movement lines per ledger page (newest first, keyset-paginated). */
export const MRO_MOVEMENT_LEDGER_PAGE = 50;
/** Moving item-name groups per Screen-1 directory page (name-sorted, keyset-paginated). */
export const MRO_MOVEMENT_GROUPS_PAGE = 50;
/** Screen 2's MODEL rows (one SKU of the group, aggregated) — same page size as
 *  the other movement registers, so a big group streams instead of dumping. */
export const MRO_MOVEMENT_MODELS_PAGE = 50;

/** The asset-transfer (`mro_asset_requests`) lifecycle — the approver feed's filter values. */
export const MRO_ASSET_REQUEST_STATUSES: string[] = ['requested', 'approved', 'rejected', 'executed'];
/** Transfer requests per approver-feed page (newest first, keyset-paginated). */
export const MRO_ASSET_REQUESTS_PAGE = 25;

/** Requisition lifecycle states that are still OPEN — a request in any of these can be cancelled/rejected. */
export const MRO_REQUISITION_OPEN_STATUSES: string[] = ['requested', 'approved', 'partially_issued'];
/** Allowed close reasons — the store keeper records why an open request was closed without full fulfilment. */
export const MRO_REQUISITION_CLOSE_REASONS: string[] = ['fulfilled', 'stock_low', 'cancelled'];

export const MM_INSUFFICIENT = 'လက်ကျန် မလုံလောက်ပါ — ပမာဏ လျှော့ပား';

/**
 * The `_meta.source` marker the inbound confirm stamps on the ONE ledger entry it
 * files for a `paid_at_receipt` draft. It is what lets the un-post delete exactly
 * the money the CONFIRM created and still refuse while any payment a person
 * recorded stands — a stock reversal must never silently erase money.
 */
export const PAID_AT_RECEIPT_SOURCE = 'paid_at_receipt';

export interface Tables {
	inbound: string;
	outbound: string;
	inLines: string;
	outLines: string;
	transfer: string;
	transferLines: string;
	transferLots: string;
	transferSerials: string;
	adjustment: string;
	adjustmentLines: string;
	adjustmentLots: string;
	adjustmentSerials: string;
	requisition: string;
	requisitionLines: string;
	model: string;
	inv: string;
	lots: string;
	serials: string;
	outLots: string;
	outSerials: string;
	group: string;
	category: string;
	events: string;
	assetRequest: string;
	empLinks: string;
	payments: string;
}

export interface DocRow {
	id: string;
	type: string | null;
	location: string | null;
	purchase_date: string | null;
	effective_date: string | null;
	note: string | null;
	doc_status: string | null;
	display_number: string | null;
	/** Inbound only: "the money came with the goods" (D1 boolean → 1/0). */
	paid_at_receipt?: number | boolean | null;
	/** Service-written cancellation audit — who ended the document and when. Set on
	 *  every cancel path (draft AND posted), so a stock reversal always names an actor. */
	cancelled_at: string | null;
	cancelled_by: string | null;
	request?: string | null;
	/** Outbound (goods issue) only: the DESTINATION the units are handed to — at most
	 *  ONE of the two is set (a truck's inventory, or a person's custody). */
	to_vehicle?: string | null;
	to_employee?: string | null;
}

export interface ModelRow {
	tracking: string | null;
	name_en: string | null;
}

export interface InventoryRow {
	id: string;
	model: string;
	location: string;
	qty_on_hand: number;
}

export interface LotRow {
	id: string;
	batch_no: string | null;
	expiry_date: string | null;
	unit_cost: number | null;
	remaining_qty: number;
	created_at: string;
}

export interface SerialRow {
	id: string;
	serial_no: string;
	status: string;
	location: string;
	expiry_date: string | null;
}

/** One stored balance row + its resolved model/group/category labels (the raw
 *  projection `stockSnapshot` reads once for every stock report). */
export interface StockInvRow {
	id: string;
	model: string;
	location: string;
	qty_on_hand: number | null;
	reorder_level: number | null;
	model_name: string | null;
	tracking: string | null;
	model_image: string | null;
	group_name: string | null;
	/** The item (group) name's Burmese label — the card's sub-line. */
	group_name_mm: string | null;
	category: string | null;
	category_name: string | null;
}

/** The stock-truth gather shared by the on-hand report and reconciliation:
 *  stored balances + derived lot/serial totals keyed `${model}|${location}`
 *  (each key's expired slice too), plus the keys holding stock with NO balance
 *  row. ONE implementation means the two reports can never disagree. */
export interface StockSnapshot {
	invRows: StockInvRow[];
	lotBy: Map<string, number>;
	serialBy: Map<string, number>;
	expiredLotBy: Map<string, number>;
	expiredSerialBy: Map<string, number>;
	orphanKeys: string[];
	orphanMeta: Map<string, ModelRow>;
}

/** One ASSET UNIT held somewhere — a tyre or any `assets`-flagged item name: seated
 *  on a wheel, riding a truck as a spare, or held by an employee. The unified
 *  holder read (`GET /api/mro/assets/holder`) resolves every display field
 *  server-side so a caller maps a card with no register walk and no client-side
 *  master join. The holder is DERIVED (employee ? person : vehicle ? truck+slot :
 *  store) — never stored, so it cannot drift. */
export interface HolderAssetRow {
	id: string;
	serial_no: string | null;
	status: string | null;
	/** The `mro_item_model` id this unit is. */
	model: string | null;
	/** `mro_item_model.name_en` — resolved here so the card needs no catalog read. */
	model_name: string | null;
	/** `mro_item_model.image` — the SKU's photo (`/api/media/<key>`, a PUBLIC URL),
	 *  resolved here for the same reason as the name: a register card paints the
	 *  model's picture with no second read. Null when the SKU has no photo yet
	 *  (the card falls back to its kind glyph). */
	model_image: string | null;
	/** The owning `mro_item_name` master + its bilingual display pair. */
	item_name: string | null;
	item_name_en: string | null;
	item_name_mm: string | null;
	/** `mro_item_model.reference_tread_mm` — the new-tread baseline (mm). */
	reference_tread_mm: number | null;
	/** 'tyre' when the SKU declares a new-tread baseline or the unit is seated on a
	 *  wheel; 'asset' otherwise — the register's tab discriminator, computed once. */
	kind: 'tyre' | 'asset';
	/** The holding vehicle (`veh_fleets.id`) + its plate — null for a person/store. */
	vehicle: string | null;
	plate_no: string | null;
	/** The fit slot id on that vehicle (e.g. "A1-L"); null = spare / person-held. */
	slot: string | null;
	/** The holding employee (`hrm_employees.id`) + display name — null for truck/store. */
	employee: string | null;
	employee_name: string | null;
	/** Provenance store (the unit's own `location`), kept even while issued out. */
	location: string | null;
	tread_mm: number | null;
	psi: number | null;
	condition: string | null;
	unit_cost: number | null;
}

/**
 * ONE row of the approver-scoped transfer-request feed
 * (`GET /api/mro/asset-requests`). Every m2o is resolved to its display field
 * server-side (serial / both plates / both custodians / requester / decider) so
 * the approval card needs no client join — the same "display-ready read" rule
 * the holder register follows.
 */
export interface AssetRequestListRow {
	id: string;
	/** `ATR-00007` — the document number the serial's lifecycle event cites. */
	display_number: string | null;
	/** `requested` | `approved` | `rejected` | `executed`. */
	status: string;
	/** The asset unit (`mro_stock_serials.id`) + its serial number. */
	serial: string | null;
	serial_no: string | null;
	/** Recorded SOURCE — the move is pinned to it at execute (`expectFrom`). */
	from_vehicle: string | null;
	from_plate: string | null;
	from_slot: string | null;
	from_employee: string | null;
	from_employee_name: string | null;
	/** Requested DESTINATION — a vehicle (+optional seat) XOR an employee; `to_location`
	 *  is set instead for a RETURN (holder → store). */
	to_vehicle: string | null;
	to_plate: string | null;
	to_slot: string | null;
	to_employee: string | null;
	to_employee_name: string | null;
	/** The STORE a return request names — null on a holder→holder transfer. */
	to_location: string | null;
	/** Set on a WRITE-OFF request (scrapped where it sits) — every destination above
	 *  is then null, and the execute performs the write-off instead of a move. */
	write_off: boolean | null;
	/** Who filed it (session-stamped) + their display name. */
	requested_by: string | null;
	requested_by_name: string | null;
	/** Who decided it (superior) + their display name and decision time. */
	approved_by: string | null;
	approved_by_name: string | null;
	approved_at: string | null;
	rejected_reason: string | null;
	executed_at: string | null;
	note: string | null;
	created_at: string | null;
}

export interface LineRow {
	id: string;
	item_model: string | null;
	qty: number | null;
	unit_price: number | null;
	location: string | null;
	batch_no: string | null;
	expiry_date: string | null;
	serials: string | null;
	note: string | null;
}

export interface AdjustmentLineRow {
	id: string;
	item_model: string | null;
	direction: string | null;
	qty: number | null;
	batch_no: string | null;
	expiry_date: string | null;
	serials: string | null;
	unit_cost: number | null;
	expected_qty: number | null;
	diff_qty: number | null;
}

export interface RequisitionLineRow {
	id: string;
	item_model: string | null;
	qty: number | null;
	note: string | null;
}

/** One model's aggregated movement (Screen 2 — belonging model list rows). */
export interface MovementModelAggRow {
	model: string;
	model_name: string | null;
	total_in: number;
	total_out: number;
	total_trf: number;
	line_count: number;
	doc_count: number;
	last_date: string | null;
}

/** One moving item-name group (Screen 1 — the directory feed rows). */
export interface MovementGroupRow {
	id: string;
	/** The display fallback — `name_en` first, then `name_mm` (the master has no
	 *  free-text `name` column; this is derived so the wire shape is unchanged). */
	name: string | null;
	name_en: string | null;
	name_mm: string | null;
}

/** One item-name group of the WHOLE catalogue (the item-groups hub directory). */
export interface CatalogGroupRow {
	id: string;
	/** The display fallback — `name_en` first, then `name_mm` (derived; see above). */
	name: string | null;
	name_en: string | null;
	name_mm: string | null;
	/** `standard` | `batch` | `serial` — the policy this master's SKUs inherit. */
	tracking: string | null;
	/** Live (non-deleted) SKUs under this master. */
	count: number;
	/** The parent category (`mro_item_categories`) — the hub's nav grouping.
	 *  Null when the master is unclassified (the client shows an "Uncategorized"
	 *  section rather than dropping the row). */
	category_id: string | null;
	category_name_en: string | null;
	category_name_mm: string | null;
}

/** One confirmed movement line (Screen 3 — the line ledger rows). */
export interface MovementLedgerAggRow {
	direction: 'in' | 'out' | 'trf';
	line_id: string;
	/** The line's item model id — the Screen 3 drill target on a group feed. */
	model: string | null;
	kind: string | null;
	doc_no: string | null;
	/** The header's id — resolves the row's own document (`inbound` / `outbound` /
	 *  `transfer` / `adjustment`); null only when the doc was hard-deleted. */
	doc_id: string | null;
	date: string | null;
	location: string | null;
	from_location: string | null;
	to_location: string | null;
	model_name: string | null;
	qty: number | null;
	unit_price: number | null;
	batch_no: string | null;
	serials: string | null;
	note: string | null;
	/** The doc's creator, NAMED from the employee directory (`name_mm` ?? `name_en`),
	 *  so one act reads the same whether the person signed in from Telegram or with
	 *  an email + password. Falls back to the login row's own `full_name` for an
	 *  account carrying no employee link, and is null when there is neither. */
	created_name: string | null;
}

/** The ledger page's header summary — totals over the SAME active scope. */
export interface MovementLedgerSummary {
	total_in: number;
	total_out: number;
	total_trf: number;
	doc_count: number;
	line_count: number;
	on_hand: number | null;
}
