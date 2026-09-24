/**
 * Reports Routes — generalized reporting with RBAC
 *
 * Execution:
 *   POST /api/reports/execute                → Report v2 (multi-dim/measure, relation dims, subtotals, top-N)
 *   POST /api/reports/pivot                  → Pivot report (v1 compat)
 *   GET  /api/reports/pivot/{collection}     → Pivot report via URL params (v1 compat)
 *   POST /api/reports/grouped                → Grouped report (v1 compat)
 *   GET  /api/reports/grouped/{collection}   → Grouped report via URL params (v1 compat)
 *   POST /api/reports/drilldown              → Cell → underlying rows
 *   GET  /api/reports/export                 → CSV/XLSX export (?def=<ReportDefinition JSON> or legacy params)
 *   GET  /api/reports/dashboard              → System-wide summary (admin only)
 *
 * Saved reports:
 *   GET  /api/reports                        → List (role + collection-read filtered)
 *   POST /api/reports                        → Create (authenticated; becomes owner)
 *   GET  /api/reports/:id                    → One saved report
 *   PUT  /api/reports/:id                    → Update (admin or owner)
 *   DELETE /api/reports/:id                  → Delete (admin or owner)
 *
 * RBAC: execution requires `read` permission on the collection (admin bypass);
 * field restrictions are applied to dimensions/measures/filters.
 */

import { Hono, type Context } from 'hono';
import { D1Client, QueryBuilder, CacheLayer, cache } from '@mmbix/core';
import { ReportService } from '@/lib/services/report.service';
import { ReportEngine, type ReportV2Request, type ReportV2Result } from '@/services/report-engine.service';
import { QueryParser } from '@/lib/api/query-parser';
import { requireAuth } from './auth';
import { requireAdmin, requireCollectionRead } from '@/middleware/rbac-guard';
import { PermissionEvaluator } from '@/lib/services/permission-evaluator';
import type { DataFilterContext } from '@/lib/services/data-filter.service';
import { fail, success } from '@/lib/api/response';
import { toXlsxBuffer } from '@/lib/xlsx';
import { clampPageSize, DEFAULT_PAGE_SIZE } from '@/lib/api/page-size';
import type { AggregateClause, FilterClause } from '@/lib/api/query-parser';
import { idempotencyMiddleware } from '@/plugins/idempotency/plugin';

const app = new Hono<{
	Bindings: { DB: D1Database; ADMIN_PASSWORD: string };
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
}>();
app.use('*', requireAuth);
// Stripe-style Idempotency-Key: keyed retries never duplicate; unkeyed pass through.
app.use('*', idempotencyMiddleware());

const svc = (c: Context) => new ReportService(new D1Client(c.env.DB));
const engine = (c: Context) => new ReportEngine(new D1Client(c.env.DB));
const authOf = (c: Context) => c.get('auth') as import('@/lib/services/auth.service').AuthContext;

/** Inline collection-read guard for body-based routes (admin bypass). */
async function guardCollectionRead(c: Context, collection: string): Promise<boolean> {
	const auth = authOf(c);
	if (auth.is_admin) return true;
	const db = new D1Client(c.env.DB);
	return PermissionEvaluator.checkBusiness(db, auth, collection, 'read');
}

// ─── Field-restriction filtering ─────────────────────────

/** Parse the BASE schema field name out of a dimension/measure/filter ref. */
function baseFieldOf(ref: string): string {
	const bucket = ref.match(/^(month|year|date|week|quarter)\(([a-zA-Z][a-zA-Z0-9_]*)\)$/);
	if (bucket) return bucket[2];
	const dot = ref.indexOf('.');
	return dot === -1 ? ref : ref.slice(0, dot);
}

/** System columns every read path always returns — never treated as restricted. */
const SYSTEM_ALLOWED_FIELDS = new Set(['id', 'created_at', 'updated_at']);

