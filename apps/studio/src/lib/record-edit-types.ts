/**
 * Field types the generic record create/edit forms can edit.
 *
 * Single source of truth — RecordFormDialog (the "Add <collection>" form behind
 * the table view's Create button) and RecordDetailView (row edit) both filter
 * schema fields through this set, so a type missing here silently vanishes from
 * every collection's create/edit form (e.g. timestamp/check_in or location
 * fields would never be enterable).
 *
 * Relation inputs rendered by RecordFieldInput:
 *  - `m2o` — single select over the related collection (scalar FK on the row);
 *  - `m2m` — multi-select chips over the related collection (the chosen ids are
 *    sent in the same create/update payload and the engine writes the junction
 *    rows atomically with the parent record).
 *
 * Deliberately excluded (not "forgotten" types):
 *  - `formula` — computed by the engine (stored formulas are engine-owned);
 *  - `o2m` / `m2a` / `table` — relation containers that need the record to
 *    exist first (o2m children) or a polymorphic picker (m2a/table); they
 *    surface in the detail view's related-items sidebar / schema builder, not
 *    as a picker on a fresh record;
 *  - `file` — needs an upload UI, a bare text box can't attach a real file
 *    (image is the editable media type in generic forms via the Studio picker);
 *  - `password` — secrets are hashed server-side; never echo or overwrite them.
 */
/**
 * DocStatus vocabulary + legal transitions, mirrored from the engine
 * (packages/core/src/entity/field-utils.ts) so record forms can surface the
 * document machine. The ENGINE stays the source of truth — the server re-
 * validates every transition — this map only decides which options the UI offers.
 */
export const DOC_STATUSES = ['draft', 'submitted', 'approved', 'cancelled', 'pending_review', 'rejected'] as const;
export type StudioDocStatus = (typeof DOC_STATUSES)[number];

export const DOC_STATUS_LABELS: Record<string, string> = {
	draft: 'Draft',
	submitted: 'Submitted',
	approved: 'Approved',
	cancelled: 'Cancelled',
	pending_review: 'Pending Review',
	rejected: 'Rejected',
};

const DOC_STATUS_TRANSITIONS: Record<string, string[]> = {
	draft: ['submitted', 'cancelled', 'pending_review'],
	submitted: ['approved', 'cancelled'],
	approved: ['cancelled'],
	cancelled: ['draft'],
	pending_review: ['approved', 'rejected', 'cancelled'],
	rejected: ['draft', 'cancelled'],
};

/** Legal next statuses for a document (never includes the current one). */
export function nextDocStatuses(current: string | null | undefined): string[] {
	const cur = (current ?? 'draft').toLowerCase();
	return DOC_STATUS_TRANSITIONS[cur] ?? [];
}

export function docStatusLabel(status: string | null | undefined): string {
	return DOC_STATUS_LABELS[(status ?? '').toLowerCase()] ?? status ?? 'Draft';
}

export const RECORD_EDITABLE_TYPES = new Set([
	// Text-ish scalars.
	'text',
	'longtext',
	'slug',
	'email',
	'phone',
	'url',
	'color',
	'code',
	'markdown',
	'text_editor',
	'icon',
	'barcode',
	'signature',
	// Numeric scalars.
	'number',
	'integer',
	'bigint',
	'currency',
	'percent',
	'rating',
	'duration',
	'progress',
	// Booleans & temporal.
	'boolean',
	'date',
	'datetime',
	'time',
	'timestamp',
	// Structured.
	'json',
	'csv',
	'select',
	'uuid',
	'location',
	// Relations.
	'm2o',
	'm2m',
	'tags',
	// Media (value = a URL string, R2 `/api/media/…` or external CDN).
	'image',
]);
