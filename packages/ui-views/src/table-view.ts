/**
 * Table-view editor config — the single source of truth for how a collection's
 * list table renders (columns order/visibility/width/pin, sort, density, rows
 * options). Written by the Studio's table editor (schema_json.list_view) and
 * consumed by the admin frontend's collection list — preview == runtime.
 */

import { formatFieldValue } from './field-format';

export interface TableColumnMeta {
	name: string;
	visible?: boolean;
	/** Display label override — defaults to the field's label. */
	label?: string;
	/** CSS width, e.g. "140px". */
	width?: string;
	align?: 'left' | 'center' | 'right';
	pinned?: 'left' | 'right';
	sortable?: boolean;
}

export interface TableViewConfig {
	/** Ordered column list — later entries come after earlier ones. Omitted columns default to visible at the end. */
	columns?: TableColumnMeta[];
	pageSize?: number;
	defaultSort?: { id: string; direction: 'asc' | 'desc' } | null;
	density?: 'compact' | 'comfortable' | 'spacious';
	striped?: boolean;
	stickyHeader?: boolean;
	/** Show the search toolbar. Defaults to true. */
	searchable?: boolean;
	/** Show an edit/open actions column on each row. */
	rowActions?: boolean;
	/** Enable row checkboxes + a bulk-actions bar. */
	selection?: boolean;
	/** Double-click a cell to edit it in place (runtime only — text/number/select/boolean). */
	inlineEdit?: boolean;
	/**
	 * Show a summary footer row (`<tfoot>`) — record count in the first column
	 * + sums of visible numeric columns. Rendered via the DataTable's native
	 * `showFooter` (see `attachSummaryFooters`).
	 */
	summary?: boolean;
	/**
	 * Group rows by a column — native DataTable grouping (`enableGrouping` +
	 * `defaultGrouping`). Renders expandable group rows with value + count.
	 */
	groupBy?: string | null;
}

import { SYSTEM_FIELD_NAMES } from './system-fields';

/** Resolve the ordered, visible column list for a collection given its config. */
export function tableColumnsOf(lv: TableViewConfig | null | undefined, fields: Array<{ name: string }>): TableColumnMeta[] {
	const user = fields.filter((f) => !SYSTEM_FIELD_NAMES.has(f.name));
	const configured = (lv?.columns ?? [])
		.map((c) => ({ ...c, visible: c.visible !== false }))
		.filter((c) => user.some((f) => f.name === c.name));
	const known = new Set(configured.map((c) => c.name));
	// Fields missing from the config (e.g. added later) appear at the end, visible.
	const rest = user.filter((f) => !known.has(f.name)).map((f) => ({ name: f.name }));
	return [...configured, ...rest];
}

/**
 * Build the per-column `footer` render props for the DataTable summary footer
 * (`showFooter`). Shared by EntityPage and TableBlock so the Studio's
 * `summary: true` renders identically everywhere (design == runtime).
 *
 * Behavior mirrors the old toolbar SummaryBar, relocated into a real `<tfoot>`:
 * - the FIRST rendered column shows the real total (`?count=true`) or the
 *   current-page row count;
 * - every visible numeric column shows the sum of the currently loaded rows,
 *   formatted with the schema field's formatter (currency/percent/…).
 *
 * @param resolvedColumns the rendered column ids, in order (ColumnDef list).
 * @returns footer render props keyed by column id — spread onto columns.
 */
export function attachSummaryFooters(
	resolvedColumns: Array<{ id: string }>,
	fields: Array<{ name: string; type: string; label?: string }>,
	opts: {
		/** Live accessor for the currently loaded rows (current page). */
		getRows: () => Array<Record<string, unknown>>;
		/** Live accessor for the real total (`?count=true`), or null. */
		getTotal: () => number | null;
	},
): Record<string, import('@mmbix/design-system/datatable').ColumnDef<Record<string, unknown>>['footer']> {
	const NUMERIC = new Set(['number', 'integer', 'bigint', 'currency', 'percent', 'duration']);
	const ids = new Set(resolvedColumns.map((c) => c.id));
	const numeric = fields.filter((f) => NUMERIC.has(f.type) && ids.has(f.name));
	const firstId = resolvedColumns[0]?.id;
	const footers: Record<string, import('@mmbix/design-system/datatable').ColumnDef<Record<string, unknown>>['footer']> = {};

	if (firstId) {
		footers[firstId] = () => {
			const count = opts.getTotal() ?? opts.getRows().length;
			return `${count} record${count === 1 ? '' : 's'}`;
		};
	}

	for (const f of numeric) {
		footers[f.name] = () => {
			const sum = opts.getRows().reduce((acc, r) => {
				const v = Number(r[f.name]);
				return Number.isFinite(v) ? acc + v : acc;
			}, 0);
			return sum ? formatFieldValue(f, sum) : '\u2014';
		};
	}

	return footers;
}
