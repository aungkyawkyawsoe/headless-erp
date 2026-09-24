/**
 * Query Parser
 *
 * Parses URL query parameters into structured filter/sort/field objects.
 * Supports cursor pagination, AND/OR groups, nested relation filters, and aggregation.
 *
 * URL patterns:
 *   ?filter[title][_eq]=Hello
 *   ?filter[category][name][_eq]=Electronics        (nested relation filter)
 *   ?filter[_and][0][a][_eq]=1
 *   ?sort=-price,title
 *   ?fields=id,title
 *   ?search=keyword                 (matches via the collection's search policy:
 *                                    `contains` substring OR index-backed `prefix`)
 *   ?cursor=uuid&limit=10
 *   ?aggregate[count]=*
 *   ?aggregate[sum]=price&aggregate[avg]=price
 *   ?export=csv
 */

import type { QueryBuilder } from '@mmbix/core';
import { ValidationError, sanitizeIdentifier } from '@mmbix/utils';
import { MAX_FIELD_SELECTIONS } from '@mmbix/types';
import { clampPageSize, DEFAULT_PAGE_SIZE } from './page-size';

/**
 * Escape `\`, `%` and `_` so a search term matches LITERALLY under
 * `LIKE ? ESCAPE '\'`. Without this a term containing `%` matches every row
 * (and `_` matches any single char) — a silently-WRONG result, not just noise.
 */
