/**
 * Report Engine 2.0 — Grouped Reports & Pivot Tables
 *
 * Provides grouped (GROUP BY + aggregates) and pivot (cross-tabulation)
 * report generation on top of the existing QueryBuilder infrastructure.
 *
 * Both modes support standard filters, function-based filters (date/year/month),
 * and post-aggregation HAVING filters.
 */

import { D1Client } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import { clampPageSize, MAX_PAGE_SIZE } from '@/lib/api/page-size';
import { OPERATOR_MAP, parseGroupByClause, groupByFnExpr } from '@/lib/api/query-parser';
import { sanitizeIdentifier } from '@mmbix/utils';
import { collectionTable } from '@/lib/utils/table-name';
import { DataFilterService, type DataFilterContext } from '@/lib/services/data-filter.service';
import { findCollectionRow } from '@/lib/services/schema-lookup';
import type { AggregateClause, FilterClause, FilterOperator } from '@/lib/api/query-parser';

// ─── Types ──────────────────────────────────────────────

export interface GroupedReportRequest {
	collection: string;
	groupBy: string[];
	aggregates: AggregateClause[];
	filters?: FilterClause[];
	having?: Record<string, unknown>;
	dateRange?: { field: string; from: string; to: string };
	includeTrashed?: boolean;
}

export interface GroupedReportRow {
	[key: string]: unknown;
}

export interface GroupedReportResult {
	data: GroupedReportRow[];
	meta: {
		collection: string;
		groupBy: string[];
		total: number;
	};
}

export interface PivotReportRequest {
	collection: string;
	rowGroup: string;
	columnGroup: string;
	aggregate: AggregateClause;
	filters?: FilterClause[];
	dateRange?: { field: string; from: string; to: string };
	includeTrashed?: boolean;
}

export interface PivotReportResult {
	rows: Record<string, unknown>[];
	columns: string[];
	meta: {
		collection: string;
		rowGroup: string;
		columnGroup: string;
	};
}

// ─── Report v2 — generalized (multi-dimension / multi-measure) ──────────

/** One aggregate measure of a report. */
export interface ReportV2Measure {
	op: string;
	field: string; // '*' for count
	alias: string;
	/** Display label — overrides the auto `op(field)` label. */
	label?: string;
}

/** Generalized report request — superset of the v1 grouped/pivot shapes. */
export interface ReportV2Request {
	collection: string;
	/** Row dimensions — plain field, relation path (`customer.country`), or date bucket (`month(created_at)`). */
	rowDimensions: string[];
	/** Column dimensions (pivot). Omit/empty for a grouped (row-only) report. */
	columnDimensions?: string[];
	measures: ReportV2Measure[];
	filters?: FilterClause[];
	having?: Record<string, unknown>;
	dateRange?: { field: string; from: string; to: string };
	/** Keep only the top-N row groups (ranked by their numeric total). */
	rowLimit?: number;
	/** Keep only the top-N column groups by total (drops the rest into an "Other" column). */
	topNColumns?: number;
	/** Insert subtotal rows at each row-dimension level break (rowDimensions.length >= 2). */
	subtotals?: boolean;
	includeTrashed?: boolean;
}

export interface ReportV2Result {
	/** Dense rows: dim keys + one cell per column (pivot) or per measure (grouped). */
	data: Record<string, unknown>[];
	/** Pivot column keys (composite `a|b` for multi col dims / measures). Empty for grouped. */
	columns: string[];
	meta: {
		collection: string;
		rowDimensions: string[];
		columnDimensions: string[];
		measures: ReportV2Measure[];
		totalRows: number;
		truncated?: { rowLimit?: number; topNColumns?: number };
	};
}

// ── v2 internal resolution types ──────────────────────────

/** Minimal schema field shape used to resolve relation paths. */
interface FieldLike {
	name: string;
	type: string;
	related_collection?: string | null;
}

/** One LEFT JOIN onto a related collection table (one m2o hop). */
interface JoinSpec {
	table: string; // related collection table
	alias: string; // unique join alias (rj_<field>)
	fk: string; // FK column on the base table (the m2o field's own column)
}

