/**
 * Audit Routes — v2 with diff viewing
 *
 * GET /api/audit/:collection/:id          → Get full history with snapshots
 * GET /api/audit/:collection/:id/diff     → Get structured diff between two versions
 *                                           Query params: from=<entryId>, to=<entryId>
 */

import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { AuditService } from '@/lib/services/audit.service';
import { requireAuth } from './auth';
import { businessGuard } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';

type AuditBindings = {
	Bindings: { DB: D1Database };
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
};

const app = new Hono<AuditBindings>();
app.use('*', requireAuth);

function getAudit(c: Context): AuditService {
	return new AuditService(new D1Client(c.env.DB));
}

/**
 * GET /api/audit/:collection/:id
 *
 * Returns the full audit history for a document, with parsed snapshot data
 * in each entry so clients can reconstruct the document state at any point.
 */
app.get('/:collection/:id', businessGuard('collection', 'read'), async (c) => {
	const { collection, id } = c.req.param();
	const audit = getAudit(c);
	const history = await audit.getHistory(collection, id);
	// Row-level scope: non-admins only see audit entries they authored — a
	// filtered user must not learn about (or diff) other users' documents.
	const auth = c.get('auth');
	const scoped = auth.is_admin ? history : history.filter((e) => e.user_id === auth.user_id);
	return success(c, scoped);
});

/**
 * GET /api/audit/:collection/:id/diff
 *
 * Returns a structured diff between two audit entries.
 * Query parameters:
 *   from — audit entry ID (the "before" state)
 *   to   — audit entry ID (the "after" state)
 *
 * Response:
 *   {
 *     "from":    { "field": "old_value", ... },
 *     "to":      { "field": "new_value", ... },
 *     "changes": [
 *       { "field": "title", "from": "Old", "to": "New" },
 *       { "field": "status", "from": "draft", "to": "submitted" }
 *     ]
 *   }
 */
app.get('/:collection/:id/diff', businessGuard('collection', 'read'), async (c) => {
	const { collection, id } = c.req.param();
	const fromEntryId = c.req.query('from');
	const toEntryId = c.req.query('to');

	if (!fromEntryId || !toEntryId) {
		return fail(c, 'Both "from" and "to" query parameters are required', 400);
	}

	const audit = getAudit(c);
	try {
		const diff = await audit.getDiff(collection, id, fromEntryId, toEntryId);
		// Row-level scope: non-admins cannot diff entries they did not author.
		const auth = c.get('auth');
		if (!auth.is_admin) {
			const [fromEntry, toEntry] = await Promise.all([
				audit.getHistory(collection, id).then((h) => h.find((e) => e.id === fromEntryId)),
				audit.getHistory(collection, id).then((h) => h.find((e) => e.id === toEntryId)),
			]);
			if (fromEntry?.user_id !== auth.user_id || toEntry?.user_id !== auth.user_id) {
				return fail(c, 'Audit entries not found', 404);
			}
		}
		return success(c, diff);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return fail(c, message, 400);
	}
});

export { app as auditRoutes };
