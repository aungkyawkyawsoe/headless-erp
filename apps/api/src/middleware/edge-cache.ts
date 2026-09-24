/**
 * Edge Cache Middleware
 *
 * Sets Cache-Control headers on GET /api/entities/* responses.
 *
 * Security (corrected strategy): every entity endpoint is authenticated and
 * row-filtered (RBAC), and Cloudflare's CDN does NOT honor `Vary: Authorization`
 * for the Authorization header — a shared `public` cache could therefore serve
 * one user's filtered rows to another for up to the s-maxage TTL. So:
 *   - Authenticated responses → `private, no-store` (never enter a shared cache)
 *   - Anonymous responses only → short public cache (public, max-age=5, s-maxage=30)
 *
 * Entity routes are always authenticated, so in practice the shared cache is
 * disabled; the public branch exists only for genuinely anonymous GET responses.
 */

import { createMiddleware } from 'hono/factory';

/**
 * Cache-Control middleware for GET endpoints.
 * Writes are never cached — only safe, idempotent GET requests.
 */
export const edgeCache = () =>
	createMiddleware(async (c, next) => {
		await next();

		// Only cache successful GET responses
		if (c.req.method !== 'GET') return;
		if (c.res.status !== 200) return;

		// Skip if the caller already set Cache-Control (e.g. private data, auth responses)
		if (c.res.headers.has('Cache-Control')) return;

		// Authenticated (requireAuth sets c.get('auth')) → never share in a public
		// cache. The CDN ignores Vary: Authorization, so a shared cache could leak
		// one user's RBAC-filtered rows to another user.
		const auth = c.get('auth') as { user_id?: string } | undefined;
		if (auth?.user_id) {
			c.res.headers.set('Cache-Control', 'private, no-store');
			return;
		}

		// Anonymous response — short public cache only.
		c.res.headers.set('Cache-Control', 'public, max-age=5, s-maxage=30');
	});
