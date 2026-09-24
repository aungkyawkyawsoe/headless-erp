/**
 * Decision Tables Plugin — Drools-style data-driven business rules.
 *
 * Routes (all auth required, writes admin-only):
 *   GET    /api/decision-tables             → list (?collection=slug)
 *   POST   /api/decision-tables             → create/upsert (validated)
 *   GET    /api/decision-tables/:id         → get one
 *   PUT    /api/decision-tables/:id         → update (version bumps)
 *   DELETE /api/decision-tables/:id         → remove
 *   POST   /api/decision-tables/:id/evaluate → dry-run against a sample doc
 *
 * The pipeline integration lives in collection-mutation.service.ts — every
 * create/update runs the enabled tables for the collection (before validation,
 * after the hook spine + marketplace chain), so rules behave like Odoo/SAP
 * business rules: data-driven, hot-reloadable, audited.
 *
 * Bundle impact: ~5KB
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { DecisionTableService } from './service';
import type { DecisionTableDefinition } from './types';
import type { AuthContext } from '@/lib/services/auth.service';
import { success, fail } from '@/lib/api/response';

export function decisionTablePlugin(): Plugin {
	return {
		id: 'decision-table',
		name: 'Decision Tables (data-driven business rules)',
		version: '1.0.0',
		migrations: [
			{
				name: '023_decision_tables',
				up: [
					{
						sql: `CREATE TABLE IF NOT EXISTS _decision_tables (
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
						sql: `CREATE INDEX IF NOT EXISTS idx_decision_tables_collection ON _decision_tables (collection, enabled)`,
						bindings: [],
					},
					{
						sql: `CREATE TABLE IF NOT EXISTS _decision_rule_audit (
							id TEXT PRIMARY KEY,
							collection_slug TEXT NOT NULL,
							document_id TEXT,
							table_id TEXT,
							rule_id TEXT NOT NULL,
							rule_name TEXT NOT NULL,
							actions_json TEXT NOT NULL,
							by_user TEXT,
							created_at TEXT NOT NULL
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
			const svc = (c: Context) => new DecisionTableService(getDb(c));

			// ─── List ─────────────────────────────────────
			app.get('/', async (c) => {
				const list = await svc(c).list(c.req.query('collection') || undefined);
				return success(c, list);
			});

			// ─── Create / upsert ──────────────────────────
			app.post('/', requireAdmin, async (c) => {
				const body = (await c.req.json()) as DecisionTableDefinition & { id?: string };
				svc(c).validate(body); // fail fast at save time
				const saved = await svc(c).upsert(body, body.id);
				const row = await svc(c).get(saved.id);
				return success(c, { ...row, version: saved.version }, 201);
			});

			// ─── Get one ──────────────────────────────────
			app.get('/:id', async (c) => {
				const row = await svc(c).get(c.req.param('id'));
				if (!row) return fail(c, 'Decision table not found', 404);
				return success(c, row);
			});

			// ─── Update ───────────────────────────────────
			app.put('/:id', requireAdmin, async (c) => {
				const existing = await svc(c).get(c.req.param('id'));
				if (!existing) return fail(c, 'Decision table not found', 404);
				const body = (await c.req.json()) as Partial<DecisionTableDefinition>;
				const next: DecisionTableDefinition = { ...existing.definition, ...body };
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

			// ─── Dry-run against a sample doc ─────────────
			app.post('/:id/evaluate', async (c) => {
				const row = await svc(c).get(c.req.param('id'));
				if (!row) return fail(c, 'Decision table not found', 404);
				const body = (await c.req.json()) as { doc?: Record<string, unknown> };
				const service = svc(c);
				const result = service.evaluateTable(row.definition, body.doc ?? {});
				let doc = body.doc ?? {};
				for (const rule of result.fired) {
					doc = service.applyActions(rule.actions, doc);
				}
				return success(c, {
					fired: result.fired.map((r) => r.name),
					doc,
					note: 'Dry-run — pipeline rules + audit are only applied on real writes.',
				});
			});

			return { routes: [{ path: '/api/decision-tables', handler: app as unknown as Hono }] };
		},
	};
}
