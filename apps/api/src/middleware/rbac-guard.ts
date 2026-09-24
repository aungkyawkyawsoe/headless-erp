/**
 * 🛡️ RBAC Guard Middleware — Business Layer Enforcement
 *
 * Provides:
 *   1. requireAdmin — shorthand for admin-only routes
 *   2. businessGuard(collection, action) — for DB-based collection permissions
 *
 * Usage:
 *   // Admin-only
 *   app.get('/api/users', requireAdmin, handler);
 *
 *   // Business guard (DB-based)
 *   app.post('/api/entities/:collection', businessGuard('c', 'create'), handler);
 */

import { createMiddleware } from 'hono/factory';
import type { MiddlewareHandler } from 'hono';
import { PermissionEvaluator } from '@/lib/services/permission-evaluator';
import { D1Client } from '@mmbix/core';
import type { AuthContext } from '@/lib/services/auth.service';
import { fail } from '@/lib/api/response';

// ─── Types ───────────────────────────────────────────────

type GuardBindings = {
	Bindings: { DB: D1Database; ADMIN_PASSWORD: string };
	Variables: { auth: AuthContext };
};

type RouteContext = { req: { param: (name: string) => string } };

// ─── Admin-Only ──────────────────────────────────────────

/**
 * Shorthand middleware — requires admin role.
 * Use for routes that should ONLY be accessible to administrators.
 */
export const requireAdmin: MiddlewareHandler<GuardBindings> = createMiddleware(async (c, next) => {
	const auth = c.get('auth');
	if (!auth) {
		return fail(c, 'Authentication required', 401, 'UNAUTHORIZED');
	}

	if (!auth.is_admin) {
		return fail(c, 'Admin access required', 403, 'FORBIDDEN');
	}

	await next();
});

// ─── Business Guard ──────────────────────────────────────

/**
 * Business-level guard middleware.
 * Checks DB-based permissions for collection CRUD.
 *
 * @param collectionParam - Route parameter name for collection slug (default: 'collection')
 * @param action - CRUD action ('read', 'write', 'create', 'delete', 'approve', 'submit')
 */
export function businessGuard(
	collectionParam: string = 'collection',
	action: 'read' | 'write' | 'create' | 'delete' | 'approve' | 'submit' = 'read',
): MiddlewareHandler {
	return createMiddleware<GuardBindings>(async (c, next) => {
		const auth = c.get('auth');
		if (!auth) {
			return fail(c, 'Authentication required', 401, 'UNAUTHORIZED');
		}

		// Admin bypass
		if (auth.is_admin) {
			await next();
			return;
		}

		const collectionSlug = (c as unknown as RouteContext).req.param(collectionParam);
		if (!collectionSlug) {
			return fail(c, 'Collection slug required', 400, 'BAD_REQUEST');
		}

		const db = new D1Client(c.env.DB);
		const allowed = await PermissionEvaluator.checkBusiness(db, auth, collectionSlug, action);

		if (!allowed) {
			return fail(c, `You do not have "${action}" permission on "${collectionSlug}"`, 403, 'FORBIDDEN');
		}

		await next();
	});
}

/**
 * Collection read guard with a dynamic slug resolver — for routes that read
 * the collection from the request BODY (e.g. POST /api/reports/execute).
 * Admin bypasses; other users need `read` permission on the collection.
 */
export function requireCollectionRead(
	resolveCollection: (c: import('hono').Context<GuardBindings>) => string | null,
): MiddlewareHandler<GuardBindings> {
	return createMiddleware<GuardBindings>(async (c, next) => {
		const auth = c.get('auth');
		if (!auth) {
			return fail(c, 'Authentication required', 401, 'UNAUTHORIZED');
		}
		if (auth.is_admin) {
			await next();
			return;
		}

		const collectionSlug = resolveCollection(c);
		if (!collectionSlug) {
			return fail(c, 'Collection slug required', 400, 'BAD_REQUEST');
		}

		const db = new D1Client(c.env.DB);
		const allowed = await PermissionEvaluator.checkBusiness(db, auth, collectionSlug, 'read');
		if (!allowed) {
			return fail(c, `You do not have "read" permission on "${collectionSlug}"`, 403, 'FORBIDDEN');
		}

		await next();
	});
}
