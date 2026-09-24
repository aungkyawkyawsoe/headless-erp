/**
 * Module Routes
 *
 * GET    /api/modules                              → List modules
 * GET    /api/modules/:slug                        → Get module + collections
 * POST   /api/modules                              → Create module (admin)
 * PUT    /api/modules/:slug                        → Update module (admin)
 * DELETE /api/modules/:slug                        → Delete module (admin)
 * GET    /api/modules/:slug/collections             → Get module collections
 * POST   /api/modules/:slug/collections             → Attach collection (admin)
 * DELETE /api/modules/:slug/collections/:collSlug   → Detach collection (admin)
 */

import { Hono, type Context } from 'hono';
import { D1Client, MigrationRunner, QueryBuilder } from '@mmbix/core';
import { ModuleService } from '@/lib/services/module.service';
import { ModuleMenuService } from '@/lib/services/module-menu.service';
import { ModuleViewService } from '@/lib/services/module-view.service';
import { requireAuth } from './auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';
import { idempotencyMiddleware } from '@/plugins/idempotency/plugin';

type CmsBindings = {
	Bindings: { DB: D1Database };
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
};
const app = new Hono<CmsBindings>();
// Stripe-style Idempotency-Key support on menu writes (keyed replays get the
// cached 2xx response — same contract as /api/entities/*).
app.use('/:slug/menus', idempotencyMiddleware());
app.use('*', requireAuth);

// Ensure system tables exist (idempotent — runs pending migrations once)
app.use('*', async (c, next) => {
	await new MigrationRunner(new D1Client(c.env.DB)).runPending();
	await next();
});

function getService(c: Context): ModuleService {
	const auth = c.get('auth');
	return new ModuleService(new D1Client(c.env.DB), auth);
}

function getMenuService(c: Context): ModuleMenuService {
	const auth = c.get('auth');
	return new ModuleMenuService(new D1Client(c.env.DB), auth);
}

function getViewService(c: Context): ModuleViewService {
	const auth = c.get('auth');
	return new ModuleViewService(new D1Client(c.env.DB), auth);
}

// ─── List Modules ──────────────────────────────────────

app.get('/', async (c) => {
	try {
		const all = c.req.query('all') === 'true';
		const svc = getService(c);
		const modules = await svc.getModules(all);
		return success(c, modules);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Failed to list modules', 500);
	}
});

// ─── Get Module Detail ─────────────────────────────────

app.get('/:slug', async (c) => {
	try {
		const svc = getService(c);
		const module = await svc.getModule(c.req.param('slug'));
		if (!module) return fail(c, 'Module not found', 404);
		return success(c, module);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Failed to get module', 500);
	}
});

// ─── Create Module ─────────────────────────────────────

app.post('/', requireAdmin, async (c) => {
	let body:
		| { name: string; slug: string; icon?: string; icon_color?: string; bg_color?: string; description?: string; version?: string }
		| undefined;
	try {
		body = await c.req.json<{
			name: string;
			slug: string;
			icon?: string;
			icon_color?: string;
			bg_color?: string;
			description?: string;
			version?: string;
		}>();

		if (!body.name?.trim()) return fail(c, 'Module name is required');
		if (!body.slug?.trim()) return fail(c, 'Module slug is required');

		const svc = getService(c);
		const module = await svc.createModule(body);
		return success(c, module, 201);
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to create module';
		const isDuplicate = msg.includes('UNIQUE') || msg.includes('SQLITE_CONSTRAINT');
		const status = msg.includes('already exists') || isDuplicate ? 409 : 500;
		const displayMsg = isDuplicate ? `Slug "${body?.slug || ''}" already taken. Choose a different name.` : msg;
		return fail(c, displayMsg, status);
	}
});

// ─── Update Module ─────────────────────────────────────

app.put('/:slug', requireAdmin, async (c) => {
	try {
		const body = await c.req.json<{
			name?: string;
			icon?: string;
			icon_color?: string;
			bg_color?: string;
			description?: string;
			version?: string;
			is_active?: boolean;
			sort_order?: number;
		}>();

		const svc = getService(c);
		const module = await svc.updateModule(c.req.param('slug'), body);
		// Meta changes (name/icon/colors) must refresh the frontend too.
		if (module.id) await svc.bumpConfigVersion(module.id);
		return success(c, module);
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to update module';
		const status = msg.includes('not found') ? 404 : 500;
		return fail(c, msg, status);
	}
});

// ─── Delete Module ─────────────────────────────────────

app.delete('/:slug', requireAdmin, async (c) => {
	try {
		const svc = getService(c);
		await svc.deleteModule(c.req.param('slug'));
		return success(c, { deleted: true });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to delete module';
		const status = msg.includes('not found') ? 404 : 500;
		return fail(c, msg, status);
	}
});

// ─── Module Collections ────────────────────────────────

app.get('/:slug/collections', async (c) => {
	try {
		const svc = getService(c);
		const collections = await svc.getModuleCollections(c.req.param('slug'));
		return success(c, collections);
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to get collections';
		const status = msg.includes('not found') ? 404 : 500;
		return fail(c, msg, status);
	}
});

