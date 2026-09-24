/**
 * KPI Plugin — metric registry (SVOT) + materialized values.
 *
 * Routes (all auth required, writes admin-only):
 *   GET    /api/kpis                    → list (?collection=slug)
 *   POST   /api/kpis                    → create/upsert (validated)
 *   GET    /api/kpis/:id                → get one
 *   PUT    /api/kpis/:id                → update (version bumps)
 *   DELETE /api/kpis/:id                → remove (values too)
 *   POST   /api/kpis/:id/compute        → materialize now (on-demand)
 *   GET    /api/kpis/:id/data           → materialized values (?period_from=&period_to=&limit=)
 *
 * The nightly scheduled handler (src/index.ts, cron 30 3 * * *) recomputes
 * every KPI with schedule='daily'. Dashboards read _kpi_values — pre-computed,
 * O(log n) per KPI, and always the same numbers for the same definition (SVOT).
 *
 * Bundle impact: ~5KB
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { ValidationError } from '@mmbix/utils';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { KpiService } from './service';
import { clampPageSize, DEFAULT_PAGE_SIZE } from '@/lib/api/page-size';
import type { KpiDefinition } from './service';
import type { AuthContext } from '@/lib/services/auth.service';
import { success, fail } from '@/lib/api/response';

export function kpiPlugin(): Plugin {
	return {
		id: 'kpi',
		name: 'KPI Registry (metric definitions + materialized values)',
		version: '1.0.0',
		migrations: [
			{
				name: '024_kpis',
				up: [
					{
						sql: `CREATE TABLE IF NOT EXISTS _kpis (
							id TEXT PRIMARY KEY,
							name TEXT NOT NULL,
							collection TEXT NOT NULL,
							definition_json TEXT NOT NULL,
							enabled INTEGER NOT NULL DEFAULT 1,
							version INTEGER NOT NULL DEFAULT 1,
							created_at TEXT NOT NULL,
							updated_at TEXT NOT NULL
						)`,
						bindings: [],
					},
					{
						sql: `CREATE TABLE IF NOT EXISTS _kpi_values (
							id TEXT PRIMARY KEY,
							kpi_id TEXT NOT NULL,
							period_key TEXT NOT NULL DEFAULT 'all',
							group_key TEXT NOT NULL DEFAULT 'all',
							value REAL NOT NULL DEFAULT 0,
							computed_at TEXT NOT NULL,
							UNIQUE (kpi_id, period_key, group_key)
						)`,
						bindings: [],
					},
					{
						sql: `CREATE INDEX IF NOT EXISTS idx_kpi_values_kpi ON _kpi_values (kpi_id, period_key)`,
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
			const svc = (c: Context) => new KpiService(getDb(c));

			// ─── List ─────────────────────────────────────
			app.get('/', async (c) => {
				const list = await svc(c).list(c.req.query('collection') || undefined);
				return success(c, list);
			});

			// ─── Create / upsert ──────────────────────────
			app.post('/', requireAdmin, async (c) => {
				const body = (await c.req.json()) as KpiDefinition & { id?: string };
				svc(c).validate(body); // fail fast at save time
				const saved = await svc(c).upsert(body, body.id);
				const row = await svc(c).get(saved.id);
				return success(c, { ...row, version: saved.version }, 201);
			});

			// ─── Get one ──────────────────────────────────
			app.get('/:id', async (c) => {
				const row = await svc(c).get(c.req.param('id'));
				if (!row) return fail(c, 'KPI not found', 404);
				return success(c, row);
			});

			// ─── Update ───────────────────────────────────
			app.put('/:id', requireAdmin, async (c) => {
				const existing = await svc(c).get(c.req.param('id'));
				if (!existing) return fail(c, 'KPI not found', 404);
				const body = (await c.req.json()) as Partial<KpiDefinition>;
				const next: KpiDefinition = { ...existing.definition, ...body };
				svc(c).validate(next);
				const saved = await svc(c).upsert(next, existing.id);
				const row = await svc(c).get(saved.id);
				return success(c, { ...row, version: saved.version });
			});

			// ─── Delete ───────────────────────────────────
			app.delete('/:id', requireAdmin, async (c) => {
				await svc(c).remove(c.req.param('id'));
				return success(c, { deleted: true });
			});

			// ─── Compute now (on-demand materialization) ──
			app.post('/:id/compute', async (c) => {
				const row = await svc(c).get(c.req.param('id'));
				if (!row) return fail(c, 'KPI not found', 404);
				if (row.enabled !== 1) return fail(c, 'KPI is disabled', 400);
				try {
					const result = await svc(c).compute(row);
					return success(c, result);
				} catch (err) {
					throw new ValidationError(`KPI compute failed: ${err instanceof Error ? err.message : String(err)}`);
				}
			});

			// ─── Materialized values (BI read path) ───────
			app.get('/:id/data', async (c) => {
				const row = await svc(c).get(c.req.param('id'));
				if (!row) return fail(c, 'KPI not found', 404);
				const values = await svc(c).getData(c.req.param('id'), {
					period_from: c.req.query('period_from') || undefined,
					period_to: c.req.query('period_to') || undefined,
					// Page-size policy (enterprise): default 25, max 100 (page-size.ts).
					limit: clampPageSize(Number(c.req.query('limit') ?? '') || DEFAULT_PAGE_SIZE),
				});
				return success(c, { kpi: row.name, definition: row.definition, values });
			});

			return { routes: [{ path: '/api/kpis', handler: app as unknown as Hono }] };
		},
	};
}
