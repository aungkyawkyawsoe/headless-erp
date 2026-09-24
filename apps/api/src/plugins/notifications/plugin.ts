/**
 * Email Notifications Plugin
 *
 * Email template CRUD + test send + per-entity notification config.
 *
 *   GET  /api/notifications/templates        → List templates
 *   POST /api/notifications/templates        → Create template
 *   DEL  /api/notifications/templates/:id    → Delete template
 *   POST /api/notifications/test              → Send test
 *   POST /api/notifications/entity/:slug     → Configure per-entity
 *
 * Bundle impact: ~2KB
 */
import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono } from 'hono';
import { D1Client, cache } from '@mmbix/core';
import { MigrationRunner } from '@mmbix/core';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';

interface NotificationTemplate {
	subject: string;
	to: string;
	body?: string;
}
interface NotificationConfig {
	on_create?: NotificationTemplate;
	on_submit?: NotificationTemplate;
	on_approve?: NotificationTemplate;
	on_reject?: NotificationTemplate;
}
interface EmailTemplate {
	id?: string;
	name: string;
	subject: string;
	body: string;
	channel: string;
	created_at?: string;
}

export class NotificationService {
	static render(template: string, doc: Record<string, unknown>): string {
		return template.replace(/\{\{doc\.(\w+)\}\}/g, (_: string, key: string) => String(doc[key] ?? ''));
	}
	static async send(config: NotificationConfig | undefined, event: keyof NotificationConfig, doc: Record<string, unknown>): Promise<void> {
		if (!config) return;
		const tpl = config[event];
		if (!tpl) return;
		console.log(
			JSON.stringify({
				type: 'notification',
				event,
				to: this.render(tpl.to, doc),
				subject: this.render(tpl.subject, doc),
				timestamp: new Date().toISOString(),
			}),
		);
	}
}

export function notificationPlugin(): Plugin {
	return {
		id: 'notifications',
		name: 'Email Notifications',
		version: '1.0.0',
		migrations: [
			{
				name: '012_email_templates',
				up: [
					{
						sql: `CREATE TABLE IF NOT EXISTS _email_templates (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '', channel TEXT DEFAULT 'email',
          created_at TEXT DEFAULT (datetime('now'))
        )`,
						bindings: [],
					},
				],
			},
		],
		register(_ctx: PluginContext): PluginRegistration {
			type NotificationsEnv = {
				Bindings: { DB: D1Database; ADMIN_PASSWORD: string };
				Variables: { auth: import('@/lib/services/auth.service').AuthContext };
			};
			const app = new Hono<NotificationsEnv>();
			app.use('*', requireAuth, requireAdmin);

			app.get('/templates', async (c) => {
				const db = new D1Client(c.env.DB);
				await new MigrationRunner(db).runPending();
				const templates = await db.all<EmailTemplate>({ sql: 'SELECT * FROM _email_templates ORDER BY created_at DESC', bindings: [] });
				return success(c, templates);
			});

			app.post('/templates', async (c) => {
				const db = new D1Client(c.env.DB);
				await new MigrationRunner(db).runPending();
				const body = (await c.req.json()) as EmailTemplate;
				if (!body.name || !body.subject) return fail(c, 'name and subject required', 400);
				const id = crypto.randomUUID();
				await db.run({
					sql: 'INSERT INTO _email_templates (id, name, subject, body, channel) VALUES (?, ?, ?, ?, ?)',
					bindings: [id, body.name, body.subject, body.body ?? '', body.channel ?? 'email'],
				});
				return success(c, { id, ...body }, 201);
			});

			app.delete('/templates/:id', async (c) => {
				const db = new D1Client(c.env.DB);
				await new MigrationRunner(db).runPending();
				await db.run({ sql: 'DELETE FROM _email_templates WHERE id = ?', bindings: [c.req.param('id')] });
				return success(c, { deleted: true });
			});

			app.post('/test', async (c) => {
				const { to, subject, body, template_id } = await c.req.json();
				const db = new D1Client(c.env.DB);
				await new MigrationRunner(db).runPending();
				let tpl = { subject: subject || 'Test', body: body || 'Hello from Entity Engine' };
				if (template_id) {
					const stored = await db.first<EmailTemplate>({ sql: 'SELECT * FROM _email_templates WHERE id = ?', bindings: [template_id] });
					if (stored) tpl = { subject: stored.subject, body: stored.body };
				}
				console.log(JSON.stringify({ type: 'notification', to, subject: tpl.subject, timestamp: new Date().toISOString() }));
				return success(c, { sent: true, to, subject: tpl.subject });
			});

			app.post('/entity/:collection', async (c) => {
				const config = (await c.req.json()) as NotificationConfig;
				const db = new D1Client(c.env.DB);
				await new MigrationRunner(db).runPending();
				await db.run({
					sql: 'UPDATE _entity_schemas SET schema_json = json_set(schema_json, "$.notifications", ?) WHERE slug = ?',
					bindings: [JSON.stringify(config), c.req.param('collection')],
				});
				// This is a schema_json write OUTSIDE the normal schema lifecycle — the
				// schema cache must not keep serving the pre-toggle config. Invalidate
				// the schema + derived caches for the collection (readc/report/perm
				// too) and advance the schema version counter.
				const slug = c.req.param('collection');
				cache.invalidateCollection(slug);
				await db.run({
					sql: 'UPDATE _entity_schemas SET _schema_version = COALESCE(_schema_version, 1) + 1 WHERE slug = ?',
					bindings: [slug],
				});
				return success(c, { collection: slug, config });
			});

			return { routes: [{ path: '/api/notifications', handler: app as unknown as Hono }] };
		},
	};
}
