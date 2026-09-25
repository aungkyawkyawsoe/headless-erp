/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { sha256Hex } from '@/lib/services/api-key.service';

/**
 * Machine-key expiry (deny-by-default).
 *
 * `_api_keys.expires_at` (core migration `045_api_keys_expires_at`) is an ISO
 * timestamp where `null` means the key NEVER expires. That is the non-breaking
 * default: every key created before this feature — and any key created without an
 * explicit `expires_at` — keeps authenticating forever, exactly as before.
 *
 * When a key DOES carry an expiry, `requireAuth`'s `mmk_` branch refuses it the
 * instant the clock passes it, with the SAME canonical 401 any other invalid key
 * gets (no enumeration oracle). Visibility comes from a distinct security-audit
 * row instead of the response body.
 *
 * The expired case is seeded through RAW D1 (not the create route): `POST
 * /api/api-keys` deliberately rejects a past `expires_at` with a 400, so the only
 * honest way to prove the AUTH-time gate is to put a past stamp straight into the
 * table — precisely the leaked/defaulted row this feature defends against.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const ADMIN_JSON = { 'Content-Type': 'application/json', ...ADMIN };

// The owner of every key here. `requireAuth` refuses a key whose `_users` row is
// missing ("API key owner not found"), so the owner must exist.
const OWNER_ID = '00000000-0000-4000-8000-0000000000e0';
const OWNER_EMAIL = 'api-key-expiry-owner@test.local';

interface Envelope<T> {
	success: boolean;
	data: T;
	error?: string;
	code?: string;
}

interface KeyData {
	id: string;
	name: string;
	key: string;
	user_id: string;
	scope: string;
	created_at: string;
	expires_at: string | null;
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

/** Poll `_audit_log` until a matching row lands (the audit write is fire-and-forget). */
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

async function createKey(body: Record<string, unknown>): Promise<{ status: number; body: Envelope<KeyData> }> {
	const res = await SELF.fetch(`${BASE_URL}/api/api-keys`, {
		method: 'POST',
		headers: ADMIN_JSON,
		body: JSON.stringify({ user_id: OWNER_ID, ...body }),
	});
	return { status: res.status, body: (await res.json()) as Envelope<KeyData> };
}

/** Insert a key row directly, so a PAST expiry can exist despite the route's future-only guard. */
async function seedRawKey(id: string, plain: string, expiresAt: string | null): Promise<void> {
	const hash = await sha256Hex(plain);
	await env.DB.prepare(
		"INSERT OR REPLACE INTO _api_keys (id, name, key_hash, user_id, role_id, scope, is_active, created_at, last_used_at, revoked_at, expires_at) VALUES (?, ?, ?, ?, NULL, 'read', 1, ?, NULL, NULL, ?)",
	)
		.bind(id, id, hash, OWNER_ID, new Date().toISOString(), expiresAt)
		.run();
}

async function callMe(key: string) {
	const res = await SELF.fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${key}` } });
	return { status: res.status, body: (await res.json().catch(() => ({}))) as Envelope<unknown> };
}

beforeAll(async () => {
	// Any admin api-keys read runs pending migrations, so `_api_keys.expires_at`
	// (migration 045) and `_users` exist before we touch them directly.
	await SELF.fetch(`${BASE_URL}/api/api-keys`, { headers: ADMIN });
	await env.DB.prepare(
		"INSERT OR REPLACE INTO _users (id, email, full_name, password_hash, role_id, status) VALUES (?, ?, ?, 'x', NULL, 'active')",
	)
		.bind(OWNER_ID, OWNER_EMAIL, 'Key Expiry Owner')
		.run();
});

describe('machine-key expiry', () => {
	it('(a) refuses a key whose expiry is in the PAST (401 at auth)', async () => {
		const plain = 'mmk_expired_past_key_000000000000000001';
		await seedRawKey('key-expired-past', plain, new Date(Date.now() - 60_000).toISOString());

		const res = await callMe(plain);
		expect(res.status).toBe(401);
		expect(res.body.code).toBe('UNAUTHORIZED');
		// The refusal is the SAME message as any other invalid key — no oracle.
		expect(res.body.error).toBe('Invalid API key');
	});

	it('(b) accepts a key whose expiry is in the FUTURE', async () => {
		const future = new Date(Date.now() + 3_600_000).toISOString();
		const created = await createKey({ name: 'future-key', expires_at: future });
		expect(created.status, created.body.error ?? '').toBe(201);
		expect(created.body.data.key.startsWith('mmk_')).toBe(true);
		expect(created.body.data.expires_at).toBe(future);

		const res = await callMe(created.body.data.key);
		expect(res.status).toBe(200);
	});

	it('(c) still accepts a key with NO expiry (the non-breaking default) and lists expires_at', async () => {
		const created = await createKey({ name: 'forever-key' });
		expect(created.status, created.body.error ?? '').toBe(201);
		expect(created.body.data.expires_at).toBeNull();

		// The non-breaking default: an omitted expiry never expires.
		expect((await callMe(created.body.data.key)).status).toBe(200);

		const listed = await SELF.fetch(`${BASE_URL}/api/api-keys`, { headers: ADMIN });
		const list = (await listed.json()) as Envelope<Array<KeyData>>;
		const row = list.data.find((k) => k.id === created.body.data.id);
		expect(row).toBeDefined();
		expect(row!.expires_at).toBeNull();
	});

	it('(d) writes a security-audit row for the expired-key attempt', async () => {
		const plain = 'mmk_expired_past_key_audit_00000000000002';
		await seedRawKey('key-expired-audit', plain, new Date(Date.now() - 60_000).toISOString());

		expect((await callMe(plain)).status).toBe(401);

		const row = await waitForAudit('_auth', 'login_failed', (r) => r.document_id === 'key-expired-audit');
		expect(row.document_id).toBe('key-expired-audit');
		const fields = (JSON.parse(row.changes ?? '{}') as { fields?: Record<string, unknown> }).fields ?? {};
		expect(fields.reason).toBe('api_key_expired');
		// 🔒 The plaintext key is NEVER recorded — only the key's id + stamp.
		expect(row.changes ?? '').not.toContain(plain);
	});

	it('rejects a past or unparseable expires_at at create time (canonical 400)', async () => {
		const past = await createKey({ name: 'past-rejected', expires_at: new Date(Date.now() - 1000).toISOString() });
		expect(past.status).toBe(400);
		expect(past.body.code).toBe('VALIDATION_ERROR');

		const nonsense = await createKey({ name: 'nonsense-rejected', expires_at: 'not-a-timestamp' });
		expect(nonsense.status).toBe(400);
		expect(nonsense.body.code).toBe('VALIDATION_ERROR');
	});
});
