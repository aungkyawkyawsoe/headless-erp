/**
 * Add-on Routes — /api/addons
 *
 * The runtime install/remove surface for the factory's add-ons (modules). The
 * catalog is the compiled `ModuleManifest`s + the build allowlist
 * (`DOMAIN_MODULES`) + the `_addons` install state, resolved into a graph with
 * dependency/capability issues.
 *
 *   GET  /api/addons                → catalog + install state + issues (auth)
 *   POST /api/addons/:id/install    → install (admin) — validates deps/capabilities
 *   POST /api/addons/:id/uninstall  → uninstall (admin) — refused if depended on
 */
import { Hono, type Context } from 'hono';
import { D1Client, MigrationRunner } from '@mmbix/core';
import { requireAuth } from './auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';
import { AddonService } from '@/lib/services/addon.service';
import { moduleManifests } from '@/domain-modules';
import type { AuthContext } from '@/lib/services/auth.service';

type AddonBindings = {
	Bindings: { DB: D1Database; [key: string]: unknown };
	Variables: { auth: AuthContext };
};

const app = new Hono<AddonBindings>();
app.use('*', requireAuth);
app.use('*', async (c: Context<AddonBindings>, next) => {
	await new MigrationRunner(new D1Client(c.env.DB)).runPending();
	await next();
});

const envOf = (c: { env: unknown }) => (c.env ?? {}) as Record<string, unknown>;

app.get('/', async (c) => {
	const svc = new AddonService(new D1Client(c.env.DB));
	const { catalog, issues } = await svc.catalog(envOf(c), moduleManifests);
	return success(c, { addons: catalog, issues });
});

app.post('/:id/install', requireAdmin, async (c) => {
	const id = c.req.param('id');
	try {
		await new AddonService(new D1Client(c.env.DB)).install(envOf(c), moduleManifests, id);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Install failed', 400, 'VALIDATION_ERROR');
	}
	const { catalog, issues } = await new AddonService(new D1Client(c.env.DB)).catalog(envOf(c), moduleManifests);
	return success(c, { id, installed: true, addons: catalog, issues });
});

app.post('/:id/uninstall', requireAdmin, async (c) => {
	const id = c.req.param('id');
	try {
		await new AddonService(new D1Client(c.env.DB)).uninstall(envOf(c), moduleManifests, id);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Uninstall failed', 400, 'VALIDATION_ERROR');
	}
	const { catalog, issues } = await new AddonService(new D1Client(c.env.DB)).catalog(envOf(c), moduleManifests);
	return success(c, { id, installed: false, addons: catalog, issues });
});

export { app as addonRoutes };
