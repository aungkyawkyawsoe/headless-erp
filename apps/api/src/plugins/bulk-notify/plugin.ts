/**
 * Bulk Notify Plugin (Email / SMS)
 *
 * Queue bulk notifications for email/SMS delivery.
 *
 *   POST /api/notify/bulk           → Queue bulk notification
 *   GET  /api/notify/queue           → List queue
 *   POST /api/notify/queue/:id/send  → Trigger send
 *
 * Bundle impact: ~3KB
 */
import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono } from 'hono';
import { D1Client } from '@mmbix/core';
import { MigrationRunner } from '@mmbix/core';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';

interface BulkNotify {
	id?: string;
	channel: 'email' | 'sms';
	subject?: string;
	body_template: string;
	collection_slug: string;
	filter_json?: string;
	status?: string;
	total?: number;
	sent?: number;
	created_at?: string;
}

export function bulkNotifyPlugin(): Plugin {
	return {
		id: 'bulk-notify',
		name: 'Bulk Notifications',
		version: '1.0.0',
		migrations: [
			{
				name: '011_bulk_notify',
				up: [
					{
						sql: `CREATE TABLE IF NOT EXISTS _bulk_notifications (
          id TEXT PRIMARY KEY, channel TEXT DEFAULT 'email', subject TEXT,
          body_template TEXT NOT NULL, collection_slug TEXT NOT NULL,
          filter_json TEXT, status TEXT DEFAULT 'queued',
          total INTEGER DEFAULT 0, sent INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        )`,
						bindings: [],
					},
				],
			},
		],
		register(_ctx: PluginContext): PluginRegistration {
			type BulkNotifyEnv = {
				Bindings: { DB: D1Database; ADMIN_PASSWORD: string };
				Variables: { auth: import('@/lib/services/auth.service').AuthContext };
			};
			const app = new Hono<BulkNotifyEnv>();
			app.use('*', requireAuth);
			app.use('*', requireAdmin);

			app.post('/bulk', async (c) => {
				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				await new MigrationRunner(db).runPending();
				const body = (await c.req.json()) as BulkNotify;
				if (!body.collection_slug || !body.body_template) return fail(c, 'collection_slug and body_template required', 400);
				const id = crypto.randomUUID();
				await db.run({
					sql: 'INSERT INTO _bulk_notifications (id, channel, subject, body_template, collection_slug, filter_json, status, total, sent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
					bindings: [
						id,
						body.channel ?? 'email',
						body.subject ?? null,
						body.body_template,
						body.collection_slug,
						body.filter_json ?? null,
						'queued',
						0,
						0,
					],
				});
				return success(c, { id, ...body, status: 'queued' }, 201);
			});

			app.get('/queue', async (c) => {
				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				await new MigrationRunner(db).runPending();
				const items = await db.all<BulkNotify>({
					sql: 'SELECT * FROM _bulk_notifications ORDER BY created_at DESC LIMIT 50',
					bindings: [],
				});
				return success(c, items);
			});

			app.post('/queue/:id/send', async (c) => {
				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				await new MigrationRunner(db).runPending();
				const notify = await db.first<BulkNotify>({ sql: 'SELECT * FROM _bulk_notifications WHERE id = ?', bindings: [c.req.param('id')] });
				if (!notify) return fail(c, 'Notification not found', 404);
				if (notify.status !== 'queued') return fail(c, `Status is "${notify.status}", must be "queued"`, 400);

				// Look up table_name from schema instead of constructing cms_${slug}
				const schema = await db.first<{ table_name: string }>({
					sql: 'SELECT table_name FROM _entity_schemas WHERE slug = ?',
					bindings: [notify.collection_slug],
				});
				const validCol = schema?.table_name || '_entity_schemas';

				const recipients = await db.all<Record<string, unknown>>({
					sql: `SELECT * FROM "${validCol}" WHERE deleted_at IS NULL LIMIT 100`,
					bindings: [],
				});

				await db.run({
					sql: 'UPDATE _bulk_notifications SET status = ?, total = ? WHERE id = ?',
					bindings: ['sending', recipients.length, notify.id],
				});

				let sent = 0;
				for (const recipient of recipients) {
					const rendered = notify.body_template.replace(/\{\{doc\.(\w+)\}\}/g, (_: string, key: string) => String(recipient[key] ?? ''));
					console.log(
						JSON.stringify({
							type: 'bulk_notify',
							id: notify.id,
							channel: notify.channel,
							recipient: recipient.email || recipient.phone || recipient.id,
							subject: notify.subject,
							body: rendered,
							timestamp: new Date().toISOString(),
						}),
					);
					sent++;
				}

				await db.run({ sql: 'UPDATE _bulk_notifications SET status = ?, sent = ? WHERE id = ?', bindings: ['sent', sent, notify.id] });
				return success(c, { id: notify.id, total: recipients.length, sent });
			});

			return { routes: [{ path: '/api/notify', handler: app as unknown as Hono }] };
		},
	};
}
