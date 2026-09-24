/**
 * Pivot-view config — the Studio-designed pivot report block.
 * Consumed by the frontend's `PivotBlock` (design == runtime) and persisted in
 * the page block config (`config`).
 */

export interface PivotAggregate {
	op: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'count_distinct';
	field: string;
	/** SELECT alias — defaults to `${op}_${field === '*' ? 'all' : field}`. */
	alias?: string;
}

export interface PivotViewConfig {
	collection: string;
	/** Row label field (rows dimension). */
	rowGroup: string;
	/** Cross-tab column field (columns dimension). */
	columnGroup: string;
	/** Single aggregate cell value. */
	aggregate: PivotAggregate;
	/** DataTable ColumnFilter shape — translated to the API FilterClause at the call site. */
	filters?: Array<{ id: string; operator: string; value: unknown; valueTo?: unknown }>;
	/** Render a totals row + totals column (client-side sums). */
	showTotals?: boolean;
}
