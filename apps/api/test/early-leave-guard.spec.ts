/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The early-leave day guard — ONE `hrm_early_leaves` row per employee per day.
 *
 * Regression guard for the cross-row rule that neither the declarative field
 * validation nor the `unique` constraint can express (date_time is a full
 * timestamp). The rule lives in `domain-modules/hr/early-leave-guard.ts`, a
 * compiled before_insert/before_update hook, so it fires on every write path.
 *
 * The suite provisions the real collection slug (the hook is keyed on it),
 * seeds an employee, and asserts:
 *   - a second same-day request is refused (400 + the message the form shows);
 *   - a DIFFERENT day is allowed;
 *   - a CANCELLED request frees the day again.
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

async function ensureCollection(slug: string, fields: Array<Record<string, unknown>>): Promise<void> {
	const res = await call('/api/collections', { method: 'POST', body: JSON.stringify({ name: slug, slug, fields }) });
	if (res.status === 201) return;
	const read = await call(`/api/collections/${slug}`);
	expect(read.status).toBe(200);
}

describe('early-leave day guard', () => {
	const DAY_A = '2031-03-04'; // far-future so a seeded run can never collide
	const DAY_B = '2031-03-05';
	let employee = '';

	beforeAll(async () => {
		await ensureCollection('hrm_employees', [
			{ name: 'etg_id', type: 'text', required: false, label: 'TG' },
			{ name: 'name_en', type: 'text', required: false, label: 'Name EN' },
		]);
		await ensureCollection('hrm_early_leaves', [
			{ name: 'employee', type: 'm2o', required: true, label: 'Employee', related_collection: 'hrm_employees' },
			{ name: 'date_time', type: 'datetime', required: true, label: 'Date Time' },
			{ name: 'location', type: 'text', required: false, label: 'Location' },
			{ name: 'reason', type: 'longtext', required: false, label: 'Reason' },
		]);

		const emp = await call('/api/entities/hrm_employees', {
			method: 'POST',
			body: JSON.stringify({ name_en: 'Guard Test', etg_id: 'guard-test-1' }),
		});
		expect(emp.status).toBe(201);
		employee = String((emp.body.data as { id: string }).id);
	});

	const create = (date: string, time: string) =>
		call('/api/entities/hrm_early_leaves', {
			method: 'POST',
			body: JSON.stringify({ employee, date_time: `${date}T${time}`, location: '16.8,96.1', reason: 'test' }),
		});

	it('accepts the first request, refuses a second on the same day, allows another day', async () => {
		const first = await create(DAY_A, '16:00');
		expect(first.status).toBe(201);
		const firstId = String((first.body.data as { id: string }).id);

		// Same employee, same day (a different clock time) → refused with the message
		// the early-leave form surfaces verbatim.
		const second = await create(DAY_A, '15:00');
		expect(second.status).toBe(400);
		expect(second.body.code).toBe('VALIDATION_ERROR');
		expect(second.body.error).toContain('already exists');

		// A different calendar day is untouched by the first request.
		const nextDay = await create(DAY_B, '16:00');
		expect(nextDay.status).toBe(201);

		// Cancelling frees the day again — a re-request is allowed.
		const cancelled = await call(`/api/entities/hrm_early_leaves/${firstId}`, {
			method: 'PUT',
			body: JSON.stringify({ doc_status: 'cancelled' }),
		});
		expect(cancelled.status).toBe(200);

		const retry = await create(DAY_A, '14:00');
		expect(retry.status).toBe(201);
	});
});
