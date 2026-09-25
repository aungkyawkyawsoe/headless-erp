/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Security audit — a durable trace for NON-document security events.
 *
 * Sign-ins, machine-key lifecycle and access-control (role/permission) writes are
 * not entity writes, so before this they left NO trace: a brute-force run, a leaked
 * key or a silent privilege grant was invisible after the fact (STRIDE:
 * Repudiation / Information Visibility).
 *
 * They are recorded through the ONE existing trail (`_audit_log`, `AuditService`)
 * under PSEUDO collection slugs (`_auth`, `_api_keys`, `_users`) so they are
 * queryable and distinguishable from entity writes — never a second log.
 *
 * The audit write is fire-and-forget (`ctx.waitUntil`), so these tests POLL for the
 * row rather than assuming it landed synchronously with the response.
 *
 * 🔒 The strongest assertion here is negative: a password or a plaintext API key
 * must NEVER appear anywhere in the stored `changes` — not because the masker
 * catches it, but because it is never handed to the audit at all.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const ADMIN_JSON = { ...JSON_HEADERS, ...ADMIN };

// A user id that need not exist — `POST /api/api-keys` only requires a non-empty one.
const KEY_OWNER = '00000000-0000-4000-8000-00000000c0de';

interface Envelope<T> {
	success: boolean;
	data: T;
	error?: string;
	code?: string;
}

interface AuditRow {
	id: string;
	collection_slug: string;
	document_id: string;
	action: string;
	user_id: string | null;
	changes: string | null;
	timestamp: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `_audit_log` until a matching row lands (the write is fire-and-forget). */
async function waitForAudit(collection: string, action: string, predicate: (row: AuditRow) => boolean = () => true): Promise<AuditRow> {
	const deadline = Date.now() + 5000;
	let seen: AuditRow[] = [];
	while (Date.now() < deadline) {
		const res = await env.DB.prepare('SELECT * FROM _audit_log WHERE collection_slug = ? AND action = ? ORDER BY timestamp DESC, id DESC')
			.bind(collection, action)
			.all<AuditRow>();
		seen = res.results ?? [];
		const hit = seen.find(predicate);
		if (hit) return hit;
		await sleep(50);
	}
	throw new Error(`no _audit_log row for ${collection}/${action}; saw ${JSON.stringify(seen)}`);
}

/** The parsed `changes.fields` payload of an audit row. */
function fieldsOf(row: AuditRow): Record<string, unknown> {
	return (JSON.parse(row.changes ?? '{}') as { fields?: Record<string, unknown> }).fields ?? {};
}

async function login(email: string, password: string) {
	const res = await SELF.fetch(`${BASE_URL}/api/auth/login`, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({ email, password }),
	});
	return {
		status: res.status,
		body: ((await res.json().catch(() => null)) ?? {}) as Envelope<{ token: string; user: { id: string; email: string } }>,
	};
}

/** Create an account with a KNOWN password (never depend on the ambient admin creds). */
async function createUser(email: string, password: string): Promise<string> {
	const res = await SELF.fetch(`${BASE_URL}/api/users`, {
		method: 'POST',
		headers: ADMIN_JSON,
		body: JSON.stringify({ email, password, full_name: 'Security Audit Probe' }),
	});
	const body = (await res.json()) as Envelope<{ id: string }>;
	expect(res.status, body.error ?? '').toBe(201);
	return body.data.id;
}