/**
 * The role's field-visibility WHITELIST for a collection (same source the
 * entity list path prunes with). `null` = unrestricted (admin, or no row in
 * `_role_permissions`). An EMPTY array is a real whitelist that allows
 * nothing but system columns — callers must reject, not treat as "all".
 */
async function allowedFieldSet(c: Context, collection: string): Promise<Set<string> | null> {
	const auth = authOf(c);
	if (!auth || auth.is_admin) return null;
	const restrictions = await PermissionEvaluator.getFieldRestrictions(new D1Client(c.env.DB), auth.role_id, collection);
	if (restrictions === null) return null;
	const allowed = new Set(restrictions.map((f) => f.replace(/^!/, '')));
	for (const s of SYSTEM_ALLOWED_FIELDS) allowed.add(s);
	return allowed;
}

/**
 * Row-level RBAC scope for a report query — mirrors the entity list path's
 * `getFilterContext(...)`. Admins have no scope (full visibility).
 */
function rowFilterFor(c: Context, collection: string): DataFilterContext | null {
	const auth = authOf(c);
	if (!auth || auth.is_admin) return null;
	return { db: new D1Client(c.env.DB), auth, collectionSlug: collection };
}

/**
 * Filter a report request down to the fields the user may read.
 * Restricted dimensions/measures/filters are dropped; when nothing remains
 * for a required axis the whole request is rejected (403).
 */
async function applyFieldRestrictions(
	c: Context,
	req: ReportV2Request,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
	const allowed = await allowedFieldSet(c, req.collection);
	if (allowed === null) return { ok: true };

	const canUse = (ref: string) => allowed.has(baseFieldOf(ref));

	const rowDimensions = req.rowDimensions.filter(canUse);
	const columnDimensions = (req.columnDimensions ?? []).filter(canUse);
	const measures = req.measures.filter((m) => m.field === '*' || canUse(m.field));
	const filters = (req.filters ?? []).filter((f) => canUse(f.field));
	const dateRange = req.dateRange && canUse(req.dateRange.field) ? req.dateRange : undefined;

	if (rowDimensions.length === 0 || measures.length === 0) {
		return { ok: false, status: 403, error: 'All report fields are restricted for your role' };
	}

	req.rowDimensions = rowDimensions;
	req.columnDimensions = columnDimensions;
	req.measures = measures;
	req.filters = filters;
	req.dateRange = dateRange;
	return { ok: true };
}

/**
 * Filter a v1 grouped-report request (groupBy/aggregates/filters/dateRange) down
 * to the fields the user may read — adapted from applyFieldRestrictions for the
 * v1 request shape. Restricted axes are dropped; when nothing usable remains for
 * a required axis the whole request is rejected (403). Admin bypass.
 */
async function applyGroupedFieldRestrictions(
	c: Context,
	body: {
		collection: string;
		groupBy: string[];
		aggregates: { op: string; field: string; alias: string }[];
		filters?: FilterClause[];
		having?: Record<string, unknown>;
		dateRange?: { field: string; from: string; to: string };
	},
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
	const allowed = await allowedFieldSet(c, body.collection);
	if (allowed === null) return { ok: true };

	const canUse = (ref: string) => allowed.has(baseFieldOf(ref));

	body.groupBy = body.groupBy.filter(canUse);
	body.aggregates = body.aggregates.filter((a) => a.field === '*' || canUse(a.field));
	if (body.filters) body.filters = body.filters.filter((f) => canUse(f.field));
	body.dateRange = body.dateRange && canUse(body.dateRange.field) ? body.dateRange : undefined;

	if (body.groupBy.length === 0 || body.aggregates.length === 0) {
		return { ok: false, status: 403, error: 'All report fields are restricted for your role' };
	}

	return { ok: true };
}

/** Drop filter fields the role may not read from a drilldown request (parity with /execute). */
async function restrictDrilldownFilters(c: Context, collection: string, filters: FilterClause[] | undefined): Promise<FilterClause[]> {
	const allowed = await allowedFieldSet(c, collection);
	if (allowed === null || !filters || filters.length === 0) return filters ?? [];
	return filters.filter((f) => allowed.has(baseFieldOf(f.field)));
}

