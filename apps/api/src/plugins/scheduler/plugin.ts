/**
 * Headless Scheduler Plugin — global scheduling for any use case.
 *
 * Routes (all auth required, writes admin-only) — mounted at /api/scheduler
 * alongside the legacy cron-jobs routes (distinct sub-paths, no conflicts):
 *
 *   GET    /api/scheduler/tasks            → list (?status&type&limit)
 *   POST   /api/scheduler/tasks            → schedule { type, runAt|delayMs, repeatMs|cron, payload, maxAttempts }
 *   GET    /api/scheduler/tasks/:id        → one task
 *   DELETE /api/scheduler/tasks/:id        → cancel + disarm
 *   POST   /api/scheduler/tasks/:id/run    → run now (returns RunOutcome)
 *   POST   /api/scheduler/tasks/:id/retry  → reset a failed task
 *   GET    /api/scheduler/handlers         → registered handler types (code side)
 *   POST   /api/scheduler/reconcile        → watchdog: re-arm due/lost alarms
 *   POST   /api/scheduler/prune            → housekeeping (?days=7)
 *   GET    /api/scheduler/stats            → counts by status
 *
 * The DO class (`SchedulerDO`) is re-exported from src/index.ts so wrangler
 * can bind the SCHEDULER namespace. The scheduled handler runs reconcile()
 * on the recurring cron (self-healing).
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { SchedulerService, registerBuiltinHandlers } from '@mmbix/scheduler';
import type { ScheduleInput, SchedulerEnv } from '@mmbix/scheduler';
import type { AuthContext } from '@/lib/services/auth.service';
import { success, fail } from '@/lib/api/response';

// The factory ships generic parts (http.request, http.retry-until,
// entity.transition, entity.expire, query.rollup, aggregate.delta,
// notify.digest) — registered once at startup so any task can reference them.
registerBuiltinHandlers();

export function schedulerPlugin(): Plugin {
	return {
		id: 'scheduler',
		name: 'Headless Scheduler (DO alarms + cron watchdog)',
		version: '1.0.0',
		migrations: [
			{
				name: '026_scheduler',
				up: [
					{
						sql: `CREATE TABLE IF NOT EXISTS _scheduler_tasks (
							id TEXT PRIMARY KEY,
							type TEXT NOT NULL,
							name TEXT,
							payload_json TEXT NOT NULL DEFAULT '{}',
							status TEXT NOT NULL DEFAULT 'pending',
							run_at TEXT NOT NULL,
							repeat_ms INTEGER,
							cron TEXT,
							max_attempts INTEGER NOT NULL DEFAULT 5,
							attempts INTEGER NOT NULL DEFAULT 0,
							run_count INTEGER NOT NULL DEFAULT 0,
							last_error TEXT,
							last_result TEXT,
							last_run_at TEXT,
							completed_at TEXT,
							created_at TEXT NOT NULL,
							updated_at TEXT NOT NULL
						)`,
						bindings: [],
					},
					{
						sql: `CREATE INDEX IF NOT EXISTS idx_scheduler_due ON _scheduler_tasks (status, run_at)`,
						bindings: [],
					},
				],
			},
			{
				// Separate migration: existing databases already applied 026 — the
				// timezone column + type index must be additive (ALTER is not
				// idempotent, so it is tracked by name and applied exactly once).
				name: '027_scheduler_timezone_index',
				up: [
					{
						sql: `ALTER TABLE _scheduler_tasks ADD COLUMN timezone TEXT DEFAULT 'UTC'`,
						bindings: [],
					},
					{
						sql: `CREATE INDEX IF NOT EXISTS idx_scheduler_type ON _scheduler_tasks (type, status)`,
						bindings: [],
					},
				],
			},
		],
		register(_ctx: PluginContext): PluginRegistration {
			const app = new Hono<{
				Bindings: { DB: D1Database; SCHEDULER: DurableObjectNamespace };
				Variables: { auth: AuthContext };
			}>();

			app.use('*', requireAuth);

			const getDb = (c: Context) => new D1Client((c.env as { DB: D1Database }).DB as D1Database);
			const svc = (c: Context) => new SchedulerService(getDb(c));
			const envOf = (c: Context) => c.env as unknown as SchedulerEnv;

			// ─── List tasks (admin — tasks may embed sensitive payload_json) ────
			app.get('/tasks', requireAdmin, async (c) => {
				const rows = await svc(c).list({
					status: c.req.query('status') || undefined,
					type: c.req.query('type') || undefined,
					limit: Number(c.req.query('limit') ?? 50),
				});
				return success(c, rows);
			});

			// ─── Schedule a task ───────────────────────────
			app.post('/tasks', requireAdmin, async (c) => {
				const body = (await c.req.json()) as ScheduleInput;
				try {
					const task = await svc(c).schedule(body, envOf(c));
					return success(c, task, 201);
				} catch (err) {
					return fail(c, err instanceof Error ? err.message : String(err), 400);
				}
			});

			// ─── Get one task (admin — payload_json may embed sensitive data) ──
			app.get('/tasks/:id', requireAdmin, async (c) => {
				const row = await svc(c).get(c.req.param('id'));
				if (!row) return fail(c, 'task not found', 404);
				return success(c, row);
			});

			// ─── Cancel + disarm ───────────────────────────
			app.delete('/tasks/:id', requireAdmin, async (c) => {
				const ok = await svc(c).cancel(c.req.param('id'), envOf(c));
				if (!ok) return fail(c, 'task not found', 404);
				return success(c, { cancelled: true });
			});

			// ─── Run now ───────────────────────────────────
			app.post('/tasks/:id/run', requireAdmin, async (c) => {
				try {
					const outcome = await svc(c).runNow(c.req.param('id'), envOf(c));
					return success(c, outcome);
				} catch (err) {
					return fail(c, err instanceof Error ? err.message : String(err), 400);
				}
			});

			// ─── Retry a failed task ───────────────────────
			app.post('/tasks/:id/retry', requireAdmin, async (c) => {
				const ok = await svc(c).retry(c.req.param('id'), envOf(c));
				if (!ok) return fail(c, 'task not found or not failed', 404);
				return success(c, { retried: true });
			});

			// ─── Registered handler types (admin) ───────────
			app.get('/handlers', requireAdmin, async (c) => success(c, svc(c).listHandlers()));

			// ─── Watchdog ──────────────────────────────────
			app.post('/reconcile', requireAdmin, async (c) => {
				const result = await svc(c).reconcile(envOf(c), 200);
				return success(c, result);
			});

			// ─── Housekeeping ──────────────────────────────
			app.post('/prune', requireAdmin, async (c) => {
				const days = Math.max(Number(c.req.query('days') ?? 7) || 7, 1);
				const pruned = await svc(c).prune(days);
				return success(c, { pruned });
			});

			// ─── Stats (admin) ─────────────────────────────
			app.get('/stats', requireAdmin, async (c) => success(c, await svc(c).stats()));

			return { routes: [{ path: '/api/scheduler', handler: app as unknown as Hono }] };
		},
	};
}
