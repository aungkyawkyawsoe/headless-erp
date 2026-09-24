/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Per-employee RBAC on Telegram login:
 *
 * The directory row (`directory.etg_id`) names the employee AND their role
 * (`directory.role`, a `_roles` name). Login must grant THAT role — not the
 * one hardcoded default — so `/auth/me` returns the role's `app_access` and the
 * client launcher shows only allowed apps. A blank/unknown role falls back to
 * the configured default (Employee), and an admin changing the directory role
 * takes effect on the next sign-in (the `_users` row is re-synced).
 *
 * The test env (wrangler.testco.jsonc) runs IS_DEV=true WITH a
 * TELEGRAM_BOT_TOKEN — dev trust mode does NOT apply and the directory gate is
 * enforced (same as production). The directory collection + field are the
 * generic fixtures configured by TELEGRAM_DIRECTORY_COLLECTION / _FIELD.
 */

const BASE_URL = 'http://localhost';
const BOT_TOKEN = 'test-bot-token';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const DIRECTORY = 'directory';

/** Build a Telegram initData string signed with the bot token (mirrors the API's validateInitData). */
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

async function login(tgId: number): Promise<{ status: string; token?: string; user?: { role_name: string } }> {
	const initData = await buildInitData({ id: tgId, first_name: 'Test', username: `u${tgId}` }, BOT_TOKEN);
	const res = await SELF.fetch(`${BASE_URL}/api/auth/telegram`, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({ initData }),
	});
	expect(res.status).toBe(200);
	return ((await res.json()) as { data: { status: string; token?: string; user?: { role_name: string } } }).data;
}

async function meApps(token: string): Promise<{ role_name: string; apps: string[] | null }> {
	const res = await SELF.fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
	expect(res.status).toBe(200);
	return ((await res.json()) as { data: { role_name: string; apps: string[] | null } }).data;
}

describe('telegram login grants the employee directory role', () => {
	const STOREKEEPER_APPS = ['app-a', 'app-b'];
	const TG_STOREKEEPER = 51510001;
	const TG_NO_ROLE = 51510002;
	const TG_UNKNOWN = 51510003;
	const TG_CHANGED = 51510004;
	let changedRowId: string;

	beforeAll(async () => {
		// Directory collection with the RBAC role field.
		const coll = await SELF.fetch(`${BASE_URL}/api/collections`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({
				name: DIRECTORY,
				slug: DIRECTORY,
				fields: [
					{ name: 'etg_id', type: 'text', required: false },
					{ name: 'name_mm', type: 'text', required: false },
					{
						name: 'role',
						type: 'select',
						required: false,
						options: [
							{ value: 'Administrator', label: 'Administrator' },
							{ value: 'Employee', label: 'Employee' },
							{ value: 'Storekeeper', label: 'Storekeeper' },
						],
					},
				],
			}),
		});
		expect(coll.status).toBe(201);

		// A curated role with an app allow-list.
		const storekeeper = await SELF.fetch(`${BASE_URL}/api/users/roles`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ name: 'Storekeeper', description: 'test', app_access: STOREKEEPER_APPS }),
		});
		expect(storekeeper.status).toBe(201);

		const add = (etgId: number, role?: string) =>
			SELF.fetch(`${BASE_URL}/api/entities/${DIRECTORY}`, {
				method: 'POST',
				headers: { ...JSON_HEADERS, ...ADMIN },
				body: JSON.stringify({ etg_id: String(etgId), name_mm: `Emp ${etgId}`, ...(role ? { role } : {}) }),
			});

		for (const [id, role] of [
			[TG_STOREKEEPER, 'Storekeeper'],
			[TG_NO_ROLE, undefined],
			[TG_UNKNOWN, 'Ghost Role'],
			[TG_CHANGED, 'Employee'],
		] as const) {
			const res = await add(id, role);
			expect(res.status).toBe(201);
			if (id === TG_CHANGED) changedRowId = ((await res.json()) as { data: { id: string } }).data.id;
		}
	});

	it('grants the directory role and its app allow-list', async () => {
		const res = await login(TG_STOREKEEPER);
		expect(res.status).toBe('approved');
		expect(res.user?.role_name).toBe('Storekeeper');
		const me = await meApps(res.token!);
		expect(me.role_name).toBe('Storekeeper');
		expect(me.apps).toEqual(STOREKEEPER_APPS);
	});

	it('falls back to the default Employee role when the directory names no role', async () => {
		const res = await login(TG_NO_ROLE);
		expect(res.status).toBe('approved');
		expect(res.user?.role_name).toBe('Employee');
		const me = await meApps(res.token!);
		// The uncurated default role has app_access null ⇒ no launcher filter.
		expect(me.apps).toBeNull();
	});

	it('falls back to the default role when the directory role does not resolve', async () => {
		const res = await login(TG_UNKNOWN);
		expect(res.status).toBe('approved');
		expect(res.user?.role_name).toBe('Employee');
	});

	it('re-syncs the role on the next login when the directory changes', async () => {
		const first = await login(TG_CHANGED);
		expect(first.user?.role_name).toBe('Employee');

		const upd = await SELF.fetch(`${BASE_URL}/api/entities/${DIRECTORY}/${changedRowId}`, {
			method: 'PUT',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ role: 'Storekeeper' }),
		});
		expect(upd.status).toBe(200);

		const second = await login(TG_CHANGED);
		expect(second.user?.role_name).toBe('Storekeeper');
		const me = await meApps(second.token!);
		expect(me.apps).toEqual(STOREKEEPER_APPS);
	});
});
