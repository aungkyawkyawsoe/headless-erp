/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Business-permission freshness — the authz version stamp.
 *
 * `PermissionEvaluator.checkBusiness` (and the `user:` / `role:` lookups in
 * `AuthService.verifyToken`) cache their answers. `CacheLayer` is PER-ISOLATE and
 * Workers reuse many isolates, so a bare `perm:<role>:<slug>:<action>` key lets a
 * grant/revoke served by ONE isolate keep returning the OLD answer from every
 * OTHER isolate for the whole TTL — the "I changed the role but the app still
 * denies/allows it" report.
 *
 * The fix (`apps/api/src/lib/services/authz-version.ts`) appends a stamp — the
 * newest `updated_at` across `_users` / `_roles` / `_role_permissions` — to every
 * authz cache key. A write anywhere bumps that data, so the next read MISSES the
 * stale entry with no cross-isolate invalidation channel. The stamp itself is
 * cached only ~1s, so the worst-case cross-isolate lag is ~1s.
 *
 * Each case below writes DIRECTLY to D1 — no service call, so nothing invalidates
 * anything — which is exactly what a write served by a different isolate looks
 * like. It then waits out the 1s stamp window and asserts the very next gated
 * read reflects the new data. If a `perm:` or `user:` key ever loses its version
 * suffix, the warmed stale entry survives its 15s/60s TTL and these cases fail.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const COLLECTION = 'authz_probe';

/**
 * A timestamp strictly after every row written so far, so a RAW D1 write really
 * advances `MAX(updated_at)`. It must beat BOTH our own cursor AND the real wall
 * clock: a prior API write stamps `updated_at` with the actual `now`, which can
 * be LATER than a cursor seeded at module load once the suite is loaded and the
 * file takes >1s to reach a case — the raw write would then not be the maximum,
 * the version would not change, and the warmed deny would never clear.
 */
let stampCursor = Date.now();
function nextStamp(): string {
	stampCursor = Math.max(stampCursor + 1_000, Date.now() + 1_000);
	return new Date(stampCursor).toISOString();
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function call(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
	return SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: {
			...JSON_HEADERS,
			...(token ? { Authorization: `Bearer ${token}` } : ADMIN),
			...(init.headers ?? {}),
		},
	});
}

async function createRole(name: string): Promise<string> {
	const res = await call('/api/users/roles', { method: 'POST', body: JSON.stringify({ name, description: 'test' }) });
	expect(res.status).toBe(201);
	return ((await res.json()) as { data: { id: string } }).data.id;
}

async function createUserWithToken(email: string, roleId: string): Promise<string> {
	const res = await call('/api/users', {
		method: 'POST',
		body: JSON.stringify({ email, password: 'authz-freshness-pass', full_name: 'Authz Freshness', role_id: roleId }),
	});
	expect(res.status).toBe(201);
	const login = await call('/api/auth/login', {
		method: 'POST',
		body: JSON.stringify({ email, password: 'authz-freshness-pass' }),
	});
	expect(login.status).toBe(200);
	return ((await login.json()) as { data: { token: string } }).data.token;
}

async function ensureCollection(): Promise<void> {
	const res = await call('/api/collections', {
		method: 'POST',
		body: JSON.stringify({
			name: COLLECTION,
			slug: COLLECTION,
			fields: [{ name: 'label', type: 'text', required: false, label: 'Label' }],
		}),
	});
	// 201 = created; 409 = already provisioned (only matters within one file).
	expect([201, 409]).toContain(res.status);
}

/** A non-admin read of the probe collection — 403 until the role can read it. */
async function probe(token: string): Promise<number> {
	const res = await call(`/api/entities/${COLLECTION}`, {}, token);
	// Drain the body so the request fully completes before the next assertion.
	await res.text();
	return res.status;
}

/**
 * Poll the probe until it reports `expected` (or the deadline passes). The version
 * stamp is a ~1s-TTL cache, so a RAW write converges on the NEXT request after
 * that window — but a FIXED `sleep(1.2s)` is timing-fragile under a loaded
 * parallel suite. Polling asserts the SAME contract (the stamp makes the stale
 * entry unreachable) without depending on the suite's scheduling.
 */
