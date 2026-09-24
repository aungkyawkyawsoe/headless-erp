/**
 * Field Audit Plugin — per-field change log (data lineage) + query route.
 *
 *   GET /api/audit/fields/:collection/:documentId[?field=name]
 *
 * Rows are written by the entity pipeline (collection-mutation.service.ts)
 * when the collection opts in (audit_enabled=true). Combined with workflow
 * history + decision-rule audit, this answers "where did this value come
 * from, who set it, when?" — enterprise-grade data lineage.
 *
 * Bundle impact: ~2KB
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono } from 'hono';
import { D1Client } from '@mmbix/core';
import { requireAuth } from '@/routes/auth';
import { FieldAuditService } from '@/lib/services/field-audit.service';
import type { AuthContext } from '@/lib/services/auth.service';
import { success } from '@/lib/api/response';

export function fieldAuditPlugin(): Plugin {
	return {
		id: 'field-audit',
		name: 'Field Audit (per-field data lineage)',
		version: '1.0.0',
		migrations: [
			{
				name: '025_field_audit',
				up: [
					{
						sql: `CREATE TABLE IF NOT EXISTS _field_audit (
							id TEXT PRIMARY KEY,
							collection_slug TEXT NOT NULL,
							document_id TEXT NOT NULL,
							field TEXT NOT NULL,
							value_from TEXT,
							value_to TEXT,
							by_user TEXT,
							source TEXT NOT NULL DEFAULT 'update',
							created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
						)`,
						bindings: [],
					},
					{
						sql: `CREATE INDEX IF NOT EXISTS idx_field_audit_doc ON _field_audit (collection_slug, document_id, field)`,
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

			// ─── Lineage for one document ──────────────────
			app.get('/fields/:collection/:documentId', async (c) => {
				const db = new D1Client((c.env as { DB: D1Database }).DB as D1Database);
				const svc = new FieldAuditService(db);
				const lineage = await svc.getLineage(c.req.param('collection'), c.req.param('documentId'), c.req.query('field') || undefined);
				return success(c, lineage);
			});

			return { routes: [{ path: '/api/audit', handler: app as unknown as Hono }] };
		},
	};
}
