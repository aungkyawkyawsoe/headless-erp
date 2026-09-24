/**
 * GDPR Plugin — data-subject erasure with an audit trail.
 *
 * Routes (admin):
 *   POST /api/gdpr/erasure   { subject, piiField, collections?, mode?, dryRun? }
 *   GET  /api/gdpr/requests  (?limit=) — erasure history for compliance
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { GdpRService } from '@mmbix/gdpr';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import type { AuthContext } from '@/lib/services/auth.service';
import { success, fail } from '@/lib/api/response';

export function gdprPlugin(): Plugin {
	return {
		id: 'gdpr',
		name: 'GDPR Data-Subject Erasure',
		version: '1.0.0',
		migrations: [
			{
				name: '033_gdpr',
				up: [
					{
						sql: `CREATE TABLE IF NOT EXISTS _gdpr_requests (id TEXT PRIMARY KEY, subject TEXT NOT NULL, pii_field TEXT NOT NULL, mode TEXT NOT NULL, collections_json TEXT, dry_run INTEGER NOT NULL DEFAULT 0, matched_total INTEGER NOT NULL DEFAULT 0, actions_json TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL)`,
						bindings: [],
					},
				],
			},
		],
		register(_ctx: PluginContext): PluginRegistration {
			const app = new Hono<{ Bindings: { DB: D1Database }; Variables: { auth: AuthContext } }>();
			app.use('*', requireAuth);
			const svc = (c: Context) => new GdpRService(new D1Client((c.env as { DB: D1Database }).DB as D1Database));

			app.post('/erasure', requireAdmin, async (c) => {
				const body = (await c.req.json()) as {
					subject?: string;
					piiField?: string;
					collections?: string[];
					mode?: 'anonymize' | 'delete';
					dryRun?: boolean;
				};
				if (!body.subject || !body.piiField) {
					return fail(c, 'subject and piiField are required', 400);
				}
				try {
					const result = await svc(c).erase(body as { subject: string; piiField: string });
					return success(c, result);
				} catch (err) {
					return fail(c, err instanceof Error ? err.message : String(err), 400);
				}
			});

			app.get('/requests', requireAdmin, async (c) => {
				return success(c, await svc(c).listRequests(Number(c.req.query('limit') ?? 50)));
			});

			return { routes: [{ path: '/api/gdpr', handler: app as unknown as Hono }] };
		},
	};
}
