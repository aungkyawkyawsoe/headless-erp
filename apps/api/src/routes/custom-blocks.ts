/**
 * Custom Blocks Routes — /api/custom-blocks
 *
 * Extension API for runtime-registered block types.
 *   GET    /api/custom-blocks          — list custom block types
 *   POST   /api/custom-blocks          — create / upsert (by type)
 *   PUT    /api/custom-blocks/:id      — update
 *   DELETE /api/custom-blocks/:id      — delete
 */
import { Hono, type Context } from 'hono';
import { D1Client, MigrationRunner } from '@mmbix/core';
import { CustomBlockService } from '@/lib/services/custom-block.service';
import { requireAuth } from './auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';

type Ctx = {
	Bindings: { DB: D1Database; ADMIN_PASSWORD: string };
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
};

const app = new Hono<Ctx>();
app.use('*', requireAuth);

app.use('*', async (c, next) => {
	await new MigrationRunner(new D1Client(c.env.DB)).runPending();
	await next();
});

function getService(c: Context): CustomBlockService {
	return new CustomBlockService(new D1Client(c.env.DB), c.get('auth'));
}

// GET /api/custom-blocks
app.get('/', async (c) => {
	try {
		return success(c, await getService(c).list());
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'List failed', 500);
	}
});

// POST /api/custom-blocks (admin only — global extension config)
app.post('/', requireAdmin, async (c) => {
	try {
		const body = await c.req.json<{
			type: string;
			label: string;
			group?: string;
			resolve: string;
			icon?: string | null;
			props_schema?: Record<string, unknown> | null;
			defaults?: Record<string, unknown> | null;
		}>();
		const type = String(body.type ?? '').trim();
		const label = String(body.label ?? '').trim();
		const resolve = String(body.resolve ?? '').trim();
		if (!type || !label || !resolve) return fail(c, 'type, label and resolve are required', 400);
		if (!/^[a-z][a-z0-9-]*$/.test(type)) return fail(c, 'type must be lowercase with dashes (e.g. stock-badge)', 400);
		const saved = await getService(c).save({
			type,
			label,
			group: body.group,
			resolve,
			icon: body.icon ?? null,
			props_schema: body.props_schema ?? null,
			defaults: body.defaults ?? null,
		});
		return success(c, saved, 201);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Save failed', 500);
	}
});

// PUT /api/custom-blocks/:id (admin only)
app.put('/:id', requireAdmin, async (c) => {
	try {
		const svc = getService(c);
		const existing = await svc.getById(c.req.param('id'));
		if (!existing) return fail(c, 'Not found', 404);
		const body = await c.req.json<{
			label?: string;
			group?: string;
			resolve?: string;
			icon?: string | null;
			props_schema?: Record<string, unknown> | null;
			defaults?: Record<string, unknown> | null;
		}>();
		const saved = await svc.save({
			type: existing.type,
			label: body.label ?? existing.label,
			group: body.group ?? existing.group,
			resolve: body.resolve ?? existing.resolve,
			icon: body.icon !== undefined ? body.icon : existing.icon,
			props_schema: body.props_schema !== undefined ? body.props_schema : existing.props_schema,
			defaults: body.defaults !== undefined ? body.defaults : existing.defaults,
		});
		return success(c, saved);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Update failed', 500);
	}
});

// DELETE /api/custom-blocks/:id (admin only)
app.delete('/:id', requireAdmin, async (c) => {
	try {
		const svc = getService(c);
		const existing = await svc.getById(c.req.param('id'));
		if (!existing) return fail(c, 'Not found', 404);
		await svc.delete(existing.id);
		return success(c, { deleted: true });
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Delete failed', 500);
	}
});

export { app as customBlockRoutes };
