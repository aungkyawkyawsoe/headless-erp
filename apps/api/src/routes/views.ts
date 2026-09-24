/**
 * Saved Views Routes — /api/views
 *
 * CRUD for user-saved collection views (filter/sort/column presets).
 * Authenticated users only.
 */
import { Hono } from 'hono';
import { D1Client } from '@mmbix/core';
import { SavedViewService } from '@/lib/services/saved-view.service';
import { requireAuth } from './auth';
import { success, fail } from '@/lib/api/response';

const views = new Hono<{
	Bindings: { DB: D1Database };
	Variables: { auth: { user_id: string; is_admin: boolean; role_id: string; email: string } };
}>();

// Table creation is idempotent — run per request (D1 sessions may be short-lived)
async function ensureViewTable(db: D1Client): Promise<void> {
	await SavedViewService.ensureTable(db);
}

// Auth required for all routes
views.use('*', requireAuth);

// GET /api/views/detail/:id — get a single view
// Registered BEFORE /:collection so the literal path `/api/views/detail` is
// never captured as a collection lookup.
views.get('/detail/:id', async (c) => {
	const db = new D1Client(c.env.DB);
	await ensureViewTable(db);
	const svc = new SavedViewService(db);
	const auth = c.get('auth');
	const viewId = c.req.param('id');

	// Ownership enforced: only the owner (or an admin) may read a view. Others
	// get 404 (not 403) to avoid leaking that the view exists.
	const view = await svc.getById(viewId);
	if (!view || (view.user_id !== auth.user_id && !auth.is_admin)) {
		return fail(c, 'View not found', 404, 'NOT_FOUND');
	}
	return success(c, view);
});

// GET /api/views/:collection — list views for a collection
views.get('/:collection', async (c) => {
	const db = new D1Client(c.env.DB);
	await ensureViewTable(db);
	const svc = new SavedViewService(db);
	const auth = c.get('auth');
	const collectionSlug = c.req.param('collection');

	const result = await svc.listForCollection(collectionSlug, auth.user_id);
	return success(c, result);
});

// POST /api/views — create a new view
views.post('/', async (c) => {
	const db = new D1Client(c.env.DB);
	await ensureViewTable(db);
	const svc = new SavedViewService(db);
	const auth = c.get('auth');
	const body = await c.req.json<{
		collection_slug: string;
		name: string;
		config: {
			filter?: Array<{ field: string; op: string; value: unknown }>;
			sort?: string;
			columns?: string[];
			pageSize?: number;
			isDefault?: boolean;
		};
		visibility?: string;
	}>();

	if (!body.collection_slug || !body.name || !body.config) {
		return fail(c, 'collection_slug, name, and config are required', 400, 'VALIDATION_ERROR');
	}

	const view = await svc.create({
		collection_slug: body.collection_slug,
		name: body.name,
		user_id: auth.user_id,
		config: body.config,
		visibility: body.visibility,
	});

	return success(c, view, 201);
});

// PUT /api/views/:id — update a view
views.put('/:id', async (c) => {
	const db = new D1Client(c.env.DB);
	await ensureViewTable(db);
	const svc = new SavedViewService(db);
	const auth = c.get('auth');
	const viewId = c.req.param('id');
	const body = await c.req.json<{
		name?: string;
		config?: {
			filter?: Array<{ field: string; op: string; value: unknown }>;
			sort?: string;
			columns?: string[];
			pageSize?: number;
			isDefault?: boolean;
		};
		visibility?: string;
	}>();

	const view = await svc.update(viewId, auth.user_id, body);
	if (!view) {
		return fail(c, 'View not found or access denied', 404, 'NOT_FOUND');
	}
	return success(c, view);
});

// DELETE /api/views/:id — delete a view
views.delete('/:id', async (c) => {
	const db = new D1Client(c.env.DB);
	await ensureViewTable(db);
	const svc = new SavedViewService(db);
	const auth = c.get('auth');
	const viewId = c.req.param('id');

	const deleted = await svc.delete(viewId, auth.user_id);
	if (!deleted) {
		return fail(c, 'View not found or access denied', 404, 'NOT_FOUND');
	}
	return success(c, { deleted: true });
});

export { views as savedViewRoutes, SavedViewService };
