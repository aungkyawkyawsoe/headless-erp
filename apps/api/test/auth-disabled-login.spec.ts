/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * A DISABLED account must not be able to sign in.
 *
 * `AuthService.login()` verified that the user exists and that the password is
 * correct, but never looked at `user.status`. So `POST /api/auth/login` answered
 * 200 with a perfectly-formed token for a disabled account — and `verifyToken`,
 * which DOES require `status === 'active'`, then rejected that token on the very
 * next request. The client saw a successful login followed by a silent bounce
 * back to the login screen, with no way to tell what went wrong. The Studio
 * Users screen's Disable action was therefore not actually a lockout.
 *
 * The status check belongs in the guards that already exist, and it must read
 * exactly like the missing-user / wrong-password failure: the response for a
 * disabled account has to be byte-for-byte indistinguishable from a wrong
 * password, or the endpoint becomes an account-state oracle ("does this email
 * exist, and is it disabled?").
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

interface LoginData {
	token: string;
	user: { id: string; email: string; full_name: string };
}

async function login(email: string, password: string): Promise<{ status: number; body: Envelope<LoginData> }> {
	const res = await SELF.fetch(`${BASE_URL}/api/auth/login`, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({ email, password }),
	});
	return { status: res.status, body: (await res.json()) as Envelope<LoginData> };
}

async function setStatus(id: string, status: 'active' | 'disabled'): Promise<void> {
	const res = await SELF.fetch(`${BASE_URL}/api/users/${id}`, {
		method: 'PUT',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify({ status }),
	});
	expect(res.status, ((await res.json()) as { error?: string }).error ?? '').toBe(200);
}

describe('a disabled account cannot sign in', () => {
	// A distinctive address of its own so this suite can never collide with (or
	// depend on) another file's fixtures.
	const EMAIL = 'disabled-login@test.local';
	const PASSWORD = 'disabled-login-pass';

	it('refuses a disabled account with the SAME message as a wrong password, and re-enabling restores sign-in', async () => {
		// 1. An admin creates the account (the route returns `{ id, email, full_name }`).
		const created = await SELF.fetch(`${BASE_URL}/api/users`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ email: EMAIL, password: PASSWORD, full_name: 'Disabled Login Probe' }),
		});
		const createdBody = (await created.json()) as Envelope<{ id: string; email: string; full_name: string }>;
		expect(created.status, createdBody.error ?? '').toBe(201);
		const id = createdBody.data.id;
		expect(id).toBeTruthy();

		// 2. Baseline: an ACTIVE account with the right password signs in and gets a token.
		const baseline = await login(EMAIL, PASSWORD);
		expect(baseline.status, baseline.body.error ?? '').toBe(200);
		expect(typeof baseline.body.data.token).toBe('string');
		expect(baseline.body.data.token.length).toBeGreaterThan(0);

		// 3. Admin disables it — the Studio Users screen's Disable action.
		await setStatus(id, 'disabled');

		// 4. The correct password is now REFUSED, and the response is the wrong-password
		//    response: 401 + the exact same message. No token is minted at all, so the
		//    client never gets the dead token it used to be handed.
		const disabled = await login(EMAIL, PASSWORD);
		expect(disabled.status, disabled.body.error ?? '').toBe(401);
		expect(disabled.body.success).toBe(false);
		expect(disabled.body.error).toBe('Invalid email or password');
		expect(disabled.body.data).toBeUndefined();

		// 5. Reversible: re-enabling restores sign-in, so the check is not a one-way door.
		await setStatus(id, 'active');
		const reenabled = await login(EMAIL, PASSWORD);
		expect(reenabled.status, reenabled.body.error ?? '').toBe(200);
		expect(typeof reenabled.body.data.token).toBe('string');

		// 6. The two failures are indistinguishable: a WRONG password for the (active)
		//    same account yields the same 401, the same error text and the same code —
		//    so no caller can use this endpoint to enumerate account state.
		const wrongPassword = await login(EMAIL, `${PASSWORD}-wrong`);
		expect(wrongPassword.status, wrongPassword.body.error ?? '').toBe(401);
		expect(wrongPassword.body.error).toBe(disabled.body.error);
		expect(wrongPassword.body.code).toBe(disabled.body.code);
	});
});
