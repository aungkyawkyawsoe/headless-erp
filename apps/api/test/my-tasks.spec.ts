/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * GET /api/hr/my-tasks — the attendance dashboard's task feed.
 *
 * Regression guard for the whole-collection walk: `hrm_tasks.assignee` is an m2m
 * the entity URL filter syntax cannot express, so the mini app used to page
 * through EVERY task (100/request) and filter in the browser. This endpoint
 * resolves the junction server-side and returns ONLY the acting employee's rows
 * in one round trip.
 *
 * The suite provisions the real `hrm_employees` / `hrm_tasks` collections (with
 * the m2m `assignee`), seeds three tasks, and asserts the feed is exactly the
 * requested employee's — the bug this pins is "returns rows belonging to someone
 * else" (over-fetch) or "returns nothing" (the junction path regressing to the
 * broken `filter[assignee]` shape).
 *
 * The second block covers the employee PROFILE case: the page views another
 * employee, so a non-admin with `hrm_tasks` read must get THAT person's rows —
 * while still 403ing without the grant, and defaulting to its own empty feed when
 * no `employee_id` is supplied.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface Envelope {
	success?: boolean;
	error?: string;
	code?: string;
	data?: unknown;
}

async function call(path: string, init: RequestInit = {}): Promise<{ status: number; body: Envelope }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...JSON_HEADERS, ...ADMIN, ...(init.headers ?? {}) },
	});
	return { status: res.status, body: ((await res.json().catch(() => null)) ?? {}) as Envelope };
}

/** Create the collection once (idempotent across a re-run / pre-existing seed). */
async function ensureCollection(slug: string, fields: Array<Record<string, unknown>>): Promise<void> {
	const res = await call('/api/collections', { method: 'POST', body: JSON.stringify({ name: slug, slug, fields }) });
	// 201 = created; anything else (already exists) is fine as long as it reads.
	if (res.status === 201) return;
	const read = await call(`/api/collections/${slug}`);
	expect(read.status).toBe(200);
}

async function createRow(slug: string, body: Record<string, unknown>): Promise<string> {
	const res = await call(`/api/entities/${slug}`, { method: 'POST', body: JSON.stringify(body) });
	expect(res.status).toBe(201);
	return String((res.body.data as { id: string }).id);
}

