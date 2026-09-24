/**
 * Row shapes for the engine-native MRO requisition collections consumed by the
 * store-requests module.
 *
 * A requisition is a multi-line document: the `mro_requisitions` header row
 * (below) plus child rows in `mro_requisition_lines` (linked by `parent_id`).
 * Draft creation is ONE engine-native POST — the engine assigns
 * `display_number`/`doc_status` and inserts the child lines itself.
 *
 * Local interfaces only: the engine-native `mro_*` collections exist in the
 * backend schema but NOT in the tgapp's generated `Schema` (which still
 * describes the legacy `store_*` demo rows), so nothing here derives from
 * `SchemaRow`.
 */

import type { MroDocStatus, MroLocation } from '@/shared/mro';
import { trackingOfModel } from '@/shared/mro';

/** The user-facing requisition lifecycle — driven by the store approve/issue
 *  service (see the store-request workflow spec). `doc_status` stays the engine
 *  confirm guard; these five values are the workflow's visible state. */
export type RequisitionStatus = 'requested' | 'approved' | 'partially_issued' | 'fulfilled' | 'cancelled';

/** An expanded `hrm_employees` row (m2o relation) — the requester / approver. */
export interface EmployeeRef {
	id: string;
	/** English display name — preferred for the card copy when present. */
	name_en?: string | null;
	/** Burmese name — used when there is no English name. */
	name_mm?: string | null;
	/** Optional `/api/media/<key>` avatar — shown when set. */
	avatar?: string | null;
}

/** One of `{ id | name_en | name_mm | avatar }` used by both person fields. */
export type PersonField = string | EmployeeRef | null;

/** A person resolved for display from the (possibly expanded) m2o field. */
export interface ResolvedPerson {
	/** `hrm_employees.id`. */
	id: string | null;
	/** Display name resolved from the expansion — English first, else Burmese. */
	name: string | null;
	/** Optional `/api/media/<key>` avatar. */
	avatar: string | null;
}

/** Resolve an m2o person field (bare id or expanded row) for the card. */
export function personOf(p?: PersonField, denormalized?: string | null): ResolvedPerson {
	if (p && typeof p === 'object') {
		const name = p.name_en?.trim() || p.name_mm?.trim() || '';
		return { id: p.id ?? null, name: name || null, avatar: p.avatar?.trim() || null };
	}
	return { id: typeof p === 'string' ? p : null, name: denormalized?.trim() || null, avatar: null };
}

/** A requisition line's resolved model identity — the `item_model` m2o arrives
 *  EXPANDED on a direct read (`{ id, name_en, name_mm }`) and bare (uuid)
 *  otherwise. Returns the display name (English first, then Burmese) and the raw
 *  model id (used for the issue prefill). */
export function lineModelOf(line: MroRequisitionLineRow): { id: string | null; name: string | null } {
	const model = line.item_model;
	if (model && typeof model === 'object') {
		return { id: model.id ?? null, name: model.name_en?.trim() || model.name_mm?.trim() || null };
	}
	return { id: typeof model === 'string' ? model : null, name: null };
}

