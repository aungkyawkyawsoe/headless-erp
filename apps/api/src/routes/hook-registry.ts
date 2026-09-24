/**
 * Code-hook registry introspection — /api/hook-registry
 *
 * Read-only admin surface for the COMPILED lifecycle hooks registered at boot
 * (and at runtime by plugins). Unlike `/api/server-functions` (the DECLARATIVE
 * JSON rules stored in `_server_functions`), these hooks are TypeScript handlers
 * living in the worker — a domain module's denorm/guard hooks, and the
 * `pluginHookRegistry` registrations plugins make via `ctx.hooks.on`. There is
 * no database row to list, so Studio reads this endpoint instead.
 *
 *   GET /api/hook-registry → every registered code hook (no handlers exposed):
 *     { plugin_id, collection, event, description, writes_to, priority, timeout_ms }
 *
 * This is telemetry about registered behavior, not row data — admin-only.
 */

import { Hono } from 'hono';
import { pluginHookRegistry } from '@/core/plugin-hooks';
import { requireAuth } from './auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success } from '@/lib/api/response';
import type { AuthContext } from '@/lib/services/auth.service';

type RegistryBindings = {
	Bindings: { DB: D1Database; [key: string]: unknown };
	Variables: { auth: AuthContext };
};

const app = new Hono<RegistryBindings>();
app.use('*', requireAuth, requireAdmin);

app.get('/', (c) => {
	const meta = pluginHookRegistry.listMeta();
	return success(
		c,
		meta.map((h) => ({
			plugin_id: h.pluginId,
			collection: h.collection,
			event: h.event,
			description: h.description || null,
			writes_to: h.writesTo,
			priority: h.priority,
			timeout_ms: h.timeoutMs,
		})),
	);
});

export const hookRegistryRoutes = app;