// ─── Execute (v2) ────────────────────────────────────────

/**
 * Stable cache key for a report execution — the *restricted* request (after
 * field restrictions are applied) hashed with the viewer's role AND identity
 * (row filters resolve `$CURRENT_USER` per user, so same-role users cannot
 * share one payload), so users only ever read back rows computed under their
 * own restrictions.
 */
async function reportCacheKey(collection: string, roleKey: string, req: unknown): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(req)));
	const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
	return `report:${collection}:${roleKey}:${hex}`;
}

/**
 * POST /api/reports/execute — generalized report execution.
 * Body: ReportV2Request (rowDimensions, columnDimensions?, measures, …).
 * Results are cached per (definition, role) for a short TTL (see CacheLayer).
 */
app.post('/execute', async (c) => {
	const body = (await c.req.json().catch(() => null)) as Partial<ReportV2Request> | null;
	if (!body || !body.collection) return fail(c, 'collection is required', 400);
	if (!(await guardCollectionRead(c, body.collection))) {
		return fail(c, `You do not have "read" permission on "${body.collection}"`, 403);
	}

	const guarded = await applyFieldRestrictions(c, body as ReportV2Request);
	if (!guarded.ok) return fail(c, guarded.error, guarded.status);

	const auth = authOf(c);
	const scopeKey = auth.is_admin ? 'admin' : `role_${auth.role_id}:u_${auth.user_id || auth.email || 'anon'}`;
	const cacheKey = await reportCacheKey(body.collection, scopeKey, body);
	const cached = cache.get<{ data: ReportV2Result['data']; columns: string[]; meta: ReportV2Result['meta'] }>(cacheKey);
	if (cached) return c.json({ success: true, data: cached.data, columns: cached.columns, meta: cached.meta });

	// Row-level RBAC: aggregate only the rows this viewer may read (admins: all).
	const result = await engine(c).reportV2(body as ReportV2Request, rowFilterFor(c, body.collection));
	cache.set(cacheKey, { data: result.data, columns: result.columns, meta: result.meta }, CacheLayer.SHORT_TTL);
	return c.json({ success: true, data: result.data, columns: result.columns, meta: result.meta });
});

// ─── v1 Compat routes (now collection-read gated) ────────

app.post('/pivot', async (c) => {
	const body = (await c.req.json()) as {
		collection: string;
		rowGroup: string;
		columnGroup: string;
		aggregate: { op: string; field: string; alias: string };
		filters?: FilterClause[];
		dateRange?: { field: string; from: string; to: string };
	};
	if (!body.collection || !body.rowGroup || !body.columnGroup || !body.aggregate) {
		return fail(c, 'collection, rowGroup, columnGroup, and aggregate are required', 400);
	}
	if (!(await guardCollectionRead(c, body.collection))) {
		return fail(c, `You do not have "read" permission on "${body.collection}"`, 403);
	}

	const result = await engine(c).pivotReport(
		{
			collection: body.collection,
			rowGroup: body.rowGroup,
			columnGroup: body.columnGroup,
			aggregate: body.aggregate as AggregateClause,
			filters: body.filters,
			dateRange: body.dateRange,
		},
		rowFilterFor(c, body.collection),
	);
	return c.json({ success: true, data: result.rows, columns: result.columns, meta: result.meta });
});

