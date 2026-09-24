/**
 * Outbox Plugin — durable side-effect queue + dead-letter management.
 *
 * Routes (all auth required, writes admin-only):
 *   GET    /api/outbox                  → list (?status=pending|done|failed&limit=50)
 *   POST   /api/outbox                  → enqueue a custom task { type, payload, dedupe_key? }
 *   GET    /api/outbox/dlq              → dead-letter rows
 *   POST   /api/outbox/:id/retry        → move a DLQ row back into the queue
 *   DELETE /api/outbox/done             → prune finished rows (?days=7)
 *
 * The scheduled handler (src/index.ts) calls OutboxService.flushDue() on a
 * recurring cron — side effects survive worker restarts, retry with backoff,
 * and never double-fire thanks to dedupe keys.
 *
 * Bundle impact: ~3KB
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { OutboxService } from './service';
import { clampPageSize, DEFAULT_PAGE_SIZE } from '@/lib/api/page-size';
import type { AuthContext } from '@/lib/services/auth.service';
import { success, fail } from '@/lib/api/response';

export function outboxPlugin(): Plugin {
	return {
		id: 'outbox',
		name: 'Outbox (durable side-effects + dead-letter queue)',
		version: '1.0.0',
		migrations: [
			{
				name: '022_outbox',
				up: [
					{
						sql: `CREATE TABLE IF NOT EXISTS _outbox (
							id TEXT PRIMARY KEY,
							type TEXT NOT NULL,
							dedupe_key TEXT UNIQUE,
							payload_json TEXT NOT NULL,
							status TEXT NOT NULL DEFAULT 'pending',
							attempts INTEGER NOT NULL DEFAULT 0,
							next_attempt_at TEXT NOT NULL,
							error TEXT,
							created_at TEXT NOT NULL,
							updated_at TEXT NOT NULL
						)`,
						bindings: [],
					},
					{
						sql: `CREATE INDEX IF NOT EXISTS idx_outbox_due ON _outbox (status, next_attempt_at)`,
						bindings: [],
					},
					{
						sql: `CREATE TABLE IF NOT EXISTS _outbox_dlq (
							id TEXT PRIMARY KEY,
							type TEXT NOT NULL,
							dedupe_key TEXT,
							payload_json TEXT NOT NULL,
							attempts INTEGER NOT NULL,
							error TEXT,
							failed_at TEXT NOT NULL
						)`,
						bindings: [],
					},
				],
			},
		],
		register(_ctx: PluginContext): PluginRegistration {
			const app = new Hono<{
				Bindings: { DB: D1Database };
				Variables: { auth: AuthContext };
			}>();

			app.use('*', requireAuth);

			const getDb = (c: Context) => new D1Client((c.env as { DB: D1Database }).DB as D1Database);
			const svc = (c: Context) => new OutboxService(getDb(c));

			// ─── List ─────────────────────────────────────
			app.get('/', async (c) => {
				const status = c.req.query('status') || undefined;
				// Page-size policy (enterprise): default 25, max 100 (page-size.ts).
				const limit = clampPageSize(Number(c.req.query('limit') ?? '') || DEFAULT_PAGE_SIZE);
				const rows = await svc(c).list(status, limit);
				return success(c, rows);
			});

			// ─── Enqueue a custom task ────────────────────
			app.post('/', requireAdmin, async (c) => {
				const body = (await c.req.json()) as { type?: string; payload?: Record<string, unknown>; dedupe_key?: string };
				if (!body.type) return fail(c, 'type is required (plugin | hook | webhook | custom)', 400);
				const result = await svc(c).enqueue(body.type, body.payload ?? {}, {
					dedupeKey: body.dedupe_key,
				});
				return success(c, result, 201);
			});

			// ─── Dead letters ─────────────────────────────
			app.get('/dlq', async (c) => {
				// Page-size policy (enterprise): default 25, max 100 (page-size.ts).
				const limit = clampPageSize(Number(c.req.query('limit') ?? '') || DEFAULT_PAGE_SIZE);
				const rows = await svc(c).listDlq(limit);
				return success(c, rows);
			});

			// ─── Retry a dead letter ──────────────────────
			app.post('/:id/retry', requireAdmin, async (c) => {
				const ok = await svc(c).retryDlq(c.req.param('id'));
				if (!ok) return fail(c, 'Dead-letter row not found', 404);
				return success(c, { retried: true });
			});

			// ─── Prune finished rows ──────────────────────
			app.delete('/done', requireAdmin, async (c) => {
				const days = Math.max(Number(c.req.query('days') ?? 7) || 7, 1);
				const pruned = await svc(c).pruneDone(days);
				return success(c, { pruned });
			});

			return { routes: [{ path: '/api/outbox', handler: app as unknown as Hono }] };
		},
	};
}
