/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { D1Client } from '@mmbix/core';
import { AuthService } from '@/lib/services/auth.service';

/**
 * Team Tracking — the server-scoped attendance reads.
 *
 * `hrm_attendances` carries a SELF-only role row filter, so a generic entity
 * read can never surface a colleague's punches. A supervisor views their direct
 * reports' attendance ONLY through the two routes pinned here:
 *
 *   GET /api/hr/attendances/team?search=            — the viewable roster
 *   GET /api/hr/attendances/employee/:id?days=7     — identity + day rows + leaves
 *
 * Scope is resolved from the SIGNED session + `hrm_employee_links` (self +
 * direct subordinates; an admin sees everyone), the reads run privileged so the
 * row filter can't shrink the target, and the projection is explicit — a viewer
 * gets punches + minimal identity, never a whole directory row. The window is
 * bounded (`days`), so an old punch never leaks into the week view.
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

const jsonPost = (path: string, payload: unknown, token?: string) => call(path, { method: 'POST', body: JSON.stringify(payload) }, token);

async function ensureCollection(slug: string, extra: Record<string, unknown>): Promise<void> {
	const res = await jsonPost('/api/collections', { name: slug, slug, ...extra });
	expect([201, 409]).toContain(res.status);
}

/** Raw insert that BYPASSES the entity engine (and the attendance time lock) —
 *  the only way to place a backdated punch for the window test. */
async function insertRaw(row: Record<string, unknown>): Promise<void> {
	const cols = Object.keys(row);
	const table = 'cms_hrm_attendances';
	await env.DB.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
		.bind(...cols.map((c) => row[c] as never))
		.run();
}

let superior = '';
let subordinate = '';
let peer = '';
/** A dedicated direct report read ONLY by the window test — the engine's read
 *  cache is keyed on the query (employee + day-truncated cutoff), so a target
 *  no earlier test read keeps the raw-inserted rows visible (raw writes bypass
 *  the cache invalidation the engine's own writes perform). */
let weekTarget = '';
let superiorTok = '';
let peerTok = '';
let shiftId = '';

