/**
 * Security Headers Middleware
 *
 * Applies hardening headers to every response:
 *   - X-Content-Type-Options: nosniff
 *   - X-Frame-Options: DENY
 *   - Referrer-Policy: strict-origin-when-cross-origin
 *   - X-XSS-Protection: 0 (modern guidance — the legacy filter is disabled)
 *   - Permissions-Policy: camera=(), microphone=(), geolocation=()
 *   - Strict-Transport-Security (HSTS) on HTTPS / prod responses (opt-out: { hsts: false })
 *   - Cache-Control: no-store on /api/auth/* (credential endpoints must not be cached)
 *
 * Usage:
 *   app.use('*', securityHeaders());
 *   app.use('*', securityHeaders({ hsts: false })); // e.g. plain-HTTP dev environments
 */

import { createMiddleware } from 'hono/factory';
import type { MiddlewareHandler } from 'hono';

export interface SecurityHeadersOptions {
	/** Emit Strict-Transport-Security on HTTPS/prod responses. Default: true */
	hsts?: boolean;
}

export function securityHeaders(options: SecurityHeadersOptions = {}): MiddlewareHandler {
	const hsts = options.hsts ?? true;

	return createMiddleware(async (c, next) => {
		await next();

		c.res.headers.set('X-Content-Type-Options', 'nosniff');
		c.res.headers.set('X-Frame-Options', 'DENY');
		c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
		c.res.headers.set('X-XSS-Protection', '0');
		c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

		const env = (c.env as Record<string, unknown> | undefined) ?? {};
		const isProd = env.IS_DEV !== 'true' && env.IS_DEV !== true;
		if (hsts && (c.req.url.startsWith('https:') || isProd)) {
			c.res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
		}

		// Login/token endpoints must never be cached by browsers or intermediaries.
		if (c.req.path.startsWith('/api/auth/')) {
			c.res.headers.set('Cache-Control', 'no-store');
		}
	});
}
