/**
 * Per-field grid span — how many columns a field occupies inside its group's grid.
 * Semantics (preview == runtime — shared by the Studio canvas, the Studio preview
 * and the runtime form):
 *
 * 1. `group.fieldSpans[name]` wins (the Studio 1/2/3/4 shortcut) — capped at the
 *    group's column count.
 * 2. Legacy `group.fieldWidths[name] === 'full'` spans all columns.
 * 3. Textarea-ish fields default to full width (long labels benefit), unless an
 *    explicit span says otherwise.
 * 4. Everything else spans 1 column.
 */

/** Field types that read better at full width by default. */
export const TEXTAREA_FIELD_TYPES = new Set(['longtext', 'markdown', 'text_editor']);

interface SpanGroup {
	columns?: number;
	fieldSpans?: Record<string, number>;
	fieldWidths?: Record<string, 'half' | 'full'>;
}

/** Resolve the effective span (1..group.columns) for a field inside a group. */
export function fieldSpanOf(group: SpanGroup, name: string, isTextarea = false): number {
	const cols = Math.max(1, group.columns || 2);
	// An EXPLICIT span (even 1) always wins — presence matters, not just > 1,
	// so fields with a legacy 'full' width or textarea default can be forced narrow.
	const explicit = group.fieldSpans?.[name];
	if (explicit !== undefined) return Math.min(Math.max(1, Math.round(explicit)), cols);
	if (group.fieldWidths?.[name] === 'full') return cols;
	return isTextarea ? cols : 1;
}

/** True when the field type renders as a multi-line textarea. */
export function isTextareaField(type: string): boolean {
	return TEXTAREA_FIELD_TYPES.has(type);
}