describe('security audit — durable trace for non-document events', () => {
	it('records a FAILED sign-in under _auth/login_failed (attempted email + outcome, no password)', async () => {
		const attempted = 'no-such-account-security-audit@test.local';
		const attemptedPassword = 'definitely-not-the-password-9Q7x';

		const res = await login(attempted, attemptedPassword);
		expect(res.status, res.body.error ?? '').toBe(401);

		const row = await waitForAudit('_auth', 'login_failed', (r) => r.document_id === attempted);
		expect(row.action).toBe('login_failed');
		expect(row.document_id).toBe(attempted);
		expect(row.user_id).toBeNull();
		const fields = fieldsOf(row);
		expect(fields.email).toBe(attempted);
		expect(fields.outcome).toBe('failure');
		// The attempted password is nowhere in the stored row.
		expect(row.changes ?? '').not.toContain(attemptedPassword);
	});

	it('records a SUCCESSFUL sign-in under _auth/login with the user id as the subject', async () => {
		const email = 'security-audit-login@test.local';
		const password = 'security-audit-login-pass';
		const userId = await createUser(email, password);

		const res = await login(email, password);
		expect(res.status, res.body.error ?? '').toBe(200);
		expect(res.body.data.user.id).toBe(userId);

		const row = await waitForAudit('_auth', 'login', (r) => r.document_id === userId);
		expect(row.action).toBe('login');
		expect(row.document_id).toBe(userId);
		expect(row.user_id).toBe(userId);
		const fields = fieldsOf(row);
		expect(fields.email).toBe(email);
		expect(fields.outcome).toBe('success');
		// Never the password that produced the session.
		expect(row.changes ?? '').not.toContain(password);
	});

	it('records machine-key create (grant) and revoke under _api_keys — never the plaintext key', async () => {
		const created = await SELF.fetch(`${BASE_URL}/api/api-keys`, {
			method: 'POST',
			headers: ADMIN_JSON,
			body: JSON.stringify({ name: 'security-audit-key', user_id: KEY_OWNER, scope: 'read' }),
		});
		const createdBody = (await created.json()) as Envelope<{ id: string; key: string; name: string }>;
		expect(created.status, createdBody.error ?? '').toBe(201);
		const keyId = createdBody.data.id;
		const plaintext = createdBody.data.key;
		expect(plaintext.startsWith('mmk_')).toBe(true);

		const grant = await waitForAudit('_api_keys', 'grant', (r) => r.document_id === keyId);
		expect(grant.user_id).toBeTruthy(); // actor = the admin session
		const grantFields = fieldsOf(grant);
		expect(grantFields.name).toBe('security-audit-key');
		expect(grantFields.scope).toBe('read');
		expect(grantFields.user_id).toBe(KEY_OWNER);
		// 🔒 The plaintext key is returned once and NEVER persisted to the trail.
		expect(grant.changes ?? '').not.toContain(plaintext);
		expect(grantFields.key).toBeUndefined();

		const revoked = await SELF.fetch(`${BASE_URL}/api/api-keys/${keyId}`, { method: 'DELETE', headers: ADMIN });
		expect(revoked.status, ((await revoked.json()) as { error?: string }).error ?? '').toBe(200);

		const revoke = await waitForAudit('_api_keys', 'revoke', (r) => r.document_id === keyId);
		expect(revoke.action).toBe('revoke');
		expect(revoke.user_id).toBeTruthy();
	});

	it('records a role grant AND a permission grant under _users (attributable to the admin)', async () => {
		const roleRes = await SELF.fetch(`${BASE_URL}/api/users/roles`, {
			method: 'POST',
			headers: ADMIN_JSON,
			body: JSON.stringify({ name: `security-audit-role-${Date.now()}` }),
		});
		const roleBody = (await roleRes.json()) as Envelope<{ id: string; name: string }>;
		expect(roleRes.status, roleBody.error ?? '').toBe(201);
		const roleId = roleBody.data.id;

		const roleAudit = await waitForAudit('_users', 'grant', (r) => r.document_id === roleId);
		expect(roleAudit.user_id).toBeTruthy(); // WHO granted
		expect(fieldsOf(roleAudit).kind).toBe('role_created');

		const permRes = await SELF.fetch(`${BASE_URL}/api/users/permissions`, {
			method: 'POST',
			headers: ADMIN_JSON,
			body: JSON.stringify({ role_id: roleId, collection_slug: 'security_audit_widget', can_read: true, can_write: true }),
		});
		const permBody = (await permRes.json()) as Envelope<{ id: string }>;
		expect(permRes.status, permBody.error ?? '').toBe(201);

		const permAudit = await waitForAudit('_users', 'grant', (r) => r.document_id === permBody.data.id);
		expect(permAudit.user_id).toBeTruthy();
		const permFields = fieldsOf(permAudit);
		expect(permFields.kind).toBe('permission_set');
		expect(permFields.role_id).toBe(roleId);
		expect(permFields.collection_slug).toBe('security_audit_widget');
		expect(permFields.can_write).toBe(true);
	});

	it('NEVER persists a password or a plaintext key anywhere in the audit trail', async () => {
		const email = 'security-audit-secret@test.local';
		const probePassword = 'security-audit-secret-password-9Q7x';

		const userId = await createUser(email, probePassword);

		// Exercise every path that COULD leak a secret: a successful sign-in, a failed
		// one, and a key creation. Wait for each audit row to land before scanning, so
		// the negative assertion is not trivially true because nothing was written yet.
		expect((await login(email, probePassword)).status).toBe(200);
		expect((await login(email, `${probePassword}-wrong`)).status).toBe(401);
		await waitForAudit('_auth', 'login', (r) => r.document_id === userId);
		await waitForAudit('_auth', 'login_failed', (r) => r.document_id === email);

		const keyRes = await SELF.fetch(`${BASE_URL}/api/api-keys`, {
			method: 'POST',
			headers: ADMIN_JSON,
			body: JSON.stringify({ name: 'security-audit-secret-key', user_id: KEY_OWNER, scope: 'read' }),
		});
		const keyBody = (await keyRes.json()) as Envelope<{ id: string; key: string }>;
		expect(keyRes.status, keyBody.error ?? '').toBe(201);
		const plaintext = keyBody.data.key;
		await waitForAudit('_api_keys', 'grant', (r) => r.document_id === keyBody.data.id);

		const rows = await env.DB.prepare('SELECT changes FROM _audit_log').all<{ changes: string | null }>();
		const dump = (rows.results ?? []).map((r) => r.changes ?? '').join('\n');
		expect(dump).not.toContain(probePassword);
		expect(dump).not.toContain(plaintext);
		// Not even the field NAME is stored — a hash was never handed to the audit.
		expect(dump).not.toContain('password_hash');
	});
});
