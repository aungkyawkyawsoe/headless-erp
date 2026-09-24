/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * A PASSWORD (web) account signs in AS an employee — `_users.employee_id`.
 *
 * The Telegram login route has always bound an acting employee into the signed
 * token (`generateToken(..., directory.id)`), which is what makes every
 * server-scoped action possible: a punch, a leave request, a custody move or a
 * transfer decision all resolve their actor from `ctx.employee_id`, never from a
 * field the caller sends. `POST /api/auth/login` minted its token WITHOUT one, so
 * an employee who signed in on the web with an email and password could reach the
 * app but do nothing in it.
 *
 * The link closes that AND gives web sessions the revoke property the Telegram
 * `etg_id` gate had: the account may sign in only while the employee it points at
 * is LIVE, and an already-minted token stops working the moment that employee is
 * offboarded (`verifyToken` → `_healActingEmployee` re-validates the link on every
 * request). Without it, terminating an employee revoked their Telegram access and
 * left their web access intact.
 *
 * The link is also UNSETTABLE (`employee_id: null`), unlike `role_id` — a binding
 * made to the wrong person has to be removable.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** UUID v4 fixtures — the engine's `id` validator rejects anything else. */
const EMP_A = 'a1a1a1a1-0000-4000-8000-00000000000a';
const EMP_B = 'b2b2b2b2-0000-4000-8000-00000000000b';
const GHOST = 'cccccccc-0000-4000-8000-00000000dead';

interface Envelope<T> {
	success: boolean;
	data: T;
	error?: string;
	code?: string;
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

async function login(email: string, password: string) {
	const res = await SELF.fetch(`${BASE_URL}/api/auth/login`, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({ email, password }),
	});
	return { status: res.status, body: (await res.json()) as Envelope<{ token: string }> };
}

/** `GET /api/auth/me` as the session itself — the end-to-end proof that the
 *  acting employee is bound, not just present in the token bytes. */
async function me(token: string) {
	const res = await SELF.fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
	return { status: res.status, body: ((await res.json().catch(() => null)) ?? {}) as Envelope<{ employee_id: string | null }> };
}

async function exec(sql: string, ...bindings: unknown[]): Promise<void> {
	await env.DB.prepare(sql)
		.bind(...(bindings as never[]))
		.run();
}

async function createUser(body: Record<string, unknown>) {
	const res = await SELF.fetch(`${BASE_URL}/api/users`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify(body),
	});
	return { status: res.status, body: (await res.json()) as Envelope<{ id: string }> };
}

async function updateUser(id: string, body: Record<string, unknown>) {
	const res = await SELF.fetch(`${BASE_URL}/api/users/${id}`, {
		method: 'PUT',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify(body),
	});
	return { status: res.status, body: (await res.json()) as Envelope<Record<string, unknown>> };
}

