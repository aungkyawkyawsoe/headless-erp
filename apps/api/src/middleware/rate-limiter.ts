/**
 * Dynamic Rate Limiting Middleware
 *
 * Per-role and per-endpoint rate limits using in-memory store.
 * Falls back to an eviction-managed Map if no KV/Durable Object binding.
 *
 * Tracking key: `${clientIp}:${userId||'anon'}`
 *
 * Usage:
 *   // Defaults: 100/min anonymous, 300/min authenticated, 1000/min admin
 *   app.use('/api/*', rateLimiter());
 *
 *   // Custom limits for specific role tiers
 *   app.use('/api/*', rateLimiter({
 *     defaults: { anonymous: { window: 60, max: 10 } }
 *   }));
 *
 *   // Per-endpoint override (path prefix, method+path, or bare method)
 *   app.use('/api/bulk/*', rateLimiter({
 *     endpoints: { 'POST': { window: 60, max: 10 } }
 *   }));
 */

import { createMiddleware } from 'hono/factory';
import type { MiddlewareHandler } from 'hono';
import type { Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { rateLimitConfigFor, isLocalDevRequest } from './rate-limit-tiers';
import { fail } from '@/lib/api/response';

// ─── Types ───────────────────────────────────────────────

export interface RateLimitConfig {
	window: number; // Time window in seconds
	max: number; // Max requests in window
}

export interface RateLimiterDefaults {
	anonymous: RateLimitConfig;
	authenticated: RateLimitConfig;
	admin: RateLimitConfig;
}

export interface RateLimiterOptions {
	/** Partial role defaults — missing roles fall back to built-in defaults (deep-merged). */
	defaults?: Partial<RateLimiterDefaults>;

	/**
	 * Per-endpoint overrides matched against the request path + method.
	 *
	 * Keys support three formats:
	 *   'POST'              → matches any path when method is POST
	 *   '/api/bulk'         → matches any method when path starts with /api/bulk
	 *   'POST /api/bulk'    → matches POST + path starts with /api/bulk
	 */
	endpoints?: Record<string, RateLimitConfig>;
}

// ─── In-Memory Store ─────────────────────────────────────

const store = new Map<string, { count: number; resetAt: number }>();
const MAX_STORE_SIZE = 10_000;

/**
 * Evict excess entries when store exceeds MAX_STORE_SIZE.
 * Uses Map iteration order (insertion order ≈ LRU) — no sort needed.
 * Stale entries are cleaned up lazily on access (see store.get below).
 */
function evictOldest(): void {
	if (store.size <= MAX_STORE_SIZE) return;
	const excess = store.size - MAX_STORE_SIZE;
	let deleted = 0;
	for (const key of store.keys()) {
		store.delete(key);
		if (++deleted >= excess) break;
	}
}

/** Clear the in-memory store. Intended for testing only. */
export function clearRateLimitStore(): void {
	store.clear();
}

// ─── Helpers ─────────────────────────────────────────────

async function getRole(c: Parameters<MiddlewareHandler>[0]): Promise<RoleTier> {
	return resolveRateLimitTier(c);
}

function getClientIp(c: Parameters<MiddlewareHandler>[0]): string {
	// CF-Connecting-IP only — X-Forwarded-For is client-spoofable and must never
	// be trusted for rate-limit identity (Cloudflare always sets CF-Connecting-IP).
	return c.req.header('CF-Connecting-IP') || '127.0.0.1';
}

function getUserId(c: Parameters<MiddlewareHandler>[0]): string | null {
	const auth = c.get('auth') as { user_id?: string } | undefined;
	return auth?.user_id ?? null;
}

/**
 * Find a matching endpoint override by checking method and path.
 *
 * Priority (highest first):
 *   1. `METHOD /path` (exact method + path prefix)
 *   2. `/path`         (any method + path prefix)
 *   3. `METHOD`        (method only)
 */
function matchEndpoint(endpoints: Record<string, RateLimitConfig>, method: string, path: string): RateLimitConfig | undefined {
	const candidates: { priority: number; config: RateLimitConfig }[] = [];

	for (const [key, config] of Object.entries(endpoints)) {
		const parts = key.split(/\s+/);
		if (parts.length === 2) {
			// "METHOD /path"
			const [keyMethod, keyPath] = parts;
			if (keyMethod === method && path.startsWith(keyPath)) {
				// More specific path = higher priority
				candidates.push({ priority: 2 + keyPath.length, config });
			}
		} else if (key.startsWith('/')) {
			// "/path"
			if (path.startsWith(key)) {
				candidates.push({ priority: 1 + key.length, config });
			}
		} else {
			// "METHOD"
			if (key === method) {
				candidates.push({ priority: 0, config });
			}
		}
	}

	if (candidates.length === 0) return undefined;
	// Highest priority wins
	candidates.sort((a, b) => b.priority - a.priority);
	return candidates[0].config;
}

// ─── Shared helpers ────────────────────────────────────────

export type RoleTier = 'admin' | 'authenticated' | 'anonymous';

export interface RateLimitCheckResult {
	allowed: boolean;
	count: number;
	limit: number;
	resetAt: number;
}

/**
 * Standalone fixed-window rate check against the shared in-memory store.
 * Used by the middleware below AND by non-Hono callers (e.g. tRPC login).
 * `ns` scopes the counters so independent limiter instances don't share budgets.
 */
export function checkRateLimit(ns: string, ip: string, userId: string | null, config: RateLimitConfig): RateLimitCheckResult {
	const key = `${ns}:${ip}:${userId || 'anon'}`;
	const now = Date.now();
	let entry = store.get(key);
	if (!entry || now > entry.resetAt) {
		entry = { count: 0, resetAt: now + config.window * 1000 };
		store.set(key, entry);
		evictOldest();
	}
	entry.count++;
	return { allowed: entry.count <= config.max, count: entry.count, limit: config.max, resetAt: entry.resetAt };
}

/**
 * Resolve the caller's rate-limit tier.
 *
 * The limiter mounts BEFORE requireAuth, so `c.get('auth')` is normally unset
 * and everyone used to be treated as "anonymous". When an `Authorization:
 * Bearer` header is present we now derive the tier ourselves:
 *   - `dev-token` → admin when IS_DEV === 'true'
 *   - otherwise verify the JWT via AuthService.verifyToken (user + role lookup)
 *   - on any failure → anonymous
 * Public routes (login, media upload-by-token) carry no bearer header → anonymous.
 */
export async function resolveRateLimitTier(c: Context): Promise<RoleTier> {
	const auth = c.get('auth') as { is_admin?: boolean; user_id?: string } | undefined;
	if (auth?.is_admin) return 'admin';
	if (auth?.user_id) return 'authenticated';

	const header = c.req.header('Authorization');
	if (header?.startsWith('Bearer ')) {
		const token = header.slice(7);
		const env = (c.env as Record<string, unknown> | undefined) ?? {};
		const isDev = env.IS_DEV === 'true' || env.IS_DEV === true;
		// dev-token is a FULL-admin bypass — never accept it from a non-local
		// Host (matches requireAuth in routes/auth.ts).
		if (isDev && token === 'dev-token' && isLocalDevRequest(c)) return 'admin';
		try {
			const db = env.DB as D1Database | undefined;
			if (db) {
				const { AuthService } = await import('@/lib/services/auth.service');
				// 🔒 Fail closed: resolveJwtSecret throws in production without an
				// explicit JWT_SECRET — the ADMIN_PASSWORD fallback is dev-only.
				const jwtSecret = AuthService.resolveJwtSecret(env as { JWT_SECRET?: string; ADMIN_PASSWORD?: string; IS_DEV?: string });
				const ctx = await new AuthService(new D1Client(db)).verifyToken(token, jwtSecret, true, env);
				if (ctx?.is_admin) return 'admin';
				if (ctx?.user_id) return 'authenticated';
			}
		} catch {
			// Invalid/expired token → treat as anonymous
		}
	}
	return 'anonymous';
}

// ─── Middleware Factory ──────────────────────────────────

// Each rateLimiter() instance gets its own counter namespace so separate mounts
// (e.g. general /api/* limiter + strict /api/bulk/* limiter) don't share counters.
let instanceSeq = 0;

export function rateLimiter(options?: Partial<RateLimiterOptions>): MiddlewareHandler {
	// Unique namespace for THIS instance
	const ns = `rl${instanceSeq++}`;

	return createMiddleware(async (c, next) => {
		// In dev/test mode, use a permissive default to avoid interfering with other tests
		const env = (c.env as Record<string, unknown> | undefined) ?? {};
		const isDev = env.IS_DEV === 'true' || env.IS_DEV === true;

		// Deep merge defaults — dev permissive ceiling applied to EVERY tier, user options win
		const opts: RateLimiterOptions & { defaults: RateLimiterDefaults } = {
			defaults: {
				anonymous: { ...rateLimitConfigFor('anonymous', isDev), ...options?.defaults?.anonymous },
				authenticated: { ...rateLimitConfigFor('authenticated', isDev), ...options?.defaults?.authenticated },
				admin: { ...rateLimitConfigFor('admin', isDev), ...options?.defaults?.admin },
			},
			endpoints: options?.endpoints,
		};

		const ip = getClientIp(c);
		const userId = getUserId(c);
		const role = await getRole(c);
		const path = c.req.path;
		const method = c.req.method;

		// 1. Start with role-based limit
		let effectiveConfig: RateLimitConfig = opts.defaults[role];

		// 2. Check for a more specific endpoint override
		if (opts.endpoints) {
			const override = matchEndpoint(opts.endpoints, method, path);
			if (override) {
				effectiveConfig = override;
			}
		}

		// 3. Build tracking key: instance + ip + user — each instance has its own budget
		const result = checkRateLimit(ns, ip, userId, effectiveConfig);

		// Set rate limit headers
		c.res.headers.set('X-RateLimit-Limit', String(result.limit));
		c.res.headers.set('X-RateLimit-Remaining', String(Math.max(0, result.limit - result.count)));
		c.res.headers.set('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

		if (!result.allowed) {
			const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
			c.res.headers.set('Retry-After', String(retryAfter));
			c.res = fail(c, `Rate limit exceeded (${role} tier). Retry after ${retryAfter}s.`, 429, 'RATE_LIMIT_EXCEEDED');
			return;
		}

		await next();
	});
}
