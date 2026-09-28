/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { sha256Hex } from '@/lib/services/api-key.service';

/**
 * Refresh tokens — the "stay signed in" credential (`_refresh_tokens`, migration
 * `048_refresh_tokens`) and its two endpoints (design §7.3).
 *
 * The JWT is a session POINTER: every request re-validates the account and the
 * acting employee, so a disable/offboard kills it immediately — but it cannot
 * outlive 24h. The refresh token is the long-lived companion: minted at login
 * (`login` response `refresh_token`), rotated single-use at
 * `POST /api/auth/refresh`, revoked at `POST /api/auth/logout`.
 *
 * The three properties this spec pins:
 *
 *  1. SINGLE-USE ROTATION — a successful refresh revokes the presented row and
 *     issues a successor (`rotated_from` names the predecessor, `device_id`
 *     survives, `expires_at` slides). Replaying an already-rotated token is the
 *     THEFT signal: the whole descendant chain dies (attacker AND victim are
 *     logged out; the victim re-authenticates, the thief cannot) and a
 *     security-audit `revoke` row with `reason: 'refresh_token_reuse'` records it.
 *  2. REVOCATION — logout kills the presented chain (`all: true` → every live
 *     chain of the user), idempotent and oracle-free. A refresh that finds the
 *     account disabled or its employee link gone refuses AND revokes the whole
 *     chain: offboarding ends the bearer and the chain together.
 *  3. STORAGE HYGIENE — only the SHA-256 hash is stored (the `_api_keys`
 *     precedent); the plaintext exists in the response and nowhere else.
 *
 * The expired case is seeded through RAW D1: only `issue()` mints tokens, and it
 * always writes a future `expires_at` — so the only honest way to prove the
 * time gate is to put a past stamp straight into the table.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const PASSWORD = 'refresh-token-pass';

/** UUID v4 fixtures — the engine's `id` validator rejects anything else. */
const EMP_A = 'a1a1a1a1-0000-4000-8000-00000000000a';
const EMP_OFF = '0ff00000-0000-4000-8000-0000000000ff';

interface Envelope<T> {
	success: boolean;
	data: T;
	error?: string;
	code?: string;
}

interface SessionData {
	token: string;
	refresh_token: string;
	user: { id: string; email: string; full_name: string };
}

interface TokenRow {
	id: string;
	user_id: string;
	token_hash: string;
	device_id: string | null;
	created_at: string;
	expires_at: string;
	rotated_from: string | null;
	revoked_at: string | null;
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

const field = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
	name,
	type,
	...(extra.required === undefined ? { required: false } : {}),
	...extra,
});

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: Envelope<Record<string, unknown>> }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...JSON_HEADERS, ...ADMIN, ...(init?.headers ?? {}) },
	});
	return { status: res.status, body: ((await res.json().catch(() => null)) ?? {}) as Envelope<Record<string, unknown>> };
}

async function createUser(body: Record<string, unknown>) {
	const res = await api('/api/users', { method: 'POST', body: JSON.stringify(body) });
	return { status: res.status, body: res.body as unknown as Envelope<{ id: string }> };
}

async function login(email: string, password: string, deviceId?: string) {
	const res = await SELF.fetch(`${BASE_URL}/api/auth/login`, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({ email, password, ...(deviceId ? { device_id: deviceId } : {}) }),
	});
	return { status: res.status, body: ((await res.json().catch(() => null)) ?? {}) as Envelope<SessionData> };
}

async function refresh(token: string) {
	const res = await SELF.fetch(`${BASE_URL}/api/auth/refresh`, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({ refresh_token: token }),
	});
	return { status: res.status, body: ((await res.json().catch(() => null)) ?? {}) as Envelope<SessionData> };
}

async function logout(body: Record<string, unknown>) {
	const res = await SELF.fetch(`${BASE_URL}/api/auth/logout`, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify(body),
	});
	return { status: res.status, body: ((await res.json().catch(() => null)) ?? {}) as Envelope<{ revoked: number }> };
}

async function me(token: string) {
	const res = await SELF.fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
	return { status: res.status, body: ((await res.json().catch(() => null)) ?? {}) as Envelope<{ employee_id: string | null }> };
}

async function exec(sql: string, ...bindings: unknown[]): Promise<void> {
	await env.DB.prepare(sql)
		.bind(...(bindings as never[]))
		.run();
}

/** Find the raw row for a PRESENTED token — proves the plaintext never lands in D1. */
async function rowFor(plain: string): Promise<TokenRow | null> {
	return env.DB.prepare('SELECT * FROM _refresh_tokens WHERE token_hash = ?')
		.bind(await sha256Hex(plain))
		.first<TokenRow>();
}

