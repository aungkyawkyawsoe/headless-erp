/**
 * Quota Plugin — atomic usage quotas per tenant/collection.
 *
 * Routes:
 *   GET  /api/quotas                  (admin) list (?limit=)
 *   POST /api/quotas/consume          (admin) { key, amount, limit, windowMs } → { allowed, used, resetAt }
 *   POST /api/quotas/reset            (admin) { key }
 *   POST /api/quotas/peek             (admin) { key, windowMs }
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { QuotaService } from '@mmbix/quota';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { clampPageSize, DEFAULT_PAGE_SIZE } from '@/lib/api/page-size';
import type { AuthContext } from '@/lib/services/auth.service';
import { success, fail } from '@/lib/api/response';

export function quotaPlugin(): Plugin {
	return {
		id: 'quota',
		name: 'Usage Quotas (atomic windows)',
		version: '1.0.0',
		migrations: [
			{
				name: '032_quota',
				up: [
					{
						sql: `CREATE TABLE IF NOT EXISTS _quotas (key TEXT PRIMARY KEY, window INTEGER NOT NULL, used REAL NOT NULL, max_value REAL NOT NULL, updated_at TEXT NOT NULL)`,
						bindings: [],
					},
				],
			},
		],
		register(_ctx: PluginContext): PluginRegistration {
			const app = new Hono<{ Bindings: { DB: D1Database }; Variables: { auth: AuthContext } }>();
			app.use('*', requireAuth);
			const svc = (c: Context) => new QuotaService(new D1Client((c.env as { DB: D1Database }).DB as D1Database));

			// Page-size policy (enterprise): default 25, max 100 (page-size.ts).
			app.get('/', requireAdmin, async (c) =>
				success(c, await svc(c).list(clampPageSize(Number(c.req.query('limit') ?? '') || DEFAULT_PAGE_SIZE))),
			);

			app.post('/consume', requireAdmin, async (c) => {
				const body = (await c.req.json()) as { key?: string; amount?: number; limit?: number; windowMs?: number };
				if (!body.key) return fail(c, 'key is required', 400);
				if (!body.limit || !body.windowMs) return fail(c, 'limit and windowMs are required', 400);
				const result = await svc(c).consume(body.key, body.amount ?? 1, { limit: body.limit, windowMs: body.windowMs });
				return success(c, result);
			});

			app.post('/reset', requireAdmin, async (c) => {
				const body = (await c.req.json()) as { key?: string };
				if (!body.key) return fail(c, 'key is required', 400);
				await svc(c).reset(body.key);
				return success(c, { reset: true });
			});

			app.post('/peek', requireAdmin, async (c) => {
				const body = (await c.req.json()) as { key?: string; windowMs?: number };
				if (!body.key || !body.windowMs) return fail(c, 'key and windowMs are required', 400);
				return success(c, await svc(c).peek(body.key, body.windowMs));
			});

			return { routes: [{ path: '/api/quotas', handler: app as unknown as Hono }] };
		},
	};
}
