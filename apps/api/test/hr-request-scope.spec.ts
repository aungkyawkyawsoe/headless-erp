/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { D1Client } from '@mmbix/core';
import { AuthService } from '@/lib/services/auth.service';

/**
 * HR request scoping + the punch time lock — the cross-employee gaps this pass
 * closed.
 *
 * 1. **Requests are read through a server-scoped feed.** `GET /api/hr/requests`
 *    resolves the scope from the SIGNED session + the reporting graph (`own` =
 *    the session employee; `approve` = their recorded direct subordinates, or
 *    everyone for an admin) — never a client-supplied identity. The Telegram role
 *    also carries a SELF-only row filter on the three request collections, so the
 *    generic `/api/entities` read can no longer surface a colleague's `reason`.
 * 2. **A decision is a server authorisation.** `POST /api/hr/requests/:kind/:id/decide`
 *    only lets a recorded superior (or an admin) approve/reject, and only the
 *    requester (or an admin) cancel — the client can never name itself an approver.
 * 3. **A punch's time is server-owned.** `POST /api/hr/attendances/punch` stamps it,
 *    and the compiled attendance time lock re-stamps every other write path, so a
 *    backdated `check_in` never lands.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface Envelope {
	success?: boolean;
	data?: Record<string, unknown>;
	error?: string;
	code?: string;
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

async function body<T = Record<string, unknown>>(res: Response): Promise<T> {
	const parsed = (await res.json().catch(() => ({}))) as Envelope;
	return (parsed.data ?? {}) as T;
}

const ROW_FILTER = { combiner: 'and', conditions: [{ field: 'employee', op: 'eq', value: '$CURRENT_USER.employee_id' }] };

let superior = '';
let subordinate = '';
let peer = '';
let superiorTok = '';
let peerTok = '';
let shiftId = '';

const jsonPost = (path: string, payload: unknown, token?: string) => call(path, { method: 'POST', body: JSON.stringify(payload) }, token);
const jsonPut = (path: string, payload: unknown, token?: string) => call(path, { method: 'PUT', body: JSON.stringify(payload) }, token);

/** Provision a collection (idempotent — a prior run in the same isolate). */
async function ensureCollection(slug: string, extra: Record<string, unknown>): Promise<void> {
	const res = await jsonPost('/api/collections', { name: slug, slug, ...extra });
	expect([201, 409]).toContain(res.status);
}

/** A pending leave request for an employee (admin-created, hopped to review). */
async function seedPendingLeave(employeeId: string, reason: string): Promise<string> {
	const created = await jsonPost('/api/entities/hrm_leaves', {
		employee: employeeId,
		start_date: '2032-04-01',
		end_date: '2032-04-01',
		leave_duration_type: 'full_day',
		reason,
	});
	expect(created.status).toBe(201);
	const id = String((await body(created)).id);
	const hop = await jsonPut(`/api/entities/hrm_leaves/${id}`, { doc_status: 'pending_review' });
	expect(hop.status).toBe(200);
	return id;
}

