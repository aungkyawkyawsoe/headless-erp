/**
 * Report definitions — the single source of truth for the reporting layer.
 *
 * A `ReportDefinition` is designed in the Studio, persisted in `_reports`
 * (or a page-block config), executed by the backend (`/api/reports/execute`)
 * and rendered by the frontend (`ReportView` / `PivotTable`). "Write once,
 * run anywhere."
 */

import { SYSTEM_FIELDS } from './entity';

/** Report mode: grouped (row-only) vs pivot (rows × columns cross-tab). */
export type ReportType = 'grouped' | 'pivot';

/** Aggregate operations the report engine supports. */
export type ReportMeasureOp = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'count_distinct';

/** One aggregate measure of a report. */
export interface ReportMeasure {
	op: ReportMeasureOp;
	/** Field name (or `'*'` for count). Relation paths (`customer.country`) supported. */
	field: string;
	/** SELECT alias — defaults to `${op}_${field === '*' ? 'all' : field}`. */
	alias?: string;
	/** Display label — overrides the auto `op(field)` label. */
	label?: string;
	/** Optional presentation format hint (used by renderers). */
	format?: 'number' | 'currency' | 'percent' | 'duration';
}

/** Date-bucket granularity for time dimensions. */
export type ReportGranularity = 'day' | 'week' | 'month' | 'quarter' | 'year';

/** DataTable-shaped filter — translated to the API FilterClause at the call site. */
export interface ReportFilter {
	id: string;
	operator: string;
	value: unknown;
	valueTo?: unknown;
}

/** Report layout preferences (rendering hints — DS stays presentational). */
export interface ReportLayout {
	showTotals: boolean;
	density: 'compact' | 'comfortable' | 'spacious';
	striped: boolean;
	stickyHeader: boolean;
}

/** A saved report definition — executed by the backend, rendered anywhere. */
export interface ReportDefinition {
	type: ReportType;
	collection: string;
	/** Row dimensions — plain field, relation path, or date bucket (`month(created_at)`). */
	rowDimensions: string[];
	/** Column dimensions (pivot only). */
	columnDimensions?: string[];
	measures: ReportMeasure[];
	/** Static filters baked into the report. */
	filters?: ReportFilter[];
	/** Fields the viewer may adjust at runtime (date range, status, …). */
	userFilterFields?: string[];
	/** Optional fixed date window (from/to) — granularity bucketing is expressed
	 *  as a date-bucket dimension instead (e.g. `month(created_at)`). */
	dateRange?: { field: string; from?: string; to?: string };
	sort?: { key: string; dir: 'asc' | 'desc' } | null;
	/** Keep only the top-N row groups. */
	rowLimit?: number;
	/** Keep only the top-N column groups (rest → "Other"). */
	topNColumns?: number;
	/** Insert subtotal rows per row-dimension level. */
	subtotals?: boolean;
	layout: ReportLayout;
}

/** Result of executing a report definition. */
export interface ReportResult {
	data: Array<Record<string, unknown>>;
	/** Pivot column keys (empty for grouped). */
	columns: string[];
	meta: {
		collection: string;
		rowDimensions: string[];
		columnDimensions: string[];
		measures: ReportMeasure[];
		totalRows: number;
		truncated?: { rowLimit?: number; topNColumns?: number };
	};
}

/** A persisted saved-report record (from `_reports`). */
export interface SavedReportRecord {
	id: string;
	name: string;
	slug: string;
	collection: string;
	type: ReportType;
	config: ReportDefinition;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

const DATE_TYPES = new Set(['date', 'datetime', 'timestamp']);
const NUMERIC_TYPES = new Set(['number', 'currency', 'integer', 'bigint', 'percent']);

/**
 * Engine-managed system/audit fields — never picked as report dimensions.
 * Canonical set: `SYSTEM_FIELDS` in `./entity.ts` — imported here rather than
 * duplicated so the reports engine and the schema engine can't drift.
 * `created_at` is intentionally included: a starter pivot should bucket a real
 * user date (e.g. `claim_date`) first, and only fall back to `created_at` when
 * the collection has no other date field.
 */

/**
 * A sensible starter pivot auto-built from a collection's schema, used when
 * neither a designed config nor a baked `schema_json.pivot_view` exists yet
 * (Studio canvas + runtime admin both fall back to it): `month(<first user
 * date field>)` rows × first select columns, summing the first numeric field
 * (count(*) when none). Mirrors what an ERP would default to.
 */
export function starterPivotDef(collection: string, fields: Array<{ name: string; type: string }>): ReportDefinition {
	const userFields = fields.filter((f) => !SYSTEM_FIELDS.has(f.name));
	const dateField = userFields.find((f) => DATE_TYPES.has(f.type)) ?? { name: 'created_at', type: 'timestamp' };
	const selectField = userFields.find((f) => f.type === 'select');
	const numberField = userFields.find((f) => NUMERIC_TYPES.has(f.type));
	return {
		type: 'pivot',
		collection,
		rowDimensions: [`month(${dateField.name})`],
		...(selectField ? { columnDimensions: [selectField.name] } : {}),
		measures: numberField
			? [{ op: 'sum', field: numberField.name, alias: `sum_${numberField.name}`, label: `Sum(${numberField.name})` }]
			: [{ op: 'count', field: '*', alias: 'count_all', label: 'Count' }],
		layout: { showTotals: true, density: 'comfortable', striped: false, stickyHeader: true },
	};
}
