/**
 * Design Tokens Routes — /api/design-tokens
 *
 * CRUD for per-app theme token sets (the design-system swap layer).
 *   GET    /api/design-tokens?app=:slug|:id   — list sets (null app_id = global)
 *   GET    /api/design-tokens/effective?app=  — effective set for an app
 *   POST   /api/design-tokens                 — create / upsert set
 *   PUT    /api/design-tokens/:id             — update set
 *   DELETE /api/design-tokens/:id             — delete set
 */
import { Hono, type Context } from 'hono';
import { D1Client, MigrationRunner } from '@mmbix/core';
import { DesignTokenService } from '@/lib/services/design-token.service';
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

function getService(c: Context): DesignTokenService {
	return new DesignTokenService(new D1Client(c.env.DB), c.get('auth'));
}

// GET /api/design-tokens?app=:id
app.get('/', async (c) => {
	try {
		const appId = c.req.query('app');
		const sets = await getService(c).list(appId || null);
		return success(c, sets);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'List failed', 500);
	}
});

// GET /api/design-tokens/effective?app=:id
app.get('/effective', async (c) => {
	try {
		const appId = c.req.query('app');
		const set = await getService(c).effective(appId || null);
		return success(c, set ? { id: set.id, set_name: set.set_name, tokens: DesignTokenService.parseTokens(set) } : null);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Query failed', 500);
	}
});

// POST /api/design-tokens — create / upsert (admin only — global config)
app.post('/', requireAdmin, async (c) => {
	try {
		const body = await c.req.json();
		const set_name = String(body.set_name ?? '').trim();
		if (!set_name) return fail(c, 'set_name is required', 400);
		if (typeof body.tokens_json !== 'string') {
			return fail(c, 'tokens_json must be a JSON string', 400);
		}
		const saved = await getService(c).save({
			id: body.id ? String(body.id) : undefined,
			app_id: body.app_id ? String(body.app_id) : null,
			set_name,
			is_default: body.is_default === true,
			tokens_json: body.tokens_json,
		});
		return success(c, saved, 201);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Save failed', 500);
	}
});

// PUT /api/design-tokens/:id (admin only — global config)
app.put('/:id', requireAdmin, async (c) => {
	try {
		const body = await c.req.json();
		const existing = await getService(c).getById(c.req.param('id'));
		if (!existing) return fail(c, 'Not found', 404);
		const saved = await getService(c).save({
			id: existing.id,
			app_id: body.app_id !== undefined ? (body.app_id ? String(body.app_id) : null) : existing.app_id,
			set_name: body.set_name !== undefined ? String(body.set_name) : existing.set_name,
			is_default: body.is_default !== undefined ? body.is_default === true : existing.is_default === 1,
			tokens_json: body.tokens_json !== undefined ? String(body.tokens_json) : existing.tokens_json,
		});
		return success(c, saved);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Update failed', 500);
	}
});

// DELETE /api/design-tokens/:id (admin only)
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

export { app as designTokenRoutes };