/** `mro_requisitions` — one requisition header row (the list read's projection). */
export interface MroRequisitionRow {
	id: string;
	/** e.g. "REQ-00001" — assigned by the engine at draft creation. */
	display_number?: string | null;
	/** `draft` | `confirmed` | `cancelled` — the engine's document lifecycle. */
	doc_status?: MroDocStatus | null;
	/** The MMT calendar day the stock is requested for (`YYYY-MM-DD`). */
	request_date?: string | null;
	/** The store the stock is requested from (`main_store` … `vehicle_store`). */
	location?: MroLocation | string | null;
	/** m2o to `hrm_employees` — who requested the stock (set at create,
	 *  expanded on read). */
	requested_by?: PersonField;
	/** m2o to `hrm_employees` — the approving store keeper (set at confirm,
	 *  expanded on read). */
	approved_by?: PersonField;
	/** Optional m2o to `veh_fleets` — the truck this stock request is bound to.
	 *  Null when no vehicle was chosen. Arrives as a bare uuid on reads that
	 *  don't expand, or EXPANDED as `{ id, plate_no }` when it does. */
	vehicle?: string | { id: string; plate_no?: string | null } | null;
	/** The workflow lifecycle (`requested/approved/partially_issued/fulfilled/
	 *  cancelled`) — the user-facing state shown on the card. */
	requisition_status?: string | null;
	/** Units issued so far across this request's fulfilled goods-issue OUTs
	 *  (0 until the first issue). */
	issued_qty?: number | null;
	/** Optional close intent (`fulfilled|stock_low|cancelled`) — backend note. */
	close_reason?: string | null;
	/** The requester's free-text description of the need. */
	note?: string | null;
	/** Sum of the child lines' qty — written by the engine at confirm time. */
	total_qty?: number | null;
	/** Number of child lines — written by the engine at confirm time. */
	line_count?: number | null;
	/** When the document was confirmed (UTC ISO) — null while still a draft. */
	confirmed_at?: string | null;
	created_at?: string | null;
}

/** A line SKU's expanded m2o row — the lines read requests `item_model.name_en` +
 *  `item_model.name_mm` + `item_model.item_name.tracking` as DOTTED fields, so the
 *  API joins exactly these columns of the related `mro_item_model` row (plus its
 *  `id`) and — for the policy, which lives on the item NAME — its parent
 *  `mro_item_name` row. */
export interface RequisitionLineModel {
	id: string;
	/** English display name — the line's primary label. */
	name_en?: string | null;
	/** Burmese display name — the line's secondary label. */
	name_mm?: string | null;
	/** The expanded parent item NAME — where the stock policy lives AND the card
	 *  label's group word (`Tyre` over the size SKU). Read as `item_model.item_name.
	 *  tracking` / `.name_en` / `.name_mm`; a depth-2 m2o expansion. */
	item_name?: { tracking?: string | null; name_en?: string | null; name_mm?: string | null } | null;
}

/** `mro_requisition_lines` — one requested item inside a requisition. The lines
 *  read (part of the detail view's `POST /api/query` batch) expands each
 *  `item_model` m2o into its `{ id, name_en, name_mm, item_name: { tracking } }`
 *  row; otherwise it arrives as a bare uuid. */
export interface MroRequisitionLineRow {
	id: string;
	/** The owning `mro_requisitions` row. */
	parent_id?: string | null;
	/** Bare `mro_item_model` uuid, or the EXPANDED `{ id, name_en, name_mm,
	 *  item_name }` row on a direct line read — the detail sheet uses the names,
	 *  the serial gate the inherited policy, and the issue prefill the `id`. */
	item_model?: string | RequisitionLineModel | null;
	qty?: number | null;
	note?: string | null;
	created_at?: string | null;
}

/** A line SKU's tracking policy — the expanded m2o's inherited policy (flattened
 *  from the item NAME), folded to `undefined` when absent (a bare uuid / dangling
 *  FK has no policy) so serial-detection call sites compare a nullable-free value. */
export function lineTrackingOf(line: MroRequisitionLineRow): string | undefined {
	const model = line.item_model;
	if (!model || typeof model !== 'object') return undefined;
	return trackingOfModel(model)?.trim() || undefined;
}

/** The `/app/store-requests/:id` detail view — the doc's header + child lines,
 *  both read in ONE `POST /api/query` batch (`fetchRequisitionView`). */
export interface RequisitionView {
	header: MroRequisitionDetailModel | null;
	lines: MroRequisitionLineRow[];
}

