/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { D1Client } from '@mmbix/core';

/**
 * HR request notifications — who learns what, when.
 *
 *   1. **Filed** (draft → `pending_review`) notifies the requester's recorded
 *      superior(s). The write rides a FIRE-AND-FORGET compiled hook, so the
 *      test polls for the durable row.
 *   2. **Decided** (approve/reject) notifies the requester — awaited by the
 *      decide route, so the row is present when the response lands.
 *   3. A request with NO recorded superior notifies nobody (deny-by-default).
 *
 * Telegram itself is not exercised: the test env carries no `TELEGRAM_BOT_TOKEN`,
 * so `sendTelegramMessage` short-circuits. The assertions are on the durable
 * `hr_notifications` rows, which are the in-app fallback and the unit the DM is
 * built from.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface Envelope {
	success?: boolean;
	data?: Record<string, unknown>;
	error?: string;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
	return SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...JSON_HEADERS, ...ADMIN, ...(init.headers ?? {}) },
	});
}

async function body<T = Record<string, unknown>>(res: Response): Promise<T> {
	const parsed = (await res.json().catch(() => ({}))) as Envelope;
	return (parsed.data ?? {}) as T;
}

const jsonPost = (path: string, payload: unknown) => call(path, { method: 'POST', body: JSON.stringify(payload) });
const jsonPut = (path: string, payload: unknown) => call(path, { method: 'PUT', body: JSON.stringify(payload) });

async function ensureCollection(slug: string, extra: Record<string, unknown>): Promise<void> {
	const res = await jsonPost('/api/collections', { name: slug, slug, ...extra });
	expect([201, 409]).toContain(res.status);
}

const db = new D1Client(env.DB);

/** Every notification row for a reference (a request id), newest first. */
async function notificationsFor(referenceId: string): Promise<Array<Record<string, unknown>>> {
	return db.all<Record<string, unknown>>({
		sql: 'SELECT * FROM cms_hr_notifications WHERE reference_id = ?1',
		bindings: [referenceId],
	});
}

