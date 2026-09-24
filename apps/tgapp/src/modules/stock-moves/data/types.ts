import type { MroDocStatus, MroLocation, MroTracking } from '@/shared/mro';

/**
 * Row shapes for the MRO location-transfer document flow — header
 * (`mro_transfers`) + child lines (`mro_transfer_lines`) + the item-model
 * master.
 *
 * A transfer is an operator-reported stock move between TWO stores: each line
 * moves `qty` of a model from `from_location` to `to_location`. Creating a
 * draft just records the report — the CURRENT employee is set on `reported_by`
 * (an m2o to `hrm_employees` the API expands on read). Stock only moves when a
 * DIFFERENT employee confirms it from the list (`approved_by`, also an m2o the
 * API expands); the engine 409s when the approver equals the reporter.
 *
 * There are NO de-normalized `*_name` text columns — the display name and
 * avatar are read straight off the expanded m2o row.
 *
 * Deliberately LOCAL interfaces, not `SchemaRow`: the generated headless schema
 * knows no `mro_*` collections, so the ပြောင်းရွှေ့ screens type their reads
 * against the verified wire contract (mirror of
 * `apps/api/src/domain-modules/mro/schema-defs.json`) instead.
 */

/** `mro_item_model` — the MRO SKU master the line pickers + badges read. */
export interface MroItemModelRow {
	id: string;
	/** English display name — the picker's label line. */
	name_en?: string | null;
	/** Burmese display name — the picker's secondary line. */
	name_mm?: string | null;
	/** `standard` | `batch` | `serial` — see `MRO_TRACKING` in `shared/mro`. */
	tracking?: string | null;
	expiry_alert_days?: number | null;
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

/** `mro_transfers` — one transfer document header (list reads project these). */
export interface MroTransferRow {
	id: string;
	/** `TRF-00001` — engine naming-series number. */
	display_number?: string | null;
	/** `draft` | `confirmed` | `cancelled` ('' treated as draft by the engine). */
	doc_status?: MroDocStatus | null;
	/** One of `MRO_LOCATIONS` — the store the stock LEAVES. */
	from_location?: string | null;
	/** One of `MRO_LOCATIONS` — the store the stock ARRIVES at. */
	to_location?: string | null;
	/** `YYYY-MM-DD`. */
	transfer_date?: string | null;
	note?: string | null;
	/** m2o to `hrm_employees` — WHO reported the move (expanded on read). */
	reported_by?: PersonField;
	/** m2o to `hrm_employees` — WHO approved / applied the move (set at confirm). */
	approved_by?: PersonField;
	total_qty?: number | null;
	line_count?: number | null;
	confirmed_at?: string | null;
	created_at?: string | null;
}

/** One draft line the create form sends (nested under the header's `lines`). */
export interface TransferLineDraft {
	item_model: string;
	qty: number;
	/** Batch models only — blank lets confirm pick FEFO at the source. */
	batch_no?: string;
	/** Serial models only — the exact units (engine 409s when length ≠ qty). */
	serials?: string[];
}

/** The create payload — `POST /api/entities/mro_transfers` with nested lines. */
export interface CreateTransferDraft {
	from_location: string;
	to_location: string;
	/** `YYYY-MM-DD`. */
	transfer_date: string;
	note?: string;
	/** The current employee's `hrm_employees.id` — the reporter (m2o). */
	reported_by: string;
	lines: TransferLineDraft[];
}

/** `mro_transfer_lines` — one child line of a transfer document (direct reads
 *  expand the `item_model` m2o into its own row PLUS the nested
 *  `item_name.tracking` — the policy lives on the item NAME, not the SKU). */
export interface MroTransferLineRow {
	id: string;
	parent_id?: string | null;
	item_model?:
		string | { id: string; name_en?: string | null; name_mm?: string | null; item_name?: { tracking?: string | null } | null } | null;
	qty?: number | null;
	batch_no?: string | null;
	serials?: string | string[] | null;
	note?: string | null;
}

/** One line of an EDIT seed — a STORED line as the form's own row state. */
export interface TransferLineSeed {
	/** The stored `mro_item_model` id. */
	modelId: string;
	/** The stored line's SKU name. Carried because the picker trigger reads the
	 *  shared SKU directory, which is a cached master read that may still be in
	 *  flight: without this an edit would paint a raw UUID on a line that plainly
	 *  HAS an item. */
	modelName: string | null;
	/** The tracking policy the line was captured under — a serial row keeps its
	 *  serial field (and its serials as its quantity) visible before the directory
	 *  lands, instead of briefly reading as a plain consumable. */
	tracking: MroTracking;
	qty: number;
	/** Batch models only — the stored OPTIONAL batch restriction. It is a real column
	 *  on `mro_transfer_lines` and the confirm passes it to `allocateLots`, so a seeded
	 *  value MUST survive an edit (`inventory/confirm/transfer.ts`). */
	batchNo: string;
	/** Serial models only — the stored units. */
	serials: string[];
}

/**
 * The seed an EXISTING document hands the form — the very fields the create form
 * collects, read back off the wire, so ONE form serves create AND edit. The
 * document's status (not the caller) decides the mode: see `isTransferEditable`.
 * Absent ⇒ create mode.
 */
export interface TransferFormSeed {
	/** The row this form SAVES to (`PUT /api/entities/mro_transfers/:id`). */
	id: string;
	/** `YYYY-MM-DD`. */
	transferDate: string | null;
	/** The store the stock LEAVES — the form's own default when the stored value is
	 *  unknown, so the source picker never comes up empty on a real document. */
	fromLocation: MroLocation;
	/** The store the stock ARRIVES at — NULL when the stored value is absent/unknown,
	 *  which is the destination picker's own "nothing chosen yet" state (never a
	 *  silently invented store). */
	toLocation: MroLocation | null;
	note: string;
	lines: TransferLineSeed[];
	/** `draft` | `confirmed` | `cancelled` — the lifecycle status that decides whether
	 *  the form edits or merely reads. */
	docStatus: MroDocStatus;
}

/**
 * The update payload — `PUT /api/entities/mro_transfers/:id` with nested lines.
 *
 * Differs from a create in exactly TWO ways, and both matter:
 *
 *  - the optional note may be sent as `null` to CLEAR it, where a create simply
 *    leaves it out and keeps the engine's default (an edit must be able to empty
 *    the field it emptied on screen);
 *  - `reported_by` is OMITTED ENTIRELY. The collection declares
 *    `policies.actor_fields: ['reported_by']`, so the engine already stamps it from
 *    the session on create — and re-sending it on an update would let an admin
 *    silently REASSIGN the reporter. The reporter of a report must never change,
 *    which is why a caller cannot even express it here.
 */
export type UpdateTransferDraft = Omit<CreateTransferDraft, 'note' | 'reported_by'> & { note?: string | null };

/** The list card model — one header row resolved for display (no lines). */
export interface TransferCardModel {
	id: string;
	displayNumber: string | null;
	docStatus: MroDocStatus;
	/** The source store (`MRO_LOCATION_LABELS[from]` — null-safe). */
	fromLabel: string | null;
	/** The destination store (`MRO_LOCATION_LABELS[to]` — null-safe). */
	toLabel: string | null;
	/** `YYYY-MM-DD`. */
	transferDate: string | null;
	note: string | null;
	/** The reporter (created by) person — name + avatar. */
	reported: ResolvedPerson;
	/** The approver person, set at confirm — null name while still a draft. */
	approved: ResolvedPerson;
	totalQty: number | null;
	lineCount: number | null;
}