describe('GET /api/hr/my-tasks', () => {
	let empA = '';
	let empB = '';
	let taskA = '';
	let taskB = '';
	let taskAB = '';

	beforeAll(async () => {
		// `hrm_employees` and `hrm_tasks` are the REAL collection slugs the project
		// app reads — the endpoint hardcodes them, so the test must provision them.
		await ensureCollection('hrm_employees', [
			{ name: 'etg_id', type: 'text', required: false, label: 'TG' },
			{ name: 'name_en', type: 'text', required: false, label: 'Name EN' },
			{ name: 'name_mm', type: 'text', required: false, label: 'Name MM' },
			{ name: 'avatar', type: 'text', required: false, label: 'Avatar' },
		]);
		await ensureCollection('hrm_projects', [{ name: 'name', type: 'text', required: false, label: 'Name' }]);
		await ensureCollection('hrm_tasks', [
			{ name: 'name', type: 'text', required: false, label: 'Name' },
			{ name: 'state', type: 'text', required: false, label: 'State' },
			{ name: 'priority', type: 'text', required: false, label: 'Priority' },
			{ name: 'due_date', type: 'text', required: false, label: 'Due date' },
			{ name: 'project', type: 'm2o', required: false, label: 'Project', related_collection: 'hrm_projects' },
			{ name: 'assignee', type: 'm2m', required: false, label: 'Assignees', related_collection: 'hrm_employees' },
		]);

		empA = await createRow('hrm_employees', { etg_id: '111', name_en: 'Alice', name_mm: 'အလစ်' });
		empB = await createRow('hrm_employees', { etg_id: '222', name_en: 'Bob', name_mm: 'ဘော့' });

		taskA = await createRow('hrm_tasks', { name: 'Task A', state: 'todo', priority: 'high', assignee: [empA] });
		taskB = await createRow('hrm_tasks', { name: 'Task B', state: 'done', priority: 'low', assignee: [empB] });
		taskAB = await createRow('hrm_tasks', { name: 'Task AB', state: 'in_progress', priority: 'medium', assignee: [empA, empB] });
	});

	it('returns exactly the requested employee’s tasks (m2m resolved server-side)', async () => {
		const res = await call(`/api/hr/my-tasks?employee_id=${empA}`);
		expect(res.status).toBe(200);

		const tasks = (res.body.data as { tasks: Array<Record<string, unknown>> }).tasks;
		const ids = tasks.map((t) => t.id).sort();
		expect(ids).toEqual([taskA, taskAB].sort());
		expect(tasks.some((t) => t.id === taskB)).toBe(false);

		// The projection carries each row's assignee expansion (the card renders it).
		const shared = tasks.find((t) => t.id === taskAB);
		expect(Array.isArray(shared?.assignee)).toBe(true);
	});

	it('returns the other employee’s single task', async () => {
		const res = await call(`/api/hr/my-tasks?employee_id=${empB}`);
		expect(res.status).toBe(200);
		const ids = (res.body.data as { tasks: Array<{ id: string }> }).tasks.map((t) => t.id).sort();
		expect(ids).toEqual([taskB, taskAB].sort());
	});

	it('returns an empty feed (not an error) for an employee with no tasks', async () => {
		const res = await call('/api/hr/my-tasks?employee_id=does-not-exist');
		expect(res.status).toBe(200);
		expect((res.body.data as { tasks: unknown[] }).tasks).toEqual([]);
	});

	// ── The employee PROFILE case: an explicit `employee_id` targets that person ──
	// The profile page views someone other than the caller. Honouring the parameter
	// for a non-admin is safe because the gate already requires read on `hrm_tasks`
	// (which lets the role list the whole collection anyway, row filters applied).
	// Ignoring it would paint a colleague's profile with the CALLER's tasks — the
	// regression this block pins.
	describe('scoped read for a non-admin caller', () => {
		let token = '';
		let roleId = '';

		beforeAll(async () => {
			// Unique role name so a re-run never collides with an earlier creation.
			const roleRes = await SELF.fetch(`${BASE_URL}/api/users/roles`, {
				method: 'POST',
				headers: { ...JSON_HEADERS, ...ADMIN },
				body: JSON.stringify({ name: `TaskReader-${crypto.randomUUID()}`, description: 'test' }),
			});
			expect(roleRes.status).toBe(201);
			roleId = ((await roleRes.json()) as { data: { id: string } }).data.id;

			const email = `task-reader-${crypto.randomUUID()}@test.local`;
			const password = 'task-reader-pass';
			const userRes = await SELF.fetch(`${BASE_URL}/api/users`, {
				method: 'POST',
				headers: { ...JSON_HEADERS, ...ADMIN },
				body: JSON.stringify({ email, password, full_name: 'Task Reader', role_id: roleId }),
			});
			expect(userRes.status).toBe(201);

			const loginRes = await SELF.fetch(`${BASE_URL}/api/auth/login`, {
				method: 'POST',
				headers: JSON_HEADERS,
				body: JSON.stringify({ email, password }),
			});
			expect(loginRes.status).toBe(200);
			token = ((await loginRes.json()) as { data: { token: string } }).data.token;
		});

		it('403s while the role cannot read hrm_tasks', async () => {
			const res = await call(`/api/hr/my-tasks?employee_id=${empB}`, { headers: { Authorization: `Bearer ${token}` } });
			expect(res.status).toBe(403);
		});

		it('returns the TARGET employee’s rows (not the caller’s) once granted', async () => {
			// Grant through the API so the permission evaluator's cache is invalidated
			// (the 403 above warmed it with `false`).
			const grantRes = await SELF.fetch(`${BASE_URL}/api/users/permissions`, {
				method: 'POST',
				headers: { ...JSON_HEADERS, ...ADMIN },
				body: JSON.stringify({ role_id: roleId, collection_slug: 'hrm_tasks', can_read: true }),
			});
			expect(grantRes.status).toBe(201);

			const res = await call(`/api/hr/my-tasks?employee_id=${empB}`, { headers: { Authorization: `Bearer ${token}` } });
			expect(res.status).toBe(200);
			const ids = (res.body.data as { tasks: Array<{ id: string }> }).tasks.map((t) => t.id).sort();
			expect(ids).toEqual([taskB, taskAB].sort());
		});

		it('defaults to the caller’s OWN feed when employee_id is omitted', async () => {
			// This user has no `hrm_employees` row linked to their identity, so the
			// self-scoped default is an EMPTY feed — never another employee's rows.
			const res = await call('/api/hr/my-tasks', { headers: { Authorization: `Bearer ${token}` } });
			expect(res.status).toBe(200);
			expect((res.body.data as { tasks: unknown[] }).tasks).toEqual([]);
		});
	});
});
