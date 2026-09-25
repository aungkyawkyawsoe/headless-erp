/**
 * API Keys Routes — /api/api-keys (admin only)
 *
 *   GET    /api/api-keys        — list keys (never the hash/plaintext; includes expires_at)
 *   POST   /api/api-keys        — create { name, user_id, role_id?, scope?, expires_at? } → plaintext ONCE
 *   DELETE /api/api-keys/:id    — revoke
 */
import { Hono, type Context } from 'hono';
import { D1Client, MigrationRunner } from '@mmbix/core';
import { ApiKeyService } from '@/lib/services/api-key.service';
import { requireAuth } from './auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';
import { securityAudit, SECURITY_COLLECTIONS } from '@/lib/services/security-audit';
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
	const scopeRaw = body?.scope === undefined ? 'read' : String(body.scope);
	if (!['read', 'write', 'admin'].includes(scopeRaw)) {
		return fail(c, 'scope must be one of: read, write, admin', 400);
	}
	// Optional expiry. Absent/null/'' = NEVER expires (the non-breaking default —
	// inventing an implicit TTL would silently expire keys that work today). A
	// provided value must be a parseable timestamp in the FUTURE; a past or
	// unparseable one is a canonical 400, not a key that can never authenticate.
	let expiresAt: string | null = null;
	if (body?.expires_at !== undefined && body?.expires_at !== null && String(body.expires_at).trim() !== '') {
		const parsed = Date.parse(String(body.expires_at));
		if (!Number.isFinite(parsed)) return fail(c, 'expires_at must be a parseable ISO timestamp', 400);
		if (parsed <= Date.now()) return fail(c, 'expires_at must be in the future (or omit it to never expire)', 400);
		expiresAt = new Date(parsed).toISOString();
	}
	const created = await getService(c).create({
		name,
		user_id: userId,
		role_id: roleId,
		scope: scopeRaw as 'read' | 'write' | 'admin',
		expires_at: expiresAt,
	});
	// 🔒 The plaintext key is returned ONCE to the caller and is NEVER recorded —
	// only the non-secret metadata that makes the grant attributable (who, what
	// name, which scope, on whose behalf).
	securityAudit(c, {
		collection: SECURITY_COLLECTIONS.apiKeys,
		action: 'grant',
		document_id: created.id,
		user_id: c.get('auth')?.user_id ?? null,
		changes: { name: created.name, scope: created.scope, user_id: created.user_id, role_id: roleId, expires_at: created.expires_at },
	});
	return success(c, created, 201);
});

app.delete('/:id', requireAdmin, async (c) => {
	await ensureMigrations(c);
	const id = c.req.param('id');
	const ok = await getService(c).revoke(id);
	if (!ok) return fail(c, 'Key not found', 404);
	securityAudit(c, {
		collection: SECURITY_COLLECTIONS.apiKeys,
		action: 'revoke',
		document_id: id,
		user_id: c.get('auth')?.user_id ?? null,
		changes: { revoked: true },
	});
	return success(c, { id, revoked: true });
});

export { app as apiKeyRoutes };
