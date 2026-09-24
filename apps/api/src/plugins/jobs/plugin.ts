/**
 * Jobs Plugin — async job façade over the scheduler.
 *
 * `POST /api/jobs` enqueues a task that runs immediately (DO alarm fires asap);
 * clients poll `GET /api/jobs/:id` for status + result. Long operations never
 * block the HTTP request.
 *
 * Routes:
 *   POST   /api/jobs         (admin) { type, payload?, name? } → { jobId }
 *   GET    /api/jobs         (auth)  list (?status=&limit=)
 *   GET    /api/jobs/:id     (auth)  status, attempts, last_error, last_result
 *   DELETE /api/jobs/:id     (admin) cancel
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { SchedulerService } from '@mmbix/scheduler';
import type { SchedulerEnv } from '@mmbix/scheduler';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import type { AuthContext } from '@/lib/services/auth.service';
import { success, fail } from '@/lib/api/response';

export function jobsPlugin(): Plugin {
	return {
		id: 'jobs',
		name: 'Async Jobs (scheduler façade)',
		version: '1.0.0',
		register(_ctx: PluginContext): PluginRegistration {
			const app = new Hono<{ Bindings: { DB: D1Database; SCHEDULER: DurableObjectNamespace }; Variables: { auth: AuthContext } }>();
			app.use('*', requireAuth);
			const getDb = (c: Context) => new D1Client((c.env as { DB: D1Database }).DB as D1Database);
			const svc = (c: Context) => new SchedulerService(getDb(c));
			const envOf = (c: Context) => c.env as unknown as SchedulerEnv;

			// Enqueue an async job — runs immediately (or at `runAt` when given) in
			// the background.
			app.post('/', requireAdmin, async (c) => {
				const body = (await c.req.json()) as {
					type?: string;
					payload?: Record<string, unknown>;
					name?: string;
					runAt?: string | number;
				};
				if (!body.type?.trim()) return fail(c, 'type is required', 400);
				try {
					const task = await svc(c).schedule(
						{ type: body.type, payload: body.payload, name: body.name, runAt: body.runAt ?? Date.now() },
						envOf(c),
					);
					return success(c, { jobId: task.id, status: task.status }, 201);
				} catch (err) {
					return fail(c, err instanceof Error ? err.message : String(err), 400);
				}
			});

			app.get('/', async (c) => {
				const rows = await svc(c).list({
					status: c.req.query('status') || undefined,
					limit: Number(c.req.query('limit') ?? 50),
				});
				return success(c, rows);
			});

			app.get('/:id', async (c) => {
				const row = await svc(c).get(c.req.param('id'));
				if (!row) return fail(c, 'job not found', 404);
				return success(c, row);
			});

			app.delete('/:id', requireAdmin, async (c) => {
				const ok = await svc(c).cancel(c.req.param('id'), envOf(c));
				if (!ok) return fail(c, 'job not found', 404);
				return success(c, { cancelled: true });
			});

			return { routes: [{ path: '/api/jobs', handler: app as unknown as Hono }] };
		},
	};
}
