/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { D1Client } from '@mmbix/core';
import { AuthService } from '../src/lib/services/auth.service';

/**
 * Telegram session revocation contract:
 *
 * The directory (directory.etg_id) is the source of truth for "approved".
 * Removing the employee's etg_id must revoke the session IMMEDIATELY — GET
 * /api/auth/me 401s (the mini app validates on every load and logs the user
 * out), and the next login falls back to `pending`.
 *
 * The test env (wrangler.testco.jsonc) runs IS_DEV=true WITH a
 * TELEGRAM_BOT_TOKEN — so dev trust mode does NOT apply and the directory gate
 * is enforced (same as production).
 */

const BASE_URL = 'http://localhost';
const BOT_TOKEN = 'test-bot-token';
const TG_ID = 42424242;
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Build a Telegram initData string signed with the bot token (HMAC-SHA256,
 *  keyed by SHA256(token) with the "WebAppData" secret — mirrors the API's
 *  validateInitData). */
async function buildInitData(tgUser: Record<string, unknown>, botToken: string): Promise<string> {
	const authDate = Math.floor(Date.now() / 1000);
	const userJson = JSON.stringify(tgUser);
	const checkString = [
		['auth_date', String(authDate)],
		['user', userJson],
	]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${k}=${v}`)
		.join('\n');

	const encoder = new TextEncoder();
	const secretKey = await crypto.subtle.importKey('raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const secret = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(botToken));
	const dataKey = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = await crypto.subtle.sign('HMAC', dataKey, encoder.encode(checkString));
	const hash = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');

	return new URLSearchParams({ user: userJson, auth_date: String(authDate), hash }).toString();
}

/** Sign in a Telegram user through the real login route; asserts `approved`. */
async function loginAs(tgId: number, firstName = 'Test'): Promise<string> {
	const initData = await buildInitData({ id: tgId, first_name: firstName, username: `u${tgId}` }, BOT_TOKEN);
	const login = await SELF.fetch(`${BASE_URL}/api/auth/telegram`, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({ initData }),
	});
	expect(login.status).toBe(200);
	const body = (await login.json()) as { data: { status: string; token: string } };
	expect(body.data.status).toBe('approved');
	return body.data.token;
}

/** Create a directory employee carrying the given etg_id; returns its row id. */
async function createEmployee(body: Record<string, unknown>): Promise<string> {
	const res = await SELF.fetch(`${BASE_URL}/api/entities/directory`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify(body),
	});
	expect(res.status).toBe(201);
	return ((await res.json()) as { data: { id: string } }).data.id;
}

describe('telegram session revocation (directory gate on /api/auth/me)', () => {
	let directoryId: string;
	let token: string;

	beforeAll(async () => {
		// Seed the directory: the configured directory collection + a row carrying
		// the tg-id field (TELEGRAM_DIRECTORY_COLLECTION / _FIELD fixtures).
		const coll = await SELF.fetch(`${BASE_URL}/api/collections`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({
				name: 'directory',
				slug: 'directory',
				fields: [
					{ name: 'etg_id', type: 'text', required: false },
					{ name: 'name_mm', type: 'text', required: false },
					{ name: 'active', type: 'boolean', required: false },
					{ name: 'role', type: 'text', required: false },
				],
			}),
		});
		expect(coll.status).toBe(201);

		const row = await SELF.fetch(`${BASE_URL}/api/entities/directory`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ etg_id: String(TG_ID), name_mm: 'Test User' }),
		});
		expect(row.status).toBe(201);
		const rowBody = (await row.json()) as { data: { id: string } };
		directoryId = rowBody.data.id;

		// Sign in as the directory member — must be approved with a token.
		const initData = await buildInitData({ id: TG_ID, first_name: 'Test', username: 'tester' }, BOT_TOKEN);
		const login = await SELF.fetch(`${BASE_URL}/api/auth/telegram`, {
			method: 'POST',
			headers: JSON_HEADERS,
			body: JSON.stringify({ initData }),
		});
		expect(login.status).toBe(200);
		const loginBody = (await login.json()) as { data: { status: string; token: string } };
		expect(loginBody.data.status).toBe('approved');
		token = loginBody.data.token;
	});

	it('serves /auth/me while the tg_id is still linked', async () => {
		const res = await SELF.fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { email: string } };
		expect(body.data.email).toBe(`tg-${TG_ID}@telegram.local`);
	});

	it('revokes the session once the etg_id is removed from the directory', async () => {
		// Admin removes the employee's telegram link (sets etg_id to null).
		const clear = await SELF.fetch(`${BASE_URL}/api/entities/directory/${directoryId}`, {
			method: 'PUT',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ etg_id: null }),
		});
		expect(clear.status).toBe(200);

		// The previously valid token now 401s on the session-status endpoint.
		const res = await SELF.fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
		expect(res.status).toBe(401);
		const body = (await res.json()) as { success: boolean; code: string; error: string };
		expect(body.success).toBe(false);
		expect(body.code).toBe('UNAUTHORIZED');
		expect(body.error).toContain('no longer linked');
	});

	it('falls back to pending on the next login attempt', async () => {
		const initData = await buildInitData({ id: TG_ID, first_name: 'Test', username: 'tester' }, BOT_TOKEN);
		const login = await SELF.fetch(`${BASE_URL}/api/auth/telegram`, {
			method: 'POST',
			headers: JSON_HEADERS,
			body: JSON.stringify({ initData }),
		});
		expect(login.status).toBe(200);
		const loginBody = (await login.json()) as { data: { status: string; tg_id: string } };
		expect(loginBody.data.status).toBe('pending');
		expect(loginBody.data.tg_id).toBe(String(TG_ID));
	});
});

describe('directory gate — a deleted or deactivated employee loses access', () => {
	const TG_DEL = 51515151;
	const TG_OFF = 62626262;
	const me = (token: string) => SELF.fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
	let deletedId: string;
	let inactiveId: string;
	let deletedToken: string;
	let inactiveToken: string;

	beforeAll(async () => {
		deletedId = await createEmployee({ etg_id: String(TG_DEL), name_mm: 'To Delete' });
		inactiveId = await createEmployee({ etg_id: String(TG_OFF), name_mm: 'To Deactivate' });
		deletedToken = await loginAs(TG_DEL);
		inactiveToken = await loginAs(TG_OFF);
	});

	it('a soft-deleted employee can no longer read the session', async () => {
		// Sanity: the token is valid while the row is live.
		expect((await me(deletedToken)).status).toBe(200);

		// The row survives a soft delete (audit) — the gate must still revoke.
		const del = await SELF.fetch(`${BASE_URL}/api/entities/directory/${deletedId}`, {
			method: 'DELETE',
			headers: ADMIN,
		});
		expect(del.status).toBe(200);

		expect((await me(deletedToken)).status).toBe(401);
	});

	it('a deactivated employee (active=false) can no longer read the session', async () => {
		const off = await SELF.fetch(`${BASE_URL}/api/entities/directory/${inactiveId}`, {
			method: 'PUT',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ active: false }),
		});
		expect(off.status).toBe(200);

		expect((await me(inactiveToken)).status).toBe(401);
	});

	it('a deactivated employee also logs in as pending', async () => {
		const initData = await buildInitData({ id: TG_OFF, first_name: 'Test', username: 'off' }, BOT_TOKEN);
		const login = await SELF.fetch(`${BASE_URL}/api/auth/telegram`, {
			method: 'POST',
			headers: JSON_HEADERS,
			body: JSON.stringify({ initData }),
		});
		expect(login.status).toBe(200);
		const body = (await login.json()) as { data: { status: string } };
		expect(body.data.status).toBe('pending');
	});
});

describe('directory heal — a token minted under a dead employee re-binds to the live row', () => {
	const TG_HEAL = 71717171;

	/** The user id embedded in a minted token (payload = base64(JSON).sig). */
	function tokenPayload(token: string): { user_id: string; employee_id?: string } {
		const decoded = atob(token);
		const json = decoded.slice(0, decoded.lastIndexOf('.'));
		return JSON.parse(json) as { user_id: string; employee_id?: string };
	}

	it('heals the acting employee instead of writing under the deleted row', async () => {
		// The link the token was minted under.
		const rowA = await createEmployee({ etg_id: String(TG_HEAL), name_mm: 'Heal A' });
		const token = await loginAs(TG_HEAL);
		const embedded = tokenPayload(token);
		expect(embedded.employee_id).toBe(rowA);

		// Re-point the Telegram link to a LIVE row while the (24h) token survives.
		await SELF.fetch(`${BASE_URL}/api/entities/directory/${rowA}`, { method: 'DELETE', headers: ADMIN });
		const rowB = await createEmployee({ etg_id: String(TG_HEAL), name_mm: 'Heal B' });

		// The stale (pre-heal contract) token still carries rowA — verifyToken must
		// hand the caller the LIVE row (every write stamps its actor from this id).
		const secret = AuthService.resolveJwtSecret(env as { ADMIN_PASSWORD?: string; JWT_SECRET?: string; IS_DEV?: string });
		const db = new D1Client(env.DB as D1Database);
		const service = new AuthService(db);
		const healed = await service.verifyToken(token, secret, true, env);
		expect(healed?.employee_id).toBe(rowB);

		// A minted token with the DEAD link heals through the session's tg identity —
		// exactly the migrated-directory state the iPhone staff hit.
		const staleToken = await service.generateToken(embedded.user_id, secret, rowA);
		const healedStale = await service.verifyToken(staleToken, secret, true, env);
		expect(healedStale?.employee_id).toBe(rowB);
	});
});

describe('directory → RBAC role sync (the "changed the role but the tile is missing" report)', () => {
	const TG_SYNC = 81818181;
	/**
	 * The admin edits `directory.role` (Studio or raw SQL) while a long-lived
	 * JWT keeps the WebView alive: `/auth/me` must re-sync `_users.role_id` from
	 * the directory and report the NEW role's grants — otherwise the launcher keeps
	 * painting the old role's tiles (e.g. Projects missing after a promotion).
	 */
	it('reflects a directory role change on the next session check', async () => {
		// The Administrator role row the directory value resolves to (production has
		// it; the test DB needs it seeded once).
		const existingAdmin = await env.DB.prepare("SELECT id FROM _roles WHERE name = 'Administrator'").first();
		if (!existingAdmin) {
			await env.DB.prepare('INSERT INTO _roles (id, name, description, is_system) VALUES (?, ?, ?, 1)')
				.bind(crypto.randomUUID(), 'Administrator', 'Full system access')
				.run();
		}

		const rowId = await createEmployee({ etg_id: String(TG_SYNC), name_mm: 'Sync Probe', role: 'Employee' });
		const token = await loginAs(TG_SYNC);

		// Baseline: an Employee session (not an admin).
		const before = await SELF.fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
		expect(before.status).toBe(200);
		const beforeBody = (await before.json()) as { data: { is_admin: boolean; apps: string[] | null } };
		expect(beforeBody.data.is_admin).toBe(false);

		// The admin promotes the employee at the DIRECTORY — the reported workflow
		// (an out-of-band edit, exactly what a D1/Studio change is).
		const promote = await SELF.fetch(`${BASE_URL}/api/entities/directory/${rowId}`, {
			method: 'PUT',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ role: 'Administrator' }),
		});
		expect(promote.status).toBe(200);

		// The SAME token now answers as the Administrator — no re-login needed.
		const after = await SELF.fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
		expect(after.status).toBe(200);
		const afterBody = (await after.json()) as { data: { is_admin: boolean; role_name: string } };
		expect(afterBody.data.is_admin).toBe(true);
		expect(afterBody.data.role_name).toBe('Administrator');

		// And `_users` was actually persisted, so the very next request's RBAC
		// bypass (which reads `_users`, not the directory) is already admin.
		const userRow = await env.DB.prepare('SELECT role_id FROM _users WHERE email = ?')
			.bind(`tg-${TG_SYNC}@telegram.local`)
			.first<{ role_id: string }>();
		const adminRole = await env.DB.prepare("SELECT id FROM _roles WHERE name = 'Administrator'").first<{ id: string }>();
		expect(userRow?.role_id).toBe(adminRole?.id);
	});
});
