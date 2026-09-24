/**
 * Row shapes for the MRO outbound document flow — header (`mro_outbounds`) +
 * child lines (`mro_outbound_lines`) + the item-model master (`mro_item_model`).
 *
 * Deliberately LOCAL interfaces, not `SchemaRow`: the generated headless schema
 * knows no `mro_*` collections, so the three outbound screens (ထုတ်ပေးမှု /
 * ပယ်ဖျက် / စွန့်ပစ်) type their reads against the verified wire contract
 * (mirror of `apps/api/src/domain-modules/mro/schema-defs.json`) instead.
 */
import type { MroDocStatus, MroLocation, MroTracking } from '@/shared/mro';
import type { PersonField, ResolvedPerson } from '@/modules/store-requests/data/types';

/**
 * `mro_outbounds.type` — the three outbound document kinds. They share ONE
 * engine flow (draft multi-line doc → confirm deducts stock); the only thing
 * that differs per screen is this value + the Burmese labels:
 *
 * - `goods_issue`      — issue usable stock (ထုတ်ပေးမှု);
 * - `write_offs`       — write off expired / obsolete stock (ပယ်ဖျက်);
 * - `defects_missing`  — dispose defect / missing stock (ချို့ယွင်း/စွန့်ပစ်).
 */
export type MroOutboundType = 'goods_issue' | 'write_offs' | 'defects_missing';

/** `mro_item_model` — the MRO SKU master the pickers read (and whose inherited
 *  policy the picker chips name). */
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

/** An expanded `mro_requisitions` m2o (the goods-issue card's `request`)
 *  reference back to the source requisition. The API expands the m2o to the
 *  related row; a bare `request` id (shouldn't occur on direct reads) falls back
 *  to the placeholder on the card. */
export interface OutboundRequestRef {
	id?: string | null;
	/** e.g. `REQ-00001` — the source requisition's engine number. */
	display_number?: string | null;
	/** The source requisition's workflow lifecycle (`requisition_status`). */
	requisition_status?: string | null;
}

/** An expanded `veh_fleets` m2o (`mro_outbounds.to_vehicle`) — the truck a goods
 *  issue handed its units to. A bare id falls back to it verbatim. */
export interface OutboundVehicleRef {
	id?: string | null;
	/** The truck's plate — the display label. */
	plate_no?: string | null;
}

/** An expanded `hrm_employees` m2o (`mro_outbounds.to_employee`) — the person a
 *  goods issue handed its units into custody. */
export interface OutboundEmployeeRef {
	id?: string | null;
	/** The person's English display name. */
	name_en?: string | null;
}

/** `mro_outbounds` — one outbound document header (list reads project these). */
export interface MroOutboundRow {
	id: string;
	/** `OUT-00001` — engine naming-series number (null on a not-yet-numbered doc). */
	display_number?: string | null;
	/** `draft` | `confirmed` | `cancelled` ('' treated as draft by the engine). */
	doc_status?: MroDocStatus | null;
	/** `goods_issue` | `write_offs` | `defects_missing`. */
	type?: string | null;
	/** `YYYY-MM-DD`. */
	effective_date?: string | null;
	/** One of `MRO_LOCATIONS` — the issuing store. */
	location?: string | null;
	/** m2o to `mro_requisitions` — the source requisition a goods-issue fulfils
	 *  (present ONLY on a goods issue created from a store request). */
	request?: OutboundRequestRef | string | null;
	/** m2o to `veh_fleets` — the DESTINATION truck a goods issue handed its
	 *  item-by-item units to (the truck's inventory). At most ONE of
	 *  `to_vehicle` / `to_employee` is set. */
	to_vehicle?: OutboundVehicleRef | string | null;
	/** m2o to `hrm_employees` — the DESTINATION person a goods issue put its
	 *  item-by-item units into the custody of. */
	to_employee?: OutboundEmployeeRef | string | null;
	/** m2o to `hrm_employees` — who issued / confirmed this doc (set at confirm). */
	issued_by?: PersonField;
	note?: string | null;
	total_qty?: number | null;
	line_count?: number | null;
	total_amount?: number | null;
	confirmed_at?: string | null;
	created_at?: string | null;
}

/** `mro_outbound_lines` — one child line of an outbound document. */
export interface MroOutboundLineRow {
	id: string;
	parent_id?: string | null;
	/** m2o to `mro_item_model` — a bare id OR the expanded `{ id, name_en, name_mm,
	 *  tracking }` row (direct table reads resolve it). */
	item_model?: string | MroItemModelRow | null;
	qty?: number | null;
	unit_price?: number | null;
	/** The picked serials — the engine stores a JSON array (string when raw). */
	serials?: string | string[] | null;
	/** Location override — absent = the header's default location. */
	location?: string | null;
	note?: string | null;
}

/** One draft line the create form sends (nested under the header's `lines`). */
export interface OutboundLineDraft {
	item_model: string;
	qty: number;
	/** Cost basis of the units moved (`mro_outbound_lines.unit_price`) — NOT a field
	 *  this form collects. Carried so an EDIT can RE-STATE the stored value: the child
	 *  table is REPLACED by the payload, so a column the form does not own would
	 *  otherwise vanish from the row on every save (and the confirm reads this very
	 *  column to compute the document's `total_amount`). */
	unit_price?: number;
	/** Serial models only — the exact units (engine 409s when length ≠ qty). */
	serials?: string[];
}

