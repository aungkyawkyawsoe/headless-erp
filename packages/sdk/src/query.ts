/**
 * Typed query builder + wire serialization.
 *
 * The SDK's query shapes mirror the entity engine's native contract:
 *   filter[field][_op]=value       flat conditions
 *   filter[_or][i][field][_op]     OR groups (AND-joined to the flat filters)
 *   filter[_and][i][field][_op]    AND groups
 *   fields=a,b,c                   projection (dot paths expand relations)
 *   sort=-timestamp                +/- prefixed directions
 *   cursor=<keyset>                stable cursor pagination (no OFFSET)
 *
 * Building queries through these types (instead of hand-rolled query strings)
 * is what makes the frontend "zero-waste": typo'd field names, wrong operator
 * spellings and URL-encoding bugs become compile-time errors.
 */

export interface FilterCondition {
	_eq?: string | number | boolean | null;
	_neq?: string | number | boolean | null;
	_gt?: string | number;
	_gte?: string | number;
	_lt?: string | number;
	_lte?: string | number;
	/** Comma-joined inclusive pair `"2024-01-01,2024-12-31"` — the backend splits on ',' into [a, b]. */
	_between?: string;
	_in?: Array<string | number>;
	_nin?: Array<string | number>;
	_contains?: string;
	_icontains?: string;
	_ncontains?: string;
	/** The backend spells these `_startswith`/`_endswith` (NOT `_starts_with`) —
	 *  a misspelled operator is SILENTLY dropped by the server (unfiltered data, HTTP 200). */
	_startswith?: string;
	_endswith?: string;
	/** `= ''` / `!= ''` — the backend ignores the value; serialize as true/false. */
	_empty?: boolean;
	_nempty?: boolean;
	_null?: boolean;
	_nnull?: boolean;
}

export type Filter<T> = {
	[K in keyof T]?: FilterCondition | Filter<Record<string, unknown>>;
} & {
	_or?: Filter<T>[];
	_and?: Filter<T>[];
};

/** The aggregate measures the engine understands (`aggregate[<op>]=<field>`). */
export type AggregateOp = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max';

/** One aggregate measure — `{ op: 'sum', field: 'qty_on_hand' }` → `aggregate[sum]=qty_on_hand`. */
export interface AggregateMeasure {
	op: AggregateOp;
	field: string;
}

/**
 * The column name the engine returns an aggregate under: `${op}_${field}` (e.g.
 * `sum_qty_on_hand`, `count_id`). The alias is a SERVER contract, so it is
 * spelled ONCE here — inline the string and a server-side rename becomes a
 * silent `undefined` (the same failure class as a misspelled filter operator).
 */
export function aggregateAlias(op: AggregateOp, field: string): string {
	return `${op}_${field}`;
}

export interface ListQuery<T> {
	filter?: Filter<T>;
	/** Column projection — `*` = all, dot paths (`author.name`) expand relations.
	 *  Keep it to what the UI renders: the server skips relation resolution and
	 *  decryption for unselected columns. */
	fields?: ReadonlyArray<keyof T | (string & {}) | '*'> | keyof T | string;
	/** `-field` = descending; array for multi-column order. */
	sort?: string | string[];
	limit?: number;
	/** Keyset cursor from a previous page's `meta.next_cursor`. */
	cursor?: string;
	/** Global OR search across text-ish fields. */
	search?: string;
	/** Include `total` in meta (runs a COUNT with the same WHERE). */
	count?: boolean;
	/** Only the total — skips the page SELECT entirely. */
	countOnly?: boolean;
	/** Aggregate measures — REPLACES the row projection; pair with `groupBy` for
	 *  one row per bucket, or omit it for a single totals row. */
	aggregate?: readonly AggregateMeasure[];
	/** Group aggregate rows by plain columns (`tracking`) or date buckets
	 *  (`month(created_at)`). NOTE: a grouped aggregate is NOT page-limited —
	 *  `limit` does not cap bucket count (the server fails loudly past a ceiling
	 *  instead of truncating silently). */
	groupBy?: readonly string[];
}

export interface ListResult<T> {
	data: T[];
	meta: {
		limit: number;
		has_more: boolean;
		next_cursor?: string | null;
		prev_cursor?: string | null;
		total?: number | null;
	};
}

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@mmbix/config';

// ─── Page-size policy (enterprise grade) ───────────────────
// The BACKEND is the single source of truth for how many rows ONE page may
// ask for (the values live in @mmbix/config, env-overridable at deploy time;
// the server exposes the effective contract via GET /api/meta and clamps every
// endpoint). The SDK mirrors the same defaults so it never relies on a server
// default (it always sends an explicit limit) and never exceeds the server
// ceiling. A client can re-discover the server's policy at runtime via
// `client.loadLimits()` and adjust within it. Aggregate loads (directory,
// pickers, full collections) must cursor-walk (loop `list` with `cursor` —
// see the miniapp's `sdkListAll`), never inflate the page size.
//
// Exceptions live OUTSIDE the entity list API (server-internal jobs):
// scheduled-report generation, archive janitor, KPI analytics.

