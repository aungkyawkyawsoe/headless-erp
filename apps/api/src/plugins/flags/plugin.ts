/**
 * Feature Flags Plugin — tenant-scoped toggles + percentage rollouts.
 *
 * Routes:
 *   GET    /api/flags                 (auth)  list (?tenant=)
 *   POST   /api/flags                 (admin) { key, tenant?, enabled?, rolloutPct?, config? }
 *   DELETE /api/flags/:key            (admin) ?tenant=
 *   GET    /api/flags/:key/evaluate   (auth)  ?tenant=&seed= → { enabled, config }
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { FlagService } from '@mmbix/flags';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import type { AuthContext } from '@/lib/services/auth.service';
import { success, fail } from '@/lib/api/response';

export function flagsPlugin(): Plugin {
	return {
		id: 'flags',
		name: 'Feature Flags (tenant rollouts)',
		version: '1.0.0',
		migrations: [
			{
				name: '031_flags',
				up: [
					{
						sql: `CREATE TABLE IF NOT EXISTS _feature_flags (key TEXT NOT NULL, tenant TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, rollout_pct INTEGER NOT NULL DEFAULT 100, config_json TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (key, tenant))`,
						bindings: [],
					},
				],
			},
		],
		register(_ctx: PluginContext): PluginRegistration {
			const app = new Hono<{ Bindings: { DB: D1Database }; Variables: { auth: AuthContext } }>();
			app.use('*', requireAuth);
			const svc = (c: Context) => new FlagService(new D1Client((c.env as { DB: D1Database }).DB as D1Database));

			app.get('/', async (c) => success(c, await svc(c).list(c.req.query('tenant') || undefined)));

			app.post('/', requireAdmin, async (c) => {
				const body = (await c.req.json()) as {
					key?: string;
					tenant?: string;
					enabled?: boolean;
					rolloutPct?: number;
					config?: unknown;
				};
				if (!body.key?.trim()) return fail(c, 'key is required', 400);
				const row = await svc(c).set(body as never);
				return success(c, row, 201);
			});

			app.delete('/:key', requireAdmin, async (c) => {
				const ok = await svc(c).remove(c.req.param('key'), c.req.query('tenant') || undefined);
				if (!ok) return fail(c, 'flag not found', 404);
				return success(c, { deleted: true });
			});

			app.get('/:key/evaluate', async (c) => {
				const result = await svc(c).evaluate(c.req.param('key'), {
					tenant: c.req.query('tenant') || undefined,
					seed: c.req.query('seed') || undefined,
				});
				return success(c, result);
			});

			return { routes: [{ path: '/api/flags', handler: app as unknown as Hono }] };
		},
	};
}
