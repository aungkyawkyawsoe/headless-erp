import { humanizeEnumValue, selectOptionLabel } from '@mmbix/ui-views';
import { renderTemplate, m2oLabel } from './record-label';
import { formatDatetimeMmt } from './datetime';
import { RELATION_PAGE_LIMIT } from './list-projection';
import type { FieldDefinition } from './api';

// Re-exported so existing call sites / specs keep one import path.
export { renderTemplate, m2oLabel };

/**
 * Pure cell-rendering helpers for the collection table view. Extracted from
 * AppDetailPage so they are unit-testable and shared. Label resolution for
 * relation values lives in ./record-label (single source of truth).
 */

/** Format a raw cell value for the table view. */
export function cellValue(v: unknown): string {
	if (v === null || v === undefined) return '—';
	if (typeof v === 'object') return JSON.stringify(v);
	return String(v);
}

/** Render a cell value — m2o relations expand to objects and honor the field's
 *  display_template; relation arrays (o2m/m2m/table) show how many related rows
 *  there are; select/formula values show the option's label when one is defined,
 *  else enum tokens (`late_in`) render humanized (`Late In`). The stored value
 *  stays the value — only the displayed text changes. */
export function renderCell(f: FieldDefinition, value: unknown): string {
	if (f.type === 'm2o' && value && typeof value === 'object' && !Array.isArray(value)) {
		const obj = value as Record<string, unknown>;
		return renderTemplate(f.display_template, obj) || m2oLabel(obj) || '—';
	}
	// Relation arrays arrive id-only from the table projection (lib/list-projection.ts);
	// a count is useful, a wall of JSON is not. A full page means "at least" — the
	// engine caps each array at RELATION_PAGE_LIMIT rows, so never show it as exact.
	if ((f.type === 'o2m' || f.type === 'm2m' || f.type === 'table') && Array.isArray(value)) {
		if (value.length === 0) return '—';
		return value.length >= RELATION_PAGE_LIMIT ? `${value.length}+` : String(value.length);
	}
	if (f.type === 'select' || f.type === 'formula') {
		const label = f.type === 'select' ? selectOptionLabel(value, f.options) : null;
		if (label !== null) return label;
		const humanized = humanizeEnumValue(value);
		if (humanized !== null) return humanized;
	}
	// datetime/timestamp store UTC instants; the cell reads in Myanmar time (a
	// fixed +6:30 offset — the same wall clock for every operator, unlike the
	// machine-local `toLocaleString`). The stored bytes stay UTC.
	if (f.type === 'datetime' || f.type === 'timestamp') {
		return formatDatetimeMmt(value == null ? null : String(value));
	}
	return cellValue(value);
}
