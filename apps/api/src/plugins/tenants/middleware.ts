/**
 * Tenant Middleware — Multi-tenancy enabler
 *
 * Extracts X-Tenant-Id from request headers.
 * Entity queries auto-skip tenant filter when no header present.
 */
import { createMiddleware } from 'hono/factory';
import type { MiddlewareHandler } from 'hono';

export const tenantMiddleware: MiddlewareHandler = createMiddleware(async (c, next) => {
	const tenantId = c.req.header('X-Tenant-Id') || 'default';
	c.set('tenant', { id: tenantId });
	await next();
});