/** A resolved dimension: original key + SQL alias + expression + required joins. */
interface ResolvedDim {
	key: string; // original dim string ('customer.country', 'month(created_at)', 'status')
	alias: string; // SQL alias ('customer_country', 'month_created_at', 'status')
	expr: string; // SELECT/GROUP expression
	joins: JoinSpec[];
}

// ─── Allowed Aggregates ────────────────────────────────

const SQL_AGG_MAP: Record<string, string> = {
	count: 'COUNT',
	count_distinct: 'COUNT(DISTINCT',
	sum: 'SUM',
	avg: 'AVG',
	min: 'MIN',
	max: 'MAX',
};

// ─── Report Engine ─────────────────────────────────────

export class ReportEngine {
	constructor(private db: D1Client) {}

	/** Look up the actual table_name for a collection slug (cached schema row). */
	private async _getTableName(slug: string): Promise<string> {
		const schema = await findCollectionRow(this.db, slug);
		return schema?.table_name || collectionTable(slug);
	}

	/**
	 * Generate a grouped report with GROUP BY and aggregates.
	 */
	async groupedReport(req: GroupedReportRequest, rowFilter?: DataFilterContext | null): Promise<GroupedReportResult> {
		const rawTableName = await this._getTableName(req.collection);
		const tableName = sanitizeIdentifier(rawTableName, 'ReportEngine.table');
		const groupByCols = req.groupBy.map((g) => sanitizeIdentifier(g, 'ReportEngine.groupBy'));

		if (groupByCols.length === 0) {
			throw new Error('groupBy must contain at least one field');
		}

		const qb = QueryBuilder.from(tableName);

		// SELECT: group-by columns + aggregate expressions
		// Use selectRaw for aggregate expressions (they contain SQL functions, not plain column names)
		qb.select(...groupByCols);
		for (const a of req.aggregates) {
			const sqlFn = SQL_AGG_MAP[a.op];
			if (!sqlFn) throw new Error(`Invalid aggregate function: ${a.op}`);
			const field = a.field === '*' ? '*' : sanitizeIdentifier(a.field, 'ReportEngine.aggregate');
			const expr = sqlFn + '(' + field + (a.op === 'count_distinct' ? '))' : ')');
			// The alias is interpolated into SQL — validate it like any identifier
			// (never trust the raw request string).
			const alias = sanitizeIdentifier(a.alias, 'ReportEngine.alias');
			qb.selectRaw(`${expr} as ${alias}`);
		}
		qb.groupBy(...groupByCols);

		// Filters
		if (!req.includeTrashed) qb.whereNull('deleted_at');

		if (req.filters) {
			for (const f of req.filters) {
				const field = sanitizeIdentifier(f.field, 'ReportEngine.filter');
				const sqlOp = OPERATOR_MAP[f.operator as FilterOperator];
				if (!sqlOp) continue;

				switch (f.operator as FilterOperator) {
					case '_null':
						qb.where(field, 'IS NULL', '');
						break;
					case '_nnull':
						qb.where(field, 'IS NOT NULL', '');
						break;
					case '_contains':
					case '_icontains':
						qb.where(field, 'LIKE', `%${f.value}%`);
						break;
					case '_ncontains':
						qb.where(field, 'NOT LIKE', `%${f.value}%`);
						break;
					case '_startswith':
						qb.where(field, 'LIKE', `${f.value}%`);
						break;
					case '_endswith':
						qb.where(field, 'LIKE', `%${f.value}`);
						break;
					case '_in':
						qb.whereIn(field, f.value as unknown[]);
						break;
					case '_nin':
						qb.whereNotIn(field, f.value as unknown[]);
						break;
					case '_between': {
						const a = f.value as [unknown, unknown];
						qb.where(field, '>=', a[0]);
						qb.where(field, '<=', a[1]);
						break;
					}
					case '_empty':
						qb.where(field, '=', '');
						break;
					case '_nempty':
						qb.where(field, '!=', '');
						break;
					default:
						qb.where(field, sqlOp, f.value);
				}
			}
		}

		// Date range
		if (req.dateRange) {
			const dateField = sanitizeIdentifier(req.dateRange.field, 'ReportEngine.dateField');
			if (req.dateRange.from) qb.where(dateField, '>=', req.dateRange.from);
			if (req.dateRange.to) qb.where(dateField, '<=', req.dateRange.to);
		}

		// HAVING
		if (req.having) {
			for (const [key, val] of Object.entries(req.having)) {
				const safeKey = sanitizeIdentifier(key, 'ReportEngine.having');
				qb.having(safeKey, '>', Number(val));
			}
		}

		// Row-level RBAC — the same WHERE the entity list path applies, so a
		// role with an owner/scope row filter can never aggregate other owners'
		// rows through a report.
		if (rowFilter) await DataFilterService.applyRowFilter(qb, rowFilter);

		const stmt = qb.toSelect();
		const rows = await this.db.all<Record<string, unknown>>(stmt);

		const total = rows.length;

		return {
			data: rows as GroupedReportRow[],
			meta: {
				collection: req.collection,
				groupBy: req.groupBy,
				total,
			},
		};
	}

