/**
 * Server Functions Plugin
 *
 * Declarative JSON hook rules (workerd-safe) that execute on collection
 * lifecycle events (insert, update, delete, validate, change). The legacy
 * user-defined JavaScript `function_code` model is REJECTED — the Workers
 * runtime disallows eval/new Function, so hooks must be declared as rules.
 *
 * API:
 *   GET    /api/server-functions          → List all functions
 *   GET    /api/server-functions?collection=slug → Filter by collection
 *   POST   /api/server-functions          → Create function (rules only)
 *   PUT    /api/server-functions/:id      → Update function (rules only)
 *   DELETE /api/server-functions/:id      → Delete function
 *   POST   /api/server-functions/test     → Test-run rules with sample data
 *
 * Bundle impact: ~3KB
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { DECLARATIVE_TRIGGER_EVENTS } from '@mmbix/types';
import { Hono } from 'hono';
import { D1Client } from '@mmbix/core';
import { ServerFunctionService } from './service';
import { DECLARATIVE_TRIGGER_SQL_LIST } from './types';
import type { ServerFunctionInput, ServerFunctionTestInput } from './types';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';

export function serverFunctionsPlugin(): Plugin {
	return {
		id: 'server-functions',
		name: 'Server-Side Functions (user-defined validation/computation)',
		version: '1.0.0',
		migrations: [
			{
				name: '018_server_functions',
				up: [
					{
						sql: `CREATE TABLE IF NOT EXISTS _server_functions (
							id TEXT PRIMARY KEY,
							name TEXT NOT NULL,
							collection_slug TEXT NOT NULL,
							trigger_event TEXT NOT NULL CHECK(trigger_event IN (${DECLARATIVE_TRIGGER_SQL_LIST})),
							function_code TEXT NOT NULL DEFAULT '',
							enabled INTEGER NOT NULL DEFAULT 1,
							created_at TEXT NOT NULL,
							updated_at TEXT NOT NULL
						)`,
						bindings: [],
					},
				],
			},
			{
				// Ownership marker. `'manifest'` = the control plane's `apply_manifest`
				// created this hook, so an apply that no longer declares it may reconcile
				// (delete) it. Studio/CLI/hand-created hooks stay NULL and are INVISIBLE
				// to reconciliation. Nullable + additive; the plugin runner probes the
				// column, so a re-run on a partially-migrated DB is safe.
				name: '043_server_functions_source',
				up: [{ sql: `ALTER TABLE _server_functions ADD COLUMN source TEXT DEFAULT NULL`, bindings: [] }],
			},
		],
		register(_ctx: PluginContext): PluginRegistration {
			const app = new Hono();

			// Auth required for all routes
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			app.use('*', requireAuth as any, requireAdmin as any);

			// ─── List ─────────────────────────────────
			app.get('/', async (c) => {
				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				const svc = new ServerFunctionService(db);
				const collection = c.req.query('collection');
				const functions = await svc.list(collection || undefined);
				return success(c, functions);
			});

			// ─── Get by ID ────────────────────────────
			app.get('/:id', async (c) => {
				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				const svc = new ServerFunctionService(db);
				const fn = await svc.get(c.req.param('id'));
				if (!fn) return fail(c, 'Server function not found', 404);
				return success(c, fn);
			});

			// ─── Create ───────────────────────────────
			app.post('/', async (c) => {
				const body = (await c.req.json()) as ServerFunctionInput;
				if (!body.name || !body.collection_slug || !body.trigger_event) {
					return fail(c, 'name, collection_slug, and trigger_event are required', 400);
				}
				if (body.function_code) {
					return fail(
						c,
						'Legacy function_code (JavaScript) is not supported — the Workers runtime disallows eval/new Function. Use declarative "rules" instead.',
						400,
						'FUNCTION_CODE_REJECTED',
					);
				}
				if (!body.rules || body.rules.length === 0) {
					return fail(
						c,
						'"rules" (declarative JSON) is required. Legacy function_code (JavaScript) is not supported — the Workers runtime disallows eval/new Function for security. See the server-functions docs for the rules format.',
						400,
						'RULES_REQUIRED',
					);
				}
				const validEvents = DECLARATIVE_TRIGGER_EVENTS;
				if (!validEvents.includes(body.trigger_event)) {
					return fail(c, `Invalid trigger_event. Valid: ${validEvents.join(', ')}`, 400);
				}
				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				const svc = new ServerFunctionService(db);
				// `source` is written ONLY by the manifest reconciler — never forwarded
				// from a client, so a REST-created hook is unmarked (source NULL).
				const created = await svc.create({
					name: body.name,
					collection_slug: body.collection_slug,
					trigger_event: body.trigger_event,
					...(body.rules ? { rules: body.rules } : {}),
					...(body.enabled === undefined ? {} : { enabled: body.enabled }),
				});
				return success(c, created, 201);
			});

			// ─── Update ───────────────────────────────
			app.put('/:id', async (c) => {
				const body = (await c.req.json()) as Partial<ServerFunctionInput>;
				if (body.function_code) {
					return fail(
						c,
						'Legacy function_code (JavaScript) is not supported — the Workers runtime disallows eval/new Function. Use declarative "rules" instead.',
						400,
						'FUNCTION_CODE_REJECTED',
					);
				}
				if (body.trigger_event) {
					const validEvents = DECLARATIVE_TRIGGER_EVENTS;
					if (!validEvents.includes(body.trigger_event)) {
						return fail(c, `Invalid trigger_event. Valid: ${validEvents.join(', ')}`, 400);
					}
				}
				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				const svc = new ServerFunctionService(db);
				const updated = await svc.update(c.req.param('id'), body);
				if (!updated) return fail(c, 'Server function not found', 404);
				return success(c, updated);
			});

			// ─── Delete ───────────────────────────────
			app.delete('/:id', async (c) => {
				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				const svc = new ServerFunctionService(db);
				const deleted = await svc.delete(c.req.param('id'));
				if (!deleted) return fail(c, 'Server function not found', 404);
				return success(c, { deleted: true });
			});

			// ─── Test-run (rules only) ──────────────────
			app.post('/test', async (c) => {
				const body = (await c.req.json()) as ServerFunctionTestInput;
				if (!body.rules || body.rules.length === 0 || !body.doc || !body.collection_slug) {
					return fail(
						c,
						'rules, doc, and collection_slug are required. Legacy function_code (JavaScript) is not supported — the Workers runtime disallows eval/new Function. See the server-functions docs.',
						400,
					);
				}
				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				const svc = new ServerFunctionService(db);
				const result = await svc.test(body);
				return success(c, result);
			});

			return { routes: [{ path: '/api/server-functions', handler: app }] };
		},
	};
}
