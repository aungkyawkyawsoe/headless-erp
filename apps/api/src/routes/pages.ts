/**
 * Pages Routes — /api/pages
 *
 * CRUD for persisted pages (block configurations).
 * GET    /api/pages?module=:slug          — list pages for a module
 * GET    /api/pages/:slug?path=/route     — get page by module slug + path
 * POST   /api/pages                       — create / upsert page
 * PUT    /api/pages/:id                   — update page
 * DELETE /api/pages/:id                   — delete page
 */
import { Hono, type Context } from 'hono';
import { D1Client, QueryBuilder, MigrationRunner } from '@mmbix/core';
import { PageService, type PageBlocks } from '@/lib/services/page.service';
import { ModuleService } from '@/lib/services/module.service';
import { requireAuth } from './auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';

type Ctx = {
	Bindings: { DB: D1Database; ADMIN_PASSWORD: string };
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
};

const app = new Hono<Ctx>();
app.use('*', requireAuth);

// Ensure system tables exist (idempotent — runs pending migrations once)
app.use('*', async (c, next) => {
	await new MigrationRunner(new D1Client(c.env.DB)).runPending();
	await next();
});

function getService(c: Context): PageService {
	const auth = c.get('auth');
	return new PageService(new D1Client(c.env.DB), auth);
}

/** Bump the owning app's config version after a page mutation. */
async function bumpModule(c: Context, moduleId: string | null): Promise<void> {
	if (!moduleId) return;
	await new ModuleService(new D1Client(c.env.DB)).bumpConfigVersion(moduleId);
}

// GET /api/pages?module=:slug
app.get('/', async (c) => {
	try {
		const moduleSlug = c.req.query('module');
		const svc = getService(c);
		const pages = await svc.list(moduleSlug || undefined);
		return success(c, pages);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Failed to list pages', 500);
	}
});

// GET /api/pages/:slug?path=/
app.get('/:slug', async (c) => {
	try {
		const slug = c.req.param('slug');
		const path = c.req.query('path') || '/';
		const svc = getService(c);
		const page = await svc.getByPath(slug, path);
		if (!page) return fail(c, 'Page not found', 404);
		return success(c, page);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Failed to get page', 500);
	}
});

// GET /api/pages/id/:id — fetch a page by its id (used by the runtime renderer)
app.get('/id/:id', async (c) => {
	try {
		const svc = getService(c);
		const page = await svc.getById(c.req.param('id'));
		if (!page) return fail(c, 'Page not found', 404);
		return success(c, page);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Failed to get page', 500);
	}
});

// POST /api/pages — create/upsert (admin only — global config)
app.post('/', requireAdmin, async (c) => {
	try {
		const body = await c.req.json<{
			module_slug?: string;
			path: string;
			title: string;
			blocks?: PageBlocks[];
			globalFilter?: Record<string, unknown>;
			is_published?: boolean;
		}>();
		if (!body.path?.trim()) return fail(c, 'path is required');
		if (!body.title?.trim()) return fail(c, 'title is required');

		// Resolve module_slug to module_id
		let moduleId: string | null = null;
		if (body.module_slug) {
			const modQ = QueryBuilder.from('_modules').select('id').where('slug', body.module_slug);
			const mods = await new D1Client(c.env.DB).all<{ id: string }>(modQ.toSelect());
			if (mods.length > 0) moduleId = mods[0].id;
		}

		const svc = getService(c);
		const page = await svc.save({
			module_id: moduleId,
			path: body.path,
			title: body.title,
			blocks: body.blocks,
			globalFilter: body.globalFilter,
			is_published: body.is_published,
		});
		await bumpModule(c, page.module_id);
		return success(c, page, 201);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Failed to save page', 500);
	}
});

// PUT /api/pages/:id (admin only)
app.put('/:id', requireAdmin, async (c) => {
	try {
		const id = c.req.param('id');
		const body = await c.req.json<{
			title?: string;
			blocks?: PageBlocks[];
			globalFilter?: Record<string, unknown>;
			is_published?: boolean;
		}>();

		const svc = getService(c);
		// Get existing page
		const existing = await svc.getById(id);
		if (!existing) return fail(c, 'Page not found', 404);

		const page = await svc.save({
			module_id: existing.module_id,
			path: existing.path,
			title: body.title ?? existing.title,
			blocks: body.blocks ?? existing.blocks,
			globalFilter: body.globalFilter ?? existing.globalFilter,
			is_published: body.is_published ?? existing.isPublished,
		});
		await bumpModule(c, page.module_id);
		return success(c, page);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Failed to update page', 500);
	}
});

// DELETE /api/pages/:id (admin only)
app.delete('/:id', requireAdmin, async (c) => {
	try {
		const id = c.req.param('id');
		const svc = getService(c);
		const existing = await svc.getById(id);
		await svc.delete(id);
		await bumpModule(c, existing?.module_id ?? null);
		return success(c, { deleted: true });
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Failed to delete page', 500);
	}
});

// GET /api/pages/id/:id/versions — version history (newest first)
app.get('/id/:id/versions', async (c) => {
	try {
		const svc = getService(c);
		const existing = await svc.getById(c.req.param('id'));
		if (!existing) return fail(c, 'Page not found', 404);
		const versions = await svc.versions(existing.id);
		return success(c, versions);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Failed to list versions', 500);
	}
});

// POST /api/pages/id/:id/restore — restore a version (admin only — mutates global config)
app.post('/id/:id/restore', requireAdmin, async (c) => {
	try {
		const svc = getService(c);
		const existing = await svc.getById(c.req.param('id'));
		if (!existing) return fail(c, 'Page not found', 404);
		const body = (await c.req.json().catch(() => null)) as { versionId?: string } | null;
		if (!body?.versionId) return fail(c, 'versionId is required', 400);
		const restored = await svc.restore(existing.id, body.versionId);
		if (!restored) return fail(c, 'Version not found', 404);
		await bumpModule(c, restored.module_id);
		return success(c, restored);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Failed to restore page', 500);
	}
});

export { app as pageRoutes, PageService };
