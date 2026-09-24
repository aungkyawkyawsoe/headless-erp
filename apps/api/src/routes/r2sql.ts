/**
 * R2 SQL Routes — read-only analytics over R2 Data Catalog (Iceberg).
 *
 *   GET  /api/r2sql/namespaces              (admin) → list namespaces
 *   GET  /api/r2sql/describe/:namespace/:table (admin) → column schema
 *   POST /api/r2sql/query                   (admin) → safe aggregate query
 *
 * SECURITY: R2 SQL is a read-only engine, but we still NEVER forward raw user
 * SQL. The query route only accepts a whitelisted shape (table + optional
 * where/filter fields + aggregates + limit) and builds the SQL server-side with
 * validated identifiers. This is the zero-waste, injection-safe consumption
 * surface. Gated by the R2_SQL_TOKEN secret + ENABLE_R2_LAKE flag.
 */

import { Hono, type Context } from 'hono';
import { requireAuth } from './auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';
import { R2SqlClient } from '@/services/r2sql.service';

type Env = {
	Bindings: {
		DB: D1Database;
		ADMIN_PASSWORD: string;
		R2_SQL_TOKEN?: string;
		R2_ACCOUNT_ID?: string;
		R2_BUCKET?: string;
		ENABLE_R2_LAKE?: string;
	};
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
};

const app = new Hono<Env>();
app.use('*', requireAuth);

/** Test seam — lets tests inject a mock fetch without touching global fetch. */
let fetchImpl: typeof fetch = globalThis.fetch;
export function __setFetchOverride(fn: typeof fetch | undefined): void {
	fetchImpl = fn ?? globalThis.fetch;
}

/** Whether the R2 lake integration is switched on for this deployment. */
function lakeEnabled(c: Context<Env>): boolean {
	return c.env.ENABLE_R2_LAKE === 'true' && !!c.env.R2_SQL_TOKEN;
}

function getClient(c: Context<Env>): R2SqlClient {
	const token = c.env.R2_SQL_TOKEN;
	const accountId = c.env.R2_ACCOUNT_ID;
	const bucketName = c.env.R2_BUCKET;
	if (!token || !accountId || !bucketName) {
		// Config bug, not a user error — the lake is enabled but the deployment is
		// missing the env wiring. Account/bucket come from vars (infra/env.*), the
		// token from `wrangler secret put R2_SQL_TOKEN`. No hardcoded fallbacks:
		// silently pinning a stray account/bucket is exactly how a test run ends up
		// reading production data.
		throw new Error('R2 lake is not configured: R2_SQL_TOKEN / R2_ACCOUNT_ID / R2_BUCKET must all be set');
	}
	return new R2SqlClient({ accountId, bucketName, token, fetchFn: fetchImpl });
}

// ─── List namespaces ──────────────────────────────────
app.get('/namespaces', requireAdmin, async (c) => {
	if (!lakeEnabled(c)) return fail(c, 'R2 lake (R2 SQL) is not enabled for this deployment', 404, 'RESOURCE_NOT_ENABLED');
	try {
		const rows = await getClient(c).listNamespaces();
		return success(c, { namespaces: rows });
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'R2 SQL query failed', 502);
	}
});

// ─── Describe a table ─────────────────────────────────
app.get('/describe/:namespace/:table', requireAdmin, async (c) => {
	if (!lakeEnabled(c)) return fail(c, 'R2 lake (R2 SQL) is not enabled for this deployment', 404, 'RESOURCE_NOT_ENABLED');
	const ns = sanitizeIdent(c.req.param('namespace'));
	const table = sanitizeIdent(c.req.param('table'));
	if (!ns || !table) return fail(c, 'Invalid table reference', 400);
	try {
		const result = await getClient(c).describeTable(`${ns}.${table}`);
		return success(c, { table: `${ns}.${table}`, columns: result.rows });
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'R2 SQL describe failed', 502);
	}
});

