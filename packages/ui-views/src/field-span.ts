/**
 * Per-field grid width — how many columns a field occupies inside its group's grid.
 * Semantics (preview == runtime — shared by the Studio canvas, the Studio preview
 * and the runtime form):
 *
 * 1. `group.fieldSpans[name]` wins — a column count capped at the group's column
 *    count, or `'fill'`: start where the field falls and take the REST of that row.
 * 2. Legacy `group.fieldWidths[name] === 'full'` spans all columns.
 * 3. WIDE fields (multi-line editors — longtext/markdown/text_editor/json) default
 *    to full width, unless an explicit span says otherwise.
 * 4. Everything else spans 1 column.
 *
 * `fieldSpanOf` answers what the layout DECLARES for a field; `flowSpans` answers
 * how many columns each field actually gets, because `'fill'` depends on where the
 * field lands. Both live here so one rule governs every renderer.
 */

/** Field types that read better at full width by default — the multi-line editors
 *  (a JSON blob needs the width as much as a long note does). */
export const WIDE_FIELD_TYPES = new Set(['longtext', 'markdown', 'text_editor', 'json']);

/** A declared width: a column count, or 'fill' = consume the rest of its row. */
export type FieldSpan = number | 'fill';

interface SpanGroup {
	columns?: number;
	fieldSpans?: Record<string, FieldSpan>;
	fieldWidths?: Record<string, 'half' | 'full'>;
}

/** Clamp a declared column count into 1..cols. */
function clampSpan(span: number, cols: number): number {
	return Math.min(Math.max(1, Math.round(span)), cols);
}

/** The column count that reads as "half a row" in a group of `columns`. */
export function halfSpanOf(columns: number): number {
	return Math.max(1, Math.round(Math.max(1, columns) / 2));
}

/** Resolve the width a field DECLARES inside its group (a column count or 'fill'). */
export function fieldSpanOf(group: SpanGroup, name: string, isWide = false): FieldSpan {
	const cols = Math.max(1, group.columns || 2);
	// An EXPLICIT width (even 1) always wins — presence matters, not just > 1,
	// so fields with a legacy 'full' width or wide-type default can be forced narrow.
	const explicit = group.fieldSpans?.[name];
	if (explicit !== undefined) return explicit === 'fill' ? 'fill' : clampSpan(explicit, cols);
	if (group.fieldWidths?.[name] === 'full') return cols;
	return isWide ? cols : 1;
}

/** True when the field type is a wide (multi-line) editor — see WIDE_FIELD_TYPES. */
export function isWideField(type: string): boolean {
	return WIDE_FIELD_TYPES.has(type);
}

/**
 * Positioned column spans for a group's fields, in render order — how many columns
 * each one actually occupies. A renderer can emit plain `span n` items and let grid
 * auto-placement agree with this walk (it does: an item that no longer fits wraps to
 * the next row, and nothing back-fills the gap it left).
 *
 * `'fill'` resolves against the row the field LANDS in, so a half followed by a fill
 * share one row instead of the fill dropping to the next (which is what spanning all
 * columns would do). That is the whole point of the mode: no dead space at the end of
 * a row — Directus's reason for a `fill` width, expressed in a grid whose column count
 * is configurable (there, fill and full would otherwise render identically).
 */
export function flowSpans(group: SpanGroup, fields: Array<{ name: string; type: string }>): number[] {
	const cols = Math.max(1, group.columns || 2);
	let used = 0; // columns already taken in the row the cursor sits in
	return fields.map((f) => {
		const declared = fieldSpanOf(group, f.name, isWideField(f.type));
		let span: number;
		if (declared === 'fill') {
			span = cols - used; // the rest of the row — all of it when it starts one
		} else {
			span = clampSpan(declared, cols);
			if (used + span > cols) used = 0; // doesn't fit here — wraps to the next row
		}
		used += span;
		if (used >= cols) used = 0;
		return span;
	});
}