app.post('/:slug/collections', requireAdmin, async (c) => {
	try {
		const body = await c.req.json<{ collection_slug: string }>();
		if (!body.collection_slug?.trim()) return fail(c, 'collection_slug is required');

		const svc = getService(c);
		await svc.attachCollection(c.req.param('slug'), body.collection_slug);
		return success(c, { attached: true }, 201);
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to attach collection';
		const status = msg.includes('not found') ? 404 : 500;
		return fail(c, msg, status);
	}
});

app.delete('/:slug/collections/:collSlug', requireAdmin, async (c) => {
	try {
		const svc = getService(c);
		await svc.detachCollection(c.req.param('slug'), c.req.param('collSlug'));
		return success(c, { detached: true });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to detach collection';
		const status = msg.includes('not found') ? 404 : 500;
		return fail(c, msg, status);
	}
});

// ─── Module Menus ────────────────────────────────────────

app.get('/:slug/menus', async (c) => {
	try {
		const all = c.req.query('all') === 'true';
		const svc = getMenuService(c);
		const tree = await svc.getMenuTree(c.req.param('slug'), all);
		return success(c, tree);
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to get menus';
		const status = msg.includes('not found') ? 404 : 500;
		return fail(c, msg, status);
	}
});

app.post('/:slug/menus', requireAdmin, async (c) => {
	try {
		const body = await c.req.json<{
			parent_id?: string;
			label: string;
			label_my?: string;
			icon?: string;
			type: string;
			target?: string;
			sort_order?: number;
			roles?: string[];
			template?: string | null;
		}>();
		if (!body.label?.trim()) return fail(c, 'Menu label is required');

		const svc = getMenuService(c);
		const item = await svc.createMenuItem({
			module_slug: c.req.param('slug'),
			...body,
		});
		// Bump the app's config version so the frontend refreshes its manifest.
		await getService(c).bumpConfigVersion(item.module_id);
		return success(c, item, 201);
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to create menu item';
		return fail(c, msg, 500);
	}
});

app.put('/menus/:id', requireAdmin, async (c) => {
	try {
		const body = await c.req.json<{
			label?: string;
			label_my?: string;
			icon?: string;
			type?: string;
			target?: string;
			parent_id?: string | null;
			sort_order?: number;
			is_active?: boolean;
			roles?: string[] | null;
			template?: string | null;
		}>();

		const svc = getMenuService(c);
		const item = await svc.updateMenuItem(c.req.param('id'), body);
		if (item.module_id) await getService(c).bumpConfigVersion(item.module_id);
		return success(c, item);
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to update menu item';
		return fail(c, msg, 500);
	}
});

app.delete('/menus/:id', requireAdmin, async (c) => {
	try {
		const svc = getMenuService(c);
		// Resolve the owning module first so we can bump its config version.
		const row = await new D1Client(c.env.DB).first<{ module_id: string }>(
			QueryBuilder.from('_module_menus').select('module_id').where('id', c.req.param('id')).toSelect(),
		);
		await svc.deleteMenuItem(c.req.param('id'));
		if (row) await getService(c).bumpConfigVersion(row.module_id);
		return success(c, { deleted: true });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to delete menu item';
		return fail(c, msg, 500);
	}
});

// ─── Module Views ───────────────────────────────────────

app.get('/:slug/views', async (c) => {
	try {
		const svc = getViewService(c);
		const collSlug = c.req.query('collection');
		const views = await svc.getViews(c.req.param('slug'), collSlug || undefined);
		return success(c, views);
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to list views';
		return fail(c, msg, 500);
	}
});

app.post('/:slug/views', requireAdmin, async (c) => {
	try {
		const body = await c.req.json<{
			collection_slug: string;
			name: string;
			type?: string;
			config?: Record<string, unknown>;
		}>();
		if (!body.name?.trim()) return fail(c, 'View name is required');
		// Form layout views don't need a collection
		if (body.type !== 'form' && !body.collection_slug?.trim()) return fail(c, 'collection_slug is required');

		const svc = getViewService(c);
		const view = await svc.createView({
			module_slug: c.req.param('slug'),
			collection_slug: body.collection_slug,
			name: body.name,
			type: body.type,
			config: body.config as import('@/lib/services/module-view.service').ViewConfig | undefined,
		});
		await getService(c).bumpConfigVersion(view.module_id);
		return success(c, view, 201);
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to create view';
		return fail(c, msg, 500);
	}
});

app.put('/views/:id', requireAdmin, async (c) => {
	try {
		const body = await c.req.json<{
			name?: string;
			type?: string;
			config?: Record<string, unknown>;
		}>();

		const svc = getViewService(c);
		const view = await svc.updateView(c.req.param('id'), {
			name: body.name,
			type: body.type,
			config: body.config as import('@/lib/services/module-view.service').ViewConfig | undefined,
		});
		if (view.module_id) await getService(c).bumpConfigVersion(view.module_id);
		return success(c, view);
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to update view';
		return fail(c, msg, 500);
	}
});

app.delete('/views/:id', requireAdmin, async (c) => {
	try {
		const svc = getViewService(c);
		// Resolve the owning module first so we can bump its config version.
		const row = await new D1Client(c.env.DB).first<{ module_id: string }>(
			QueryBuilder.from('_module_views').select('module_id').where('id', c.req.param('id')).toSelect(),
		);
		await svc.deleteView(c.req.param('id'));
		if (row) await getService(c).bumpConfigVersion(row.module_id);
		return success(c, { deleted: true });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to delete view';
		return fail(c, msg, 500);
	}
});

export const moduleRoutes = app;