function escapeLikeTerm(term: string): string {
	return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// ─── Types ──────────────────────────────────────────────

export type FilterOperator =
	| '_eq'
	| '_neq'
	| '_gt'
	| '_gte'
	| '_lt'
	| '_lte'
	| '_contains'
	| '_icontains'
	| '_ncontains'
	| '_startswith'
	| '_endswith'
	| '_in'
	| '_nin'
	| '_null'
	| '_nnull'
	| '_between'
	| '_empty'
	| '_nempty';

export type AggregateOp = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'count_distinct';

export interface FilterClause {
	field: string;
	operator: FilterOperator;
	value: unknown;
}

/** A relation filter on a related collection: filter[parent.field...][_op]=value */
export interface NestedFilterClause {
	path: string[]; // e.g. ['category', 'name'] or ['category', 'subcategory', 'name']
	operator: FilterOperator;
	value: unknown;
}

export interface FilterGroup {
	type: 'and' | 'or';
	conditions: FilterClause[];
}

export interface SortClause {
	field: string;
	direction: 'asc' | 'desc';
}

export interface AggregateClause {
	op: AggregateOp;
	field: string;
	alias: string;
}

/** A date-bucket function filter: filter[fn(col)][_op]=value */
export interface FunctionFilter {
	field: string;
	fn: string;
	args: string[];
	operator: FilterOperator;
	value: unknown;
}

/**
 * Directus-style field selection tree (parsed from `?fields=`).
 *
 *   fields=id,title            → root columns {id, title}
 *   fields=*                   → root.all = true (all physical columns, NO relations)
 *   fields=*, -password        → root.all + root.excludes {password}
 *   fields=category            → root.columns {category} (resolver expands relations by name)
 *   fields=category.name       → root.relations.category.columns {name}
 *   fields=category.*          → root.relations.category.all = true
 *   fields=*.*                 → root.all + expandDepth 1 (1st-level relations, all columns)
 *   fields=*.*.*               → expandDepth 2
 *   fields=orders.items.title  → multi-hop path tree
 *   fields=-category.internal  → nested exclude (implies expanding category)
 */
export interface FieldSelection {
	/** '*' at this level → all physical columns (+ formulas). */
	all: boolean;
	/** Named columns at this level (when !all). */
	columns: Set<string>;
	/** Names excluded at this level ('-name' entries). */
	excludes: Set<string>;
	/** Explicit relation paths (a.b → relations: {a: {columns: {b}}}). */
	relations: Map<string, FieldSelection>;
	/** Levels of relations to auto-expand with all columns ('*.*' → 1, '*.*.*' → 2). */
	expandDepth: number;
}

export function emptyFieldSelection(): FieldSelection {
	return { all: false, columns: new Set(), excludes: new Set(), relations: new Map(), expandDepth: 0 };
}

/** Hard caps on `?fields=` — deep/wildcard expansion fans out into one D1 query per
 *  resolved relation per level, so unbounded depth is a DoS vector. Rejected with a
 *  400-style ValidationError rather than silently truncated (callers see the limit).
 *
 *  The entry ceiling is `MAX_FIELD_SELECTIONS`, shared with clients via @mmbix/types
 *  so a projection builder can stay legal by construction — the Studio's
 *  `buildListFields` spends the same budget. */
const MAX_FIELD_PATH_SEGMENTS = 8;
const MAX_FIELD_EXPAND_DEPTH = 3;

/**
 * Parse a flat `?fields=` list into a selection tree.
 * Unknown names are NOT validated here — the resolver decides column vs relation
 * against the collection schema (lenient, like the legacy flat list).
 */
export function parseFieldSelection(fields: string[]): FieldSelection {
	if (fields.length > MAX_FIELD_SELECTIONS) {
		throw new ValidationError(`Too many field selections (max ${MAX_FIELD_SELECTIONS})`);
	}
	const root = emptyFieldSelection();
	for (let raw of fields) {
		raw = raw.trim();
		if (!raw) continue;
		if (raw.startsWith('-')) {
			const path = raw
				.slice(1)
				.split('.')
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
			if (path.length === 0) continue;
			if (path.length > MAX_FIELD_PATH_SEGMENTS) {
				throw new ValidationError(`Field path exceeds maximum depth of ${MAX_FIELD_PATH_SEGMENTS} segments`);
			}
			let node = root;
			for (let i = 0; i < path.length; i++) {
				if (i === path.length - 1) {
					node.excludes.add(path[i]);
				} else {
					let next = node.relations.get(path[i]);
					if (!next) {
						next = emptyFieldSelection();
						node.relations.set(path[i], next);
					}
					node = next;
				}
			}
			continue;
		}
		const segs = raw
			.split('.')
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
		if (segs.length === 0) continue;
		if (segs.length > MAX_FIELD_PATH_SEGMENTS) {
			throw new ValidationError(`Field path exceeds maximum depth of ${MAX_FIELD_PATH_SEGMENTS} segments`);
		}
		// Pure wildcard entries: '*', '*.*', '*.*.*' …
		if (segs.every((s) => s === '*')) {
			if (segs.length - 1 > MAX_FIELD_EXPAND_DEPTH) {
				throw new ValidationError(`Field expansion depth exceeds maximum of ${MAX_FIELD_EXPAND_DEPTH}`);
			}
			root.all = true;
			root.expandDepth = Math.max(root.expandDepth, segs.length - 1);
			continue;
		}
		let node = root;
		for (let i = 0; i < segs.length; i++) {
			const seg = segs[i];
			if (seg === '*') {
				node.all = true;
				continue;
			}
			if (i === segs.length - 1) {
				// Leaf: physical column OR relation name — resolved against the schema.
				node.columns.add(seg);
			} else {
				let next = node.relations.get(seg);
				if (!next) {
					next = emptyFieldSelection();
					node.relations.set(seg, next);
				}
				node = next;
			}
		}
	}
	return root;
}

/** Group-by clause — plain columns or date-bucket functions (month(col)/year(col)/date(col)/week(col)/quarter(col)). */
export interface GroupByClause {
	field: string;
	/** Date-bucket function name — undefined for a plain column. */
	fn?: 'month' | 'year' | 'date' | 'week' | 'quarter';
	/** SELECT alias used for the group column. */
	alias: string;
}

/** strftime formats for simple date-bucket group-by functions. */
export const GROUP_FN_FMTS: Record<string, string> = {
	month: '%Y-%m',
	year: '%Y',
	date: '%Y-%m-%d',
	week: '%G-W%V', // ISO-8601 year + week (SQLite ≥ 3.42)
};

/**
 * Full SQL group expression for a date-bucket function over a quoted field.
 * `quarter` has no strftime format — computed with printf (Q3-2026 style).
 */
export function groupByFnExpr(fn: string, quotedField: string): string {
	if (fn === 'quarter') {
		return `printf('Q%01d-%04d', ((CAST(strftime('%m', ${quotedField}) AS INTEGER) + 2) / 3), CAST(strftime('%Y', ${quotedField}) AS INTEGER))`;
	}
	return `strftime('${GROUP_FN_FMTS[fn] ?? GROUP_FN_FMTS.month}', ${quotedField})`;
}

/** Parse a `groupBy[]` entry: `status` → plain column; `month(created_at)` → date bucket. */
export function parseGroupByClause(raw: string): GroupByClause | null {
	const fn = raw.match(/^(month|year|date|week|quarter)\(([a-zA-Z][a-zA-Z0-9_]*)\)$/);
	if (fn) return { field: fn[2], fn: fn[1] as GroupByClause['fn'], alias: `${fn[1]}_${fn[2]}` };
	if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(raw)) return { field: raw, alias: raw };
	return null;
}