/** The filed notification rides a fire-and-forget hook — poll until it lands. */
async function waitForNotification(referenceId: string, tgId: string): Promise<Record<string, unknown> | undefined> {
	for (let attempt = 0; attempt < 40; attempt++) {
		const rows = await notificationsFor(referenceId);
		const hit = rows.find((r) => r.tg_id === tgId);
		if (hit) return hit;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return (await notificationsFor(referenceId)).find((r) => r.tg_id === tgId);
}

let superior = '';
let subordinate = '';
let lonely = '';
let _roleId = '';

/** A draft leave row for `employeeId`. */
async function seedDraftLeave(employeeId: string, reason: string): Promise<string> {
	const created = await jsonPost('/api/entities/hrm_leaves', {
		employee: employeeId,
		start_date: '2033-04-01',
		end_date: '2033-04-01',
		leave_duration_type: 'full_day',
		reason,
	});
	expect(created.status).toBe(201);
	return String((await body(created)).id);
}

/** A leave submitted for review (draft → pending_review) — the filing event. */
async function seedPendingLeave(employeeId: string, reason: string): Promise<string> {
	const id = await seedDraftLeave(employeeId, reason);
	const hop = await jsonPut(`/api/entities/hrm_leaves/${id}`, { doc_status: 'pending_review' });
	expect(hop.status).toBe(200);
	return id;
}

beforeAll(async () => {
	await ensureCollection('hrm_employees', {
		fields: [
			{ name: 'etg_id', type: 'text', required: false },
			{ name: 'name_en', type: 'text', required: false },
			{ name: 'name_mm', type: 'text', required: false },
		],
	});
	await ensureCollection('hrm_employee_links', {
		fields: [
			{ name: 'superior', type: 'm2o', required: true, related_collection: 'hrm_employees' },
			{ name: 'subordinate', type: 'm2o', required: true, related_collection: 'hrm_employees' },
		],
	});
	await ensureCollection('hrm_leaves', {
		fields: [
			{ name: 'employee', type: 'm2o', required: true, related_collection: 'hrm_employees' },
			{ name: 'start_date', type: 'date', required: true },
			{ name: 'end_date', type: 'date', required: true },
			{ name: 'leave_duration_type', type: 'select', required: false, options: ['full_day', 'half_day', 'multi_day'] },
			{ name: 'reason', type: 'longtext', required: false },
			{ name: 'superior_comment', type: 'longtext', required: false },
			{ name: 'approved_by', type: 'm2o', required: false, related_collection: 'hrm_employees' },
		],
	});
	await ensureCollection('hr_notifications', {
		fields: [
			{ name: 'tg_id', type: 'text', required: false },
			{ name: 'title', type: 'text', required: true },
			{ name: 'body', type: 'longtext', required: false },
			{ name: 'type', type: 'select', required: false, options: ['approval', 'info', 'reminder'], default: 'info' },
			{ name: 'reference_id', type: 'text', required: false },
			{ name: 'read', type: 'boolean', required: false, default: false },
		],
	});

	const mkEmp = async (etg: string, name: string) => {
		const res = await jsonPost('/api/entities/hrm_employees', { etg_id: etg, name_en: name });
		expect(res.status).toBe(201);
		return String((await body(res)).id);
	};
	superior = await mkEmp('notify-sup', 'Superior');
	subordinate = await mkEmp('notify-sub', 'Subordinate');
	lonely = await mkEmp('notify-lonely', 'Lonely');
	expect((await jsonPost('/api/entities/hrm_employee_links', { superior, subordinate })).status).toBe(201);

	// The role grant is not needed for admin-token writes, but the collection must
	// be readable by the engine's migration path (idempotent setup).
	const role = await jsonPost('/api/users/roles', { name: 'HR Notify Role', description: 'notify test' });
	expect(role.status).toBe(201);
	_roleId = String((await body(role)).id);
});

describe('a filed request notifies the recorded superior', () => {
	it('writes ONE durable approval notification for the superior on submit', async () => {
		const id = await seedPendingLeave(subordinate, 'need approval');
		const row = await waitForNotification(id, 'notify-sup');
		expect(row, 'superior notification').toBeTruthy();
		expect(row?.type).toBe('approval');
		expect(String(row?.title)).toContain('📝');
		expect(String(row?.title)).toContain('ခွင့်');
		expect(String(row?.body)).toContain('Subordinate');
		// The requester is NOT notified that they filed their own request.
		expect((await notificationsFor(id)).some((r) => r.tg_id === 'notify-sub')).toBe(false);
	});

	it('a draft (never submitted) notifies nobody', async () => {
		const id = await seedDraftLeave(subordinate, 'still a draft');
		// Give the (never-fired) hook a moment; nothing should appear.
		await new Promise((resolve) => setTimeout(resolve, 75));
		expect(await notificationsFor(id)).toHaveLength(0);
	});

	it('a request with no recorded superior notifies nobody', async () => {
		const id = await seedPendingLeave(lonely, 'no superior');
		await new Promise((resolve) => setTimeout(resolve, 75));
		expect(await notificationsFor(id)).toHaveLength(0);
	});
});

describe('a decided request notifies the requester', () => {
	it('an approval tells the requester the outcome', async () => {
		const id = await seedPendingLeave(subordinate, 'approve me');
		const res = await jsonPost(`/api/hr/requests/leave/${id}/decide`, { action: 'approved' });
		expect(res.status).toBe(200);
		const row = (await notificationsFor(id)).find((r) => r.tg_id === 'notify-sub');
		expect(row, 'requester notification').toBeTruthy();
		expect(row?.type).toBe('info');
		expect(String(row?.title)).toContain('✅');
	});

	it('a rejection carries the reason', async () => {
		const id = await seedPendingLeave(subordinate, 'reject me');
		const res = await jsonPost(`/api/hr/requests/leave/${id}/decide`, { action: 'rejected', reason: 'လူမလုံလောက်' });
		expect(res.status).toBe(200);
		const row = (await notificationsFor(id)).find((r) => r.tg_id === 'notify-sub');
		expect(String(row?.title)).toContain('❌');
		expect(String(row?.body)).toContain('လူမလုံလောက်');
	});

	it('a self-cancel notifies nobody (the requester already knows)', async () => {
		const id = await seedPendingLeave(subordinate, 'cancel me');
		const res = await jsonPost(`/api/hr/requests/leave/${id}/decide`, { action: 'cancelled' });
		expect(res.status).toBe(200);
		expect((await notificationsFor(id)).some((r) => r.tg_id === 'notify-sub')).toBe(false);
	});
});