// ─── Safe aggregate/report query ──────────────────────
// Body: { table: "ns.table", fields?: string[], where?: {field,op,value}[],
//         groupBy?: string[], orderBy?: {field,dir}, limit? }
app.post('/query', requireAdmin, async (c) => {
	if (!lakeEnabled(c)) return fail(c, 'R2 lake (R2 SQL) is not enabled for this deployment', 404, 'RESOURCE_NOT_ENABLED');
	const body = await c.req.json().catch(() => null);
	if (!body || typeof body !== 'object') return fail(c, 'Invalid JSON body', 400);
	const b = body as Record<string, unknown>;

	const table = typeof b.table === 'string' ? sanitizeFullTable(b.table) : '';
	if (!table) return fail(c, 'table is required (e.g. "default.sales")', 400);

	const fields = (Array.isArray(b.fields) ? (b.fields as unknown[]).map(String) : ['*']).map(sanitizeIdent).filter(Boolean);
	const where = buildWhere(b.where);
	const groupBy = (Array.isArray(b.groupBy) ? (b.groupBy as unknown[]).map(String) : []).map(sanitizeIdent).filter(Boolean);
	let limit = Number.isFinite(Number(b.limit)) ? Math.max(1, Number(b.limit)) : 100;
	limit = Math.min(limit, 10000); // R2 SQL caps LIMIT at 10k

	try {
		// SELECT list: groupBy columns first, then any explicit aggregate fields.
		const selectParts = groupBy.length > 0 ? [...groupBy, ...fields.filter((f) => f !== '*')] : fields;
		const select = selectParts.length > 0 ? [...new Set(selectParts)].join(', ') : '*';
		const sql = `SELECT ${select} FROM ${table}${where ? ` WHERE ${where}` : ''}${groupBy.length ? ` GROUP BY ${groupBy.join(', ')}` : ''} LIMIT ${limit}`;
		const result = await getClient(c).query(sql);
		return success(c, result);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'R2 SQL query failed', 502);
	}
});

// ─── Helpers (identifier safety) ──────────────────────

/** Allow only `[A-Za-z_][A-Za-z0-9_]*` identifiers. */
function sanitizeIdent(s: string): string {
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : '';
}

/** Allow `namespace.table` (each part a bare identifier). */
function sanitizeFullTable(s: string): string {
	const parts = s.trim().split('.');
	if (parts.length !== 2) return '';
	const [ns, table] = parts;
	return sanitizeIdent(ns) && sanitizeIdent(table) ? `${ns}.${table}` : '';
}

/** Build a `WHERE` clause from a validated filter list. */
function buildWhere(raw: unknown): string {
	if (!Array.isArray(raw)) return '';
	const clauses: string[] = [];
	for (const item of raw as unknown[]) {
		if (!item || typeof item !== 'object') continue;
		const f = item as Record<string, unknown>;
		const field = typeof f.field === 'string' ? sanitizeIdent(f.field) : '';
		if (!field) continue;
		const op = String(f.op ?? 'eq');
		const value = String(f.value ?? '');
		const sqlOp = OP_MAP[op as keyof typeof OP_MAP];
		if (!sqlOp) continue;
		switch (op) {
			case '_null':
				clauses.push(`${field} IS NULL`);
				break;
			case '_nnull':
				clauses.push(`${field} IS NOT NULL`);
				break;
			case '_contains':
			case '_icontains':
				clauses.push(`${field} LIKE '%${escapeLike(value)}%'`);
				break;
			default:
				clauses.push(`${field} ${sqlOp} '${escapeQuote(value)}'`);
		}
	}
	return clauses.join(' AND ');
}

const OP_MAP = {
	eq: '=',
	neq: '!=',
	gt: '>',
	gte: '>=',
	lt: '<',
	lte: '<=',
} as const;

function escapeQuote(s: string): string {
	return s.replace(/'/g, "''");
}

function escapeLike(s: string): string {
	return s.replace(/[%_\\]/g, (m) => `\\${m}`);
}

export { app as r2sqlRoutes };