	/**
	 * Generate a pivot (cross-tabulation) report.
	 *
	 * Strategy:
	 * 1. Query distinct values of the columnGroup field
	 * 2. Build a single query that aggregates per (rowGroup, columnGroup)
	 * 3. Transform into pivot format: { rows: [{rowGroup, col1, col2, ...}], columns: [...] }
	 */
	async pivotReport(req: PivotReportRequest, rowFilter?: DataFilterContext | null): Promise<PivotReportResult> {
		const rawTableName = await this._getTableName(req.collection);
		const tableName = sanitizeIdentifier(rawTableName, 'ReportEngine.table');
		const rowField = sanitizeIdentifier(req.rowGroup, 'ReportEngine.rowGroup');
		const colField = sanitizeIdentifier(req.columnGroup, 'ReportEngine.columnGroup');
		const sqlFn = SQL_AGG_MAP[req.aggregate.op];
		if (!sqlFn) throw new Error(`Invalid aggregate function: ${req.aggregate.op}`);

		// Step 1: Get distinct column values
		const distinctQb = QueryBuilder.from(tableName);
		if (!req.includeTrashed) distinctQb.whereNull('deleted_at');
		this._applyFilters(distinctQb, req.filters);
		this._applyDateRange(distinctQb, req.dateRange);
		distinctQb.select(colField);
		distinctQb.distinct();
		if (rowFilter) await DataFilterService.applyRowFilter(distinctQb, rowFilter);
		const distinctRows = await this.db.all<Record<string, unknown>>(distinctQb.toSelect());
		const columnValues = distinctRows
			.map((r) => String(r[colField] ?? ''))
			.filter((v) => v.length > 0)
			.sort();

		if (columnValues.length === 0) {
			return { rows: [], columns: [], meta: { collection: req.collection, rowGroup: req.rowGroup, columnGroup: req.columnGroup } };
		}

		// Step 2: Build the aggregated base query
		const aggField = req.aggregate.field === '*' ? '*' : sanitizeIdentifier(req.aggregate.field, 'ReportEngine.aggregate');
		const pivotQb = QueryBuilder.from(tableName);
		if (!req.includeTrashed) pivotQb.whereNull('deleted_at');
		this._applyFilters(pivotQb, req.filters);
		this._applyDateRange(pivotQb, req.dateRange);

		pivotQb.select(rowField, colField);
		pivotQb.selectRaw(`${sqlFn}(${aggField}) as pivot_value`);
		pivotQb.groupBy(rowField, colField);
		if (rowFilter) await DataFilterService.applyRowFilter(pivotQb, rowFilter);

		const rawRows = await this.db.all<Record<string, unknown>>(pivotQb.toSelect());

		// Step 3: Transform to pivot format
		const pivotMap = new Map<string, Record<string, unknown>>();
		const rowOrder: string[] = [];

		for (const raw of rawRows) {
			const rowKey = String(raw[rowField] ?? '');
			const colKey = String(raw[colField] ?? '');
			const value = raw.pivot_value;

			if (!pivotMap.has(rowKey)) {
				pivotMap.set(rowKey, { [rowField]: rowKey });
				rowOrder.push(rowKey);
			}
			const row = pivotMap.get(rowKey)!;
			row[colKey] = value;
		}

		const rows = rowOrder.map((k) => pivotMap.get(k)!) as Record<string, unknown>[];

		return {
			rows,
			columns: columnValues,
			meta: {
				collection: req.collection,
				rowGroup: req.rowGroup,
				columnGroup: req.columnGroup,
			},
		};
	}

