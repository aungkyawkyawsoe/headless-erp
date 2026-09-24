/**
 * Search Routes — with RBAC
 *
 * Global multi-entity search (the single search implementation):
 *   GET  /api/search/global?q=keyword                        → Global search (auth)
 *   GET  /api/search/global?q=keyword&collections=a,b&limit=20 → Filtered + paginated
 *   POST /api/search/global-index                            → Rebuild unified index (admin)
 *
 * The legacy v1 endpoints (`GET /api/search`, `POST /api/search/build`) were
 * removed — v2's unified index replaces the per-collection FTS5 tables.
 */

import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { SearchService } from '@/lib/services/search.service';
import { clampPageSize, DEFAULT_PAGE_SIZE } from '@/lib/api/page-size';
import { PermissionEvaluator } from '@/lib/services/permission-evaluator';
import { requireAuth } from './auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';

const app = new Hono<{
	Bindings: { DB: D1Database; ADMIN_PASSWORD: string };
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
}>();
app.use('*', requireAuth);

function getSearch(c: Context): SearchService {
	return new SearchService(new D1Client(c.env.DB), c.get('auth'));
}

/**
 * Filter search results to collections the user has read permission on.
 * For admins, returns results unchanged. For non-admins, batch-checks all
 * unique collection slugs and filters in-memory.
 */
async function filterByReadPermission<T extends { collection: string }>(
	db: D1Client,
	auth: import('@/lib/services/auth.service').AuthContext,
	results: T[],
): Promise<T[]> {
	if (auth.is_admin || results.length === 0) return results;

	const uniqueCollections = [...new Set(results.map((r) => r.collection))];
	const allowedCollections = new Set<string>();
	for (const slug of uniqueCollections) {
		if (slug && (await PermissionEvaluator.checkBusiness(db, auth, slug, 'read'))) {
			allowedCollections.add(slug);
		}
	}
	return results.filter((r) => allowedCollections.has(r.collection));
}

// ── Global Multi-Entity Search ───────────────────────

/**
 * GET /api/search/global
 *
 * Query params:
 *   q            — Search term (required)
 *   collections  — Comma-separated collection slugs (optional, searches all)
 *   limit        — Max results (default 25, max 100)
 *   cursor       — Keyset cursor from a previous page's meta.next_cursor (optional)
 */
app.get('/global', async (c) => {
	const svc = getSearch(c);
	const q = c.req.query('q');
	if (!q) return fail(c, 'Query parameter "q" is required', 400);

	const cols = c.req
		.query('collections')
		?.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	// Page-size policy (enterprise): default 25, max 100 (page-size.ts).
	const limit = clampPageSize(parseInt(c.req.query('limit') ?? String(DEFAULT_PAGE_SIZE), 10));

	const { data, meta } = await svc.searchGlobal({
		query: q,
		collections: cols,
		limit,
		cursor: c.req.query('cursor') ?? undefined,
	});

	// Apply RBAC: filter results to collections user has read permission on
	const auth = c.get('auth');
	const db = new D1Client(c.env.DB);
	const filtered = await filterByReadPermission(db, auth, data);
	return success(c, filtered, 200, { ...meta, query: q, filtered_total: filtered.length });
});

/**
 * POST /api/search/global-index
 *
 * Rebuild the unified FTS5 search index across all collections.
 * Admin only.
 */
app.post('/global-index', requireAdmin, async (c) => {
	const svc = getSearch(c);
	const total = await svc.buildGlobalIndex();
	return success(c, { indexed_count: total, message: 'Global search index rebuilt' });
});

export { app as searchRoutes };
