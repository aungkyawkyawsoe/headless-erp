/** Rate-limit tiers — canonical definition (in-memory + Durable-Object limiters share this). */
import type { Context } from 'hono';

export const RATE_LIMIT_TIERS = {
	anonymous: { window: 60, max: 100 },
	authenticated: { window: 60, max: 300 },
	admin: { window: 60, max: 1000 },
} as const;

export type RateTier = keyof typeof RATE_LIMIT_TIERS;

/** Dev-mode permissive ceiling — applied to EVERY tier (matches the DO limiter). */
export const DEV_RATE_LIMIT_MAX = 10_000;

/** Effective config for a tier: permissive in dev, prod values otherwise. */
export function rateLimitConfigFor(tier: RateTier, isDev: boolean): { window: number; max: number } {
	const base = RATE_LIMIT_TIERS[tier];
	return isDev ? { window: base.window, max: DEV_RATE_LIMIT_MAX } : { window: base.window, max: base.max };
}

/**
 * True when the request originates from the local machine.
 *
 * The `dev-token` full-admin bypass (requireAuth + the rate-limiter's tier
 * resolution) must NEVER be accepted from a non-local Host — otherwise anyone
 * who learns the dev token could authenticate against a `wrangler dev --remote`
 * or internet-reachable deployment. Real HTTP requests ALWAYS carry a Host
 * header (HTTP/1.1 requires it, HTTP/2/3 always send :authority), so an absent
 * Host can only come from synthetic/in-process dispatch (e.g. the test pool) —
 * treat that as local rather than breaking dev tooling.
 */
export function isLocalDevRequest(c: Context): boolean {
	const host = c.req.header('host') || '';
	return host === '' || /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(host);
}