	/**
	 * Drill-down — underlying rows for a pivot cell.
	 * Filters carry the cell's row/col dimension values (relation paths supported).
	 */
	async drilldown(
		req: {
			collection: string;
			filters?: FilterClause[];
			limit?: number;
			offset?: number;
		},
		rowFilter?: DataFilterContext | null,
	): Promise<{ rows: Record<string, unknown>[]; total: number }> {
		const schema = await this._getSchema(req.collection);
		const tableName = sanitizeIdentifier(schema.table_name, 'ReportEngine.table');
		const fieldMap = new Map(schema.fields.map((f) => [f.name, f]));
		const joins = new Map<string, JoinSpec>();

		// Total (filters applied) + rows.
		const build = async (withLimit: boolean): Promise<QueryBuilder> => {
			const qb = QueryBuilder.from(tableName);
			const localJoined = new Set<string>();
			const applyJoins = () => {
				for (const j of joins.values()) {
					if (!localJoined.has(j.alias)) {
						qb.leftJoin(j.table, `${tableName}.${j.fk}`, `${j.alias}.id`, j.alias);
						localJoined.add(j.alias);
					}
				}
			};
			applyJoins();
			this._applyFiltersV2(qb, req.filters, fieldMap, joins);
			applyJoins();
			// Row-level RBAC — only the rows this viewer may read (admin: no-op).
			if (rowFilter) await DataFilterService.applyRowFilter(qb, rowFilter);
			if (withLimit) {
				// Page-size policy (enterprise): default 25, max 100 (page-size.ts) — a
				// defensive clamp here AND in the route, so no caller can request an
				// oversized page.
				qb.limit(clampPageSize(req.limit));
				if (req.offset) qb.offset(req.offset);
				qb.orderBy('created_at', 'desc').orderBy('id', 'desc');
			}
			return qb;
		};

		const countRow = await this.db.first<{ count: number }>((await build(false)).toCount());
		const rows = await this.db.all<Record<string, unknown>>((await build(true)).toSelect());
		return { rows, total: countRow?.count ?? 0 };
	}

	// ── Private helpers ──────────────────────────────────

	// TODO: This duplicates QueryParser.applyToQueryBuilder() logic in
	// @/lib/api/query-parser (lines 264-328). Refactor to share by calling
	// QueryParser.applyToQueryBuilder() or QueryParser.applyFunctionFilters()
	// once the caller provides a ParsedQuery and schemaFields set.
	private _applyFilters(qb: QueryBuilder, filters?: FilterClause[]): void {
		if (!filters) return;
		for (const f of filters) {
			const field = sanitizeIdentifier(f.field, 'ReportEngine.filter');
			const sqlOp = OPERATOR_MAP[f.operator as FilterOperator];
			if (!sqlOp) continue;

			switch (f.operator as FilterOperator) {
				case '_null':
					qb.where(field, 'IS NULL', '');
					break;
				case '_nnull':
					qb.where(field, 'IS NOT NULL', '');
					break;
				case '_contains':
				case '_icontains':
					qb.where(field, 'LIKE', `%${f.value}%`);
					break;
				case '_in':
					qb.whereIn(field, f.value as unknown[]);
					break;
				case '_nin':
					qb.whereNotIn(field, f.value as unknown[]);
					break;
				case '_between': {
					const a = f.value as [unknown, unknown];
					qb.where(field, '>=', a[0]);
					qb.where(field, '<=', a[1]);
					break;
				}
				case '_empty':
					qb.where(field, '=', '');
					break;
				case '_nempty':
					qb.where(field, '!=', '');
					break;
				default:
					qb.where(field, sqlOp, f.value);
			}
		}
	}