app.get(
	'/pivot/:collection',
	requireCollectionRead((c) => c.req.param('collection') ?? null),
	async (c) => {
		const collection = c.req.param('collection');
		const url = new URL(c.req.url);
		const params = url.searchParams;

		const rowGroup = params.get('rows');
		const columnGroup = params.get('cols');
		if (!rowGroup || !columnGroup) {
			return fail(c, 'rows and cols query params are required', 400);
		}

		let aggOp = 'count';
		let aggField = '*';
		let aggAlias = 'count_all';
		for (const [key, val] of params.entries()) {
			const vMatch = key.match(/^value\[(\w+)\]$/);
			if (vMatch) {
				aggOp = vMatch[1];
				aggField = val === '*' ? '*' : val;
				aggAlias = `${aggOp}_${aggField === '*' ? 'all' : aggField}`;
			}
		}

		const parsed = QueryParser.parse(url);
		const filters: FilterClause[] = parsed.filters;

		const dateFrom = params.get('dateFrom') || undefined;
		const dateTo = params.get('dateTo') || undefined;
		const dateField = params.get('dateField') || 'created_at';
		const dateRange = dateFrom || dateTo ? { field: dateField, from: dateFrom || '', to: dateTo || '' } : undefined;

		const result = await engine(c).pivotReport(
			{
				collection,
				rowGroup,
				columnGroup,
				aggregate: { op: aggOp as AggregateClause['op'], field: aggField, alias: aggAlias },
				filters,
				dateRange,
			},
			rowFilterFor(c, collection),
		);
		return c.json({ success: true, data: result.rows, columns: result.columns, meta: result.meta });
	},
);

app.post('/grouped', async (c) => {
	const body = (await c.req.json()) as {
		collection: string;
		groupBy: string[];
		aggregates: { op: string; field: string; alias: string }[];
		filters?: FilterClause[];
		having?: Record<string, unknown>;
		dateRange?: { field: string; from: string; to: string };
	};

	if (!body.collection || !body.groupBy || !body.aggregates) {
		return fail(c, 'collection, groupBy, and aggregates are required', 400);
	}
	if (!(await guardCollectionRead(c, body.collection))) {
		return fail(c, `You do not have "read" permission on "${body.collection}"`, 403);
	}
	const guarded = await applyGroupedFieldRestrictions(c, body);
	if (!guarded.ok) return fail(c, guarded.error, guarded.status);

	const result = await engine(c).groupedReport(
		{
			collection: body.collection,
			groupBy: body.groupBy,
			aggregates: body.aggregates as AggregateClause[],
			filters: body.filters,
			having: body.having,
			dateRange: body.dateRange,
		},
		rowFilterFor(c, body.collection),
	);
	return success(c, result.data, 200, result.meta);
});

app.get(
	'/grouped/:collection',
	requireCollectionRead((c) => c.req.param('collection') ?? null),
	async (c) => {
		const collection = c.req.param('collection');
		const url = new URL(c.req.url);
		const parsed = QueryParser.parse(url);

		if (parsed.groupBy.length === 0) {
			return fail(c, 'groupBy[] is required', 400);
		}
		if (parsed.aggregate.length === 0) {
			return fail(c, 'aggregate is required', 400);
		}

		const filters: FilterClause[] = parsed.filters;
		const having: Record<string, unknown> = {};
		for (const [key, val] of url.searchParams.entries()) {
			const hMatch = key.match(/^having\[(\w+)\]$/);
			if (hMatch) {
				having[hMatch[1]] = Number(val);
			}
		}

		const dateFrom = url.searchParams.get('dateFrom') || undefined;
		const dateTo = url.searchParams.get('dateTo') || undefined;
		const dateField = url.searchParams.get('dateField') || 'created_at';
		const dateRange = dateFrom || dateTo ? { field: dateField, from: dateFrom || '', to: dateTo || '' } : undefined;

		const result = await engine(c).groupedReport(
			{
				collection,
				groupBy: parsed.groupBy,
				aggregates: parsed.aggregate,
				filters,
				having: Object.keys(having).length > 0 ? having : undefined,
				dateRange,
			},
			rowFilterFor(c, collection),
		);
		return success(c, result.data, 200, result.meta);
	},
);

// ─── Drill-down ───────────────────────────────────────────

/**
 * POST /api/reports/drilldown — underlying rows for a pivot cell.
 * Body: { collection, filters, limit?, offset? } — filters carry the cell's
 * row/col dimension values (relation paths supported).
 */
