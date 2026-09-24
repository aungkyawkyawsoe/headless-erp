/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * `veh_maintenance_logs` — the REAL vehicle-maintenance record the ပြင်ဆင် app
 * (/app/maintenances) reads and writes, and its `total_cost` STORED formula.
 *
 * The screen used to re-skin store REQUISITIONS; this spec proves the two
 * collections it now owns are provisioned through the SAME validated engine API
 * (never raw SQL) and that the engine — not the client — owns the money total:
 *
 *   1. a stored `formula` field saves at collection-create time;
 *   2. `total_cost` computes on the FIRST insert from parts_cost + labor_cost;
 *   3. a client-sent `total_cost` is IGNORED (the engine recomputes);
 *   4. an update recomputes from the NEW costs (the user's "whenever create or
 *      update, sum parts + labor" requirement);
 *   5. dotted `fields` expand the fleet plate + the cited job in ONE read.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface Row {
	id: string;
	[key: string]: unknown;
}

const PLATE = 'aaaaaaaa-0000-4000-8000-00000000000a';
const JOB = 'bbbbbbbb-0000-4000-8000-00000000000b';
const LOG = 'cccccccc-0000-4000-8000-00000000000c';
const DRIVER = 'dddddddd-0000-4000-8000-00000000000d';

// Engine rule: a field is NOT NULL unless `required: false` is explicit.
const field = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
	name,
	type,
	...(extra.required === undefined ? { required: false } : {}),
	...extra,
});

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: { data?: unknown } }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...JSON_HEADERS, ...ADMIN, ...(init?.headers ?? {}) },
	});
	return { status: res.status, body: (await res.json().catch(() => ({}))) as { data?: unknown } };
}

async function createCollection(slug: string, name: string, fields: Array<Record<string, unknown>>): Promise<void> {
	const res = await api('/api/collections', { method: 'POST', body: JSON.stringify({ name, slug, fields }) });
	expect(res.status, `create ${slug}`).toBe(201);
}

async function createRow(collection: string, body: Record<string, unknown>): Promise<Row> {
	const res = await api(`/api/entities/${collection}`, { method: 'POST', body: JSON.stringify(body) });
	expect(res.status, `create row in ${collection}`).toBe(201);
	return res.body.data as Row;
}

async function updateRow(collection: string, id: string, body: Record<string, unknown>): Promise<Row> {
	const res = await api(`/api/entities/${collection}/${id}`, { method: 'PUT', body: JSON.stringify(body) });
	expect(res.status, `update ${collection}/${id}`).toBe(200);
	return res.body.data as Row;
}