	private _applyDateRange(qb: QueryBuilder, dateRange?: { field: string; from: string; to: string }): void {
		if (!dateRange) return;
		const dateField = sanitizeIdentifier(dateRange.field, 'ReportEngine.dateField');
		if (dateRange.from) qb.where(dateField, '>=', dateRange.from);
		if (dateRange.to) qb.where(dateField, '<=', dateRange.to);
	}

	// ── Report v2 — generalized pipeline ─────────────────

	/** Load collection schema (table + fields) once per request — from the schema cache. */
	private async _getSchema(slug: string): Promise<{ table_name: string; fields: FieldLike[] }> {
		const s = await findCollectionRow(this.db, slug);
		let fields: FieldLike[] = [];
		try {
			const parsed = JSON.parse(s?.schema_json ?? '{}') as { fields?: FieldLike[] };
			fields = parsed.fields ?? [];
		} catch {
			fields = [];
		}
		return { table_name: s?.table_name || collectionTable(slug), fields };
	}

	/**
	 * Resolve a field path to a quoted SQL expression (+ required joins).
	 * Flat fields → `"field"`; one-hop m2o paths (`customer.country`) →
	 * `"rj_customer"."country"` with a LEFT JOIN on `<head>_id`.
	 */
	private _resolveFieldPath(raw: string, fieldMap: Map<string, FieldLike>): { expr: string; joins: JoinSpec[] } {
		if (!raw.includes('.')) {
			return { expr: `"${sanitizeIdentifier(raw, 'ReportEngine.field')}"`, joins: [] };
		}
		const [head, ...rest] = raw.split('.');
		if (rest.length !== 1) {
			throw new Error(`Relation paths beyond one m2o hop are not supported: ${raw}`);
		}
		const f = fieldMap.get(head);
		if (!f || f.type !== 'm2o' || !f.related_collection) {
			throw new Error(`Unknown relation field: ${head}`);
		}
		const safeHead = sanitizeIdentifier(head, 'ReportEngine.join');
		const relAlias = `rj_${safeHead}`;
		return {
			expr: `"${relAlias}"."${sanitizeIdentifier(rest[0], 'ReportEngine.field')}"`,
			// The m2o field's column is the field name itself (e.g. `customer`),
			// not `<name>_id` — mirrors the entity migrator's TEXT column.
			joins: [{ table: collectionTable(f.related_collection), alias: relAlias, fk: safeHead }],
		};
	}

	/** Resolve a dimension: date bucket, relation path, or flat field. */
	private _resolveDim(raw: string, fieldMap: Map<string, FieldLike>): ResolvedDim {
		const bucket = parseGroupByClause(raw);
		if (bucket?.fn) {
			const quoted = `"${sanitizeIdentifier(bucket.field, 'ReportEngine.dim')}"`;
			return {
				key: raw,
				alias: sanitizeIdentifier(bucket.alias, 'ReportEngine.dim'),
				expr: groupByFnExpr(bucket.fn, quoted),
				joins: [],
			};
		}
		const { expr, joins } = this._resolveFieldPath(raw, fieldMap);
		return {
			key: raw,
			alias: sanitizeIdentifier(raw.includes('.') ? raw.replace(/\./g, '_') : raw, 'ReportEngine.dim'),
			expr,
			joins,
		};
	}

