/**
 * Data Archival Plugin
 *
 * Move old/deleted records to cold storage (R2) or hard-delete.
 *
 *   POST /api/archive/rules      → Create rule
 *   GET  /api/archive/rules      → List rules
 *   POST /api/archive/run        → Execute archival
 *   GET  /api/archive/status     → Recent jobs
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

interface ArchiveRule {
	id?: string;
	collection_slug: string;
	retention_days: number;
	action: 'move_to_r2' | 'delete';
	enabled?: boolean;
	created_at?: string;
}
interface ArchiveJob {
	id?: string;
	status: string;
	started_at?: string;
	completed_at?: string;
	records_archived?: number;
	records_deleted?: number;
	created_at?: string;
}

export function archivePlugin(): Plugin {
	return {
		id: 'archive',
		name: 'Data Archival',
		version: '1.0.0',
		migrations: [
			{
				name: '010_archive',
				up: [
					{
						sql: `CREATE TABLE IF NOT EXISTS _archive_rules (
          id TEXT PRIMARY KEY, collection_slug TEXT NOT NULL, retention_days INTEGER DEFAULT 365,
          action TEXT DEFAULT 'move_to_r2', enabled INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now'))
        )`,
						bindings: [],
					},
					{
						sql: `CREATE TABLE IF NOT EXISTS _archive_jobs (
          id TEXT PRIMARY KEY, status TEXT DEFAULT 'pending', started_at TEXT,
          completed_at TEXT, records_archived INTEGER DEFAULT 0,
          records_deleted INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
        )`,
						bindings: [],
					},
				],
			},
		],
		register(ctx: PluginContext): PluginRegistration {
			type ArchiveEnv = {
				Bindings: { DB: D1Database; ADMIN_PASSWORD: string };
				Variables: { auth: import('@/lib/services/auth.service').AuthContext };
			};
			const app = new Hono<ArchiveEnv>();
			app.use('*', requireAuth, requireAdmin);

			app.post('/rules', async (c) => {
				const db = new D1Client(c.env.DB);
				await new MigrationRunner(db).runPending();
				const body = (await c.req.json()) as ArchiveRule;
				if (!body.collection_slug || !body.retention_days) return fail(c, 'collection_slug and retention_days required', 400);
				const id = crypto.randomUUID();
				await db.run({
					sql: 'INSERT INTO _archive_rules (id, collection_slug, retention_days, action) VALUES (?, ?, ?, ?)',
					bindings: [id, body.collection_slug, body.retention_days, body.action ?? 'move_to_r2'],
				});
				return success(c, { id, ...body }, 201);
			});

			app.get('/rules', async (c) => {
				const db = new D1Client(c.env.DB);
				await new MigrationRunner(db).runPending();
				const rules = await db.all<ArchiveRule>({
					sql: 'SELECT * FROM _archive_rules WHERE enabled = 1 ORDER BY created_at DESC',
					bindings: [],
				});
				return success(c, rules);
			});

			app.post('/run', async (c) => {
				const db = new D1Client(c.env.DB);
				await new MigrationRunner(db).runPending();
				const rules = await db.all<ArchiveRule>({ sql: 'SELECT * FROM _archive_rules WHERE enabled = 1', bindings: [] });
				const jobId = crypto.randomUUID();
				await db.run({
					sql: 'INSERT INTO _archive_jobs (id, status, started_at, records_archived, records_deleted) VALUES (?, ?, ?, ?, ?)',
					bindings: [jobId, 'running', new Date().toISOString(), 0, 0],
				});

				const results: Array<{ collection: string; archived: number; deleted: number }> = [];
				let totalArchived = 0,
					totalDeleted = 0;

				for (const rule of rules) {
					const cutoff = new Date();
					cutoff.setDate(cutoff.getDate() - rule.retention_days);
					const cutoffIso = cutoff.toISOString().split('T')[0];
					// Get table_name from schema instead of constructing cms_${slug}
					const schema = await db.first<{ table_name: string }>(
						QueryBuilder.from('_entity_schemas').select('table_name').where('slug', rule.collection_slug).toSelect(),
					);
					const validCol = schema?.table_name || '_entity_schemas';

					const records = await db.all<{ id: string; [key: string]: unknown }>({
						sql: `SELECT * FROM "${validCol}" WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT 1000`,
						bindings: [cutoffIso],
					});

					let archived = 0,
						deleted = 0;
					if (rule.action === 'move_to_r2' && ctx.r2) {
						await ctx.r2.put(`archive/${validCol}/${jobId}.json`, JSON.stringify(records));
						for (const rec of records) {
							await db.run({ sql: `DELETE FROM "${validCol}" WHERE id = ?`, bindings: [rec.id] });
							archived++;
						}
					} else {
						for (const rec of records) {
							await db.run({ sql: `DELETE FROM "${validCol}" WHERE id = ?`, bindings: [rec.id] });
							deleted++;
						}
					}
					totalArchived += archived;
					totalDeleted += deleted;
					results.push({ collection: rule.collection_slug, archived, deleted });
				}

				await db.run({
					sql: 'UPDATE _archive_jobs SET status = ?, completed_at = ?, records_archived = ?, records_deleted = ? WHERE id = ?',
					bindings: ['completed', new Date().toISOString(), totalArchived, totalDeleted, jobId],
				});

				return success(c, { job_id: jobId, total_archived: totalArchived, total_deleted: totalDeleted, results });
			});

			app.get('/status', async (c) => {
				const db = new D1Client(c.env.DB);
				await new MigrationRunner(db).runPending();
				const jobs = await db.all<ArchiveJob>({ sql: 'SELECT * FROM _archive_jobs ORDER BY created_at DESC LIMIT 10', bindings: [] });
				const count = await db.first<{ cnt: number }>({
					sql: 'SELECT COUNT(*) as cnt FROM _archive_rules WHERE enabled = 1',
					bindings: [],
				});
				return success(c, { rules_count: count?.cnt ?? 0, recent_jobs: jobs });
			});

			return { routes: [{ path: '/api/archive', handler: app as unknown as Hono }] };
		},
	};
}
