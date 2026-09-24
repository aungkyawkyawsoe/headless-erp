/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Attendances `in_status` / `out_status` — stored formula fields over the
 * attendance's m2o `shift`.
 *
 * The formulas classify the two punches against the shift's clock, both in MMT
 * (UTC+6:30 — the offset constant baked into each formula):
 *
 *   in_status  = on_time | grace_late_in | late_in    — check_in vs time_in,
 *                late-in grace = shift.in_grace_period
 *   out_status = on_time | grace_early_out | early_out — check_out vs
 *                time_in + working_hours, early-out grace = shift.out_grace_period
 *
 * The shift row is a LOOKUP (m2o), so these specs pin the two engine behaviors
 * the feature depends on:
 *   1. a STORED formula may reference an m2o target and computes on the FIRST
 *      insert (the pre-insert pass now attaches m2o scopes from the payload FK)
 *   2. editing the shift cascades a recalc into attendance rows that reference it
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface Row {
	id: string;
	[key: string]: unknown;
}

async function createCollection(slug: string, name: string, fields: Array<Record<string, unknown>>): Promise<void> {
	const res = await SELF.fetch(`${BASE_URL}/api/collections`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify({ name, slug, fields }),
	});
	expect(res.status).toBe(201);
}

async function createRow(collection: string, body: Record<string, unknown>): Promise<Row> {
	const res = await SELF.fetch(`${BASE_URL}/api/entities/${collection}`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify(body),
	});
	expect(res.status).toBe(201);
	const json = (await res.json()) as { data: Row };
	return json.data;
}

async function updateRow(collection: string, id: string, body: Record<string, unknown>): Promise<Row> {
	const res = await SELF.fetch(`${BASE_URL}/api/entities/${collection}/${id}`, {
		method: 'PUT',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify(body),
	});
	expect(res.status).toBe(200);
	const json = (await res.json()) as { data: Row };
	return json.data;
}

const SHIFTS_SLUG = 'att_status_shifts';
const DAYS_SLUG = 'att_status_days';

const shiftFields = [
	{ name: 'name', type: 'text', required: true },
	{ name: 'time_in', type: 'time', required: true },
	{ name: 'working_hours', type: 'number', required: true },
	{ name: 'in_grace_period', type: 'integer', required: true },
	{ name: 'out_grace_period', type: 'integer', required: true },
];

const dayFields = [
	{ name: 'employee', type: 'text', required: false },
	{ name: 'check_in', type: 'timestamp', required: true },
	{ name: 'check_out', type: 'timestamp', required: false },
	{ name: 'shift', type: 'm2o', required: true, related_collection: SHIFTS_SLUG },
	// ── the two fields under test — STORED formulas reading the shift m2o row ──
	{
		name: 'in_status',
		type: 'formula',
		required: false,
		label: 'In Status',
		formula_type: 'expression',
		result_type: 'string',
		store: true,
		formula:
			"IF(IS_EMPTY(check_in) || IS_EMPTY(shift) || IS_EMPTY(shift.time_in) || IS_EMPTY(shift.in_grace_period), null, IF((((MINUTES_BETWEEN(CONCAT(LEFT(check_in, 10), 'T00:00:00Z'), check_in) + 390) % 1440) <= MINUTES_BETWEEN('2000-01-01T00:00:00Z', CONCAT('2000-01-01T', LEFT(shift.time_in, 5), ':00Z'))), 'on_time', IF((((MINUTES_BETWEEN(CONCAT(LEFT(check_in, 10), 'T00:00:00Z'), check_in) + 390) % 1440) <= (MINUTES_BETWEEN('2000-01-01T00:00:00Z', CONCAT('2000-01-01T', LEFT(shift.time_in, 5), ':00Z')) + shift.in_grace_period)), 'grace_late_in', 'late_in')))",
	},
	{
		name: 'out_status',
		type: 'formula',
		required: false,
		label: 'Out Status',
		formula_type: 'expression',
		result_type: 'string',
		store: true,
		formula:
			"IF(IS_EMPTY(check_out) || IS_EMPTY(shift) || IS_EMPTY(shift.time_in) || IS_EMPTY(shift.out_grace_period) || IS_EMPTY(shift.working_hours), null, IF((MINUTES_BETWEEN('2000-01-01T00:00:00Z', CONCAT('2000-01-01T', LEFT(shift.time_in, 5), ':00Z')) + shift.working_hours * 60 <= ((MINUTES_BETWEEN(CONCAT(LEFT(check_out, 10), 'T00:00:00Z'), check_out) + 390) % 1440)), 'on_time', IF((MINUTES_BETWEEN('2000-01-01T00:00:00Z', CONCAT('2000-01-01T', LEFT(shift.time_in, 5), ':00Z')) + shift.working_hours * 60 - ((MINUTES_BETWEEN(CONCAT(LEFT(check_out, 10), 'T00:00:00Z'), check_out) + 390) % 1440) <= shift.out_grace_period), 'grace_early_out', 'early_out')))",
	},
];

