/**
 * Bounded, session-memoized related-row reads for the Studio's relation
 * pickers (m2o selects, m2m chip pickers, o2m join-side comboboxes).
 *
 * The old pattern fired ONE `listItems(token, slug, { limit: 500, fields: '*.*' })`
 * per relational FIELD every time a dialog/detail view opened — the same
 * collection was re-fetched (whole rows, all columns) once per field that
 * referenced it, and `limit: 500` was silently clamped to the engine's
 * 100-row page anyway.
 *
 * This replaces that with:
 *   - ONE fetch per (collection, projection) per dialog session — a loader
 *     created per session memoizes by collection + requested fields, so N
 *     fields referencing the same collection share a single request;
 *   - `limit: RELATED_ROWS_LIMIT` (the engine's max page — the old `500` was
 *     already clamped to this server-side, so nothing is lost);
 *   - a tight projection instead of `'*.*'`: `id` + the row's conventional
 *     display columns + the top-level columns its `display_template` reads
 *     (an m2o column included this way still arrives EXPANDED, so dotted
 *     templates like `{{vehicle.plate_no}}` keep resolving).
 *
 * Rows are deliberately NOT cached beyond the session: the caller recreates
 * the loader whenever the dialog reopens / a different record is loaded, so
 * rows edited elsewhere in the Studio are re-read instead of going stale.
 */

import { listItems } from './api';
import { M2O_DISPLAY_FIELDS, rowLabel } from './record-label';

/** The engine's max page size — a higher `limit` silently clamps to this, so
 *  pickers ask for exactly what they can get. */
export const RELATED_ROWS_LIMIT = 100;

/** Row shape every Studio picker consumes after label mapping. */
export interface RelatedOption {
	id: string;
	label: string;
}

/**
 * A bounded row set of one collection — the memoized unit. Projection is the
 * join of `id`, the conventional display columns and every column the caller's
 * `extraColumns` (child m2o names whose expanded rows the sidebar labels read)
 * asks for.
 */
export interface RelatedRows {
	rows: Array<Record<string, unknown>>;
}

/**
 * The comma-joined `fields` projection for one related-collection read: `id` +
 * the row's conventional display columns (so the `m2oLabel` fallback keeps
 * working without `'*.*'`) + the top-level columns a `display_template` reads
 * (dotted paths like `{{vehicle.plate_no}}` — the m2o column is projected, so
 * the engine still expands it) + caller extras.
 */
export function relatedRowsProjection(template?: string, extraColumns?: readonly string[]): string {
	const cols = new Set<string>(['id', ...M2O_DISPLAY_FIELDS]);
	for (const token of template?.match(/\{\{\s*([\w.]+)\s*\}\}/g) ?? []) {
		const column = token.replace(/\{\{\s*|\s*\}\}/g, '').split('.')[0];
		if (column) cols.add(column);
	}
	for (const column of extraColumns ?? []) {
		if (column) cols.add(column);
	}
	return [...cols].join(',');
}

export type RelatedRowsLoader = (
	/** The related collection slug. */
	slug: string,
	/** The field's `display_template` — drives the projection + label fallbacks. */
	template?: string,
	/** Extra columns to project (e.g. a child collection's m2o names). */
	extraColumns?: readonly string[],
) => Promise<Array<Record<string, unknown>>>;

/**
 * Create a session-scoped related-rows loader: fetches are memoized by
 * `collection + fields`, so several fields referencing the same collection
 * (with the same projection) collapse into ONE request per session. A failed
 * fetch is dropped from the memo so a later open retries it instead of
 * replaying the failure. Recreate the loader per dialog open / per loaded
 * record — its cache must not outlive the session (see the file header).
 */
export function createRelatedRowsLoader(token: string): RelatedRowsLoader {
	const byProjection = new Map<string, Promise<Array<Record<string, unknown>>>>();
	return function loadRelatedRows(
		slug: string,
		template?: string,
		extraColumns?: readonly string[],
	): Promise<Array<Record<string, unknown>>> {
		const fields = relatedRowsProjection(template, extraColumns);
		const key = `${slug}::${fields}`;
		let pending = byProjection.get(key);
		if (!pending) {
			pending = listItems(token, slug, { limit: RELATED_ROWS_LIMIT, fields }).then((res) => res.rows);
			// A transient failure must not poison the session — drop it so the next
			// caller retries; the caller still sees the rejection to degrade per-field.
			pending.catch(() => {
				byProjection.delete(key);
			});
			byProjection.set(key, pending);
		}
		return pending;
	};
}

/** Map fetched rows to the option shape a select/chip/combobox consumes. */
export function toRelatedOptions(rows: Array<Record<string, unknown>>, template?: string): RelatedOption[] {
	return rows.map((row) => ({ id: String(row.id), label: rowLabel(row, template) }));
}