	/** Push one filter clause as raw SQL over a pre-sanitized quoted expression. */
	private _pushFilter(qb: QueryBuilder, expr: string, operator: string, value: unknown): void {
		switch (operator) {
			case '_null':
				qb.whereRaw(`${expr} IS NULL`);
				break;
			case '_nnull':
				qb.whereRaw(`${expr} IS NOT NULL`);
				break;
			case '_contains':
			case '_icontains':
				qb.whereRaw(`${expr} LIKE ?`, [`%${value}%`]);
				break;
			case '_ncontains':
				qb.whereRaw(`${expr} NOT LIKE ?`, [`%${value}%`]);
				break;
			case '_startswith':
				qb.whereRaw(`${expr} LIKE ?`, [`${value}%`]);
				break;
			case '_endswith':
				qb.whereRaw(`${expr} LIKE ?`, [`%${value}`]);
				break;
			case '_in':
				qb.whereRaw(`${expr} IN (SELECT value FROM json_each(?))`, [JSON.stringify(value)]);
				break;
			case '_nin':
				qb.whereRaw(`${expr} NOT IN (SELECT value FROM json_each(?))`, [JSON.stringify(value)]);
				break;
			case '_between': {
				const [a, b] = value as [unknown, unknown];
				qb.whereRaw(`${expr} >= ? AND ${expr} <= ?`, [a, b]);
				break;
			}
			case '_empty':
				qb.whereRaw(`${expr} = ''`);
				break;
			case '_nempty':
				qb.whereRaw(`${expr} != ''`);
				break;
			default: {
				const sqlOp = OPERATOR_MAP[operator as FilterOperator];
				if (!sqlOp) break;
				qb.whereRaw(`${expr} ${sqlOp} ?`, [value]);
			}
		}
	}

	/** Resolve + apply v2 filters; relation paths add joins to `joins` (deduped). */
	private _applyFiltersV2(
		qb: QueryBuilder,
		filters: FilterClause[] | undefined,
		fieldMap: Map<string, FieldLike>,
		joins: Map<string, JoinSpec>,
	): void {
		if (!filters) return;
		for (const f of filters) {
			const { expr, joins: j } = this._resolveFieldPath(f.field, fieldMap);
			for (const s of j) joins.set(s.alias, s);
			this._pushFilter(qb, expr, f.operator, f.value);
		}
	}

	/** Apply v2 date-range filters (relation paths supported). */
	private _applyDateRangeV2(
		qb: QueryBuilder,
		dateRange: { field: string; from: string; to: string } | undefined,
		fieldMap: Map<string, FieldLike>,
		joins: Map<string, JoinSpec>,
	): void {
		if (!dateRange) return;
		const { expr, joins: j } = this._resolveFieldPath(dateRange.field, fieldMap);
		for (const s of j) joins.set(s.alias, s);
		if (dateRange.from) qb.whereRaw(`${expr} >= ?`, [dateRange.from]);
		if (dateRange.to) qb.whereRaw(`${expr} <= ?`, [dateRange.to]);
	}

	/** Insert subtotal rows at each row-dimension level break (JS-computed). */
	private _insertSubtotals(rows: Record<string, unknown>[], rowDims: ResolvedDim[]): Record<string, unknown>[] {
		if (rows.length === 0 || rowDims.length < 2) return rows;
		const dimKeys = new Set(rowDims.map((d) => d.key));
		const groups: { prefix: string; label: string; rows: Record<string, unknown>[] }[] = [];
		for (const row of rows) {
			const prefix = rowDims
				.slice(0, -1)
				.map((d) => String(row[d.key] ?? ''))
				.join('|');
			const label = String(row[rowDims[0].key] ?? '');
			const last = groups[groups.length - 1];
			if (last && last.prefix === prefix) last.rows.push(row);
			else groups.push({ prefix, label, rows: [row] });
		}
		const out: Record<string, unknown>[] = [];
		for (const g of groups) {
			out.push(...g.rows);
			const sub: Record<string, unknown> = { __subtotal: true };
			rowDims.forEach((d, i) => {
				sub[d.key] = i === 0 ? `${g.label} Total` : '';
			});
			// Sum every numeric measure cell present in the group's rows.
			const numericKeys = new Set<string>();
			for (const r of g.rows) {
				for (const k of Object.keys(r)) {
					if (!dimKeys.has(k) && typeof r[k] === 'number') numericKeys.add(k);
				}
			}
			for (const k of numericKeys) {
				sub[k] = g.rows.reduce((s, r) => s + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0);
			}
			out.push(sub);
		}
		return out;
	}

