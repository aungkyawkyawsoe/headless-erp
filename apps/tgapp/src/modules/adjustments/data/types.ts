import type { MroDocStatus, MroLocation, MroTracking } from '@/shared/mro';

/**
 * Row shapes for the MRO stock ADJUSTMENT document flow — header
 * (`mro_adjustments`) + child lines (`mro_adjustment_lines`) + the item-model
 * master.
 *
 * An adjustment is an operator-reported stock correction to ONE store: each
 * line either ADDS (`add`) or REMOVES (`remove`) `qty` of a model. Creating a
 * draft just records the report — the CURRENT employee is set on `reported_by`
 * (an m2o to `hrm_employees` the API expands on read). Stock only moves when a
 * DIFFERENT employee approves it from the list (`approved_by`, also an m2o the
 * API expands); the engine 409s when the approver equals the reporter.
 *
 * There are NO de-normalized `*_name` text columns — the display name and
 * avatar are read straight off the expanded m2o row.
 *
 * Deliberately LOCAL interfaces, not `SchemaRow`: the generated headless schema
 * knows no `mro_*` collections, so the Adjustment screens type their reads
 * against the verified wire contract (mirror of the API's own adjustment rows +
 * `apps/api/src/domain-modules/mro/schema-defs.json`).
 */

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
}

/** An expanded `hrm_employees` row (m2o relation) — the reporter / approver. */
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

/** The display name for a person — English first, then Burmese, else null. */
export function personNameOf(p: PersonField, denormalized?: string | null): string | null {
	if (p && typeof p === 'object') {
		const n = p.name_en?.trim() || p.name_mm?.trim() || '';
		if (n) return n;
	}
	return denormalized?.trim() || null;
}

/** `mro_adjustments` — one adjustment document header (list reads project these). */
export interface MroAdjustmentRow {
	id: string;
	/** `AJT-00001` — engine naming-series number. */
	display_number?: string | null;
	/** `draft` | `confirmed` | `cancelled` ('' treated as draft by the engine). */
	doc_status?: MroDocStatus | null;
	/** One of `MRO_LOCATIONS` — the store whose balances the correction touches. */
	location?: string | null;
	/** `YYYY-MM-DD` — the stock-correction date. */
	adjustment_date?: string | null;
	/** Free-text operator note describing the correction (optional). */
	description?: string | null;
	/** m2o to `hrm_employees` — WHO reported it (expanded on read). */
	reported_by?: PersonField;
	/** m2o to `hrm_employees` — WHO approved / applied the move (set at confirm). */
	approved_by?: PersonField;
	total_qty?: number | null;
	line_count?: number | null;
	confirmed_at?: string | null;
	created_at?: string | null;
}

