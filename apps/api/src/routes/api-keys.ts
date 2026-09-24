/**
 * API Keys Routes — /api/api-keys (admin only)
 *
 *   GET    /api/api-keys        — list keys (never the hash/plaintext)
 *   POST   /api/api-keys        — create { name, user_id, role_id? } → plaintext ONCE
 *   DELETE /api/api-keys/:id    — revoke
 */
import { Hono, type Context } from 'hono';
import { D1Client, MigrationRunner } from '@mmbix/core';
import { ApiKeyService } from '@/lib/services/api-key.service';
import { requireAuth } from './auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';
import type { AuthContext } from '@/lib/services/auth.service';

const app = new Hono<{ Variables: { auth: AuthContext } }>();
app.use('*', requireAuth);

function getService(c: Context): ApiKeyService {
	return new ApiKeyService(new D1Client(c.env.DB));
}

async function ensureMigrations(c: Context) {
	await new MigrationRunner(new D1Client(c.env.DB)).runPending();
}

app.get('/', requireAdmin, async (c) => {
	await ensureMigrations(c);
	const keys = await getService(c).list();
	return success(c, keys);
});

app.post('/', requireAdmin, async (c) => {
	await ensureMigrations(c);
	const body = await c.req.json().catch(() => null);
	const name = String(body?.name ?? '').trim();
	const userId = String(body?.user_id ?? '').trim();
	if (!name) return fail(c, 'name is required', 400);
	if (!userId) return fail(c, "user_id is required (the key acts on this user's behalf)", 400);
	const roleId = body?.role_id ? String(body.role_id) : null;
	const created = await getService(c).create({ name, user_id: userId, role_id: roleId });
	return success(c, created, 201);
});

app.delete('/:id', requireAdmin, async (c) => {
	await ensureMigrations(c);
	const id = c.req.param('id');
	const ok = await getService(c).revoke(id);
	if (!ok) return fail(c, 'Key not found', 404);
	return success(c, { id, revoked: true });
});

export { app as apiKeyRoutes };