/** SQL SELECT expression for a group-by clause (with alias). */
export function groupBySelectExpr(g: GroupByClause): string {
	if (g.fn) return `${groupByFnExpr(g.fn, `"${g.field}"`)} as "${g.alias}"`;
	return `"${g.field}" as "${g.alias}"`;
}

export interface ParsedQuery {
	fields: string[];
	/** Directus-style selection tree parsed from `?fields=` (null when the param is absent). */
	fieldSelection: FieldSelection | null;
	filters: FilterClause[];
	/** Nested relation filters (parent.field) — applied via IN subqueries */
	nestedFilters: NestedFilterClause[];
	/** Nested relation sorts (parent.field) — applied via correlated subqueries */
	nestedSorts: SortClause[];
	filterGroups: FilterGroup[];
	sorts: SortClause[];
	search: string | null;
	cursor: string | null;
	limit: number;
	aggregate: AggregateClause[];
	export_csv: boolean;
	/** Function-based filters (e.g. filter[year(created_at)][_eq]=2024) */
	functionFilters: FunctionFilter[];
	/** Group-by fields for aggregate reports */
	groupBy: string[];
}

// ─── Operator Mapping ──────────────────────────────────

export const OPERATOR_MAP: Record<FilterOperator, string> = {
	_eq: '=',
	_neq: '!=',
	_gt: '>',
	_gte: '>=',
	_lt: '<',
	_lte: '<=',
	_contains: 'LIKE',
	_icontains: 'LIKE',
	_ncontains: 'NOT LIKE',
	_startswith: 'LIKE',
	_endswith: 'LIKE',
	_in: 'IN',
	_nin: 'NOT IN',
	_null: 'IS NULL',
	_nnull: 'IS NOT NULL',
	_between: 'BETWEEN',
	_empty: '=',
	_nempty: '!=',
};

const VALID_OPERATORS = new Set(Object.keys(OPERATOR_MAP));

const AGGREGATE_OPS: Record<string, AggregateOp> = {
	count: 'count',
	count_distinct: 'count_distinct',
	sum: 'sum',
	avg: 'avg',
	min: 'min',
	max: 'max',
};

// ─── Parser ────────────────────────────────────────────

