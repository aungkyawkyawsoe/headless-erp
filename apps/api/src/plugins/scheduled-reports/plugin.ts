/**
 * Scheduled Reports Plugin
 *
 * Schedule recurring reports, auto-generate and download.
 *
 *   POST   /api/reports/schedule           → Schedule
 *   GET    /api/reports/schedule            → List
 *   DELETE /api/reports/schedule/:id        → Delete
 *   POST   /api/reports/schedule/:id/generate → Generate now
 *
 * Bundle impact: ~3KB
 */
import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono } from 'hono';
import { D1Client } from '@mmbix/core';
import { ExportImportService } from '@/lib/services/export.service';
import { MigrationRunner } from '@mmbix/core';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';

interface ReportSchedule {
	id?: string;
	name: string;
	collection_slug: string;
	format: 'json' | 'csv';
	cron: string;
	group_by?: string;
	aggregate?: string;
	filter_json?: string;
	enabled?: boolean;
	last_run?: string;
	created_at?: string;
}

export function scheduledReportsPlugin(): Plugin {
	return {
		id: 'scheduled-reports',
		name: 'Scheduled Reports',
		version: '1.0.0',
		migrations: [
			{
				name: '009_scheduled_reports',
				up: [
					{
						sql: `CREATE TABLE IF NOT EXISTS _report_schedules (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, collection_slug TEXT NOT NULL,
          format TEXT DEFAULT 'json', cron TEXT NOT NULL, group_by TEXT,
          aggregate TEXT, filter_json TEXT, enabled INTEGER DEFAULT 1,
          last_run TEXT, created_at TEXT DEFAULT (datetime('now'))
        )`,
						bindings: [],
					},
				],
			},
		],
		register(_ctx: PluginContext): PluginRegistration {
			type ScheduledReportsEnv = {
				Bindings: { DB: D1Database; ADMIN_PASSWORD: string };
				Variables: { auth: import('@/lib/services/auth.service').AuthContext };
			};
			const app = new Hono<ScheduledReportsEnv>();
			app.use('*', requireAuth);
			app.use('*', requireAdmin);

			app.post('/schedule', async (c) => {
				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				await new MigrationRunner(db).runPending();
				const body = (await c.req.json()) as ReportSchedule;
				if (!body.name || !body.collection_slug || !body.cron) return fail(c, 'name, collection_slug, cron required', 400);
				const id = crypto.randomUUID();
				await db.run({
					sql: 'INSERT INTO _report_schedules (id, name, collection_slug, format, cron, group_by, aggregate, filter_json, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
					bindings: [
						id,
						body.name,
						body.collection_slug,
						body.format ?? 'json',
						body.cron,
						body.group_by ?? null,
						body.aggregate ?? null,
						body.filter_json ?? null,
						1,
					],
				});
				return success(c, { id, ...body }, 201);
			});

			app.get('/schedule', async (c) => {
				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				await new MigrationRunner(db).runPending();
				const schedules = await db.all<ReportSchedule>({ sql: 'SELECT * FROM _report_schedules ORDER BY created_at DESC', bindings: [] });
				return success(c, schedules);
			});

			app.delete('/schedule/:id', async (c) => {
				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				await new MigrationRunner(db).runPending();
				await db.run({ sql: 'DELETE FROM _report_schedules WHERE id = ?', bindings: [c.req.param('id')] });
				return success(c, { deleted: true });
			});

			app.post('/schedule/:id/generate', async (c) => {
				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				await new MigrationRunner(db).runPending();
				const schedule = await db.first<ReportSchedule>({
					sql: 'SELECT * FROM _report_schedules WHERE id = ?',
					bindings: [c.req.param('id')],
				});
				if (!schedule) return fail(c, 'Schedule not found', 404);

				const exportSvc = new ExportImportService(db);
				const exportData = await exportSvc.exportCollection(schedule.collection_slug, { format: schedule.format, limit: 10000 });

				await db.run({ sql: 'UPDATE _report_schedules SET last_run = ? WHERE id = ?', bindings: [new Date().toISOString(), schedule.id] });

				if (schedule.format === 'csv') {
					return c.newResponse(exportData, 200, {
						'Content-Type': 'text/csv',
						'Content-Disposition': `attachment; filename="${schedule.collection_slug}_${new Date().toISOString().split('T')[0]}.csv"`,
					});
				}
				return success(c, { schedule: schedule.name, generated_at: new Date().toISOString(), data: JSON.parse(exportData) });
			});

			return { routes: [{ path: '/api/scheduled-reports', handler: app as unknown as Hono }] };
		},
	};
}
