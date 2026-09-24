/**
 * Locks Plugin — distributed mutex over the LockDO binding.
 *
 * Routes:
 *   POST /api/locks/:name/acquire (admin)  { ttlMs? } → { owner, expiresAt } — 409 when held
 *   POST /api/locks/:name/release (admin)  { owner }  → { released }
 *   GET  /api/locks/:name/status  (auth)              → { locked, owner?, expiresAt? }
 *
 * The DO class (`LockDO`) is exported from src/index.ts so the LOCK namespace
 * can be bound. No D1 migration needed — each DO self-heals its storage.
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono, type Context } from 'hono';
import { LockService, LockTimeoutError } from '@mmbix/locks';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import type { AuthContext } from '@/lib/services/auth.service';
import { success, fail } from '@/lib/api/response';

export function locksPlugin(): Plugin {
	return {
		id: 'locks',
		name: 'Distributed Locks (DO-backed mutex)',
		version: '1.0.0',
		register(_ctx: PluginContext): PluginRegistration {
			const app = new Hono<{
				Bindings: { LOCK: DurableObjectNamespace };
				Variables: { auth: AuthContext };
			}>();
			app.use('*', requireAuth);

			const svc = (c: Context) => new LockService(c.env as never);

			// Acquire with a bounded wait — 409 when the lock is held.
			app.post('/:name/acquire', requireAdmin, async (c) => {
				const body = (await c.req.json().catch(() => ({}))) as { ttlMs?: number; timeoutMs?: number };
				try {
					const handle = await svc(c).acquire(c.req.param('name'), {
						ttlMs: Math.min(body.ttlMs ?? 60_000, 3_600_000),
						timeoutMs: Math.min(body.timeoutMs ?? 5_000, 60_000),
					});
					if (!handle) return fail(c, 'lock is held', 409);
					return success(c, { name: handle.name, owner: handle.owner, expiresAt: handle.expiresAt });
				} catch (err) {
					if (err instanceof LockTimeoutError) return fail(c, err.message, 409);
					throw err;
				}
			});

			app.post('/:name/release', requireAdmin, async (c) => {
				const body = (await c.req.json()) as { owner?: string };
				if (!body.owner) return fail(c, 'owner is required', 400);
				const released = await svc(c).release(c.req.param('name'), body.owner);
				if (!released) return fail(c, 'lock not held by this owner', 409);
				return success(c, { released: true });
			});

			app.get('/:name/status', async (c) => success(c, await svc(c).status(c.req.param('name'))));

			return { routes: [{ path: '/api/locks', handler: app as unknown as Hono }] };
		},
	};
}