beforeAll(async () => {
	await createCollection('hrm_employees', 'HRM Employees', [field('name_en', 'text', { required: true }), field('name_mm', 'text')]);
	await createCollection('veh_fleets', 'VEH Fleets', [field('plate_no', 'text', { required: true }), field('brand', 'text')]);

	const jobSchema = await api('/api/collections/veh_issue_types', { method: 'GET' });
	if (jobSchema.status !== 200) {
		await createCollection('veh_issue_types', 'VEH Issue Types', [
			field('name_en', 'text'),
			field('name_mm', 'text'),
			field('keywords', 'tags'),
			field('job_code', 'text', { required: true }),
			field('category', 'select', {
				options: [
					{ value: 'eng', label: 'Engine & Gearbox' },
					{ value: 'bod', label: 'Body & Door' },
					{ value: 'sus', label: 'Suspension' },
					{ value: 'ele', label: 'Lighting & Electronic' },
				],
			}),
		]);
	}

	const logSchema = await api('/api/collections/veh_maintenance_logs', { method: 'GET' });
	if (logSchema.status !== 200) {
		await createCollection('veh_maintenance_logs', 'VEH Maintenance Logs', [
			field('fleet', 'm2o', { related_collection: 'veh_fleets', display_template: '{{plate_no}}' }),
			field('started_at', 'date', { required: true }),
			field('end_at', 'date'),
			field('odo', 'text'),
			field('parts_cost', 'number'),
			field('labor_cost', 'number'),
			// The field under test — a STORED formula the engine owns.
			field('total_cost', 'formula', {
				label: 'Total Cost',
				formula: 'parts_cost + labor_cost',
				store: true,
				result_type: 'number',
				precision: 2,
			}),
			field('vendor_type', 'select', {
				options: [
					{ value: 'in_house', label: 'In-house' },
					{ value: 'external', label: 'External Vendor' },
				],
			}),
			field('technician', 'text'),
			field('note', 'text'),
			field('issues_type', 'm2o', { related_collection: 'veh_issue_types', display_template: '{{name_mm}}' }),
			// Who drove the truck in — an hrm_employees m2o (added after the first release).
			field('driver', 'm2o', { related_collection: 'hrm_employees', display_template: '{{name_en}}' }),
			field('approved_by', 'm2o', { related_collection: 'hrm_employees', display_template: '{{name_en}}' }),
			field('recommended_by', 'm2o', { related_collection: 'hrm_employees', display_template: '{{name_en}}' }),
		]);
	}

	// Fixture rows with explicit UUID ids (the m2o values are validated as UUIDs).
	const insert = async (table: string, row: Record<string, unknown>) => {
		const cols = Object.keys(row);
		await env.DB.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
			.bind(...cols.map((c) => row[c] as never))
			.run();
	};
	await insert('cms_veh_fleets', { id: PLATE, plate_no: 'RF-11', brand: 'fuso' });
	await insert('cms_veh_issue_types', {
		id: JOB,
		name_en: 'Suspension Repair',
		name_mm: 'ဆိုင်းစနစ် ပြုပြင်မှု',
		job_code: 'JOB-SUS',
		category: 'sus',
	});
	await insert('cms_hrm_employees', { id: DRIVER, name_en: 'U Soe Naing', name_mm: 'ဦးစိုးနိုင်း' });
});

describe('veh_maintenance_logs — the stored total_cost formula (parts_cost + labor_cost)', () => {
	it('computes the total on the FIRST insert', async () => {
		const row = await createRow('veh_maintenance_logs', {
			id: LOG,
			fleet: PLATE,
			issues_type: JOB,
			started_at: '2026-08-12',
			parts_cost: 1000,
			labor_cost: 250.5,
			vendor_type: 'in_house',
			driver: DRIVER,
		});
		expect(row.total_cost).toBe(1250.5);
	});

	it('IGNORES a client-sent total_cost and recomputes from the parts', async () => {
		const row = await updateRow('veh_maintenance_logs', LOG, { parts_cost: 2000, total_cost: 999999 });
		// labor_cost is untouched (250.5) — the total is engine-owned, not the payload's.
		expect(row.total_cost).toBe(2250.5);
	});

	it('recomputes when only the labor changes', async () => {
		const row = await updateRow('veh_maintenance_logs', LOG, { labor_cost: 500 });
		expect(row.total_cost).toBe(2500); // 2000 + 500
	});

	it('coerces unset costs to a zero total (nothing priced)', async () => {
		const blank = await createRow('veh_maintenance_logs', {
			fleet: PLATE,
			started_at: '2026-08-20',
			end_at: '2026-08-20',
		});
		expect(blank.total_cost).toBe(0);
	});

	it('expands the truck plate, the driver and the cited job in ONE dotted read', async () => {
		const read = await api(
			`/api/entities/veh_maintenance_logs/${LOG}?fields=id,total_cost,driver.name_en,fleet.plate_no,fleet.brand,issues_type.name_en,issues_type.job_code,issues_type.category`,
		);
		expect(read.status).toBe(200);
		const data = read.body.data as {
			total_cost?: number;
			driver?: { name_en?: string };
			fleet?: { plate_no?: string; brand?: string };
			issues_type?: { name_en?: string; job_code?: string; category?: string };
		};
		expect(data.total_cost).toBe(2500);
		expect(data.driver?.name_en).toBe('U Soe Naing');
		expect(data.fleet?.plate_no).toBe('RF-11');
		expect(data.issues_type?.job_code).toBe('JOB-SUS');
		expect(data.issues_type?.category).toBe('sus');
	});
});