describe('attendances in_status/out_status stored formulas (shift lookup)', () => {
	it('accepts the string-literal formulas at save time', async () => {
		await createCollection(SHIFTS_SLUG, 'Status Shifts', shiftFields);
		const res = await SELF.fetch(`${BASE_URL}/api/collections`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ name: 'Status Attendance Days', slug: DAYS_SLUG, fields: dayFields }),
		});
		expect(res.status).toBe(201);
	});

	it('computes in_status/out_status on the very first insert (m2o lookup on create)', async () => {
		const shift = await createRow(SHIFTS_SLUG, {
			name: 'Morning',
			time_in: '09:00',
			working_hours: 8.5, // 09:00 → 17:30 MMT
			in_grace_period: 10,
			out_grace_period: 15,
		});

		// check_in 02:48Z = 09:18 MMT → 18 min late → past the 10 min grace.
		// No check_out yet → out_status stays null.
		const day = await createRow(DAYS_SLUG, {
			employee: 'U Aung',
			check_in: '2026-09-03T02:48:00.000Z',
			shift: shift.id,
		});
		expect(day.in_status).toBe('late_in');
		expect(day.out_status).toBeNull();
	});

	it('recomputes out_status when check_out lands (grace window respected)', async () => {
		const shift = await createRow(SHIFTS_SLUG, {
			name: 'Morning',
			time_in: '09:00',
			working_hours: 8.5,
			in_grace_period: 10,
			out_grace_period: 15,
		});
		const day = await createRow(DAYS_SLUG, {
			employee: 'U Ba',
			check_in: '2026-09-03T01:00:00.000Z', // 07:30 MMT → on_time
			shift: shift.id,
		});
		expect(day.in_status).toBe('on_time');
		expect(day.out_status).toBeNull();

		// check_out 10:55Z = 17:25 MMT → 5 min before the 17:30 end → within grace.
		const updated = await updateRow(DAYS_SLUG, day.id, { check_out: '2026-09-03T10:55:00.000Z' });
		expect(updated.out_status).toBe('grace_early_out');

		// Later the same day with an EARLIER check-out → beyond the grace.
		const hard = await updateRow(DAYS_SLUG, day.id, { check_out: '2026-09-03T10:40:00.000Z' }); // 17:10 MMT → 20 min early
		expect(hard.out_status).toBe('early_out');
	});

	it('recomputes existing attendance rows when the shift clock/grace changes (cascade)', async () => {
		const shift = await createRow(SHIFTS_SLUG, {
			name: 'Morning',
			time_in: '09:00',
			working_hours: 8.5,
			in_grace_period: 10,
			out_grace_period: 15,
		});
		const day = await createRow(DAYS_SLUG, {
			employee: 'Daw Cho',
			check_in: '2026-09-03T02:48:00.000Z', // 09:18 MMT → 18 min late
			check_out: '2026-09-03T10:55:00.000Z', // 17:25 MMT → 5 min early
			shift: shift.id,
		});
		expect(day.in_status).toBe('late_in');
		expect(day.out_status).toBe('grace_early_out');

		// Loosen the in-grace to 20 → 18 min late is forgiven; tighten the
		// out-grace to 3 → 5 min early becomes a hard early-out. Editing the
		// SHIFT (not the attendance row) must cascade into the stored columns.
		const updatedShift = await updateRow(SHIFTS_SLUG, shift.id, { in_grace_period: 20, out_grace_period: 3 });
		expect(updatedShift.in_grace_period).toBe(20);

		const res = await SELF.fetch(`${BASE_URL}/api/entities/${DAYS_SLUG}/${day.id}`, { headers: ADMIN });
		expect(res.status).toBe(200);
		const row = ((await res.json()) as { data: Row }).data;
		expect(row.in_status).toBe('grace_late_in');
		expect(row.out_status).toBe('early_out');
	});
});