app.post('/drilldown', async (c) => {
	const body = (await c.req.json()) as {
		collection: string;
		filters?: FilterClause[];
		limit?: number;
		offset?: number;
	};

	if (!body.collection) return fail(c, 'collection is required', 400);
	if (!(await guardCollectionRead(c, body.collection))) {
		return fail(c, `You do not have "read" permission on "${body.collection}"`, 403);
	}

	const filters = await restrictDrilldownFilters(c, body.collection, body.filters);

	const result = await engine(c).drilldown(
		{
			collection: body.collection,
			filters,
			// Page-size policy (enterprise): default 25, max 100 (page-size.ts).
			limit: clampPageSize(body.limit ?? DEFAULT_PAGE_SIZE),
			offset: body.offset ?? 0,
		},
		rowFilterFor(c, body.collection),
	);

	// Column-level RBAC: drilldown returns raw rows — prune every field the
	// viewer's whitelist does not allow (parity with the entity read path).
	const allowed = await allowedFieldSet(c, body.collection);
	const rows =
		allowed === null
			? result.rows
			: result.rows.map((r) => {
					const out: Record<string, unknown> = {};
					for (const [k, v] of Object.entries(r)) if (allowed.has(k)) out[k] = v;
					return out;
				});
	return success(c, rows, 200, { total: result.total });
});

// ─── Export ───────────────────────────────────────────────

