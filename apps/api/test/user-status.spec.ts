/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * The account lifecycle vocabulary — `active | invited | suspended`.
 *
 * `invited` is the missing middle state (the Directus user directory has one):
 * the account EXISTS and holds a role, but no credential was ever set, so it
 * cannot sign in until an admin activates it. The engine stores it as a status
 * plus a `password_hash` marker (`invited:no-password` — the column is NOT
 * NULL), and every gate is unchanged and fail-closed: `login` and `verifyToken`
 * only ever accept `active`.
 *
 * This file pins the five rules that keep the vocabulary honest:
 *   1. create without a password ⇒ `invited` ⇒ refused at login;
 *   2. activating an invited account REQUIRES the credential in the same
 *      request — an `active` row with no way in would be a lie;
 *   3. `suspended` blocks sign-in AND kills a token that was minted while the
 *      account was active, and the refusal is INDISTINGUISHABLE from a wrong
 *      password (same 401/message/code — no account-state oracle);
 *   4. the gate is a door, not a wall: re-activating restores sign-in;
 *   5. a status outside the vocabulary is refused at BOTH write seams — the old
 *      code wrote any truthy string, stranding the account in a state no reader
 *      knows (`status !== 'active'` still refused it, but silently).
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** The standard envelope: `{ success, data, error?, code? }`. */
interface Envelope<T> {
	success: boolean;
	data: T;
	error?: string;
	code?: string;
}

interface UserRow {
	id: string;
	email: string;
	status: 'active' | 'invited' | 'suspended';
}

async function createUser(body: Record<string, unknown>): Promise<{ status: number; body: Envelope<{ id: string }> }> {
	const res = await SELF.fetch(`${BASE_URL}/api/users`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify(body),
	});
	return { status: res.status, body: (await res.json()) as Envelope<{ id: string }> };
}

async function putUser(id: string, body: Record<string, unknown>): Promise<{ status: number; body: Envelope<UserRow> }> {
	const res = await SELF.fetch(`${BASE_URL}/api/users/${id}`, {
		method: 'PUT',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify(body),
	});
	return { status: res.status, body: (await res.json()) as Envelope<UserRow> };
}

async function getUser(id: string): Promise<UserRow> {
	const res = await SELF.fetch(`${BASE_URL}/api/users/${id}`, { headers: ADMIN });
	const body = (await res.json()) as Envelope<UserRow>;
	expect(res.status, body.error ?? '').toBe(200);
	return body.data;
}

async function login(email: string, password: string): Promise<{ status: number; body: Envelope<{ token: string }> }> {
	const res = await SELF.fetch(`${BASE_URL}/api/auth/login`, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({ email, password }),
	});
	return { status: res.status, body: (await res.json()) as Envelope<{ token: string }> };
}

describe('the account lifecycle', () => {
	const EMAIL = 'lifecycle@test.local';
	const PASSWORD = 'lifecycle-pass';

	it('creates INVITED without a password, refuses it at login, activates with one, and suspends it again', async () => {
		// 1. No password in the request at all — the account is lined up, not usable.
		const created = await createUser({ email: EMAIL, full_name: 'Lifecycle Probe' });
		expect(created.status, created.body.error ?? '').toBe(201);
		const id = created.body.data.id;

		// The STORED state is what the Studio renders its Invited pill from.
		expect((await getUser(id)).status).toBe('invited');

		// 2. There is no credential, so no password can possibly sign in — and the
		//    refusal is the SAME generic 401 as a wrong password (no state oracle).
		const asInvited = await login(EMAIL, PASSWORD);
		expect(asInvited.status, asInvited.body.error ?? '').toBe(401);
		expect(asInvited.body.error).toBe('Invalid email or password');

		// 3. Activating without a password is refused — an `active` account with no
		//    way in would be a state that claims something it cannot back.
		const bareActivate = await putUser(id, { status: 'active' });
		expect(bareActivate.status, bareActivate.body.error ?? '').toBe(400);
		expect(bareActivate.body.error).toMatch(/no password yet/i);
		// …and the refusal wrote nothing.
		expect((await getUser(id)).status).toBe('invited');

		// 4. Activation WITH the credential in the same request lands, and the
		//    account genuinely signs in — the whole point of the state.
		const activated = await putUser(id, { status: 'active', password: PASSWORD });
		expect(activated.status, activated.body.error ?? '').toBe(200);
		const signedIn = await login(EMAIL, PASSWORD);
		expect(signedIn.status, signedIn.body.error ?? '').toBe(200);
		const token = signedIn.body.data.token;
		expect(typeof token).toBe('string');

		// 5. Suspending blocks the next sign-in AND kills the token already minted:
		//    `verifyToken` refuses any status ≠ active, so a live session dies on its
		//    very next request rather than outliving the suspension.
		await putUser(id, { status: 'suspended' });
		const suspended = await login(EMAIL, PASSWORD);
		expect(suspended.status).toBe(401);
		const me = await SELF.fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
		expect(me.status).toBe(401);

		// The refusal is INDISTINGUISHABLE from a wrong password — same 401, same
		// message, same code, no token minted — so the endpoint cannot be used as
		// an account-state oracle ("does this email exist, and is it suspended?").
		const wrongPassword = await login(EMAIL, `${PASSWORD}-wrong`);
		expect(wrongPassword.status).toBe(401);
		expect(wrongPassword.body.error).toBe(suspended.body.error);
		expect(wrongPassword.body.code).toBe(suspended.body.code);
		expect(suspended.body.data).toBeUndefined();

		// 6. A door, not a wall: re-activating restores sign-in.
		await putUser(id, { status: 'active' });
		expect((await login(EMAIL, PASSWORD)).status).toBe(200);
	});

	it('refuses an ACTIVE create with no credential, and an out-of-vocabulary status on BOTH write seams', async () => {
		const noPassword = await createUser({ email: 'active-nopass@test.local', full_name: 'No Pass', status: 'active' });
		expect(noPassword.status, noPassword.body.error ?? '').toBe(400);
		expect(noPassword.body.error).toMatch(/needs a password/i);

		const badCreate = await createUser({
			email: 'bogus-status@test.local',
			full_name: 'Bogus',
			status: 'enabled',
		});
		expect(badCreate.status, badCreate.body.error ?? '').toBe(400);
		expect(badCreate.body.error).toMatch(/status must be one of/i);

		// The same whitelist on UPDATE — the old code wrote ANY truthy string, which
		// stranded the account in a state every reader denies but no operator chose.
		const created = await createUser({ email: 'bogus-status2@test.local', password: 'a-good-password', full_name: 'Bogus Two' });
		expect(created.status, created.body.error ?? '').toBe(201);
		const id = created.body.data.id;
		expect((await getUser(id)).status).toBe('active');

		const badUpdate = await putUser(id, { status: 'enabled' });
		expect(badUpdate.status, badUpdate.body.error ?? '').toBe(400);
		expect(badUpdate.body.error).toMatch(/status must be one of/i);
		expect((await getUser(id)).status).toBe('active');
	});
});