async function liveCount(userId: string): Promise<number> {
	const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM _refresh_tokens WHERE user_id = ? AND revoked_at IS NULL')
		.bind(userId)
		.first<{ n: number }>();
	return row?.n ?? 0;
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

beforeAll(async () => {
	// The directory shape the employee link resolves against (`active` is the
	// live/dead signal `findLiveEmployeeById` reads).
	const res = await api('/api/collections', {
		method: 'POST',
		body: JSON.stringify({
			name: 'HRM Employees',
			slug: 'directory',
			fields: [field('name_en', 'text', { required: true }), field('active', 'boolean', { default: 'true' })],
		}),
	});
	expect(res.status, String(res.body.error ?? 'create directory')).toBe(201);

	const insert = async (row: Record<string, unknown>) => {
		const cols = Object.keys(row);
		await exec(`INSERT INTO cms_directory (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map((c) => row[c]));
	};
	await insert({ id: EMP_A, name_en: 'Refresh Employee A', active: 1 });
	await insert({ id: EMP_OFF, name_en: 'Refresh Employee OFF', active: 1 });
});

describe('login issues a refresh token', () => {
	it('mints a 256-bit token, stores only its hash, and binds the device', async () => {
		const created = await createUser({
			email: 'rt-issue@test.local',
			password: PASSWORD,
			full_name: 'RT Issue',
			employee_id: EMP_A,
		});
		expect(created.status, created.body.error ?? 'create user').toBe(201);

		const signedIn = await login('rt-issue@test.local', PASSWORD, 'device-1');
		expect(signedIn.status, signedIn.body.error ?? 'login').toBe(200);
		const rt = signedIn.body.data.refresh_token;
		expect(rt).toMatch(/^[0-9a-f]{64}$/);

		// The row exists under the HASH — the plaintext is not in the database.
		const row = await rowFor(rt);
		expect(row).not.toBeNull();
		expect(row?.user_id).toBe(created.body.data.id);
		expect(row?.device_id).toBe('device-1');
		expect(row?.revoked_at).toBeNull();
		expect(row?.rotated_from).toBeNull();
		expect(row?.token_hash).not.toBe(rt);
	});
});

describe('single-use rotation', () => {
	it('revokes the presented token, issues a working successor, keeps the device binding', async () => {
		const created = await createUser({
			email: 'rt-rotate@test.local',
			password: PASSWORD,
			full_name: 'RT Rotate',
			employee_id: EMP_A,
		});
		expect(created.status, created.body.error ?? 'create user').toBe(201);
		const userId = created.body.data.id;

		const signedIn = await login('rt-rotate@test.local', PASSWORD, 'device-1');
		expect(signedIn.status, signedIn.body.error ?? 'login').toBe(200);
		const r1 = signedIn.body.data.refresh_token;

		const rotated = await refresh(r1);
		expect(rotated.status, rotated.body.error ?? 'refresh').toBe(200);
		const r2 = rotated.body.data.refresh_token;
		expect(r2).not.toBe(r1);

		const row1 = await rowFor(r1);
		const row2 = await rowFor(r2);
		expect(row1?.revoked_at).not.toBeNull();
		expect(row2?.revoked_at).toBeNull();
		expect(row2?.rotated_from).toBe(row1?.id);
		expect(row2?.user_id).toBe(userId);
		// The device binding survives rotation — a stolen token cannot shed it.
		expect(row2?.device_id).toBe('device-1');
		// Sliding TTL: the successor's window is at least as far out as the predecessor's.
		expect(Date.parse(row2?.expires_at ?? '')).toBeGreaterThanOrEqual(Date.parse(row1?.expires_at ?? ''));

		// The fresh JWT is a REAL session — same employee still bound.
		const who = await me(rotated.body.data.token);
		expect(who.status).toBe(200);
		expect(who.body.data.employee_id).toBe(EMP_A);
	});
});

describe('theft detection', () => {
	it('replaying a rotated token revokes the whole descendant chain and audits it', async () => {
		const created = await createUser({ email: 'rt-reuse@test.local', password: PASSWORD, full_name: 'RT Reuse' });
		expect(created.status, created.body.error ?? 'create user').toBe(201);
		const userId = created.body.data.id;

		const signedIn = await login('rt-reuse@test.local', PASSWORD);
		const r1 = signedIn.body.data.refresh_token;
		const rotated = await refresh(r1);
		expect(rotated.status, rotated.body.error ?? 'first refresh').toBe(200);
		const r2 = rotated.body.data.refresh_token;

		// The replay: R1 was already rotated away — presenting it again is theft.
		const replay = await refresh(r1);
		expect(replay.status).toBe(401);
		expect(replay.body.error).toBe('Invalid refresh token');

		// The live successor died with it — the thief gains nothing.
		expect((await rowFor(r2))?.revoked_at).not.toBeNull();
		expect(await liveCount(userId)).toBe(0);

		const audit = await waitForAudit('_auth', 'revoke', (row) => (row.changes ?? '').includes('refresh_token_reuse'));
		expect(audit.document_id).toBe(userId);
		expect(audit.changes ?? '').toContain('"revoked":1');

		// The killed successor stays dead.
		expect((await refresh(r2)).status).toBe(401);
	});
});

describe('expiry', () => {
	it('refuses an expired token and kills the dead row', async () => {
		const plain = 'expired-token-plaintext';
		const now = Date.now();
		await exec(
			'INSERT INTO _refresh_tokens (id, user_id, token_hash, device_id, created_at, expires_at, rotated_from, revoked_at) VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL)',
			'00000000-0000-4000-8000-0000000000ee',
			'expired-seed-user',
			await sha256Hex(plain),
			new Date(now - 2 * 86_400_000).toISOString(),
			new Date(now - 86_400_000).toISOString(),
		);

		const refused = await refresh(plain);
		expect(refused.status).toBe(401);
		expect(refused.body.error).toBe('Invalid refresh token');

		// The row is revoked, so a stale client's retry loop cannot keep hitting it.
		expect((await rowFor(plain))?.revoked_at).not.toBeNull();
	});
});

describe('logout', () => {
	it('revokes the presented chain only — other chains of the user survive', async () => {
		const created = await createUser({ email: 'rt-logout-one@test.local', password: PASSWORD, full_name: 'RT Logout One' });
		expect(created.status, created.body.error ?? 'create user').toBe(201);
		const userId = created.body.data.id;

		const first = await login('rt-logout-one@test.local', PASSWORD);
		const second = await login('rt-logout-one@test.local', PASSWORD);
		const r1 = first.body.data.refresh_token;
		const r2 = second.body.data.refresh_token;

		const out = await logout({ refresh_token: r1 });
		expect(out.status).toBe(200);
		expect(out.body.data.revoked).toBe(1);
		expect(await liveCount(userId)).toBe(1);

		// The logged-out chain is dead...
		expect((await refresh(r1)).status).toBe(401);
		// ...the other device keeps its session.
		expect((await refresh(r2)).status).toBe(200);

		const audit = await waitForAudit('_auth', 'logout', (row) => row.document_id === userId);
		expect(audit.changes ?? '').toContain('"all":false');
	});

	it('all:true signs the user out everywhere', async () => {
		const created = await createUser({ email: 'rt-logout-all@test.local', password: PASSWORD, full_name: 'RT Logout All' });
		expect(created.status, created.body.error ?? 'create user').toBe(201);
		const userId = created.body.data.id;

		const first = await login('rt-logout-all@test.local', PASSWORD);
		const second = await login('rt-logout-all@test.local', PASSWORD);
		const r1 = first.body.data.refresh_token;
		const r2 = second.body.data.refresh_token;

		const out = await logout({ refresh_token: r1, all: true });
		expect(out.status).toBe(200);
		expect(out.body.data.revoked).toBe(2);
		expect(await liveCount(userId)).toBe(0);
		expect((await refresh(r1)).status).toBe(401);
		expect((await refresh(r2)).status).toBe(401);

		const audit = await waitForAudit('_auth', 'logout', (row) => row.document_id === userId && (row.changes ?? '').includes('"all":true'));
		expect(audit.changes ?? '').toContain('"revoked":2');
	});

	it('is idempotent and oracle-free — unknown and missing tokens still answer 200', async () => {
		const unknown = await logout({ refresh_token: 'totally-unknown-token' });
		expect(unknown.status).toBe(200);
		expect(unknown.body.data.revoked).toBe(0);

		const empty = await logout({});
		expect(empty.status).toBe(200);
		expect(empty.body.data.revoked).toBe(0);

		const created = await createUser({ email: 'rt-logout-idem@test.local', password: PASSWORD, full_name: 'RT Logout Idem' });
		expect(created.status, created.body.error ?? 'create user').toBe(201);
		const signedIn = await login('rt-logout-idem@test.local', PASSWORD);
		const rt = signedIn.body.data.refresh_token;

		expect((await logout({ refresh_token: rt })).body.data.revoked).toBe(1);
		// Replaying logout is a no-op, not an error.
		const again = await logout({ refresh_token: rt });
		expect(again.status).toBe(200);
		expect(again.body.data.revoked).toBe(0);
	});
});

describe('session re-validation', () => {
	it('refuses when the employee link is gone and kills the chain (offboarding)', async () => {
		const created = await createUser({
			email: 'rt-offboard@test.local',
			password: PASSWORD,
			full_name: 'RT Offboard',
			employee_id: EMP_OFF,
		});
		expect(created.status, created.body.error ?? 'create user').toBe(201);
		const userId = created.body.data.id;

		const signedIn = await login('rt-offboard@test.local', PASSWORD);
		const rotated = await refresh(signedIn.body.data.refresh_token);
		expect(rotated.status, rotated.body.error ?? 'first refresh').toBe(200);
		const live = rotated.body.data.refresh_token;

		// HR offboards the employee — the act the refresh must catch between JWTs.
		await exec('UPDATE cms_directory SET active = 0 WHERE id = ?', EMP_OFF);

		const refused = await refresh(live);
		expect(refused.status).toBe(401);
		expect(refused.body.error).toBe('Invalid refresh token');
		// The refusal ends the bearer's whole chain — "offboard ⇒ bearer ရော
		// refresh chain ရော ကုန်" (design §7.3).
		expect(await liveCount(userId)).toBe(0);

		const audit = await waitForAudit(
			'_auth',
			'revoke',
			(row) => (row.changes ?? '').includes('refresh_session_refused') && (row.changes ?? '').includes('unlinked'),
		);
		expect(audit.document_id).toBe(userId);

		// Reversible: restoring the employee restores sign-in.
		await exec('UPDATE cms_directory SET active = 1 WHERE id = ?', EMP_OFF);
		const restored = await login('rt-offboard@test.local', PASSWORD);
		expect(restored.status, restored.body.error ?? 'restored login').toBe(200);
	});

	it('refuses when the account is disabled and kills the chain', async () => {
		const created = await createUser({ email: 'rt-disable@test.local', password: PASSWORD, full_name: 'RT Disable' });
		expect(created.status, created.body.error ?? 'create user').toBe(201);
		const userId = created.body.data.id;

		const signedIn = await login('rt-disable@test.local', PASSWORD);
		const rt = signedIn.body.data.refresh_token;

		await exec("UPDATE _users SET status = 'disabled' WHERE id = ?", userId);

		const refused = await refresh(rt);
		expect(refused.status).toBe(401);
		expect(await liveCount(userId)).toBe(0);

		const audit = await waitForAudit(
			'_auth',
			'revoke',
			(row) => (row.changes ?? '').includes('refresh_session_refused') && (row.changes ?? '').includes('inactive'),
		);
		expect(audit.document_id).toBe(userId);

		// Re-enabled → the account can sign in again (a new chain).
		await exec("UPDATE _users SET status = 'active' WHERE id = ?", userId);
		expect((await login('rt-disable@test.local', PASSWORD)).status).toBe(200);
	});

	it('refreshes fine for an account with no employee link (the bootstrap-admin shape)', async () => {
		const created = await createUser({ email: 'rt-unlinked@test.local', password: PASSWORD, full_name: 'RT Unlinked' });
		expect(created.status, created.body.error ?? 'create user').toBe(201);

		const signedIn = await login('rt-unlinked@test.local', PASSWORD);
		const rotated = await refresh(signedIn.body.data.refresh_token);
		expect(rotated.status, rotated.body.error ?? 'refresh').toBe(200);

		const who = await me(rotated.body.data.token);
		expect(who.status).toBe(200);
		expect(who.body.data.employee_id).toBeNull();
	});
});

describe('input handling', () => {
	it('answers 400 for a missing token, 400 for a non-JSON body, 401 for a garbage token', async () => {
		const missing = await refresh('');
		expect(missing.status).toBe(400);
		expect(missing.body.error).toBe('refresh_token required');

		const raw = await SELF.fetch(`${BASE_URL}/api/auth/refresh`, { method: 'POST', headers: JSON_HEADERS, body: 'not-json' });
		expect(raw.status).toBe(400);
		expect(((await raw.json()) as Envelope<unknown>).error).toBe('refresh_token required');

		const garbage = await refresh('garbage-token');
		expect(garbage.status).toBe(401);
		expect(garbage.body.error).toBe('Invalid refresh token');
	});
});
