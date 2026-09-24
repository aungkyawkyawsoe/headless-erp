/**
 * Global Rate Limiter — Durable Object backed
 *
 * Provides a cross-isolate, fleet-wide rate limit store so counters are
 * consistent across every instance of the Worker. One DO instance per key
 * (via idFromName) stores a fixed-window bucket counter in KV storage.
 *
 * When the DO binding is not configured (`RATE_LIMIT` missing or
 * `RATE_LIMIT_DO !== 'true'`) the middleware is a no-op passthrough — the
 * caller keeps the in-memory limiter wired as fallback. All DO calls are
 * wrapped so any failure fails open (the limiter never breaks the API).
 *
 * Usage:
 *   app.use('/api/*', rateLimiterDO());
 *
 * Env:
 *   RATE_LIMIT      — Durable Object namespace binding (GlobalRateLimitStore)
 *   RATE_LIMIT_DO   — 'true' to enable the DO-backed limiter
 */

import { createMiddleware } from 'hono/factory';
import type { MiddlewareHandler } from 'hono';
import { RateLimitError } from '@mmbix/utils';
import { resolveRateLimitTier, type RoleTier } from './rate-limiter';
import { rateLimitConfigFor } from './rate-limit-tiers';

// ─── Durable Object Store ───────────────────────────────

interface RateLimitCheck {
	key: string;
	max: number;
	windowSeconds: number;
}

interface RateLimitResult {
	count: number;
	limit: number;
	allowed: boolean;
	/** Epoch seconds when the current window ends */
	resetAt: number;
}

/**
 * Per-key fixed-window counter stored in a Durable Object SQLite table.
 *
 * Keyed per-IP/tier via idFromName, so each limiter key owns a single DO
 * instance whose atomic UPSERT increments are globally consistent.
 * Uses `new_sqlite_classes` (KV-backed DO namespaces are deprecated).
 */
export class GlobalRateLimitStore {
	private sql: SqlStorage;

	constructor(ctx: DurableObjectState) {
		this.sql = ctx.storage.sql;
	}

	async fetch(request: Request): Promise<Response> {
		let payload: RateLimitCheck;
		try {
			payload = (await request.json()) as RateLimitCheck;
		} catch {
			// Malformed request — fail open rather than blocking traffic.
			return Response.json({ count: 0, limit: 0, allowed: true, resetAt: 0 } satisfies RateLimitResult, { status: 400 });
		}

		const { key, max, windowSeconds } = payload;
		const now = Math.floor(Date.now() / 1000);
		const currentWindow = Math.floor(now / windowSeconds);
		const resetAt = (currentWindow + 1) * windowSeconds;

		let count = 0;
		try {
			// Ensure schema (idempotent)
			await this.sql.exec(`CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL)`);

			// Atomic fixed-window increment: same window → count+1, rolled over → reset to 1
			const row = this.sql
				.exec(
					`INSERT INTO rate_limits (key, window, count) VALUES (?, ?, 1)
					 ON CONFLICT(key) DO UPDATE SET
					   count = CASE WHEN rate_limits.window = excluded.window THEN rate_limits.count + 1 ELSE 1 END,
					   window = excluded.window
					 RETURNING count`,
					key,
					currentWindow,
				)
				.one() as unknown as { count?: number } | null;
			count = Number(row?.count ?? 1);
		} catch (err) {
			// Storage failure — fail open so the limiter never breaks the API.
			console.error('[rate-limit-do] storage update failed:', err);
		}

		return Response.json({
			count,
			limit: max,
			allowed: count <= max,
			resetAt,
		} satisfies RateLimitResult);
	}
}

// ─── Middleware ─────────────────────────────────────────

type Tier = RoleTier;

/**
 * Collapse an IP to its rate-limit identity: IPv4 untouched, IPv6 truncated to
 * the /64 prefix (the standard anti-abuse granularity). Handles `::` compression
 * by reconstructing the full 8-group form before slicing the first 4 groups.
 * Non-IP values ('unknown', malformed) pass through unchanged.
 */
function ipv6Prefix64(ip: string): string {
	if (!ip.includes(':')) return ip;
	const [head, tail] = ip.split('::'); // at most one '::'
	const headGroups = head ? head.split(':') : [];
	const tailGroups = tail ? tail.split(':') : [];
	const zeros = Math.max(0, 8 - headGroups.length - tailGroups.length);
	const full = [...headGroups, ...Array(zeros).fill('0'), ...tailGroups];
	return full
		.slice(0, 4)
		.map((g) => g.padStart(4, '0'))
		.join(':');
}

export function rateLimiterDO(): MiddlewareHandler {
	return createMiddleware(async (c, next) => {
		const env = (c.env as Record<string, unknown> | undefined) ?? {};
		const rateLimit = env.RATE_LIMIT as DurableObjectNamespace | undefined;

		// Not enabled — passthrough; the caller keeps the in-memory limiter wired.
		if (!rateLimit || env.RATE_LIMIT_DO !== 'true') {
			await next();
			return;
		}

		// Tiers come from the shared resolver (decodes a Bearer token when the
		// auth middleware hasn't run yet — see middleware/rate-limiter.ts).
		const tier: Tier = await resolveRateLimitTier(c);
		const isDev = env.IS_DEV === 'true' || env.IS_DEV === true;
		// Effective per-tier config — permissive ceiling in dev (matches the
		// in-memory limiter) so local testing / smoke tests are never throttled.
		const tierConfig = rateLimitConfigFor(tier, isDev);
		const ip = c.req.header('CF-Connecting-IP') || 'unknown';
		// 🔒 Instance-proliferation guard (M5): keying a DO per raw IPv6 address
		// lets an attacker rotating addresses within a /64 spawn unbounded DO
		// instances. Collapse IPv6 to its /64 prefix — one instance per real
		// address block, preserving per-IP semantics for IPv4 (and the
		// in-memory limiter keeps exact per-IP accounting as the fast path).
		const key = `rl:${tier}:${ipv6Prefix64(ip)}`;

		try {
			const id = rateLimit.idFromName(key);
			const stub = rateLimit.get(id);
			const res = await stub.fetch('https://ratelimit/check', {
				method: 'POST',
				body: JSON.stringify({ key, max: tierConfig.max, windowSeconds: tierConfig.window }),
			});
			const data = (await res.json()) as RateLimitResult;

			const now = Math.floor(Date.now() / 1000);
			c.res.headers.set('X-RateLimit-Limit', String(data.limit));
			c.res.headers.set('X-RateLimit-Remaining', String(Math.max(0, data.limit - data.count)));
			c.res.headers.set('X-RateLimit-Reset', String(data.resetAt));

			if (!data.allowed) {
				const retryAfter = Math.max(1, data.resetAt - now);
				c.res.headers.set('Retry-After', String(retryAfter));
				throw new RateLimitError(`Rate limit exceeded (${tier} tier). Retry after ${data.resetAt - now}s`);
			}
		} catch (err) {
			// Preserve the deliberate 429 — rethrow only our own error.
			if (err instanceof RateLimitError) throw err;
			// DO failure — fail open so the limiter never breaks the API.
			console.error('[rate-limit-do] check failed, failing open:', err);
		}

		await next();
	});
}