/** The requisition list card — one header row, labeled client-side. */
export interface MroRequisitionCardModel {
	id: string;
	displayNumber: string | null;
	/** The engine confirm guard (`draft` → `confirmed`, or `cancelled`). */
	status: MroDocStatus;
	/** The effective workflow lifecycle the card badges — includes a legacy
	 *  fallback when the row predates the `requisition_status` column. */
	requisitionStatus: RequisitionStatus;
	/** The requester (created by) person — name + avatar. */
	requestedBy: ResolvedPerson;
	/** The approving store keeper, set at confirm — null name while `requested`. */
	approvedBy: ResolvedPerson;
	/** The bound truck's `veh_fleets` id — null when no vehicle was chosen. */
	vehicleId: string | null;
	/** The bound truck's `veh_fleets` plate — null when unset or unresolved. */
	vehiclePlate: string | null;
	/** Units issued so far (0 until the first issue fulfils this request). */
	issuedQty: number | null;
	/** The total qty requested across the child lines (written at confirm). */
	requestedQty: number | null;
	/** `MRO_LOCATION_LABELS` lookup — null when the row's value is unknown. */
	locationLabel: string | null;
	/** Date label of `request_date` — null when unset/unparsable. */
	requestDateLabel: string | null;
	lineCount: number | null;
	totalQty: number | null;
	/** "3 items · Total 12" — null until the doc has computed totals. */
	summaryLabel: string | null;
	/** The requester's note — excerpted (clamped) on the card. */
	note: string | null;
	/** Close reason when cancelled/rejected (`cancelled` | `stock_low` | null). */
	closeReason: string | null;
	/** "1 week ago" — the relative `created_at` age, null when unset/unparsable. */
	ageLabel: string | null;
}

/** The single-req header read for the DETAIL page — the list-card projection PLUS
 *  the RAW store `location` (the OUT draft for a goods-issue must carry the same
 *  store value so stock leaves the matching shelf). Labels are resolved exactly
 *  like the list card; only the raw actors + quantities drive the actions. */
export interface MroRequisitionDetailModel {
	id: string;
	/** e.g. `REQ-00001`. */
	displayNumber: string | null;
	/** `draft` | `confirmed` | `cancelled` — the engine confirm guard. */
	docStatus: MroDocStatus;
	/** The user-facing lifecycle the detail page renders by state. */
	requisitionStatus: RequisitionStatus;
	/** The RAW store value — POSTed as the OUT's `location` on a goods issue. */
	location: MroLocation | null;
	/** `MRO_LOCATION_LABELS[location]` — the readable store name. */
	locationLabel: string | null;
	/** The RAW `request_date` (`YYYY-MM-DD`) — the amend form's pre-fill. */
	requestDate: string | null;
	/** Date label of `request_date`. */
	requestDateLabel: string | null;
	/** The requester (created by) — name + avatar. */
	requestedBy: ResolvedPerson;
	/** The approving store keeper — set at confirm. */
	approvedBy: ResolvedPerson;
	/** The bound truck's `veh_fleets` id — null when no vehicle was chosen. */
	vehicleId: string | null;
	/** The bound truck's `veh_fleets` plate — null when unset or unresolved. */
	vehiclePlate: string | null;
	/** Units issued so far across the fulfilled goods-issue OUTs. */
	issuedQty: number | null;
	/** The header's total requested qty (sum of the child lines). */
	requestedQty: number | null;
	lineCount: number | null;
	/** The requester's free-text need. */
	note: string | null;
	/** Close reason when cancelled/rejected (`cancelled` | `stock_low` | null). */
	closeReason: string | null;
}

/** Draft creation payload — POSTed as ONE engine-native multi-line document. */
export interface CreateRequisitionInput {
	/** The MMT calendar day (`YYYY-MM-DD`) the stock is requested for. */
	request_date: string;
	location: MroLocation;
	/** Optional bare `veh_fleets` uuid the request is bound to — sent only when
	 *  a vehicle was chosen (no vehicle = no field). */
	vehicle?: string;
	/** The current logged-in employee's `hrm_employees.id` — the requester (m2o). */
	requested_by: string;
	/** Every new request enters the workflow as `requested`. */
	requisition_status: 'requested';
	note?: string;
	/** The requested lines — each carries a bare `mro_item_model` uuid + qty. */
	lines: Array<{
		item_model: string;
		qty: number;
		note?: string;
	}>;
}