function csvEscape(value: unknown): string {
	const s = value == null ? '' : String(value);
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(
	headers: string[],
	rows: Array<Record<string, unknown>>,
	keyOf: (row: Record<string, unknown>, header: string) => unknown,
): string {
	const lines = [headers.map(csvEscape).join(',')];
	for (const row of rows) {
		lines.push(headers.map((h) => csvEscape(keyOf(row, h))).join(','));
	}
	return lines.join('\n');
}

/**
 * GET /api/reports/export?collection=&format=csv|xlsx
 * Either `def` (urlencoded ReportDefinition JSON) or legacy
 * `rows=&cols=&value[op]=field` / `groupBy[]=&aggregate[op]=field` params.
 */
app.get(
	'/export',
	requireCollectionRead((c) => new URL(c.req.url).searchParams.get('collection')),
	async (c) => {
		const params = new URL(c.req.url).searchParams;
		const collection = params.get('collection');
		const format = params.get('format') ?? 'csv';
		if (!collection) return fail(c, 'collection is required', 400);
		if (format !== 'csv' && format !== 'xlsx') return fail(c, 'Only format=csv or format=xlsx is supported', 400);

		let req: ReportV2Request;
		const defRaw = params.get('def');
		if (defRaw) {
			try {
				req = JSON.parse(defRaw) as ReportV2Request;
			} catch {
				return fail(c, 'def must be valid ReportDefinition JSON', 400);
			}
			if (!req.collection) return fail(c, 'def.collection is required', 400);
		} else {
			const rowsParam = params.get('rows');
			const colsParam = params.get('cols');
			const measures: ReportV2Request['measures'] = [];
			for (const [key, val] of params.entries()) {
				const m = key.match(/^value\[(\w+)\]$/);
				if (m) {
					const field = val === '*' ? '*' : val;
					measures.push({ op: m[1], field, alias: `${m[1]}_${field === '*' ? 'all' : field}` });
				}
			}
			const groupBy = params.getAll('groupBy[]');
			if (!rowsParam && groupBy.length === 0) return fail(c, 'rows or groupBy[] is required', 400);
			req = {
				collection,
				rowDimensions: rowsParam
					? rowsParam
							.split(',')
							.map((s) => s.trim())
							.filter(Boolean)
					: groupBy,
				columnDimensions: colsParam
					? colsParam
							.split(',')
							.map((s) => s.trim())
							.filter(Boolean)
					: [],
				measures: measures.length > 0 ? measures : [{ op: 'count', field: '*', alias: 'count_all' }],
			};
		}

		// The guarded query param is the read scope — a `def` may not pivot to a
		// different collection than the one checked by requireCollectionRead.
		if (req.collection !== collection) return fail(c, 'def.collection must match the collection query param', 400);

		// Field-level RBAC: drop dimensions/measures/filters the viewer may not read.
		const restricted = await applyFieldRestrictions(c, req);
		if (!restricted.ok) return fail(c, restricted.error, restricted.status);

		// Row-level RBAC: export only the rows this viewer may read.
		const result = await engine(c).reportV2(req, rowFilterFor(c, collection));

		// Headers: row dims first, then pivot columns / measure aliases.
		const headers = [...req.rowDimensions, ...(result.columns.length > 0 ? result.columns : req.measures.map((m) => m.alias))];
		const keyOf = (row: Record<string, unknown>, h: string) => row[h] ?? '';

		if (format === 'xlsx') {
			const buf = toXlsxBuffer(headers, result.data, keyOf);
			return new Response(buf, {
				headers: {
					'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
					'Content-Disposition': `attachment; filename="${req.collection}-report.xlsx"`,
				},
			});
		}

		const csv = toCsv(headers, result.data, keyOf);

		return new Response(csv, {
			headers: {
				'Content-Type': 'text/csv; charset=utf-8',
				'Content-Disposition': `attachment; filename="${req.collection}-report.csv"`,
			},
		});
	},
);

// ─── Dashboard (admin only) — registered BEFORE /:id so it is not shadowed ──

app.get('/dashboard', requireAdmin, async (c) => {
	const data = await svc(c).dashboard();
	return success(c, data);
});

/** POST /api/reports/generate — legacy custom report (admin only, kept for compat). */
app.post('/generate', requireAdmin, async (c) => {
	const body = await c.req.json();
	const result = await svc(c).generateReport(body);
	return success(c, result);
});

// ─── Saved reports (_reports CRUD) ────────────────────────

function slugify(name: string): string {
	return name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
}

async function canViewReport(
	c: Context,
	report: { collection: string; roles: string | null },
	/** Per-request memo of the collection permission — the saved reports share a
	 *  handful of collections, so listing N reports over M collections cost N
	 *  `checkBusiness` lookups (each an uncached-on-cold `_role_permissions` read);
	 *  M is now the ceiling. */
	canRead?: (collection: string) => Promise<boolean>,
): Promise<boolean> {
	const auth = authOf(c);
	if (auth.is_admin) return true;
	// Role gate: roles === null → visible to every reader of the collection.
	if (report.roles) {
		try {
			const allowed = JSON.parse(report.roles) as string[];
			if (!allowed.includes(auth.role_name) && !allowed.includes(auth.role_id)) return false;
		} catch {
			return false;
		}
	}
	if (canRead) return canRead(report.collection);
	const db = new D1Client(c.env.DB);
	return PermissionEvaluator.checkBusiness(db, auth, report.collection, 'read');
}

app.get('/', async (c) => {
	const db = new D1Client(c.env.DB);
	const rows = await db.all<{
		id: string;
		name: string;
		slug: string;
		collection: string;
		type: string;
		config_json: string;
		roles: string | null;
		created_by: string | null;
		created_at: string;
		updated_at: string;
	}>(QueryBuilder.from('_reports').select('*').orderBy('name', 'asc').toSelect());

	// ONE permission lookup per distinct collection, not one per report.
	const permissionCache = new Map<string, boolean>();
	const canRead = async (collection: string): Promise<boolean> => {
		const cached = permissionCache.get(collection);
		if (cached !== undefined) return cached;
		const allowed = await PermissionEvaluator.checkBusiness(db, authOf(c), collection, 'read');
		permissionCache.set(collection, allowed);
		return allowed;
	};

	const out = [];
	for (const r of rows) {
		if (!(await canViewReport(c, r, canRead))) continue;
		let config: unknown = {};
		try {
			config = JSON.parse(r.config_json);
		} catch {
			config = {};
		}
		out.push({
			id: r.id,
			name: r.name,
			slug: r.slug,
			collection: r.collection,
			type: r.type,
			config,
			created_by: r.created_by,
			created_at: r.created_at,
			updated_at: r.updated_at,
		});
	}
	return success(c, out);
});

app.post('/', async (c) => {
	const auth = authOf(c);
	const body = (await c.req.json()) as {
		name?: string;
		collection?: string;
		type?: 'grouped' | 'pivot';
		config?: ReportV2Request;
		roles?: string[] | null;
	};
	if (!body.name || !body.collection || !body.type || !body.config) {
		return fail(c, 'name, collection, type, and config are required', 400);
	}

	const db = new D1Client(c.env.DB);
	const base = slugify(body.name) || 'report';
	let slug = base;
	let n = 1;
	const existing = await db.all<{ slug: string }>(QueryBuilder.from('_reports').select('slug').toSelect());
	const taken = new Set(existing.map((r) => r.slug));
	while (taken.has(slug)) {
		slug = `${base}-${n++}`;
	}

	const id = crypto.randomUUID();
	await db.run(
		QueryBuilder.from('_reports').toInsert({
			id,
			name: body.name,
			slug,
			collection: body.collection,
			type: body.type,
			config_json: JSON.stringify(body.config),
			roles: body.roles ? JSON.stringify(body.roles) : null,
			created_by: auth.user_id,
		}),
	);
	return success(c, { id, slug, name: body.name, collection: body.collection, type: body.type, created_by: auth.user_id });
});

app.get('/:id', async (c) => {
	const db = new D1Client(c.env.DB);
	const report = await db.first<{
		id: string;
		name: string;
		slug: string;
		collection: string;
		type: string;
		config_json: string;
		roles: string | null;
		created_by: string | null;
		created_at: string;
		updated_at: string;
	}>(QueryBuilder.from('_reports').select('*').where('id', c.req.param('id')).toSelect());
	if (!report) return fail(c, 'Report not found', 404);
	if (!(await canViewReport(c, report))) return fail(c, 'You do not have access to this report', 403);

	let config: unknown = {};
	try {
		config = JSON.parse(report.config_json);
	} catch {
		config = {};
	}
	return success(c, {
		id: report.id,
		name: report.name,
		slug: report.slug,
		collection: report.collection,
		type: report.type,
		config,
		created_by: report.created_by,
		created_at: report.created_at,
		updated_at: report.updated_at,
	});
});

app.put('/:id', async (c) => {
	const auth = authOf(c);
	const db = new D1Client(c.env.DB);
	const report = await db.first<{ id: string; created_by: string | null }>(
		QueryBuilder.from('_reports').select('id', 'created_by').where('id', c.req.param('id')).toSelect(),
	);
	if (!report) return fail(c, 'Report not found', 404);
	if (!auth.is_admin && report.created_by !== auth.user_id) {
		return fail(c, 'Only the owner or an admin can edit this report', 403);
	}

	const body = (await c.req.json()) as { name?: string; type?: 'grouped' | 'pivot'; config?: ReportV2Request; roles?: string[] | null };
	const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
	if (body.name) patch.name = body.name;
	if (body.type) patch.type = body.type;
	if (body.config) patch.config_json = JSON.stringify(body.config);
	if (body.roles !== undefined) patch.roles = body.roles ? JSON.stringify(body.roles) : null;

	await db.run(QueryBuilder.from('_reports').where('id', report.id).toUpdate(patch));
	return success(c, { updated: true, id: report.id });
});

app.delete('/:id', async (c) => {
	const auth = authOf(c);
	const db = new D1Client(c.env.DB);
	const report = await db.first<{ id: string; created_by: string | null }>(
		QueryBuilder.from('_reports').select('id', 'created_by').where('id', c.req.param('id')).toSelect(),
	);
	if (!report) return fail(c, 'Report not found', 404);
	if (!auth.is_admin && report.created_by !== auth.user_id) {
		return fail(c, 'Only the owner or an admin can delete this report', 403);
	}
	await db.run(QueryBuilder.from('_reports').where('id', report.id).toDelete());
	return success(c, { deleted: true, id: report.id });
});

export { app as reportRoutes };