/** The create payload — `POST /api/entities/mro_outbounds` with nested lines. */
export interface CreateOutboundDraft {
	type: MroOutboundType;
	effective_date: string;
	location: string;
	/** The source requisition id this GOODS-ISSUE fulfils — present only when the
	 *  draft was opened from a store request (`?request=<reqId>`). Absent on the
	 *  standalone + path and on write-off / dispose docs. */
	request?: string;
	/** The goods-issue DESTINATION — the `veh_fleets` id whose INVENTORY the issued
	 *  units land in (they appear on that truck's registry, unseated). ONE
	 *  destination only: never together with `to_employee`. */
	to_vehicle?: string;
	/** The goods-issue DESTINATION — the `hrm_employees` id who TAKES CUSTODY of the
	 *  issued units (they appear on that person's asset register). */
	to_employee?: string;
	note?: string;
	lines: OutboundLineDraft[];
}

/** One line of an EDIT seed — a STORED line as the form's own row state. */
export interface OutboundLineSeed {
	/** The stored `mro_item_model` id. */
	modelId: string;
	/** The stored line's SKU name. Carried because the picker trigger reads the
	 *  shared SKU directory, which is a cached master read that may still be in
	 *  flight: without this an edit would paint a raw UUID on a line that plainly
	 *  HAS an item. */
	modelName: string | null;
	/** The tracking policy the line was captured under — a serial row keeps its unit
	 *  picker (and its quantity = picks) visible before the directory lands. */
	tracking: MroTracking;
	qty: number;
	/** The stored cost basis, or null. Not a form field — re-stated on save for the
	 *  same reason it is seeded (a replace writes the whole child set). */
	unitPrice: number | null;
	/** Serial models only — the stored units. */
	serials: string[];
}

/**
 * The seed an EXISTING document hands the form — the very fields the create form
 * collects, read back off the wire, so ONE form serves create AND edit. The
 * document's status (not the caller) decides the mode: see `isOutboundEditable`.
 * Absent ⇒ create mode.
 */
export interface OutboundFormSeed {
	/** The row this form SAVES to (`PUT /api/entities/mro_outbounds/:id`). */
	id: string;
	/** `goods_issue` | `write_offs` | `defects_missing` — the document's OWN kind,
	 *  which outranks the route's `?type=` when the two disagree. */
	type: MroOutboundType;
	/** `YYYY-MM-DD`. */
	effectiveDate: string | null;
	location: MroLocation;
	note: string;
	/** The source requisition this issue fulfils — re-stated on save, so an edit can
	 *  neither drop the link nor invent one. */
	requestId: string | null;
	/** WHICH kind of holder the document names — null when it names none. A MODE (not
	 *  two nullable ids) for the same reason the form uses one. */
	destinationKind: 'fleet' | 'employee' | null;
	destinationId: string | null;
	/** The holder's display label (plate / person) — the picker trigger reads it until
	 *  the vehicle directory resolves, so a chosen truck never reads as unchosen. */
	destinationLabel: string | null;
	lines: OutboundLineSeed[];
	/** `draft` | `confirmed` | `cancelled` — the lifecycle status that decides whether
	 *  the form edits or merely reads. */
	docStatus: MroDocStatus;
}

/**
 * The update payload — `PUT /api/entities/mro_outbounds/:id` with nested lines.
 *
 * Differs from a create in exactly ONE way, and it matters: the destination pair
 * and the optional text column may be sent as `null` to CLEAR them. An edit can
 * change a goods issue from a truck to a person (or drop both when its last serial
 * line goes), and the schema allows ONE holder — so the column the document no
 * longer uses has to be emptied explicitly, or the row would keep a stale holder
 * beside the new one (a document that left with both).
 */
export type UpdateOutboundDraft = Omit<CreateOutboundDraft, 'to_vehicle' | 'to_employee' | 'note'> & {
	to_vehicle?: string | null;
	to_employee?: string | null;
	note?: string | null;
};

/** The list card model — one header row resolved for display (no lines). */
export interface OutboundCardModel {
	id: string;
	displayNumber: string | null;
	docStatus: MroDocStatus;
	type: MroOutboundType;
	/** The raw engine location value (one of `MRO_LOCATIONS`). */
	location: string | null;
	/** `MRO_LOCATION_LABELS[location]` — null-safe. */
	locationLabel: string | null;
	/** `YYYY-MM-DD`. */
	effectiveDate: string | null;
	/** The source requisition reference — a display label (engine `REQ-…` number,
	 *  falling back to the m2o id) + its workflow lifecycle for the status tag.
	 *  Null when this OUT is not linked to a store request. */
	requestRef: {
		/** The m2o id (link target). */
		id: string | null;
		/** `REQ-00001` number if the API expanded it, else the id. */
		label: string | null;
		/** The source request's lifecycle (`requisition_status`) verbatim. */
		requisitionStatus?: string | null;
	} | null;
	/** The person who issued / confirmed this OUT (name + avatar). */
	issuedBy: ResolvedPerson;
	/** Free-text operator note, trimmed — may be null. */
	note: string | null;
	totalQty: number | null;
	lineCount: number | null;
	/** The doc's sum (Ks) — written at confirm from per-line prices (cost basis of
	 *  the units moved); null while unset. Deliberately NOT the card's header value:
	 *  the row's top-right corner carries the lifecycle (status pill + ⋮), so the
	 *  total rides the disclosure facts instead. */
	totalAmount: number | null;
	/** Where the item-by-item units were HANDED TO — the destination truck's plate
	 *  or the person's name; null when the doc names no holder (a write-off, or a
	 *  goods issue of plain consumables). Set at CREATE, so a draft states its
	 *  destination before anything moves. */
	destination: string | null;
}