beforeAll(async () => {
	// A directory collection with `active` — the prod shape — so BOTH revoke
	// signals are exercised: `active = 0` and a soft delete.
	const res = await api('/api/collections', {
		method: 'POST',
		body: JSON.stringify({
			name: 'HRM Employees',
			slug: 'hrm_employees',
			fields: [field('name_en', 'text', { required: true }), field('name_mm', 'text'), field('active', 'boolean', { default: 'true' })],
		}),
	});
	expect(res.status, res.body.error ?? 'create hrm_employees').toBe(201);

	const insert = async (row: Record<string, unknown>) => {
		const cols = Object.keys(row);
		await exec(`INSERT INTO cms_hrm_employees (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map((c) => row[c]));
	};
	await insert({ id: EMP_A, name_en: 'Web Employee A', active: 1 });
	await insert({ id: EMP_B, name_en: 'Web Employee B', active: 1 });
});

describe('a web account signs in as its employee', () => {
	const EMAIL = 'web-employee-a@test.local';
	const PASSWORD = 'web-employee-pass';

	it('binds the linked employee into the session, and the account is listed with it', async () => {
		const created = await createUser({
			email: EMAIL,
			password: PASSWORD,
			full_name: 'Web Employee A',
			employee_id: EMP_A,
		});
		expect(created.status, created.body.error ?? 'create user').toBe(201);

		// The Users table's read carries the link — that is what lets the Studio
		// show WHICH employee an account is (and what it edits).
		const list = await api('/api/users');
		expect(list.status).toBe(200);
		const rows = list.body.data as unknown as Array<Record<string, unknown>>;
		const row = rows.find((r) => r.email === EMAIL);
		expect(row?.employee_id).toBe(EMP_A);
		// ...and it is still the SAFE projection: no credential ever leaves this route.
		expect(row).not.toHaveProperty('password_hash');

		const signedIn = await login(EMAIL, PASSWORD);
		expect(signedIn.status, signedIn.body.error ?? 'login').toBe(200);

		const who = await me(signedIn.body.data.token);
		expect(who.status).toBe(200);
		expect(who.body.data.employee_id).toBe(EMP_A);
	});

	it('refuses a link to an employee who does not exist, on create and on update', async () => {
		const created = await createUser({
			email: 'web-ghost-link@test.local',
			password: PASSWORD,
			full_name: 'Ghost Link',
			employee_id: GHOST,
		});
		expect(created.status).toBe(400);
		expect(created.body.error ?? '').toMatch(/no longer active|does not exist/i);

		// The same guard on the update path — a re-point to a dead row must not be
		// silently accepted either (it would produce an account nobody can sign into).
		const ok = await createUser({
			email: 'web-ghost-update@test.local',
			password: PASSWORD,
			full_name: 'Ghost Update',
			employee_id: EMP_B,
		});
		expect(ok.status, ok.body.error ?? 'create').toBe(201);

		const bad = await updateUser(ok.body.data.id, { employee_id: GHOST });
		expect(bad.status).toBe(400);
		expect(bad.body.error ?? '').toMatch(/no longer active|does not exist/i);
	});

	it('revokes the session when the employee is deactivated, and restores sign-in when re-activated', async () => {
		const created = await createUser({
			email: 'web-revoke@test.local',
			password: PASSWORD,
			full_name: 'Web Revoke',
			employee_id: EMP_A,
		});
		expect(created.status, created.body.error ?? 'create').toBe(201);

		const signedIn = await login('web-revoke@test.local', PASSWORD);
		expect(signedIn.status, signedIn.body.error ?? 'login').toBe(200);
		const token = signedIn.body.data.token;
		expect((await me(token)).status).toBe(200);

		// HR deactivates the employee — the offboarding act.
		await exec('UPDATE cms_hrm_employees SET active = 0 WHERE id = ?', EMP_A);

		// The token minted moments ago is refused on its very next request: the link
		// is re-validated per request, never cached behind a TTL.
		const revoked = await me(token);
		expect(revoked.status).toBe(401);

		// A fresh sign-in is refused too, with an actionable message (this branch is
		// only reachable AFTER the password verified, so it tells the account's own
		// owner something without answering a question about anyone else's account).
		const refused = await login('web-revoke@test.local', PASSWORD);
		expect(refused.status).toBe(401);
		expect(refused.body.error ?? '').toMatch(/no longer linked to an active employee/i);

		// Reversible: restoring the employee restores the web sign-in.
		await exec('UPDATE cms_hrm_employees SET active = 1 WHERE id = ?', EMP_A);
		const restored = await login('web-revoke@test.local', PASSWORD);
		expect(restored.status, restored.body.error ?? 'login').toBe(200);
		expect((await me(restored.body.data.token)).body.data.employee_id).toBe(EMP_A);
	});

	it('revokes the session when the employee is soft-deleted', async () => {
		const created = await createUser({
			email: 'web-softdeleted@test.local',
			password: PASSWORD,
			full_name: 'Web Soft Deleted',
			employee_id: EMP_B,
		});
		expect(created.status, created.body.error ?? 'create').toBe(201);

		const signedIn = await login('web-softdeleted@test.local', PASSWORD);
		expect(signedIn.status, signedIn.body.error ?? 'login').toBe(200);
		const token = signedIn.body.data.token;

		// A soft-deleted row survives for audit but is NOT a live identity.
		await exec('UPDATE cms_hrm_employees SET deleted_at = ? WHERE id = ?', new Date().toISOString(), EMP_B);

		expect((await me(token)).status).toBe(401);
		expect((await login('web-softdeleted@test.local', PASSWORD)).status).toBe(401);
	});

	it('un-links an account (employee_id: null) without breaking its sign-in', async () => {
		const created = await createUser({
			email: 'web-unlink@test.local',
			password: PASSWORD,
			full_name: 'Web Unlink',
			employee_id: EMP_A,
		});
		expect(created.status, created.body.error ?? 'create').toBe(201);
		const id = created.body.data.id;

		const unlinked = await updateUser(id, { employee_id: null });
		expect(unlinked.status, unlinked.body.error ?? 'unlink').toBe(200);
		expect(unlinked.body.data.employee_id).toBeNull();

		// An account with no employee is a legitimate state (the bootstrap admin is
		// one) — it signs in, it just has no acting employee.
		const signedIn = await login('web-unlink@test.local', PASSWORD);
		expect(signedIn.status, signedIn.body.error ?? 'login').toBe(200);
		const who = await me(signedIn.body.data.token);
		expect(who.status).toBe(200);
		expect(who.body.data.employee_id).toBeNull();

		// And `undefined` still means "leave it alone", not "clear it".
		const rebound = await updateUser(id, { employee_id: EMP_A });
		expect(rebound.status, rebound.body.error ?? 'rebind').toBe(200);
		const untouched = await updateUser(id, { full_name: 'Web Unlink' });
		expect(untouched.body.data.employee_id).toBe(EMP_A);
	});
});
