/**
 * MVE Template Routes — /api/mve
 *
 * MiniApp module templates (list/form/editForm/dashboard configs) served from
 * D1. The MiniApp's BFF worker proxies + caches these; the client merges the
 * template with its local behavior registry (loaders/submit/handlers).
 *
 *   GET    /api/mve/:slug  → template (auth) — ETag = version, 304 revalidation
 *   GET    /api/mve        → slug+version index (auth)
 *   PUT    /api/mve/:slug  → create/replace template (admin) — bumps version
 *   DELETE /api/mve/:slug  → remove template (admin)
 */

import { Hono, type Context } from 'hono';
import { D1Client, MigrationRunner } from '@mmbix/core';
import { MveTemplateService } from '@/lib/services/mve-template.service';
import { requireAuth } from './auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';

type CmsBindings = {
	Bindings: { DB: D1Database };
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
};
const app = new Hono<CmsBindings>();
app.use('*', requireAuth);

// Ensure system tables exist (idempotent — runs pending migrations once)
app.use('*', async (c, next) => {
	await new MigrationRunner(new D1Client(c.env.DB)).runPending();
	await next();
});

function getService(c: Context): MveTemplateService {
	return new MveTemplateService(new D1Client(c.env.DB));
}

// ─── Index (slug + version) ─────────────────────────────

app.get('/', async (c) => {
	try {
		const rows = await getService(c).listTemplates();
		return success(c, rows);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Failed to list templates', 500);
	}
});

// ─── Get Template (conditional freshness via ETag = version) ─────
// `:slug{.+}` — template slugs contain a slash ('store/products'); a plain
// `:slug` param would only match a single path segment.
app.get('/:slug{.+}', async (c) => {
	try {
		const tpl = await getService(c).getTemplate(c.req.param('slug'));
		if (!tpl) return fail(c, 'Template not found', 404);
		// Templates are public-to-authenticated (no per-user data) — short-lived
		// edge cache + version ETag. The miniapp BFF adds its own cache layer.
		c.header('Cache-Control', 'public, max-age=300, s-maxage=300');
		const etag = `"${tpl.version}"`;
		const inm = c.req.header('If-None-Match');
		if (inm && inm.replace(/^W\//, '') === etag) {
			c.header('ETag', etag);
			return c.body(null, 304);
		}
		c.header('ETag', etag);
		return success(c, tpl);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Failed to get template', 500);
	}
});

// ─── Upsert Template (admin) ────────────────────────────

app.put('/:slug{.+}', requireAdmin, async (c) => {
	try {
		const slug = c.req.param('slug');
		if (!slug.trim()) return fail(c, 'slug is required');
		const body = await c.req.json<{
			title?: string;
			accent?: string;
			collection?: string;
			list?: unknown;
			form?: unknown;
			editForm?: unknown;
			dashboard?: unknown;
		}>();
		if (!body.title?.trim()) return fail(c, 'Template title is required');
		if (!body.accent?.trim()) return fail(c, 'Template accent is required');

		const tpl = await getService(c).upsertTemplate(slug, {
			title: body.title,
			accent: body.accent,
			collection: body.collection,
			list: body.list,
			form: body.form,
			editForm: body.editForm,
			dashboard: body.dashboard,
		});
		return success(c, tpl, 200);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Failed to save template', 500);
	}
});

// ─── Delete Template (admin) ────────────────────────────

app.delete('/:slug{.+}', requireAdmin, async (c) => {
	try {
		await getService(c).deleteTemplate(c.req.param('slug'));
		return success(c, { deleted: true });
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Failed to delete template', 500);
	}
});

export const mveRoutes = app;