/** A person resolved for display from the (possibly expanded) m2o field. */
export interface ResolvedPerson {
	/** `hrm_employees.id`. */
	id: string | null;
	/** Display name resolved from the expansion, else the de-normalized copy. */
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

/** One line the create form sends (nested under the header's `lines`). */
export interface AdjustmentLineDraft {
	item_model: string;
	/** `add` raises the store balance; `remove` lowers it. */
	direction: 'add' | 'remove';
	/** A POSITIVE integer — the number of units to add/remove. */
	qty: number;
	/** Batch models only — the lot no (blank = the engine auto-names it). */
	batch_no?: string;
	/** Batch models only — `YYYY-MM-DD`, optional. */
	expiry_date?: string;
	/** Optional per-unit cost — echoed onto stock at confirm. */
	unit_cost?: number;
	/** Serial models only (REMOVE) — the exact units to take out of stock. */
	serials?: string[];
}

/** The create payload — `POST /api/entities/mro_adjustments` with nested lines. */
export interface CreateAdjustmentDraft {
	/** One of `MRO_LOCATIONS` — the corrected store. */
	location: string;
	/** `YYYY-MM-DD`. */
	adjustment_date: string;
	/** Free-text reason (optional). */
	description?: string;
	/** The current employee's `hrm_employees.id` — the reporter (m2o). */
	reported_by: string;
	lines: AdjustmentLineDraft[];
}

/**
 * The update payload — `PUT /api/entities/mro_adjustments/:id` with nested lines.
 *
 * Differs from a create in TWO ways, and both matter:
 *
 *  - `description` may be sent as `null` to CLEAR it, where a create simply omits
 *    the column — an edit has to be able to empty the reason the draft carried;
 *  - `reported_by` does not exist here ON PURPOSE. It is an `actor_fields` column
 *    (see `schema-defs.json`): the engine stamps it from the signed session on
 *    create and deletes it from a non-admin update, while a TRUSTED-ROOT admin
 *    could otherwise rewrite it. The report's author is a historical fact that must
 *    never change — and the engine's whole two-person rule (`approved_by !=
 *    reported_by`) rests on it — so the edit payload cannot express it at all.
 */
export type UpdateAdjustmentDraft = Omit<CreateAdjustmentDraft, 'description' | 'reported_by'> & {
	description?: string | null;
};

/** `mro_adjustment_lines` — one child line of an adjustment document. */
export interface MroAdjustmentLineRow {
	id: string;
	/** The owning header (`mro_adjustments`) — used to filter a doc's own lines. */
	parent_id?: string | null;
	/** m2o to `mro_item_model` — a bare id OR the expanded `{ id, name_en, name_mm,
	 *  tracking }` row (direct table reads resolve it). */
	item_model?: string | MroItemModelRow | null;
	/** `add` | `remove`. */
	direction?: string | null;
	/** The (positive) number of units to add/remove. */
	qty?: number | null;
	/** Batch models only — the lot no (blank = the engine auto-named it). */
	batch_no?: string | null;
	/** Batch models only — `YYYY-MM-DD`. */
	expiry_date?: string | null;
	/** Optional per-unit cost — echoed from the create form. */
	unit_cost?: number | null;
	/** Serial models only — the exact units (JSON array). */
	serials?: string | string[] | null;
	note?: string | null;
}

/**
 * One line of an EDIT seed — a STORED adjustment line as the form's own row.
 *
 * `batchNo` / `expiryDate` are carried ONLY for an `add`. On a `remove` the lot a
 * line actually drew from is not a property of that line at all — the confirm
 * takes it FEFO and records WHICH lot in `mro_adjustment_lots` — so seeding one
 * here would put a lot number the engine never honoured back in front of the
 * operator, and re-submit it on the next save.
 */
export interface AdjustmentLineSeed {
	/** The stored `mro_item_model` id. */
	modelId: string;
	/** The stored line's SKU name. Carried because the picker trigger reads the
	 *  shared SKU directory, which is a cached master read that may still be in
	 *  flight: without this an edit would paint a raw UUID on a line that plainly
	 *  HAS an item. */
	modelName: string | null;
	/** The tracking policy the line was captured under — a serial row keeps its
	 *  unit list visible before the directory lands. */
	tracking: MroTracking;
	/** `add` raises the store balance; `remove` lowers it. */
	direction: 'add' | 'remove';
	qty: number;
	/** Batch models on an `add` only — the lot the line created (blank when the
	 *  row predates this rule). Always `''` on a `remove`. */
	batchNo: string;
	/** Batch models on an `add` only — `YYYY-MM-DD`, or `''`. */
	expiryDate: string;
	/** The per-unit cost the row carries, or null. NOT a form field: the create
	 *  form does not collect it, so an edit re-states the stored value rather than
	 *  dropping it (a replace writes the whole child set). */
	unitCost: number | null;
	/** Serial models only — the stored units. */
	serials: string[];
}

/**
 * The seed an EXISTING document hands the form — the very fields the create form
 * collects, read back off the wire, so ONE form serves create AND edit. The
 * document's status (not the caller) decides the mode: see `isAdjustmentEditable`.
 * Absent ⇒ create mode.
 *
 * There is no `reportedBy` here on purpose: an edit never re-states the reporter
 * (see `UpdateAdjustmentDraft`), so the form HIDES its reporter section rather
 * than claim the current user filed a document somebody else reported.
 */
export interface AdjustmentFormSeed {
	/** The row this form SAVES to (`PUT /api/entities/mro_adjustments/:id`). */
	id: string;
	/** `YYYY-MM-DD`. */
	adjustmentDate: string | null;
	location: MroLocation;
	description: string;
	lines: AdjustmentLineSeed[];
	/** `draft` | `confirmed` | `cancelled` — the lifecycle status that decides
	 *  whether the form edits or merely reads. */
	docStatus: MroDocStatus;
}

/** The list card model — one header row resolved for display (no lines). */
export interface AdjustmentCardModel {
	id: string;
	displayNumber: string | null;
	docStatus: MroDocStatus;
	location: string | null;
	/** `MRO_LOCATION_LABELS[location]` — null-safe. */
	locationLabel: string | null;
	/** `YYYY-MM-DD` (the adjustment date). */
	adjustmentDate: string | null;
	/** Free-text operator reason, trimmed — may be null. */
	description: string | null;
	/** The reporter (created by) person — name + avatar. */
	reported: ResolvedPerson;
	/** The approver person, set at confirm — null name while still a draft. */
	approved: ResolvedPerson;
	totalQty: number | null;
	lineCount: number | null;
}
