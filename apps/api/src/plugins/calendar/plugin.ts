/**
 * Calendar / Due-Date Triggers Plugin
 *
 * Auto-detect entities with date fields. Register triggers for overdue items.
 *
 *   GET  /api/calendar/fields            → Auto-detect date fields
 *   POST /api/calendar/triggers          → Register trigger
 *   GET  /api/calendar/triggers          → List triggers
 *   POST /api/calendar/check             → Check all, fire webhooks for overdue
 *
 * Bundle impact: ~3KB
 */
import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono } from 'hono';
import { D1Client } from '@mmbix/core';
import { MigrationRunner } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';

interface Trigger {
	id?: string;
	collection_slug: string;
	field: string;
	days_before: number;
	action: 'webhook' | 'notify';
	webhook_url?: string;
	created_at?: string;
}

export function calendarPlugin(): Plugin {
	return {
		id: 'calendar',
		name: 'Calendar Triggers',
		version: '1.0.0',
		migrations: [
			{
				name: '008_calendar_triggers',
				up: [
					{
						sql: `CREATE TABLE IF NOT EXISTS _calendar_triggers (
          id TEXT PRIMARY KEY, collection_slug TEXT NOT NULL, field TEXT NOT NULL,
          days_before INTEGER DEFAULT 0, action TEXT DEFAULT 'webhook',
          webhook_url TEXT, created_at TEXT DEFAULT (datetime('now'))
        )`,
						bindings: [],
					},
				],
			},
		],
		register(_ctx: PluginContext): PluginRegistration {
			type CalendarEnv = {
				Bindings: { DB: D1Database; ADMIN_PASSWORD: string };
				Variables: { auth: import('@/lib/services/auth.service').AuthContext };
			};
			const app = new Hono<CalendarEnv>();
			app.use('*', requireAuth, requireAdmin);

			app.get('/fields', async (c) => {
				const db = new D1Client(c.env.DB);
				await new MigrationRunner(db).runPending();
				const schemas = await db.all<{ slug: string; schema_json: string }>({
					sql: 'SELECT slug, schema_json FROM _entity_schemas WHERE deleted_at IS NULL',
					bindings: [],
				});
				const dateFields: Array<{ collection: string; field: string; type: string }> = [];
				for (const row of schemas) {
					try {
						(JSON.parse(row.schema_json || '[]') as Array<{ name: string; type: string }>)
							.filter((f) => ['date', 'timestamp', 'datetime'].includes(f.type))
							.forEach((f) => dateFields.push({ collection: row.slug, field: f.name, type: f.type }));
					} catch {
						/* skip */
					}
				}
				return success(c, dateFields);
			});

			app.post('/triggers', async (c) => {
				const db = new D1Client(c.env.DB);
				await new MigrationRunner(db).runPending();
				const body = (await c.req.json()) as Trigger;
				if (!body.collection_slug || !body.field) return fail(c, 'collection_slug and field required', 400);
				const id = crypto.randomUUID();
				await db.run({
					sql: 'INSERT INTO _calendar_triggers (id, collection_slug, field, days_before, action, webhook_url) VALUES (?, ?, ?, ?, ?, ?)',
					bindings: [id, body.collection_slug, body.field, body.days_before ?? 0, body.action ?? 'webhook', body.webhook_url ?? null],
				});
				return success(c, { id, ...body }, 201);
			});

			app.get('/triggers', async (c) => {
				const db = new D1Client(c.env.DB);
				await new MigrationRunner(db).runPending();
				const triggers = await db.all<Trigger>({ sql: 'SELECT * FROM _calendar_triggers ORDER BY collection_slug, field', bindings: [] });
				return success(c, triggers);
			});

			app.post('/check', async (c) => {
				const db = new D1Client(c.env.DB);
				await new MigrationRunner(db).runPending();
				const triggers = await db.all<Trigger>({ sql: 'SELECT * FROM _calendar_triggers', bindings: [] });
				const fired: Array<{ collection: string; field: string; item_id: string; due_date: string }> = [];
				const webhookPromises: Promise<void>[] = [];

				for (const trigger of triggers) {
					const dueThreshold = new Date();
					dueThreshold.setDate(dueThreshold.getDate() + trigger.days_before);
					const dueIso = dueThreshold.toISOString().split('T')[0];
					const now = new Date().toISOString();

					const validField = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trigger.field) ? trigger.field : 'id';
					// Get table_name from schema instead of constructing cms_${slug}
					const schema = await db.first<{ table_name: string }>(
						QueryBuilder.from('_entity_schemas').select('table_name').where('slug', trigger.collection_slug).toSelect(),
					);
					const validCollection = schema?.table_name || '_entity_schemas';

					const items = await db.all<{ id: string; [key: string]: unknown }>({
						sql: `SELECT id, ${validField} FROM "${validCollection}" WHERE ${validField} IS NOT NULL AND ${validField} < ? AND doc_status != 'cancelled' AND deleted_at IS NULL LIMIT 100`,
						bindings: [dueIso],
					});

					for (const item of items) {
						const dueVal = item[validField] as string;
						fired.push({ collection: trigger.collection_slug, field: trigger.field, item_id: item.id, due_date: dueVal });

						if (trigger.action === 'webhook' && trigger.webhook_url) {
							webhookPromises.push(
								fetch(trigger.webhook_url, {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({
										event: 'due',
										collection: trigger.collection_slug,
										item_id: item.id,
										due_date: dueVal,
										checked_at: now,
									}),
								})
									.then(() => {})
									.catch(() => {}),
							);
						}
						if (trigger.action === 'notify') {
							console.log(
								JSON.stringify({ type: 'calendar_notify', collection: trigger.collection_slug, item_id: item.id, due_date: dueVal }),
							);
						}
					}
				}

				// Fire webhooks in background after response is sent (Cloudflare Workers waitUntil)
				if (webhookPromises.length > 0) {
					c.executionCtx.waitUntil(Promise.allSettled(webhookPromises));
				}

				return success(c, { checked_at: new Date().toISOString(), triggers_checked: triggers.length, overdue_found: fired.length, fired });
			});

			return { routes: [{ path: '/api/calendar', handler: app as unknown as Hono }] };
		},
	};
}