beforeAll(async () => {
	// Masters referenced by the employee projection.
	await ensureCollection('hrm_departments', { fields: [{ name: 'name', type: 'text', required: false }] });
	await ensureCollection('hrm_designations', { fields: [{ name: 'name', type: 'text', required: false }] });
	await ensureCollection('hrm_employees', {
		fields: [
			{ name: 'etg_id', type: 'text', required: false },
			{ name: 'name_en', type: 'text', required: false },
			{ name: 'name_mm', type: 'text', required: false },
			{ name: 'eid', type: 'text', required: false },
			{ name: 'avatar', type: 'text', required: false },
			{ name: 'department', type: 'm2o', required: false, related_collection: 'hrm_departments' },
			{ name: 'designation', type: 'm2o', required: false, related_collection: 'hrm_designations' },
		],
	});
	await ensureCollection('hrm_employee_links', {
		fields: [
			{ name: 'superior', type: 'm2o', required: true, related_collection: 'hrm_employees' },
			{ name: 'subordinate', type: 'm2o', required: true, related_collection: 'hrm_employees' },
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
	await ensureCollection('hrm_leaves', {
		fields: [
			{ name: 'employee', type: 'm2o', required: true, related_collection: 'hrm_employees' },
			{ name: 'start_date', type: 'date', required: true },
			{ name: 'end_date', type: 'date', required: true },
			{ name: 'leave_duration_type', type: 'select', required: false, options: ['full_day', 'half_day', 'multi_day'] },
		],
	});

	// ── roster ──────────────────────────────────────────────────────────────
	const mkEmp = async (etg: string, name: string) => {
		const res = await jsonPost('/api/entities/hrm_employees', { etg_id: etg, name_en: name });
		expect(res.status).toBe(201);
		return String((await body(res)).id);
	};
	superior = await mkEmp('team-sup', 'Superior');
	subordinate = await mkEmp('team-sub', 'Subordinate');
	peer = await mkEmp('team-peer', 'Peer');
	weekTarget = await mkEmp('team-week', 'Week Target');
	expect((await jsonPost('/api/entities/hrm_employee_links', { superior, subordinate })).status).toBe(201);
	expect((await jsonPost('/api/entities/hrm_employee_links', { superior, subordinate: weekTarget })).status).toBe(201);

	const shift = await jsonPost('/api/entities/hrm_shifts', { name: 'Day', time_in: '09:00', working_hours: 8 });
	expect(shift.status).toBe(201);
	shiftId = String((await body(shift)).id);

	// ── role + grants (a Telegram "Employee" shape: hrm_attendances self-only) ─
	const role = await jsonPost('/api/users/roles', { name: 'HR Team Role', description: 'team attendance reader' });
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
	await grant('hrm_attendances', ROW_FILTER);

	// ── users + session-bound tokens (Telegram-shaped emails) ───────────────
	const secret = AuthService.resolveJwtSecret(env as { JWT_SECRET?: string; ADMIN_PASSWORD?: string; IS_DEV?: string });
	const auth = new AuthService(new D1Client(env.DB));
	const mkUser = async (etg: string, employeeId: string) => {
		const res = await jsonPost('/api/users', {
			email: `tg-${etg}@telegram.local`,
			password: 'hr-team-pass',
			full_name: etg,
			role_id: roleId,
		});
		expect([200, 201]).toContain(res.status);
		const userId = String((await body(res)).id);
		return auth.generateToken(userId, secret, employeeId);
	};
	superiorTok = await mkUser('team-sup', superior);
	peerTok = await mkUser('team-peer', peer);
});

describe('Team Tracking roster is server-scoped', () => {
	it('a supervisor sees a direct report, never an unrelated peer', async () => {
		const res = await call('/api/hr/attendances/team', {}, superiorTok);
		expect(res.status).toBe(200);
		const { rows } = await body<{ rows: Array<{ id: string }> }>(res);
		const ids = rows.map((r) => r.id);
		expect(ids).toContain(subordinate);
		expect(ids).not.toContain(peer);
	});

	it('the roster is REPORTS only — the session employee is not listed', async () => {
		const res = await call('/api/hr/attendances/team', {}, superiorTok);
		const { rows } = await body<{ rows: Array<{ id: string }> }>(res);
		expect(rows.map((r) => r.id)).not.toContain(superior);
	});

	it('an employee with no reports gets an empty roster (not an error)', async () => {
		const res = await call('/api/hr/attendances/team', {}, peerTok);
		expect(res.status).toBe(200);
		const { rows } = await body<{ rows: Array<{ id: string }> }>(res);
		expect(rows).toEqual([]);
	});

	it('the roster projection never leaks a whole directory row', async () => {
		const res = await call('/api/hr/attendances/team', {}, superiorTok);
		const { rows } = await body<{ rows: Array<Record<string, unknown>> }>(res);
		expect(rows.length).toBeGreaterThan(0);
		expect(Object.keys(rows[0])).not.toContain('etg_id');
	});

	it('an admin sees anyone', async () => {
		const res = await call('/api/hr/attendances/team');
		expect(res.status).toBe(200);
		const { rows } = await body<{ rows: Array<{ id: string }> }>(res);
		expect(rows.map((r) => r.id)).toContain(peer);
	});
});

describe('Team Tracking detail is server-authorised', () => {
	it('a supervisor can open a direct report (identity + rows)', async () => {
		const res = await call(`/api/hr/attendances/employee/${subordinate}`, {}, superiorTok);
		expect(res.status).toBe(200);
		const data = await body<{ employee: { id: string }; attendance: unknown[]; leaves: unknown[] }>(res);
		expect(data.employee.id).toBe(subordinate);
		expect(Array.isArray(data.attendance)).toBe(true);
		expect(Array.isArray(data.leaves)).toBe(true);
	});

	it('an unrelated employee cannot open a colleague', async () => {
		const res = await call(`/api/hr/attendances/employee/${peer}`, {}, superiorTok);
		expect(res.status).toBe(403);
	});

	it('a peer viewer is refused the subordinate', async () => {
		const res = await call(`/api/hr/attendances/employee/${subordinate}`, {}, peerTok);
		expect(res.status).toBe(403);
	});

	it('an employee may open their own detail', async () => {
		const res = await call(`/api/hr/attendances/employee/${superior}`, {}, superiorTok);
		expect(res.status).toBe(200);
		expect((await body<{ employee: { id: string } }>(res)).employee.id).toBe(superior);
	});

	it('an admin may open anyone', async () => {
		const res = await call(`/api/hr/attendances/employee/${subordinate}`);
		expect(res.status).toBe(200);
	});
});

describe('Team Tracking bounds the window', () => {
	it('returns a recent punch and drops one outside the 7-day window', async () => {
		const now = new Date().toISOString();
		const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
		const freshId = crypto.randomUUID();
		const oldId = crypto.randomUUID();
		await insertRaw({ id: freshId, employee: weekTarget, shift: shiftId, check_in: now, created_at: now, updated_at: now });
		await insertRaw({ id: oldId, employee: weekTarget, shift: shiftId, check_in: old, created_at: old, updated_at: old });

		const res = await call(`/api/hr/attendances/employee/${weekTarget}?days=7`, {}, superiorTok);
		expect(res.status).toBe(200);
		const { attendance } = await body<{ attendance: Array<{ id: string }> }>(res);
		const ids = attendance.map((r) => r.id);
		expect(ids).toContain(freshId);
		expect(ids).not.toContain(oldId);
	});
});
