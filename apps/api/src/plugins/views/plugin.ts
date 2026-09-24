/**
 * Views Plugin — declarative materialized views (CQRS read models).
 *
 * Routes:
 *   GET  /api/materialized-views           (auth)  list
 *   POST /api/materialized-views           (admin) { name, source, columns, where?, groupBy? }
 *   POST /api/materialized-views/:name/refresh (admin) rebuild `_view_<name>` (DROP + CREATE AS SELECT)
 *   DELETE /api/materialized-views/:name   (admin)
 *
 * Note: `/api/views` is owned by the core Saved-Views feature (UI filter
 * presets) — this plugin intentionally mounts on its own path.
 *
 * Also registers the `view.refresh` scheduler handler so views can be refreshed
 * on a cron — combine with the scheduler for nightly read models.
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { ViewService } from '@mmbix/views';
import type { ViewDefinition } from '@mmbix/views';
import { registerHandler } from '@mmbix/scheduler';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import type { AuthContext } from '@/lib/services/auth.service';
import { success, fail } from '@/lib/api/response';

export function viewsPlugin(): Plugin {
	return {
		id: 'views',
		name: 'Materialized Views (CQRS read models)',
		version: '1.0.0',
		migrations: [
			{
				name: '034_views',
				up: [
					{
						sql: `CREATE TABLE IF NOT EXISTS _views (name TEXT PRIMARY KEY, source TEXT NOT NULL, columns_json TEXT NOT NULL, where_json TEXT, group_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
						bindings: [],
					},
				],
			},
		],
		register(_ctx: PluginContext): PluginRegistration {
			// Scheduler part: refresh a view on a cron (payload: { view }).
			registerHandler('view.refresh', async (payload, ctx) => {
				const name = String((payload as { view?: string }).view ?? '');
				if (!name) throw new Error('view.refresh: view is required');
				const result = await new ViewService(new D1Client((ctx.env as unknown as { DB: D1Database }).DB as D1Database)).refresh(name);
				return result;
			});

			const app = new Hono<{ Bindings: { DB: D1Database }; Variables: { auth: AuthContext } }>();
			app.use('*', requireAuth);
			const svc = (c: Context) => new ViewService(new D1Client((c.env as { DB: D1Database }).DB as D1Database));

			app.get('/', async (c) => success(c, await svc(c).list()));

			app.post('/', requireAdmin, async (c) => {
				const body = (await c.req.json()) as ViewDefinition;
				try {
					return success(c, await svc(c).create(body), 201);
				} catch (err) {
					return fail(c, err instanceof Error ? err.message : String(err), 400);
				}
			});

			app.post('/:name/refresh', requireAdmin, async (c) => {
				try {
					return success(c, await svc(c).refresh(c.req.param('name')));
				} catch (err) {
					return fail(c, err instanceof Error ? err.message : String(err), 400);
				}
			});

			app.delete('/:name', requireAdmin, async (c) => {
				const ok = await svc(c).remove(c.req.param('name'));
				if (!ok) return fail(c, 'view not found', 404);
				return success(c, { deleted: true });
			});

			return { routes: [{ path: '/api/materialized-views', handler: app as unknown as Hono }] };
		},
	};
}