beforeAll(async () => {
	await ensureCollection('hrm_employees', {
		fields: [
			{ name: 'etg_id', type: 'text', required: false },
			{ name: 'name_en', type: 'text', required: false },
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
	await ensureCollection('hrm_shifts', {
		fields: [
			{ name: 'name', type: 'text', required: false },
			{ name: 'time_in', type: 'text', required: false },
			{ name: 'working_hours', type: 'number', required: false },
		],
	});
	await ensureCollection('hrm_attendances', {
		policies: { actor_fields: ['employee'] },
		fields: [
			{ name: 'employee', type: 'm2o', required: true, related_collection: 'hrm_employees' },
			{ name: 'check_in', type: 'datetime', required: true },
			{ name: 'check_out', type: 'datetime', required: false },
			{ name: 'shift', type: 'm2o', required: true, related_collection: 'hrm_shifts' },
			{ name: 'geo_in', type: 'text', required: false },
			{ name: 'geo_out', type: 'text', required: false },
		],
	});

	// ── roster ──────────────────────────────────────────────────────────────
	const mkEmp = async (etg: string, name: string) => {
		const res = await jsonPost('/api/entities/hrm_employees', { etg_id: etg, name_en: name });
		expect(res.status).toBe(201);
		return String((await body(res)).id);
	};
	superior = await mkEmp('scope-sup', 'Superior');
	subordinate = await mkEmp('scope-sub', 'Subordinate');
	peer = await mkEmp('scope-peer', 'Peer');
	expect((await jsonPost('/api/entities/hrm_employee_links', { superior, subordinate })).status).toBe(201);

	const shift = await jsonPost('/api/entities/hrm_shifts', { name: 'Day', time_in: '09:00', working_hours: 8 });
	expect(shift.status).toBe(201);
	shiftId = String((await body(shift)).id);

	// ── role + grants (the Telegram "Employee" role shape) ──────────────────
	const role = await jsonPost('/api/users/roles', { name: 'HR Scope Role', description: 'scoped HR reader/approver' });
	expect(role.status).toBe(201);
	const roleId = String((await body(role)).id);

	const grant = async (slug: string, rowFilters?: unknown) => {
		const res = await jsonPost('/api/users/permissions', {
			role_id: roleId,
			collection_slug: slug,
			can_read: 1,
			can_write: 1,
			can_create: 1,
			can_submit: 1,
			can_approve: 1,
			...(rowFilters ? { row_filters: JSON.stringify(rowFilters) } : {}),
		});
		expect([200, 201]).toContain(res.status);
	};
	await grant('hrm_employees');
	await grant('hrm_employee_links');
	await grant('hrm_shifts');
	await grant('hrm_leaves', ROW_FILTER);
	await grant('hrm_attendances', ROW_FILTER);

	// ── users + session-bound tokens (Telegram-shaped emails) ───────────────
	const secret = AuthService.resolveJwtSecret(env as { JWT_SECRET?: string; ADMIN_PASSWORD?: string; IS_DEV?: string });
	const auth = new AuthService(new D1Client(env.DB));
	const mkUser = async (etg: string, employeeId: string) => {
		const res = await jsonPost('/api/users', {
			email: `tg-${etg}@telegram.local`,
			password: 'hr-scope-pass',
			full_name: etg,
			role_id: roleId,
		});
		expect([200, 201]).toContain(res.status);
		const userId = String((await body(res)).id);
		return auth.generateToken(userId, secret, employeeId);
	};
	superiorTok = await mkUser('scope-sup', superior);
	peerTok = await mkUser('scope-peer', peer);
});

describe('HR request feed is server-scoped', () => {
	it('an approver sees a direct subordinate’s request', async () => {
		const id = await seedPendingLeave(subordinate, 'subordinate leave');
		const res = await call('/api/hr/requests?scope=approve&type=leave&status=pending', {}, superiorTok);
		expect(res.status).toBe(200);
		const { rows } = await body<{ rows: Array<Record<string, unknown>> }>(res);
		expect(rows.map((r) => r.id)).toContain(id);
	});

	it('a peer with no reporting line gets an empty feed (not an error)', async () => {
		await seedPendingLeave(subordinate, 'peer must not see this');
		const res = await call('/api/hr/requests?scope=approve&type=leave', {}, peerTok);
		expect(res.status).toBe(200);
		const { rows } = await body<{ rows: unknown[] }>(res);
		expect(rows).toHaveLength(0);
	});

	it('own scope returns only the session employee’s rows', async () => {
		const mine = await seedPendingLeave(subordinate, 'mine');
		const res = await call('/api/hr/requests?scope=own&type=leave', {}, superiorTok);
		expect(res.status).toBe(200);
		const { rows } = await body<{ rows: Array<Record<string, unknown>> }>(res);
		// The superior's own feed must not carry the subordinate's request.
		expect(rows.map((r) => r.id)).not.toContain(mine);
		expect(rows.every((r) => r._kind === 'leave')).toBe(true);
	});

	it('pending counts match the feed and never leak a peer’s queue', async () => {
		await seedPendingLeave(subordinate, 'count me');
		// The approver's real COUNT for the leave tab…
		const mine = await call('/api/hr/requests/counts?scope=approve', {}, superiorTok);
		expect(mine.status).toBe(200);
		const counts = await body<{ leave: number; ot: number; early: number }>(mine);
		const feed = await call('/api/hr/requests?scope=approve&type=leave&status=pending', {}, superiorTok);
		const { rows } = await body<{ rows: unknown[] }>(feed);
		// …must equal the rows the tab will actually show (a truthful badge, not a
		// capped page length).
		expect(counts.leave).toBe(rows.length);
		expect(counts.leave).toBeGreaterThan(0);

		// A peer with no reporting line gets zeros, exactly like their empty feed.
		const peer = await call('/api/hr/requests/counts?scope=approve', {}, peerTok);
		expect(await body<{ leave: number }>(peer)).toMatchObject({ leave: 0, ot: 0, early: 0 });
	});

	it('the generic entity read is self-only (role row filter)', async () => {
		await seedPendingLeave(subordinate, 'colleague secret');
		const res = await call('/api/entities/hrm_leaves?limit=100&fields=id,employee,reason', {}, peerTok);
		expect(res.status).toBe(200);
		const rows = (await res.json()) as unknown as { data: Array<{ employee?: unknown }> };
		// No peer row was ever seeded, so a well-scoped read returns nothing.
		expect(rows.data).toHaveLength(0);
	});
});

describe('HR request decision is server-authorised', () => {
	it('a recorded superior can approve a subordinate’s request', async () => {
		const id = await seedPendingLeave(subordinate, 'approve me');
		const res = await jsonPost(`/api/hr/requests/leave/${id}/decide`, { action: 'approved' }, superiorTok);
		expect(res.status).toBe(200);
		expect(String((await body(res)).doc_status)).toBe('approved');
	});

	it('an unrelated peer cannot decide it', async () => {
		const id = await seedPendingLeave(subordinate, 'not for peer');
		const res = await jsonPost(`/api/hr/requests/leave/${id}/decide`, { action: 'approved' }, peerTok);
		expect(res.status).toBe(403);
	});

	it('a rejection without a reason is refused', async () => {
		const id = await seedPendingLeave(subordinate, 'need a reason');
		const res = await jsonPost(`/api/hr/requests/leave/${id}/decide`, { action: 'rejected' }, superiorTok);
		expect(res.status).toBe(422);
	});

	it('only the requester (or an admin) can cancel', async () => {
		const id = await seedPendingLeave(subordinate, 'cancel me');
		const asPeer = await jsonPost(`/api/hr/requests/leave/${id}/decide`, { action: 'cancelled' }, peerTok);
		expect(asPeer.status).toBe(403);
		const asAdmin = await jsonPost(`/api/hr/requests/leave/${id}/decide`, { action: 'cancelled' });
		expect(asAdmin.status).toBe(200);
	});
});

describe('a punch time is server-owned', () => {
	it('stamps check-in server-side and closes the open row on check-out', async () => {
		const checkIn = await jsonPost(
			'/api/hr/attendances/punch',
			{ kind: 'in', shiftId, lat: 16.8, lng: 96.1, check_in: '2000-01-01T00:00:00.000Z' },
			superiorTok,
		);
		expect(checkIn.status).toBe(200);
		const punch = await body<{ id: string; timestamp?: string | null }>(checkIn);
		expect(Math.abs(Date.now() - Date.parse(String(punch.timestamp)))).toBeLessThan(60_000);

		const checkOut = await jsonPost('/api/hr/attendances/punch', { kind: 'out', lat: 16.8, lng: 96.1 }, superiorTok);
		expect(checkOut.status).toBe(200);
		const closed = await call(`/api/entities/hrm_attendances/${punch.id}?fields=check_in,check_out`, {}, superiorTok);
		const row = await body<{ check_in?: string; check_out?: string }>(closed);
		expect(row.check_out).toBeTruthy();
		expect(new Date(String(row.check_in)).getUTCFullYear()).toBeGreaterThan(2020);
	});

	it('re-stamps a backdated value sent to the generic entity API', async () => {
		const res = await jsonPost(
			'/api/entities/hrm_attendances',
			{ employee: subordinate, shift: shiftId, check_in: '2000-01-01T00:00:00.000Z' },
			superiorTok,
		);
		expect(res.status).toBe(201);
		const row = await body<{ check_in?: string }>(res);
		expect(Math.abs(Date.now() - Date.parse(String(row.check_in)))).toBeLessThan(60_000);
	});
});
