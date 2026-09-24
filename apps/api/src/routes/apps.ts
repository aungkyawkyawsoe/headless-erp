/**
 * Apps Routes — /api/apps
 *
 * Aggregate endpoints for the frontend shell (Studio writes config, frontend
 * renders it). One round trip instead of 1 + M separate fetches:
 *   GET /api/apps       → dock list (active modules with config_version)
 *   GET /api/apps/:slug → app manifest (module + collections + menus + pages)
 *
 * Freshness: clients cache by `config_version` and re-fetch when it changes
 * (or send If-None-Match) — no TTL guessing.
 */
import { Hono, type Context } from 'hono';
import { D1Client, MigrationRunner } from '@mmbix/core';
import { ModuleService } from '@/lib/services/module.service';
import { requireAuth } from './auth';
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

function getService(c: Context): ModuleService {
	const auth = c.get('auth');
	return new ModuleService(new D1Client(c.env.DB), auth);
}

// Dock list — active modules with config_version.
app.get('/', async (c) => {
	try {
		const modules = await getService(c).getModules(false);
		return success(c, modules);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Failed to list apps', 500);
	}
});

// App manifest — everything the shell needs for one module in one payload.
// Conditional freshness: ETag = "<config_version>". A matching If-None-Match
// returns 304 (no body) so the frontend can revalidate cheaply on focus.
app.get('/:slug', async (c) => {
	try {
		const manifest = await getService(c).getAppManifest(c.req.param('slug'));
		if (!manifest) return fail(c, 'App not found', 404);
		const etag = `"${manifest.config_version}"`;
		const inm = c.req.header('If-None-Match');
		if (inm && inm.replace(/^W\//, '') === etag) {
			return c.body(null, 304);
		}
		c.header('ETag', etag);
		return success(c, manifest);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Failed to get app', 500);
	}
});

export { app as appRoutes };
