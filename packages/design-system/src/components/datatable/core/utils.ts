import type { RowData } from '@tanstack/react-table';
import type { LegacyReactTable } from '@tanstack/react-table/legacy';
import type { BorderStyle, FilterOperator } from './types';

/**
 * Convert a CSS width string ("200px", "8rem", "12em") to a pixel number so
 * TanStack's numeric column-sizing model can seed from the column's CSS width.
 * Returns `undefined` for anything it can't parse.
 */
export function cssWidthToNumber(value?: string): number | undefined {
	if (value == null) return undefined;
	const match = value.trim().match(/^([\d.]+)(px|rem|em)?$/i);
	if (!match) return undefined;
	const n = Number.parseFloat(match[1]);
	const unit = (match[2] ?? 'px').toLowerCase();
	if (unit === 'px') return n;
	const base = typeof document !== 'undefined' ? Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16 : 16;
	return Math.round(n * base);
}

/**
 * Width (px) of the row-selection / row-expansion control columns that anchor
 * the left edge of the table (both are `w-10`). Left-pinned columns must be
 * offset by this so they don't overlap the sticky control columns.
 */
export const CONTROL_COLUMN_WIDTH = 40;

/**
 * Vertical (column) border class shared by the header and body cells so the
 * header's column lines stay aligned with the rows below it. Mirrors the
 * body's `all` / `column` border styles; the last cell of each row drops its
 * right border so the table frame stays clean.
 */
export const columnBorderCellClass: Record<BorderStyle, string> = {
	row: '',
	all: 'border-r last:border-r-0',
	column: 'border-r last:border-r-0',
	none: '',
};

/**
 * Border class for the trailing edge of a pinned column group — the boundary
 * between the pinned (sticky) columns and the horizontally scrolling content:
 * - left-pinned: the right edge of the *last* left-pinned column
 * - right-pinned: the left edge of the *first* right-pinned column
 */
export function pinnedColumnBorderClass<TData extends RowData>(table: LegacyReactTable<TData>, columnId: string): string {
	const { start = [], end = [] } = table.getState().columnPinning;
	if (start.length > 0 && start[start.length - 1] === columnId) {
		return 'border-r border-border';
	}
	if (end.length > 0 && end[0] === columnId) {
		return 'border-l border-border';
	}
	return '';
}

/**
 * Sticky positioning style for a pinned (left/right) cell — shared by the
 * header, body and footer so pinned columns stay aligned across all three.
 *
 * Right-pinned columns must use `getAfter('end')` so their DOM order matches
 * their visual order: `getStart('end')` would reverse the order, and the
 * browser's sticky-shift limit would then stop the DOM-first right-pinned
 * column from staying pinned at high scroll positions.
 */
export function pinnedCellStyle<TData extends RowData>(
	table: LegacyReactTable<TData>,
	columnId: string,
	controlOffset = 0,
): React.CSSProperties | undefined {
	const col = table.getColumn(columnId);
	if (!col) return undefined;
	const pinned = col.getIsPinned();
	if (!pinned) return undefined;

	const rect = col.getStart(pinned);
	const offset = pinned === 'end' ? col.getAfter('end') : rect;
	return {
		position: 'sticky',
		[pinned === 'start' ? 'left' : 'right']: `${offset + (pinned === 'start' ? controlOffset : 0)}px`,
		zIndex: 1,
	};
}

/**
 * Format a raw aggregate value (grouped-row cells / footer totals).
 * Numbers are rounded to 2 decimals when non-integer; nullish → em dash.
 */
export function formatAggregateValue(value: unknown): string {
	if (value == null) return '\u2014';
	if (typeof value === 'number') {
		return Number.isInteger(value) ? String(value) : value.toFixed(2);
	}
	return String(value);
}

/**
 * Check if a single cell value matches a filter criteria.
 * Pure function — used both client-side and in custom filterFns.
 */
export function matchesFilter(cellValue: unknown, operator: FilterOperator, filterValue: unknown, filterValueTo?: unknown): boolean {
	switch (operator) {
		case 'contains':
			if (cellValue == null) return false;
			return String(cellValue).toLowerCase().includes(String(filterValue).toLowerCase());
		case 'not-contains':
			if (cellValue == null) return true;
			return !String(cellValue).toLowerCase().includes(String(filterValue).toLowerCase());
		case 'equals':
			return String(cellValue) === String(filterValue);
		case 'not-equals':
			return String(cellValue) !== String(filterValue);
		case 'starts-with':
			if (cellValue == null) return false;
			return String(cellValue).toLowerCase().startsWith(String(filterValue).toLowerCase());
		case 'ends-with':
			if (cellValue == null) return false;
			return String(cellValue).toLowerCase().endsWith(String(filterValue).toLowerCase());
		case 'gt':
			return Number(cellValue) > Number(filterValue);
		case 'gte':
			return Number(cellValue) >= Number(filterValue);
		case 'lt':
			return Number(cellValue) < Number(filterValue);
		case 'lte':
			return Number(cellValue) <= Number(filterValue);
		case 'between':
			return Number(cellValue) >= Number(filterValue) && Number(cellValue) <= Number(filterValueTo);
		case 'in':
			return (filterValue as unknown[]).includes(cellValue);
		case 'not-in':
			return !(filterValue as unknown[]).includes(cellValue);
		case 'is-empty':
			return cellValue == null || cellValue === '' || (Array.isArray(cellValue) && cellValue.length === 0);
		case 'is-not-empty':
			return cellValue != null && cellValue !== '' && (!Array.isArray(cellValue) || cellValue.length > 0);
		default:
			return true;
	}
}