async function probeUntil(token: string, expected: number, timeoutMs = 12_000): Promise<number> {
	const deadline = Date.now() + timeoutMs;
	let status = await probe(token);
	while (status !== expected && Date.now() < deadline) {
		await sleep(250);
		status = await probe(token);
	}
	return status;
}

/** Insert a read grant straight into D1 with a stamp newer than any existing row. */
async function insertGrantRaw(roleId: string): Promise<void> {
	await env.DB.prepare(
		'INSERT INTO _role_permissions (id, role_id, collection_slug, can_read, updated_at) VALUES (?, ?, ?, 1, ?) ' +
			'ON CONFLICT(role_id, collection_slug) DO UPDATE SET can_read = 1, updated_at = excluded.updated_at',
	)
		.bind(crypto.randomUUID(), roleId, COLLECTION, nextStamp())
		.run();
}

describe('authz version stamp — a grant reaches every isolate', () => {
	let tokenA = '';
	let roleA = '';
	let tokenB = '';
	let roleB = '';

	beforeAll(async () => {
		await ensureCollection();
		const uniq = crypto.randomUUID();
		roleA = await createRole(`AuthzA-${uniq}`);
		roleB = await createRole(`AuthzB-${uniq}`);
		tokenA = await createUserWithToken(`authz-a-${uniq}@test.local`, roleA);
		tokenB = await createUserWithToken(`authz-b-${uniq}@test.local`, roleB);
	});

	it('reflects a grant applied through the service on the very next request', async () => {
		// Warm the deny, then grant through the API (the real admin path).
		expect(await probe(tokenA)).toBe(403);
		const grant = await call('/api/users/permissions', {
			method: 'POST',
			body: JSON.stringify({ role_id: roleA, collection_slug: COLLECTION, can_read: true }),
		});
		expect(grant.status).toBe(201);
		expect(await probe(tokenA)).toBe(200);
	});

	it('reflects a grant written directly to the DB (another isolate) within the stamp window', async () => {
		// A deny is warmed under the OLD version...
		expect(await probe(tokenB)).toBe(403);

		// ...then a DIFFERENT isolate grants the read. Nothing in this isolate
		// invalidates anything — the only path to correctness is the version stamp.
		await insertGrantRaw(roleB);

		// Converges on the first request after the ~1s stamp window.
		expect(await probeUntil(tokenB, 200)).toBe(200);
	}, 15_000); // probeUntil tolerates up to 12s of scheduling delay; the 5s default was under it.
});

describe('authz version stamp — a role swap reaches every isolate', () => {
	let token = '';
	let userId = '';
	let grantedRole = '';

	beforeAll(async () => {
		await ensureCollection();
		const uniq = crypto.randomUUID();
		const denyRole = await createRole(`AuthzDeny-${uniq}`);
		grantedRole = await createRole(`AuthzGrant-${uniq}`);
		// The destination role can read the probe.
		const grant = await call('/api/users/permissions', {
			method: 'POST',
			body: JSON.stringify({ role_id: grantedRole, collection_slug: COLLECTION, can_read: true }),
		});
		expect(grant.status).toBe(201);

		const email = `authz-swap-${uniq}@test.local`;
		const user = await call('/api/users', {
			method: 'POST',
			body: JSON.stringify({ email, password: 'authz-freshness-pass', full_name: 'Authz Swap', role_id: denyRole }),
		});
		expect(user.status).toBe(201);
		userId = ((await user.json()) as { data: { id: string } }).data.id;

		const login = await call('/api/auth/login', {
			method: 'POST',
			body: JSON.stringify({ email, password: 'authz-freshness-pass' }),
		});
		expect(login.status).toBe(200);
		token = ((await login.json()) as { data: { token: string } }).data.token;
	});

	it('reflects a role change written directly to the DB within the stamp window', async () => {
		// Warm the deny under the old version (this also caches the user's OLD role).
		expect(await probe(token)).toBe(403);

		// Reassign the user's role straight in D1, as an admin action served by a
		// different isolate would. No service invalidation runs in this isolate.
		await env.DB.prepare('UPDATE _users SET role_id = ?, updated_at = ? WHERE id = ?').bind(grantedRole, nextStamp(), userId).run();

		expect(await probeUntil(token, 200)).toBe(200);
	}, 15_000); // matches the probeUntil budget above (see the grant case).
});