	/**
	 * Generate a generalized report (v2).
	 *
	 * Multi-dimension / multi-measure grouped or pivot report with relation
	 * dimensions (one m2o hop), date buckets, server-side row limit + top-N
	 * columns, optional subtotal rows, HAVING, filters and date range.
	 */
	async reportV2(req: ReportV2Request, rowFilter?: DataFilterContext | null): Promise<ReportV2Result> {
		const schema = await this._getSchema(req.collection);
		const tableName = sanitizeIdentifier(schema.table_name, 'ReportEngine.table');
		const fieldMap = new Map(schema.fields.map((f) => [f.name, f]));

		if (req.rowDimensions.length === 0) throw new Error('rowDimensions must contain at least one field');
		if (req.measures.length === 0) throw new Error('measures must contain at least one aggregate');

		const rowDims = req.rowDimensions.map((d) => this._resolveDim(d, fieldMap));
		const colDims = (req.columnDimensions ?? []).map((d) => this._resolveDim(d, fieldMap));

		// Measures — validate ops, sanitize aliases, resolve field exprs + joins.
		const measures = req.measures.map((m) => {
			const fn = SQL_AGG_MAP[m.op];
			if (!fn) throw new Error(`Invalid aggregate function: ${m.op}`);
			const alias = sanitizeIdentifier(m.alias, 'ReportEngine.alias');
			const { expr, joins } = m.field === '*' ? { expr: '*', joins: [] as JoinSpec[] } : this._resolveFieldPath(m.field, fieldMap);
			const selectExpr = fn === 'COUNT(DISTINCT' ? `COUNT(DISTINCT ${expr})` : `${fn}(${expr})`;
			return { ...m, alias, selectExpr, joins };
		});

		// Collect + dedupe joins across dims, measures, filters and date range.
		const joins = new Map<string, JoinSpec>();
		for (const d of [...rowDims, ...colDims]) for (const j of d.joins) joins.set(j.alias, j);
		for (const m of measures) for (const j of m.joins) joins.set(j.alias, j);

		const qb = QueryBuilder.from(tableName);
		const joined = new Set<string>();
		const applyJoins = () => {
			for (const j of joins.values()) {
				if (!joined.has(j.alias)) {
					qb.leftJoin(j.table, `${tableName}.${j.fk}`, `${j.alias}.id`, j.alias);
					joined.add(j.alias);
				}
			}
		};
		applyJoins();
		if (!req.includeTrashed) qb.whereNull(`${tableName}.deleted_at`);
		this._applyFiltersV2(qb, req.filters, fieldMap, joins);
		this._applyDateRangeV2(qb, req.dateRange, fieldMap, joins);
		// Filters/date-range may have discovered more relation joins — add them now.
		applyJoins();

		// Row-level RBAC — aggregate only the rows this viewer may read. The row
		// filter is unqualified base-column SQL, so it must be injected before
		// GROUP BY/HAVING composition (QueryBuilder renders WHERE first).
		if (rowFilter) await DataFilterService.applyRowFilter(qb, rowFilter);

		// SELECT + GROUP BY — dims (aliased) + one aggregate per measure.
		const selectExprs = [...rowDims, ...colDims].map((d) => `${d.expr} as "${d.alias}"`);
		for (const m of measures) selectExprs.push(`${m.selectExpr} as "${m.alias}"`);
		qb.selectRaw(selectExprs.join(', '));
		qb.groupBy(...[...rowDims, ...colDims].map((d) => d.alias));

		if (req.having) {
			for (const [key, val] of Object.entries(req.having)) {
				qb.having(key, '>', Number(val));
			}
		}

		const rawRows = await this.db.all<Record<string, unknown>>(qb.toSelect());
		const rowAliases = rowDims.map((d) => d.alias);
		const colAliases = colDims.map((d) => d.alias);
		const isPivot = colDims.length > 0;
		const dimKeys = new Set(rowDims.map((d) => d.key));
		const rowTotal = (row: Record<string, unknown>): number =>
			Object.entries(row).reduce((s, [k, v]) => (dimKeys.has(k) ? s : s + (typeof v === 'number' ? v : 0)), 0);

		// ── Pivot transform: dense matrix ─────────────────
		if (isPivot) {
			const rowMap = new Map<string, Record<string, unknown>>();
			const rowOrder: string[] = [];
			const colSet: string[] = [];
			const colSeen = new Set<string>();

			for (const raw of rawRows) {
				const rowKey = rowAliases.map((a) => String(raw[a] ?? '')).join('|');
				let row = rowMap.get(rowKey);
				if (!row) {
					row = {};
					rowDims.forEach((d, i) => {
						row![d.key] = raw[rowAliases[i]] ?? null;
					});
					rowMap.set(rowKey, row);
					rowOrder.push(rowKey);
				}
				const colKey = colAliases.map((a) => String(raw[a] ?? '')).join('|');
				for (const m of measures) {
					const cellKey = measures.length === 1 ? colKey : colKey === '' ? m.alias : `${colKey}|${m.alias}`;
					if (!colSeen.has(cellKey)) {
						colSeen.add(cellKey);
						colSet.push(cellKey);
					}
					row[cellKey] = raw[m.alias] ?? null;
				}
			}

			let rows = rowOrder.map((k) => rowMap.get(k)!);
			let columns = colSet;
			const meta: ReportV2Result['meta'] = {
				collection: req.collection,
				rowDimensions: req.rowDimensions,
				columnDimensions: req.columnDimensions ?? [],
				measures: req.measures.map((m) => ({ op: m.op, field: m.field, alias: m.alias })),
				totalRows: rows.length,
			};

			// top-N columns by total value (+ "Other" bucket).
			if (req.topNColumns && columns.length > req.topNColumns) {
				const totals = new Map<string, number>();
				for (const row of rows) {
					for (const c of columns) {
						const v = row[c];
						if (typeof v === 'number') totals.set(c, (totals.get(c) ?? 0) + v);
					}
				}
				const ranked = [...columns].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
				const keep = ranked.slice(0, req.topNColumns);
				const drop = ranked.slice(req.topNColumns);
				for (const row of rows) {
					const other = drop.reduce((s, c) => s + (typeof row[c] === 'number' ? (row[c] as number) : 0), 0);
					for (const c of drop) delete row[c];
					if (other !== 0) row['Other'] = other;
				}
				columns = [...keep, ...(drop.length > 0 ? ['Other'] : [])];
				meta.truncated = { topNColumns: req.topNColumns };
			}

			// Row limit — keep the biggest rows. Page-size policy (enterprise): never
			// more than MAX_PAGE_SIZE rows per call (page-size.ts), so an aggregate
			// without a rowLimit can't return an unbounded group list; `truncated.rowLimit`
			// tells the caller.
			const effectiveRowLimit = Math.min(req.rowLimit ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
			if (rows.length > effectiveRowLimit) {
				rows = [...rows].sort((a, b) => rowTotal(b) - rowTotal(a)).slice(0, effectiveRowLimit);
				meta.truncated = { ...meta.truncated, rowLimit: effectiveRowLimit };
			}
			meta.totalRows = rows.length;

			if (req.subtotals) rows = this._insertSubtotals(rows, rowDims);
			return { data: rows, columns, meta };
		}

		// ── Grouped transform: dims + measure columns ──────
		let rows = rawRows.map((raw) => {
			const row: Record<string, unknown> = {};
			rowDims.forEach((d, i) => {
				row[d.key] = raw[rowAliases[i]] ?? null;
			});
			for (const m of measures) row[m.alias] = raw[m.alias] ?? null;
			return row;
		});
		const meta: ReportV2Result['meta'] = {
			collection: req.collection,
			rowDimensions: req.rowDimensions,
			columnDimensions: [],
			measures: req.measures.map((m) => ({ op: m.op, field: m.field, alias: m.alias })),
			totalRows: rows.length,
		};
		// Row limit — keep the biggest rows. Page-size policy (enterprise): never
		// more than MAX_PAGE_SIZE rows per call (same ceiling as entity pages).
		const effectiveRowLimit = Math.min(req.rowLimit ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
		if (rows.length > effectiveRowLimit) {
			rows = [...rows].sort((a, b) => rowTotal(b) - rowTotal(a)).slice(0, effectiveRowLimit);
			meta.truncated = { rowLimit: effectiveRowLimit };
		}
		meta.totalRows = rows.length;
		if (req.subtotals) rows = this._insertSubtotals(rows, rowDims);
		return { data: rows, columns: [], meta };
	}
}
