/**
 * Idempotency Plugin — Stripe-style Idempotency-Key support for entity writes.
 *
 * The middleware factory (`idempotencyMiddleware`) is applied to write routes
 * in src/index.ts (scoped to /api/entities/*). A keyed request runs exactly
 * once; replays get the cached 2xx response. Concurrent same-key requests get
 * 409 until the first completes.
 *
 * Routes (admin):
 *   GET  /api/idempotency/keys?key=…   → cached entry metadata (no bodies)
 *   POST /api/idempotency/prune?days=7 → delete expired entries
 *
 * Table `_idempotency_keys` is declared here for pre-provisioning; the package
 * also self-heals with idempotent DDL.
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { D1Client } from '@mmbix/core';
import { IdempotencyService, IdempotencyConflictError } from '@mmbix/idempotency';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { sha256Hex } from '@/lib/services/api-key.service';
import type { AuthContext } from '@/lib/services/auth.service';
import { success, fail } from '@/lib/api/response';

/** Internal signal — the downstream response must not be cached. */
class NoCacheSignal extends Error {}

const SAFE_HEADERS = ['content-type', 'etag', 'location'];

function pickResponseHeaders(headers: Headers): Record<string, string> {
	const out: Record<string, string> = {};
	for (const name of SAFE_HEADERS) {
		const value = headers.get(name);
		if (value) out[name] = value;
	}
	return out;
}

/**
 * Wrap a request with idempotency semantics:
 *   - no Idempotency-Key or a read method → passthrough
 *   - first call runs; the 2xx response is cached (status, safe headers, body)
 *   - replay with the same key → cached response (no re-run)
 *   - concurrent same-key call → 409
 *   - non-2xx responses are never cached (retry re-runs)
 */
export function idempotencyMiddleware(): MiddlewareHandler {
	return async (c, next) => {
		const key = c.req.header('Idempotency-Key');
		if (!key) return next();
		if (['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(c.req.method)) return next();
		if (key.length < 8 || key.length > 255) {
			return fail(c, 'Idempotency-Key must be 8-255 characters', 400);
		}

		const svc = new IdempotencyService(new D1Client((c.env as { DB: D1Database }).DB));
		// Auth-scoped scope key: a different user replaying the same key must never
		// receive the first user's cached response. This middleware runs BEFORE
		// requireAuth, so the identity is fingerprinted from the bearer token
		// (SHA-256 — never stored in plaintext). Anonymous requests keep the
		// method|path|key scope.
		let scope = `${c.req.method}|${c.req.path}|${key}`;
		const authHeader = c.req.header('Authorization') || '';
		if (authHeader.startsWith('Bearer ') && authHeader.length > 7) {
			scope += `|auth:${await sha256Hex(authHeader)}`;
		}

		try {
			const result = await svc.run<{ status: number; headers: Record<string, string>; body: string }>(
				scope,
				async () => {
					await next();
					const res = c.res;
					if (res.status >= 200 && res.status < 300) {
						return {
							status: res.status,
							headers: pickResponseHeaders(res.headers),
							body: await res.clone().text(),
						};
					}
					throw new NoCacheSignal();
				},
				{ recordFailures: false },
			);

			if (result.replayed) {
				const cached = result.value;
				c.res = new Response(cached.body, { status: cached.status, headers: cached.headers });
			}
		} catch (err) {
			if (err instanceof NoCacheSignal) return; // response already written — don't cache
			if (err instanceof IdempotencyConflictError) {
				return fail(c, err.message, 409);
			}
			throw err;
		}
	};
}

export function idempotencyPlugin(): Plugin {
	return {
		id: 'idempotency',
		name: 'Idempotency (Stripe-style keys)',
		version: '1.0.0',
		migrations: [
			{
				name: '029_idempotency',
				up: [
					{
						sql: `CREATE TABLE IF NOT EXISTS _idempotency_keys (key TEXT PRIMARY KEY, status TEXT NOT NULL, response_json TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
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

			// Metadata for a specific key (never response bodies — privacy).
			app.get('/keys', requireAdmin, async (c) => {
				const key = c.req.query('key');
				if (!key) return fail(c, '?key= is required', 400);
				const svc = new IdempotencyService(getDb(c));
				const entry = await svc.get(key);
				if (!entry) return success(c, null);
				return success(c, entry);
			});

			app.post('/prune', requireAdmin, async (c) => {
				const days = Math.max(Number(c.req.query('days') ?? 7) || 7, 1);
				const pruned = await new IdempotencyService(getDb(c)).pruneExpired(days);
				return success(c, { pruned });
			});

			return { routes: [{ path: '/api/idempotency', handler: app as unknown as Hono }] };
		},
	};
}
