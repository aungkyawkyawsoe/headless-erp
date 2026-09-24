/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { D1Client, QueryBuilder } from '@mmbix/core';
import { buildConfig } from '@mmbix/config';
import { AuthService } from '@/lib/services/auth.service';
import { ensureProvisionedTelegramRole } from '@/lib/services/telegram-role.service';

/**
 * The notification inbox is PERSONAL — the Telegram Employee role carries a
 * self-only row filter on `hr_notifications` (`tg_id = $CURRENT_USER.tg_id`, the
 * id derived from the `tg-<id>@telegram.local` email). Without it the shared
 * inbox collection would surface every colleague's notifications (and let them
 * be marked read) through the generic entity API. The privileged write paths
 * (HR decide, MRO approve/issue) never touch this filter — they run as admin.
 *
 * This pins BOTH halves: a read returns only the session's own rows, and a
 * write to someone else's row is refused.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const db = new D1Client(env.DB);

async function call(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
	return SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...JSON_HEADERS, ...(token ? { Authorization: `Bearer ${token}` } : ADMIN), ...(init.headers ?? {}) },
	});
}

const jsonPost = (path: string, payload: unknown) => call(path, { method: 'POST', body: JSON.stringify(payload) });
const jsonPut = (path: string, payload: unknown, token: string) => call(path, { method: 'PUT', body: JSON.stringify(payload) }, token);

async function ensureCollection(slug: string, fields: unknown[]): Promise<void> {
	const res = await jsonPost('/api/collections', { name: slug, slug, fields });
	expect([201, 409]).toContain(res.status);
}

let tokenA = '';
let _tokenB = '';
let notifB = '';

beforeAll(async () => {
	await ensureCollection('hr_notifications', [
		{ name: 'tg_id', type: 'text', required: false },
		{ name: 'title', type: 'text', required: true },
		{ name: 'body', type: 'longtext', required: false },
		{ name: 'type', type: 'select', required: false, options: ['approval', 'info', 'reminder'], default: 'info' },
		{ name: 'reference_id', type: 'text', required: false },
		{ name: 'read', type: 'boolean', required: false, default: false },
	]);

	// Provision the REAL Employee role (grants + the self row filters) exactly as
	// a Telegram login would — so this test exercises the shipping filter, not a
	// copy of it.
	const cfg = buildConfig({ IS_DEV: 'true' });
	await ensureProvisionedTelegramRole(db, cfg);
	const role = await db.first<{ id: string }>(QueryBuilder.from('_roles').select('id').where('name', cfg.telegram.roleName).toSelect());
	expect(role?.id).toBeTruthy();
	const roleId = role!.id;

	const secret = (env as unknown as Record<string, string>).JWT_SECRET;
	const auth = new AuthService(db);
	const mkUser = async (id: string, email: string): Promise<string> => {
		await db.run(
			QueryBuilder.from('_users').toInsert({
				id,
				email,
				full_name: email,
				password_hash: 'x',
				role_id: roleId,
				status: 'active',
			}),
		);
		return auth.generateToken(id, secret);
	};
	tokenA = await mkUser('e0b00000-0000-4000-8000-00000000000a', 'tg-880001@telegram.local');
	_tokenB = await mkUser('e0b00000-0000-4000-8000-00000000000b', 'tg-880002@telegram.local');

	const mkNotif = async (id: string, tgId: string, title: string): Promise<string> => {
		await db.run(
			QueryBuilder.from('cms_hr_notifications').toInsert({
				id,
				tg_id: tgId,
				title,
				body: 'hello',
				type: 'info',
				read: 0,
			}),
		);
		return id;
	};
	await mkNotif('e0c00000-0000-4000-8000-00000000000a', '880001', 'Mine A');
	notifB = await mkNotif('e0c00000-0000-4000-8000-00000000000b', '880002', 'Theirs B');
});

describe('notification inbox is self-scoped', () => {
	it('a Telegram session reads ONLY its own notifications', async () => {
		const res = await call('/api/entities/hr_notifications?limit=100', {}, tokenA);
		expect(res.status).toBe(200);
		const rows = (await res.json()) as unknown as { data: Array<{ tg_id?: string }> };
		expect(rows.data.length).toBeGreaterThan(0);
		expect(rows.data.every((r) => r.tg_id === '880001')).toBe(true);
	});

	it('a Telegram session cannot mark another session’s notification read', async () => {
		const res = await jsonPut(`/api/entities/hr_notifications/${notifB}`, { read: true }, tokenA);
		expect(res.status).toBeGreaterThanOrEqual(400);
		const still = await db.first<{ read: unknown }>(
			QueryBuilder.from('cms_hr_notifications').select('read').where('id', notifB).toSelect(),
		);
		expect(Boolean(Number(still?.read))).toBe(false);
	});

	it('a Telegram session CAN mark its own notification read', async () => {
		const mine = await db.first<{ id: string }>(QueryBuilder.from('cms_hr_notifications').select('id').where('tg_id', '880001').toSelect());
		const res = await jsonPut(`/api/entities/hr_notifications/${mine!.id}`, { read: true }, tokenA);
		expect(res.status).toBe(200);
		const row = await db.first<{ read: unknown }>(
			QueryBuilder.from('cms_hr_notifications').select('read').where('id', mine!.id).toSelect(),
		);
		expect(Boolean(Number(row?.read))).toBe(true);
	});

	it('a session with no Telegram link reads nothing (deny-by-default)', async () => {
		// An admin bypasses row filters, so this uses a THIRD telegram-less identity
		// on the same role: its tg_id is absent, so the filter matches nothing.
		const cfg = buildConfig({ IS_DEV: 'true' });
		const role = await db.first<{ id: string }>(QueryBuilder.from('_roles').select('id').where('name', cfg.telegram.roleName).toSelect());
		await db.run(
			QueryBuilder.from('_users').toInsert({
				id: 'e0b00000-0000-4000-8000-00000000000c',
				email: 'plain@example.com',
				full_name: 'plain',
				password_hash: 'x',
				role_id: role!.id,
				status: 'active',
			}),
		);
		const secret = (env as unknown as Record<string, string>).JWT_SECRET;
		const token = await new AuthService(db).generateToken('e0b00000-0000-4000-8000-00000000000c', secret);
		const res = await call('/api/entities/hr_notifications?limit=100', {}, token);
		expect(res.status).toBe(200);
		const rows = (await res.json()) as unknown as { data: unknown[] };
		expect(rows.data).toHaveLength(0);
	});
});
