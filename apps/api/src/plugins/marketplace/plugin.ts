/**
 * Plugin Marketplace — install, configure and test plugins from the database.
 *
 * Routes (all auth required, writes admin-only):
 *   GET    /api/marketplace/plugins             → list (?event=invoices.before_insert)
 *   POST   /api/marketplace/plugins             → install / upsert a plugin
 *   GET    /api/marketplace/plugins/:id         → get one
 *   PUT    /api/marketplace/plugins/:id         → update (manifest, enabled)
 *   DELETE /api/marketplace/plugins/:id         → uninstall
 *   POST   /api/marketplace/plugins/:id/test    → dry-run against a sample doc
 *
 * The chain itself runs automatically inside the entity pipeline
 * (collection-mutation.service.ts) — install here, and every write fires it.
 *
 * Bundle impact: ~4KB
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { MarketplaceRegistry, type MarketplacePluginInput } from './registry';
import { runForEvent, invalidateChainCache } from './chain';
import type { AuthContext } from '@/lib/services/auth.service';
import { success, fail } from '@/lib/api/response';

export function marketplacePlugin(): Plugin {
	return {
		id: 'marketplace',
		name: 'Plugin Marketplace (DB-driven interceptors)',
		version: '1.0.0',
		migrations: [
			{
				name: '020_marketplace',
				up: [
					{
						sql: `CREATE TABLE IF NOT EXISTS _marketplace_plugins (
							id TEXT PRIMARY KEY,
							name TEXT NOT NULL,
							version TEXT NOT NULL,
							description TEXT DEFAULT '',
							manifest_json TEXT NOT NULL,
							hooks_json TEXT NOT NULL DEFAULT '[]',
							execution_mode TEXT NOT NULL DEFAULT 'sandbox',
							bundle_key TEXT,
							enabled INTEGER NOT NULL DEFAULT 1,
							tenant_scope TEXT DEFAULT '',
							created_at TEXT NOT NULL,
							updated_at TEXT NOT NULL
						)`,
						bindings: [],
					},
				],
			},
		],
		register(_ctx: PluginContext): PluginRegistration {
			const app = new Hono<{
				Bindings: { DB: D1Database; BUCKET?: R2Bucket };
				Variables: { auth: AuthContext };
			}>();

			app.use('*', requireAuth);

			const getDb = (c: Context) => new D1Client((c.env as { DB: D1Database }).DB as D1Database);
			const registry = (c: Context) => new MarketplaceRegistry(getDb(c));

			// ─── List ─────────────────────────────────────
			app.get('/plugins', async (c) => {
				const list = await registry(c).list(c.req.query('event') || undefined);
				return success(c, list);
			});

			// ─── Install / upsert ─────────────────────────
			app.post('/plugins', requireAdmin, async (c) => {
				const body = (await c.req.json()) as MarketplacePluginInput;
				const row = await registry(c).install(body);
				invalidateChainCache();
				return success(c, row, 201);
			});

			// ─── Get one ──────────────────────────────────
			app.get('/plugins/:id', async (c) => {
				const row = await registry(c).get(c.req.param('id'));
				if (!row) return fail(c, 'Marketplace plugin not found', 404);
				return success(c, row);
			});

			// ─── Update ───────────────────────────────────
			app.put('/plugins/:id', requireAdmin, async (c) => {
				const body = (await c.req.json()) as Partial<MarketplacePluginInput>;
				const row = await registry(c).update(c.req.param('id'), body);
				invalidateChainCache();
				return success(c, row);
			});

			// ─── Uninstall ────────────────────────────────
			app.delete('/plugins/:id', requireAdmin, async (c) => {
				await registry(c).remove(c.req.param('id'));
				invalidateChainCache();
				return success(c, { deleted: true });
			});

			// ─── Test-run against a sample doc ────────────
			app.post('/plugins/:id/test', async (c) => {
				const auth = c.get('auth');
				const row = await registry(c).get(c.req.param('id'));
				if (!row) return fail(c, 'Marketplace plugin not found', 404);
				const body = (await c.req.json()) as { collection?: string; event?: string; doc?: Record<string, unknown> };
				const collection = body.collection ?? 'sample';
				const event = body.event ?? 'test';
				const result = await runForEvent(collection, event, body.doc ?? {}, getDb(c), auth);
				return success(c, { doc: result, plugin: row.id });
			});

			return { routes: [{ path: '/api/marketplace', handler: app as unknown as Hono }] };
		},
	};
}