export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };

/** The backend's per-batch cap for POST /api/query — the server SILENTLY
 *  truncates at this many specs; the client mirrors it so both agree. */
export const MAX_QUERIES_PER_BATCH = 12;

/** The backend-declared page-size contract (GET /api/meta → data.pagination). */
export interface PageSizePolicy {
	defaultPageSize: number;
	maxPageSize: number;
}

/** The SDK's built-in fallback — identical to the server's page-size.ts. */
export const DEFAULT_PAGE_SIZE_POLICY: PageSizePolicy = {
	defaultPageSize: DEFAULT_PAGE_SIZE,
	maxPageSize: MAX_PAGE_SIZE,
};

/** Normalize a requested page size against a policy: missing/invalid → the
 *  policy's default; larger than its max → clamped (the server truncates
 *  there anyway). */
export function normalizePageSize(limit: number | undefined, policy: PageSizePolicy = DEFAULT_PAGE_SIZE_POLICY): number {
	if (limit === undefined || !Number.isFinite(limit) || limit < 1) return policy.defaultPageSize;
	return Math.min(Math.trunc(limit), policy.maxPageSize);
}

const ARRAY_OPS = new Set(['_in', '_nin']);
const BOOL_OPS = new Set(['_null', '_nnull', '_empty', '_nempty']);

/** Serialize a single filter value for the wire (`_in` joins with commas). */
export function stringifyFilterValue(op: string, value: unknown): string {
	if (value instanceof Date) return value.toISOString();
	if (BOOL_OPS.has(op)) return value ? 'true' : 'false';
	if (ARRAY_OPS.has(op)) return (value as Array<string | number>).map(String).join(',');
	return String(value);
}

/** Serialize a typed filter into `filter[...]` search params (flat + nested
 *  relation paths + groups).
 *
 *  A relation filter recurses one level per hop: `{ issues_type: { category:
 *  { _eq: id } } }` → `filter[issues_type][category][_eq]=id` (the engine's
 *  `filter[parent.field][_op]` contract). The discriminator is the KEY SHAPE —
 *  every operator is `_`-prefixed, so an object whose keys are NOT is a nested
 *  relation, not a condition. */
export function serializeFilter<T>(filter: Filter<T>, params = new URLSearchParams()): URLSearchParams {
	const walk = (f: Filter<T>, groupPrefix: string | null) => {
		for (const [field, cond] of Object.entries(f as Record<string, unknown>)) {
			if (field === '_or' || field === '_and') continue;
			if (!cond || typeof cond !== 'object') continue;
			const entry = cond as Record<string, unknown>;
			// Nested relation filter — recurse, extending the path.
			if (!Object.keys(entry).some((key) => key.startsWith('_'))) {
				walk(entry as Filter<T>, groupPrefix ? `${groupPrefix}[${field}]` : `filter[${field}]`);
				continue;
			}
			for (const [op, value] of Object.entries(entry)) {
				if (value === undefined) continue;
				const key = groupPrefix ? `${groupPrefix}[${field}][${op}]` : `filter[${field}][${op}]`;
				params.set(key, stringifyFilterValue(op, value));
			}
		}
		const ors = (f as unknown as { _or?: Filter<T>[] })._or;
		if (ors) ors.forEach((g, i) => walk(g, `filter[_or][${i}]`));
		const ands = (f as unknown as { _and?: Filter<T>[] })._and;
		if (ands) ands.forEach((g, i) => walk(g, `filter[_and][${i}]`));
	};
	walk(filter, null);
	return params;
}

/** Serialize a full list query into search params (fields/sort/filter/cursor…). */
export function serializeQuery<T>(query: ListQuery<T> = {}): URLSearchParams {
	const params = new URLSearchParams();
	if (query.fields !== undefined) {
		const fields = Array.isArray(query.fields) ? query.fields.join(',') : String(query.fields);
		if (fields) params.set('fields', fields);
	}
	if (query.sort !== undefined) {
		const sort = Array.isArray(query.sort) ? query.sort.join(',') : query.sort;
		if (sort) params.set('sort', sort);
	}
	if (query.limit !== undefined) params.set('limit', String(query.limit));
	if (query.cursor) params.set('cursor', query.cursor);
	if (query.search) params.set('search', query.search);
	if (query.count === true) params.set('count', 'true');
	if (query.countOnly === true) params.set('count_only', 'true');
	if (query.filter) serializeFilter(query.filter, params);
	// groupBy/aggregate ride LAST (they replace the SELECT server-side). `append`
	// (not `set`) keeps repeated keys — the engine accepts several `aggregate[op]`
	// entries and reads `groupBy[]` as an array.
	for (const group of query.groupBy ?? []) if (group) params.append('groupBy[]', group);
	for (const measure of query.aggregate ?? []) if (measure.field) params.append(`aggregate[${measure.op}]`, measure.field);
	return params;
}