export class QueryParser {
	static parse(url: URL): ParsedQuery {
		const params = url.searchParams;

		// Page-size policy (enterprise): the backend defines default 25 / max 100
		// (page-size.ts) — the SDK enforces the same contract client-side, so a
		// request can never exceed the ceiling.
		const rawLimit = parseInt(params.get('limit') ?? String(DEFAULT_PAGE_SIZE), 10);
		const limit = clampPageSize(rawLimit);

		const parsed: ParsedQuery = {
			fields: [],
			fieldSelection: null,
			filters: [],
			nestedFilters: [],
			nestedSorts: [],
			filterGroups: [],
			sorts: [],
			search: null,
			cursor: params.get('cursor') ?? null,
			limit,
			aggregate: [],
			export_csv: params.get('export') === 'csv',
			functionFilters: [],
			groupBy: [],
		};

		// Parse fields
		const fieldsStr = params.get('fields');
		if (fieldsStr) {
			parsed.fields = fieldsStr
				.split(',')
				.map((f) => f.trim())
				.filter((f) => f.length > 0);
			parsed.fieldSelection = parseFieldSelection(parsed.fields);
		}

		// Parse sort
		const sortStr = params.get('sort');
		if (sortStr) {
			const clauses: SortClause[] = sortStr
				.split(',')
				.map((s) => s.trim())
				.filter((s) => s.length > 0)
				.map((s) => {
					if (s.startsWith('-')) return { field: s.slice(1), direction: 'desc' as const };
					return { field: s, direction: 'asc' as const };
				});
			// Nested sorts (parent.field) are resolved against the related collection
			parsed.sorts = clauses.filter((c) => !c.field.includes('.'));
			parsed.nestedSorts = clauses.filter((c) => c.field.includes('.'));
		}

		// Parse search
		parsed.search = params.get('search') ?? null;

		// Parse groupBy — ?groupBy[]=category&groupBy[]=status
		const groupByValues = params.getAll('groupBy[]');
		if (groupByValues.length > 0) {
			parsed.groupBy = groupByValues.filter((g) => g.length > 0);
		} else {
			// Also support ?groupBy=category,status (comma-separated)
			const groupByStr = params.get('groupBy');
			if (groupByStr) {
				parsed.groupBy = groupByStr
					.split(',')
					.map((g) => g.trim())
					.filter((g) => g.length > 0);
			}
		}

		// Single pass over params.entries() for all filter/aggregate patterns
		const groupMap = new Map<string, { type: 'and' | 'or'; conditions: FilterClause[] }>();
		for (const [key, rawValue] of params.entries()) {
			// 1. Aggregate — ?aggregate[sum]=price&aggregate[count]=*
			let m = key.match(/^aggregate\[(\w+)\]$/);
			if (m) {
				const op = AGGREGATE_OPS[m[1]];
				if (op) {
					const field = rawValue === '*' ? '*' : rawValue;
					parsed.aggregate.push({ op, field, alias: `${m[1]}_${field === '*' ? 'all' : field}` });
				}
				continue;
			}

			// 2. Group filters — filter[_and|_or][N][field][_op]=value
			m = key.match(/^filter\[(_and|_or)\]\[(\d+)\]\[(.+?)\]\[(_\w+)\]$/);
			if (m) {
				const groupType = m[1] as 'and' | 'or';
				const groupIdx = m[1] + '_' + m[2];
				const opStr = m[4] as FilterOperator;
				if (!VALID_OPERATORS.has(opStr)) throw malformedFilter(key, opStr);
				if (!groupMap.has(groupIdx)) groupMap.set(groupIdx, { type: groupType.slice(1) as 'and' | 'or', conditions: [] });
				groupMap.get(groupIdx)!.conditions.push({ field: m[3], operator: opStr, value: parseFilterValue(rawValue, opStr) });
				continue;
			}

			// 3. Function filters — filter[fn(col)][_op]=value
			// strftime with argument: filter[strftime(format,field)][_op]=value
			m = key.match(/^filter\[strftime\(([^,]+),([a-zA-Z][a-zA-Z0-9_]*)\)\]\[(_\w+)\]$/);
			if (m) {
				const opStr = m[3] as FilterOperator;
				if (!VALID_OPERATORS.has(opStr)) throw malformedFilter(key, opStr);
				parsed.functionFilters.push({
					fn: 'strftime',
					field: m[2],
					args: [m[1]],
					operator: opStr,
					value: parseFilterValue(rawValue, opStr),
				});
				continue;
			}
			// Single-arg functions: filter[fn(field)][_op]=value
			m = key.match(/^filter\[(year|month|day|hour|minute|date|unixepoch)\(([a-zA-Z][a-zA-Z0-9_]*)\)\]\[(_\w+)\]$/);
			if (m) {
				const opStr = m[3] as FilterOperator;
				if (!VALID_OPERATORS.has(opStr)) throw malformedFilter(key, opStr);
				parsed.functionFilters.push({
					fn: m[1],
					field: m[2],
					args: [],
					operator: opStr,
					value: parseFilterValue(rawValue, opStr),
				});
				continue;
			}

			// 4. Nested relation filter (bracketed, single hop) — filter[parent][field][_op]=value
			m = key.match(/^filter\[([a-zA-Z][a-zA-Z0-9_]*)\]\[([a-zA-Z][a-zA-Z0-9_]*)\]\[(_\w+)\]$/);
			if (m) {
				const opStr = m[3] as FilterOperator;
				if (!VALID_OPERATORS.has(opStr)) throw malformedFilter(key, opStr);
				parsed.nestedFilters.push({
					path: [m[1], m[2]],
					operator: opStr,
					value: parseFilterValue(rawValue, opStr),
				});
				continue;
			}

			// 5. Simple filters — filter[FIELD][_OP]=value (dot notation = nested relation filter, multi-hop)
			m = key.match(/^filter\[([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+)\]\[(_\w+)\]$/);
			if (m) {
				const operator = m[2] as FilterOperator;
				if (!VALID_OPERATORS.has(operator)) throw malformedFilter(key, operator);
				parsed.nestedFilters.push({ path: m[1].split('.'), operator, value: parseFilterValue(rawValue, operator) });
				continue;
			}
			m = key.match(/^filter\[([a-zA-Z][a-zA-Z0-9_]*)\]\[(_\w+)\]$/);
			if (m) {
				const operator = m[2] as FilterOperator;
				if (!VALID_OPERATORS.has(operator)) throw malformedFilter(key, operator);
				parsed.filters.push({ field: m[1], operator, value: parseFilterValue(rawValue, operator) });
				continue;
			}

			// 6. Bare field equality — `filter[FIELD]=value`, an implicit `_eq`. This is the
			//    shorthand every caller reaches for first; before this branch existed it
			//    matched NO pattern and was SILENTLY DROPPED, so the request answered the
			//    WHOLE collection with 200 OK — the exact wrong-rows-as-right failure the
			//    applier already refuses for an unknown column (see `applyToQueryBuilder`).
			m = key.match(/^filter\[([a-zA-Z][a-zA-Z0-9_]*)\]$/);
			if (m) {
				parsed.filters.push({ field: m[1], operator: '_eq', value: parseFilterValue(rawValue, '_eq') });
				continue;
			}

			// 7. Any `filter[...]` key that matched no shape above is malformed (a typo'd
			//    bracket or an unknown form). Raise rather than ignore: an ignored filter is
			//    a wrong answer served as a right one (enterprise data integrity).
			if (key.startsWith('filter[')) throw malformedFilter(key);
		}

		// Merge group filter results
		const seenGroups = new Map<string, FilterGroup>();
		for (const [, group] of groupMap) {
			const t = group.type;
			if (!seenGroups.has(t)) seenGroups.set(t, { type: t, conditions: [] });
			seenGroups.get(t)!.conditions.push(...group.conditions);
		}
		parsed.filterGroups = [...seenGroups.values()];

		return parsed;
	}

	/**
	 * Apply filters/sorts/search to QueryBuilder (NOT pagination or aggregate).
	 * `searchFields` — the columns the global `?search=` term should match. When
	 * omitted, falls back to every non-system column (legacy).
	 * `searchMode` — `contains` (default, `LIKE '%term%'`) or `prefix` (anchored
	 * `LIKE 'term%'`, which an index can serve). The term is escaped in BOTH modes
	 * so a literal `%`/`_` in the input is not a wildcard.
	 */
	static applyToQueryBuilder(
		qb: QueryBuilder,
		parsed: ParsedQuery,
		schemaFields: Set<string>,
		searchFields?: string[],
		searchMode: 'contains' | 'prefix' = 'contains',
	): { applied: number; skipped: string[] } {
		const skipped: string[] = [];

		if (parsed.fields.length > 0) {
			const valid = parsed.fields.filter((f) => schemaFields.has(f) || f === 'id' || f === 'created_at' || f === 'updated_at');
			if (valid.length > 0) qb.select(...valid);
		}

		for (const f of parsed.filters) {
			// Fail loudly on unknown columns — silently dropping a filter would return
			// WRONG rows with 200 OK (enterprise data integrity). System columns are
			// expected to be in `schemaFields` (callers merge them in).
			if (!schemaFields.has(f.field)) {
				throw new ValidationError(`Unknown filter field "${f.field}" for this collection`);
			}
			const sqlOp = OPERATOR_MAP[f.operator];
			if (!sqlOp) {
				throw new ValidationError(`Unsupported filter operator "${f.operator}" on field "${f.field}"`);
			}
			switch (f.operator) {
				case '_null':
					qb.where(f.field, 'IS NULL', '');
					break;
				case '_nnull':
					qb.where(f.field, 'IS NOT NULL', '');
					break;
				case '_contains':
				case '_icontains':
					qb.where(f.field, 'LIKE', `%${f.value}%`);
					break;
				case '_ncontains':
					qb.where(f.field, 'NOT LIKE', `%${f.value}%`);
					break;
				case '_startswith':
					qb.where(f.field, 'LIKE', `${f.value}%`);
					break;
				case '_endswith':
					qb.where(f.field, 'LIKE', `%${f.value}`);
					break;
				case '_in':
					qb.whereIn(f.field, f.value as unknown[]);
					break;
				case '_nin':
					qb.whereNotIn(f.field, f.value as unknown[]);
					break;
				case '_between': {
					const a = f.value as [unknown, unknown];
					qb.where(f.field, '>=', a[0]);
					qb.where(f.field, '<=', a[1]);
					break;
				}
				case '_empty':
					qb.where(f.field, '=', '');
					break;
				case '_nempty':
					qb.where(f.field, '!=', '');
					break;
				default:
					qb.where(f.field, sqlOp, f.value);
			}
		}

		for (const s of parsed.sorts) {
			if (schemaFields.has(s.field)) qb.orderBy(s.field, s.direction);
			else throw new ValidationError(`Unknown sort field "${s.field}" for this collection`);
		}

		if (parsed.search) {
			// Search across the target fields (OR group), not just the first one — the
			// DataTable's global search box implies all-columns matching. The whole
			// parenthesized group AND-joins the rest of the query.
			//   contains → AND (col1 LIKE '%term%' OR col2 LIKE '%term%')   (unindexed)
			//   prefix   → AND (col1 LIKE 'term%'  OR col2 LIKE 'term%')    (index seek)
			// An explicit ESCAPE keeps a literal `%` / `_` in the term from acting as a
			// wildcard (a bare `%` search would otherwise match every row).
			const targets =
				searchFields && searchFields.length > 0
					? searchFields
					: [...schemaFields].filter((f) => f !== 'id' && f !== 'created_at' && f !== 'updated_at');
			if (targets.length > 0) {
				const escaped = escapeLikeTerm(parsed.search);
				const pattern = searchMode === 'prefix' ? `${escaped}%` : `%${escaped}%`;
				const clauses = targets.map((col) => `${sanitizeIdentifier(col, 'QueryParser.search')} LIKE ? ESCAPE '\\'`);
				qb.whereRaw(
					`(${clauses.join(' OR ')})`,
					targets.map(() => pattern),
				);
			}
		}

		return { applied: parsed.filters.length - skipped.length, skipped };
	}

	/** Apply function-based filters to QueryBuilder */
	static applyFunctionFilters(qb: QueryBuilder, parsed: ParsedQuery, schemaFields: Set<string>): void {
		for (const ff of parsed.functionFilters) {
			// Allow system timestamp fields even though they're excluded from user-facing schema field set
			const isSystemField = ff.field === 'created_at' || ff.field === 'updated_at';
			if (!schemaFields.has(ff.field) && !isSystemField) continue;

			// Build the SQLite-compatible function expression
			// SQLite has date(), strftime() but NOT year/month/day/hour/minute as standalone functions
			let fnExpr: string;
			if (ff.fn === 'strftime') {
				const fmt = ff.args[0].replace(/'/g, "''");
				fnExpr = `strftime('${fmt}', "${ff.field}")`;
			} else if (ff.fn === 'date') {
				// date() is a built-in SQLite function
				fnExpr = `date("${ff.field}")`;
			} else if (ff.fn === 'unixepoch') {
				fnExpr = `CAST(strftime('%s', "${ff.field}") AS INTEGER)`;
			} else {
				// Map year/month/day/hour/minute to strftime format
				const fmtMap: Record<string, string> = {
					year: '%Y',
					month: '%m',
					day: '%d',
					hour: '%H',
					minute: '%M',
				};
				const fmt = fmtMap[ff.fn];
				if (!fmt) continue; // unknown function, skip
				fnExpr = `CAST(strftime('${fmt}', "${ff.field}") AS INTEGER)`;
			}

			switch (ff.operator) {
				case '_null':
					qb.whereRaw(`${fnExpr} IS NULL`);
					break;
				case '_nnull':
					qb.whereRaw(`${fnExpr} IS NOT NULL`);
					break;
				case '_between': {
					const a = ff.value as [unknown, unknown];
					qb.whereRaw(`${fnExpr} >= ?`, [a[0]]);
					qb.whereRaw(`${fnExpr} <= ?`, [a[1]]);
					break;
				}
				case '_in':
				case '_nin': {
					const arr = ff.value as unknown[];
					const ph = arr.map(() => '?').join(', ');
					const sqlOp = ff.operator === '_in' ? 'IN' : 'NOT IN';
					qb.whereRaw(`${fnExpr} ${sqlOp} (${ph})`, arr);
					break;
				}
				case '_contains':
				case '_icontains':
					qb.whereRaw(`${fnExpr} LIKE ?`, [`%${ff.value}%`]);
					break;
				case '_ncontains':
					qb.whereRaw(`${fnExpr} NOT LIKE ?`, [`%${ff.value}%`]);
					break;
				case '_startswith':
					qb.whereRaw(`${fnExpr} LIKE ?`, [`${ff.value}%`]);
					break;
				case '_endswith':
					qb.whereRaw(`${fnExpr} LIKE ?`, [`%${ff.value}`]);
					break;
				case '_empty':
					qb.whereRaw(`${fnExpr} = ''`);
					break;
				case '_nempty':
					qb.whereRaw(`${fnExpr} != ''`);
					break;
				default: {
					const sqlOp = OPERATOR_MAP[ff.operator];
					if (!sqlOp) continue;
					qb.whereRaw(`${fnExpr} ${sqlOp} ?`, [ff.value]);
				}
			}
		}
	}
}

// ─── Value Parsing ─────────────────────────────────────

function parseFilterValue(rawValue: string, operator: FilterOperator): unknown {
	switch (operator) {
		case '_in':
		case '_nin':
			return rawValue
				.split(',')
				.map((v) => v.trim())
				.filter((v) => v.length > 0);
		case '_between': {
			const p = rawValue.split(',').map((v) => v.trim());
			return p.length >= 2 ? [p[0], p[1]] : [p[0], p[0]];
		}
		case '_null':
		case '_nnull':
			return null;
		case '_empty':
		case '_nempty':
			return '';
		case '_eq':
		case '_neq':
		case '_gt':
		case '_gte':
		case '_lt':
		case '_lte':
			return rawValue;
		default:
			return rawValue;
	}
}

/**
 * A `filter[...]` key or operator the parser cannot honour. Thrown rather than
 * skipped: a dropped filter returns WRONG rows with `200 OK`, so an unrecognised
 * filter must fail the request the same way an unknown COLUMN already does (see
 * `applyToQueryBuilder`). `operator` is omitted for a key that matched no shape.
 */
function malformedFilter(key: string, operator?: string): ValidationError {
	return operator === undefined
		? new ValidationError(`Malformed filter "${key}" — use filter[field]=value or filter[field][_op]=value`)
		: new ValidationError(`Unsupported filter operator "${operator}" in "${key}"`);
}
