/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Per-employee RBAC on Telegram login:
 *
 * The directory row (`hrm_employees.etg_id`) names the employee AND their role
 * (`hrm_employees.role`, a `_roles` name). Login must grant THAT role — not the
 * one hardcoded default — so `/auth/me` returns the role's `app_access` and the
 * Mini App launcher shows only allowed apps. A blank/unknown role falls back to
 * the configured default (Employee), and an admin changing the directory role
 * takes effect on the next sign-in (the `_users` row is re-synced).
 *
 * The test env (wrangler.testco.jsonc) runs IS_DEV=true WITH a
 * TELEGRAM_BOT_TOKEN — dev trust mode does NOT apply and the directory gate is
 * enforced (same as production).
 */

const BASE_URL = 'http://localhost';
const BOT_TOKEN = 'test-bot-token';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

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

/** Read a raw column — the lean entity payload hides m2o FKs unless expanded, so
 *  the session-stamped actor is asserted at the storage layer, not over the wire. */
async function rawRow(table: string, id: string): Promise<Record<string, unknown> | null> {
	return env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
}

describe('telegram login grants the employee directory role', () => {
	const STOREKEEPER_APPS = ['attendance', 'tyres', 'store-requests'];
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
				name: 'hrm_employees',
				slug: 'hrm_employees',
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
			SELF.fetch(`${BASE_URL}/api/entities/hrm_employees`, {
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

		const upd = await SELF.fetch(`${BASE_URL}/api/entities/hrm_employees/${changedRowId}`, {
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

describe('telegram Employee role can use the MRO stock + transfer surface', () => {
	const TG_EMP_A = 51510010;
	const TG_EMP_B = 51510011;
	let tokenA = '';
	let tokenB = '';
	let empAId = '';
	let empBId = '';

	async function createCollection(slug: string, name: string, fields: unknown[], policies?: unknown): Promise<void> {
		const res = await SELF.fetch(`${BASE_URL}/api/collections`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ name, slug, fields, ...(policies ? { policies } : {}) }),
		});
		expect([201, 409]).toContain(res.status);
	}

	beforeAll(async () => {
		// The collections the mini app reads through the GENERIC entity API. A real
		// employee must be able to read them — the 'Couldn't read the stock balances'
		// report was a 403 because the config grant list was missing them.
		await createCollection('mro_inventory', 'MRO Inventory', [{ name: 'qty_on_hand', type: 'number', required: false }]);
		await createCollection('mro_stock_serials', 'MRO Stock Serials', [{ name: 'serial_no', type: 'text', required: false }]);
		// The composition read's own joins — created so the route resolves (and answers
		// 404 for an unknown model) instead of erroring on a missing table.
		await createCollection('mro_item_name', 'MRO Item Name', [
			{ name: 'name_en', type: 'text', required: false },
			{ name: 'name_mm', type: 'text', required: false },
			{ name: 'tracking', type: 'text', required: false },
		]);
		await createCollection('mro_item_model', 'MRO Item Model', [
			{ name: 'name_en', type: 'text', required: false },
			{ name: 'name_mm', type: 'text', required: false },
			{ name: 'image', type: 'text', required: false },
			{ name: 'item_name', type: 'm2o', required: false, related_collection: 'mro_item_name' },
		]);
		await createCollection(
			'mro_asset_requests',
			'MRO Asset Requests',
			[
				{ name: 'requested_by', type: 'm2o', required: false, related_collection: 'hrm_employees' },
				{ name: 'status', type: 'text', required: false },
				{ name: 'note', type: 'text', required: false },
			],
			{ actor_fields: ['requested_by'], writes: { frozen_fields: ['status'] } },
		);

		for (const [id, name] of [
			[TG_EMP_A, 'Emp A'],
			[TG_EMP_B, 'Emp B'],
		] as const) {
			const res = await SELF.fetch(`${BASE_URL}/api/entities/hrm_employees`, {
				method: 'POST',
				headers: { ...JSON_HEADERS, ...ADMIN },
				body: JSON.stringify({ etg_id: String(id), name_mm: name }),
			});
			expect(res.status).toBe(201);
			const rowId = ((await res.json()) as { data: { id: string } }).data.id;
			if (id === TG_EMP_A) empAId = rowId;
			else empBId = rowId;
		}

		tokenA = (await login(TG_EMP_A)).token!;
		tokenB = (await login(TG_EMP_B)).token!;
	});

	it('reads the stock balances and the tyre serials the mini app fetches', async () => {
		for (const slug of ['mro_inventory', 'mro_stock_serials']) {
			const res = await SELF.fetch(`${BASE_URL}/api/entities/${slug}?limit=1`, { headers: { Authorization: `Bearer ${tokenA}` } });
			expect(res.status).toBe(200);
		}
	});

	it('reaches the server-scoped stock composition (never a per-collection 403)', async () => {
		// The drill-down page's read. A missing model answers 404 — the point is that it
		// is NOT a 403: the route is server-scoped precisely because `mro_stock_lots` is
		// absent from the Employee role's config grant list, so a generic
		// `/api/entities/mro_stock_lots` read would deny a real employee.
		const res = await SELF.fetch(`${BASE_URL}/api/mro/stock/items/dddd0000-0000-4000-8000-0000000000d1`, {
			headers: { Authorization: `Bearer ${tokenA}` },
		});
		expect(res.status).toBe(404);
	});

	it('files a transfer request stamped to the session, and a peer cannot touch it', async () => {
		// A forged actor in the payload is ignored: `actor_fields` binds A's own
		// directory id from the signed session, so a two-person rule cannot be
		// defeated by naming someone else as the filer.
		const created = await SELF.fetch(`${BASE_URL}/api/entities/mro_asset_requests`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, Authorization: `Bearer ${tokenA}` },
			body: JSON.stringify({ note: 'move it', requested_by: empBId }),
		});
		expect(created.status).toBe(201);
		const rowId = ((await created.json()) as { data: { id: string } }).data.id;

		const stored = await rawRow('cms_mro_asset_requests', rowId);
		expect(stored?.requested_by).toBe(empAId);

		// B (same Employee role) may not update A's request — the self row filter.
		const blocked = await SELF.fetch(`${BASE_URL}/api/entities/mro_asset_requests/${rowId}`, {
			method: 'PUT',
			headers: { ...JSON_HEADERS, Authorization: `Bearer ${tokenB}` },
			body: JSON.stringify({ note: 'hijacked' }),
		});
		expect(blocked.status).toBe(403);
	});

	it('re-applies the config grants on a session check, not only at login', async () => {
		// The state that produced the "Couldn't read the stock balances" report on a
		// LIVE deployment: the config grants `mro_inventory`, but the role row of an
		// already-signed-in employee predates it. The JWT is long-lived and the
		// WebView keeps it, so login never re-runs — only `/auth/me` (fetched on
		// every app load) can heal the grants for that session.
		const role = await env.DB.prepare('SELECT id FROM _roles WHERE name = ?').bind('Employee').first<{ id: string }>();
		expect(role).not.toBeNull();
		await env.DB.prepare('DELETE FROM _role_permissions WHERE role_id = ? AND collection_slug = ?').bind(role!.id, 'mro_inventory').run();
		const gone = await env.DB.prepare('SELECT id FROM _role_permissions WHERE role_id = ? AND collection_slug = ?')
			.bind(role!.id, 'mro_inventory')
			.first();
		expect(gone).toBeNull();

		// A's session check must re-apply the config list (the same heal login does).
		const me = await meApps(tokenA);
		expect(me.role_name).toBe('Employee');

		const healed = await env.DB.prepare('SELECT can_read FROM _role_permissions WHERE role_id = ? AND collection_slug = ?')
			.bind(role!.id, 'mro_inventory')
			.first<{ can_read: number }>();
		expect(healed?.can_read).toBe(1);
	});
});
