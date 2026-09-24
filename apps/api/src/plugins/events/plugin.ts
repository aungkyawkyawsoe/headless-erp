/**
 * Events Plugin — event bus over Cloudflare Queues.
 *
 * Routes:
 *   GET  /api/events/subscribers           (auth)  list (?topic=)
 *   POST /api/events/subscribers           (admin) { topic, action, name? }
 *   DELETE /api/events/subscribers/:id     (admin)
 *   POST /api/events/publish               (admin) { topic, payload } — direct publish
 *
 * The worker's queue() handler dispatches event-bus batches (queue name from the
 * EVENT_QUEUE_NAME var — see src/index.ts) to consumeEventBatch. Tables `_event_subscribers` +
 * `_event_deliveries` are declared here and self-healed by the package.
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { EventService, EventSubscriberService } from '@mmbix/events';
import type { SubscriberAction } from '@mmbix/events';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import type { AuthContext } from '@/lib/services/auth.service';
import { success, fail } from '@/lib/api/response';

const ACTION_TYPES = ['webhook', 'handler', 'log'];

export function eventsPlugin(): Plugin {
	return {
		id: 'events',
		name: 'Event Bus (Queues pub/sub)',
		version: '1.0.0',
		migrations: [
			{
				name: '030_events',
				up: [
					{
						sql: `CREATE TABLE IF NOT EXISTS _event_subscribers (id TEXT PRIMARY KEY, topic TEXT NOT NULL, name TEXT, action_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
						bindings: [],
					},
					{
						sql: `CREATE TABLE IF NOT EXISTS _event_deliveries (event_id TEXT NOT NULL, subscriber_id TEXT NOT NULL, status TEXT NOT NULL, processed_at TEXT NOT NULL, PRIMARY KEY (event_id, subscriber_id))`,
						bindings: [],
					},
					{
						sql: `CREATE INDEX IF NOT EXISTS idx_event_subs_topic ON _event_subscribers (topic)`,
						bindings: [],
					},
				],
			},
		],
		register(_ctx: PluginContext): PluginRegistration {
			const app = new Hono<{
				Bindings: { DB: D1Database; EVENTS: Queue };
				Variables: { auth: AuthContext };
			}>();
			app.use('*', requireAuth);

			const getDb = (c: Context) => new D1Client((c.env as { DB: D1Database }).DB as D1Database);
			const subs = (c: Context) => new EventSubscriberService(getDb(c));

			app.get('/subscribers', async (c) => {
				const rows = await subs(c).list(c.req.query('topic') || undefined);
				return success(c, rows);
			});

			app.post('/subscribers', requireAdmin, async (c) => {
				const body = (await c.req.json()) as { topic?: string; action?: SubscriberAction; name?: string };
				if (!body.topic?.trim()) return fail(c, 'topic is required', 400);
				if (!body.action || !ACTION_TYPES.includes(body.action.type)) {
					return fail(c, `action.type must be one of ${ACTION_TYPES.join(' | ')}`, 400);
				}
				if (body.action.type === 'webhook' && !body.action.url) {
					return fail(c, 'webhook action requires url', 400);
				}
				if (body.action.type === 'handler' && !body.action.handler_type) {
					return fail(c, 'handler action requires handler_type', 400);
				}
				const row = await subs(c).subscribe(body.topic, body.action, body.name);
				return success(c, row, 201);
			});

			app.delete('/subscribers/:id', requireAdmin, async (c) => {
				const ok = await subs(c).unsubscribe(c.req.param('id'));
				if (!ok) return fail(c, 'subscriber not found', 404);
				return success(c, { deleted: true });
			});

			app.post('/publish', requireAdmin, async (c) => {
				const body = (await c.req.json()) as { topic?: string; payload?: Record<string, unknown> };
				if (!body.topic?.trim()) return fail(c, 'topic is required', 400);
				const svc = new EventService((c.env as { EVENTS: Queue }).EVENTS);
				const envelope = await svc.publish(body.topic, body.payload ?? {});
				return success(c, envelope, 201);
			});

			return { routes: [{ path: '/api/events', handler: app as unknown as Hono }] };
		},
	};
}
