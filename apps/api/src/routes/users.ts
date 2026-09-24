/**
 * User + Role + Permission Management Routes
 *
 * All routes require admin access (system guard).
 *
 * Users:    GET/POST    /api/users
 *           GET/PUT /api/users/:id
 * Roles:    GET/POST    /api/roles
 * Perms:    POST        /api/permissions
 *           GET         /api/permissions/:role_id
 */

import { Hono, type Context } from 'hono';
import { UnauthorizedError } from '@mmbix/utils';
import { D1Client } from '@mmbix/core';
import { AuthService } from '@/lib/services/auth.service';
import { PermissionEvaluator } from '@/lib/services/permission-evaluator';
import { MigrationRunner } from '@mmbix/core';
import { requireAuth } from './auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';
import type { RoleRecord } from '@mmbix/types';

/** Parse a raw role's `app_access` JSON TEXT into an array for the API body
 *  (the DB stores it as TEXT; the public role JSON surfaces it as string[]). */
function parseRoleAppAccess(r: RoleRecord | null): RoleRecord | null {
	if (!r) return null;
	const raw = r.app_access;
	let list: string[] | null = null;
	if (raw != null && raw !== '') {
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) list = parsed.map(String);
		} catch {
			list = null;
		}
	}
	return { ...r, app_access: list as unknown as string | null };
}

type UB = {
	Bindings: { DB: D1Database; ADMIN_USERNAME: string; ADMIN_PASSWORD: string; IS_DEV?: string };
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
};
const app = new Hono<UB>();
app.use('*', requireAuth);

function getAuth(c: Context): AuthService {
	return new AuthService(new D1Client(c.env.DB));
}
function getSecret(c: Context) {
	const s = c.env.ADMIN_PASSWORD;
	if (!s) throw new UnauthorizedError('ADMIN_PASSWORD required');
	return s;
}

async function ensureMigrations(c: Context) {
	await new MigrationRunner(new D1Client(c.env.DB)).runPending();
}

// ─── Roles (Admin Only) ───────────────────────────────

app.get('/roles', requireAdmin, async (c) => {
	await ensureMigrations(c);
	const auth = getAuth(c);
	const roles = await auth.listRoles();
	return success(c, roles.map(parseRoleAppAccess));
});

app.post('/roles', requireAdmin, async (c) => {
	await ensureMigrations(c);
	const auth = getAuth(c);
	const body = await c.req.json();
	const role = await auth.createRole(body);
	// Invalidate cache for new role
	PermissionEvaluator.invalidateAllBusinessCache();
	return success(c, parseRoleAppAccess(role), 201);
});

// Update a role's mini-app launcher app allow-list (Design-B app access).
// Only `app_access` / `description` may change here — `name` stays immutable
// (role names back SYSTEM_GUARDS + tgapp provisioning lookups).
app.put('/roles/:id', requireAdmin, async (c) => {
	await ensureMigrations(c);
	const auth = getAuth(c);
	const id = c.req.param('id');
	const body = await c.req.json();
	let role = await auth.getRole(id);
	if (!role) return fail(c, 'Role not found', 404, 'NOT_FOUND');
	if (body.description !== undefined) role = await auth.updateRoleDescription(id, String(body.description));
	if (body.app_access !== undefined) {
		const apps = Array.isArray(body.app_access) ? body.app_access.map(String) : null;
		await auth.setRoleAppAccess(id, apps);
	}
	role = await auth.getRole(id);
	return success(c, parseRoleAppAccess(role));
});

// ─── Permissions (Admin Only) ──────────────────────────

app.post('/permissions', requireAdmin, async (c) => {
	await ensureMigrations(c);
	const auth = getAuth(c);
	const body = await c.req.json();
	if (!body.role_id) return fail(c, 'role_id is required', 400, 'VALIDATION_ERROR');
	if (!body.collection_slug) return fail(c, 'collection_slug is required', 400, 'VALIDATION_ERROR');
	const perm = await auth.setPermission(body);
	// Invalidate cache for this role
	if (body.role_id) PermissionEvaluator.invalidateBusinessCache(body.role_id);
	return success(c, perm, 201);
});

app.get('/permissions/:role_id', requireAdmin, async (c) => {
	await ensureMigrations(c);
	const auth = getAuth(c);
	const perms = await auth.getPermissions(c.req.param('role_id'));
	return success(c, perms);
});

// ─── Users (Admin Only) ────────────────────────────────

app.get('/', requireAdmin, async (c) => {
	await ensureMigrations(c);
	const auth = getAuth(c);
	const users = await auth.listUsers();
	return success(c, users);
});

app.post('/', requireAdmin, async (c) => {
	await ensureMigrations(c);
	const auth = getAuth(c);
	const body = await c.req.json();
	const user = await auth.createUser(body, getSecret(c));
	return success(c, { id: user.id, email: user.email, full_name: user.full_name }, 201);
});

app.get('/:id', requireAdmin, async (c) => {
	await ensureMigrations(c);
	const auth = getAuth(c);
	const user = await auth.getUser(c.req.param('id'));
	return success(c, user);
});

app.put('/:id', requireAdmin, async (c) => {
	await ensureMigrations(c);
	const auth = getAuth(c);
	const body = await c.req.json();
	const user = await auth.updateUser(c.req.param('id'), body, getSecret(c));
	return success(c, user);
});

export { app as userRoutes };
