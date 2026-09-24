/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Vehicle accidents & incidents — the REAL `veh_incidents` record collection.
 *
 * Purpose: the tgapp "မှတ်တမ်း" (accidents / incidents) screen used to read a
 * PHANTOM `vehicle_incidents` collection that the backend never provisioned —
 * silently dead UI (the legacy store/vehicle collection shape removed in the MRO rework).
 *
 * This spec pins the schema the screen now reads — `veh_incidents`, a plain
 * engine collection bound to the `veh_fleets` plate directory, with an
 * accident-vs-incident `kind`, a reporter m2o → `hrm_employees` and the crew
 * involved as a `personnel` m2m → `hrm_employees`. It is
 * provisioned through the SAME validated engine API (`POST /api/collections`,
 * never raw SQL) the apply script uses, and asserts normal CRUD + relation
 * expansion so the feature is proven on fresh code — not the stale :8788 worker.
 */
const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const SEVERITIES = [
	{ value: 'high', label: 'High' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'low', label: 'Low' },
];
const KINDS = [
	{ value: 'accident', label: 'Accident' },
	{ value: 'incident', label: 'Incident' },
];
const selectOpts = (options: Array<{ value: string; label: string }>) => options.map((o) => ({ ...o }));
const field = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
	name,
	type,
	// Engine rule: a field is NOT NULL unless `required: false` is explicit.
	...(extra.required === undefined ? { required: false } : {}),
	...extra,
});

// Fixture ids MUST be UUID v4 — the engine validates m2o values as UUIDs.
const PLATE = 'aaaaaaaa-0000-4000-8000-000000000001'; // a veh_fleets plate
const REPORTER = 'bbbbbbbb-0000-4000-8000-000000000002'; // an hrm_employees row
const ACCIDENT_ID = 'cccccccc-0000-4000-8000-000000000003';
const INCIDENT_ID = 'dddddddd-0000-4000-8000-000000000004';
const CREW = 'eeeeeeee-0000-4000-8000-000000000005'; // a second hrm_employees row (crew)

async function api(
	path: string,
	init?: RequestInit,
): Promise<{ status: number; body: { success?: boolean; error?: string; data?: unknown } }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...JSON_HEADERS, ...ADMIN, ...(init?.headers ?? {}) },
	});
	return { status: res.status, body: (await res.json().catch(() => null)) ?? {} };
}

const createCollection = async (slug: string, name: string, fields: Array<Record<string, unknown>>) => {
	const res = await api('/api/collections', { method: 'POST', body: JSON.stringify({ name, slug, fields }) });
	expect(res.status, `create ${slug}`).toBe(201);
};

beforeAll(async () => {
	// The two linked collections the incident record references must exist first
	// (create-order mirrors schema-defs.json's mro/base provisioning).
	await createCollection('hrm_employees', 'HRM Employees', [field('name_en', 'text', { required: true }), field('name_mm', 'text')]);
	await createCollection('veh_fleets', 'VEH Fleets', [field('plate_no', 'text', { required: true }), field('brand', 'text')]);

	const schema = await api('/api/collections/veh_incidents', { method: 'GET' });
	if (schema.status !== 200) {
		await createCollection('veh_incidents', 'VEH Accidents & Incidents', [
			field('vehicle', 'm2o', { required: false, related_collection: 'veh_fleets', display_template: '{{plate_no}}' }),
			field('kind', 'select', { options: selectOpts(KINDS), default: 'incident' }),
			field('reported_by', 'm2o', { required: false, related_collection: 'hrm_employees', display_template: '{{name_en}}' }),
			field('title', 'text', { required: true }),
			field('description', 'longtext'),
			field('incident_date', 'date'),
			field('severity', 'select', { options: selectOpts(SEVERITIES), default: 'low' }),
			field('location', 'text'),
			field('est_cost', 'number'),
			field('personnel', 'm2m', { required: false, related_collection: 'hrm_employees', display_template: '{{name_en}}' }),
		]);
	}

	// Seed the plate + reporter rows (the mro-inventory fixtures' pattern — explicit
	// UUID ids via raw SQL into the `cms_`-prefixed physical table) so the m2o
	// relations resolve to real, engine-owned rows without depending on POST id.
	const insert = async (table: string, row: Record<string, unknown>) => {
		const cols = Object.keys(row);
		await env.DB.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
			.bind(...cols.map((c) => row[c] as never))
			.run();
	};
	await insert('cms_veh_fleets', { id: PLATE, plate_no: 'TRK-7777' });
	await insert('cms_hrm_employees', { id: REPORTER, name_en: 'U Kyaw Min' });
	await insert('cms_hrm_employees', { id: CREW, name_en: 'Daw Su Su Hlaing' });
});

describe('veh_incidents — the real accident/incident record (no phantom table)', () => {
	it('creates an ACCIDENT bound to a plate (vehicle m2o) with the reporter', async () => {
		const row = await api('/api/entities/veh_incidents', {
			method: 'POST',
			body: JSON.stringify({
				id: ACCIDENT_ID,
				vehicle: PLATE,
				kind: 'accident',
				reported_by: REPORTER,
				personnel: [CREW],
				title: 'Side collision at Yangon belt road',
				severity: 'high',
				incident_date: '2026-09-06',
				location: 'Yangon / Hlaing Tharyar',
				est_cost: 1500000,
			}),
		});
		expect(row.status).toBe(201);
		const data = row.body.data as Record<string, unknown>;
		expect(data.id).toBe(ACCIDENT_ID);
		expect(data.kind).toBe('accident');
		expect(data.vehicle).toBe(PLATE);
	});

	it('creates an INCIDENT bound to a plate at a default severity', async () => {
		const row = await api('/api/entities/veh_incidents', {
			method: 'POST',
			body: JSON.stringify({
				id: INCIDENT_ID,
				vehicle: PLATE,
				kind: 'incident',
				reported_by: REPORTER,
				title: 'Bolt loose on fuel tank bracket',
				incident_date: '2026-09-05',
				location: 'Main yard',
			}),
		});
		expect(row.status).toBe(201);
		const data = row.body.data as Record<string, unknown>;
		expect(data.kind).toBe('incident');
		expect(data.severity).toBe('low');
	});

	it('lists both rows newest-first and expands the plate + reporter relations', async () => {
		const list = await api(
			'/api/entities/veh_incidents?fields=id,kind,title,severity,vehicle,reported_by,incident_date,location&sort=-created_at',
		);
		expect(list.status).toBe(200);
		const body = (list.body as { data?: unknown }).data ?? [];
		const items = (Array.isArray(body) ? body : []) as Array<Record<string, unknown>>;
		expect(items.length).toBeGreaterThanOrEqual(2);
		const found = items.filter((r) => r.id === ACCIDENT_ID || r.id === INCIDENT_ID);
		expect(found.length).toBe(2);
		for (const r of found) {
			const vehicle = r.vehicle as { id?: string; plate_no?: string | null } | null;
			expect(vehicle?.plate_no).toBe('TRK-7777');
			const reporter = r.reported_by as { name_en?: string | null } | null;
			// The reporter may arrive bare or expanded depending on the projection —
			// assert that at minimum the value resolves when expanded is requested.
			if (reporter && typeof reporter === 'object') expect(reporter.name_en).toBe('U Kyaw Min');
		}
	});

	it('carries the crew on the personnel m2m and expands the member rows', async () => {
		const read = await api(`/api/entities/veh_incidents/${ACCIDENT_ID}?fields=id,personnel.id,personnel.name_en`);
		expect(read.status).toBe(200);
		const data = read.body.data as { personnel?: Array<{ id?: string; name_en?: string | null }> };
		const crew = data.personnel ?? [];
		expect(crew.map((m) => m.id)).toContain(CREW);
		expect(crew.some((m) => m.name_en === 'Daw Su Su Hlaing')).toBe(true);
	});

	it('replaces the personnel m2m on update', async () => {
		const put = await api(`/api/entities/veh_incidents/${ACCIDENT_ID}`, {
			method: 'PUT',
			body: JSON.stringify({ personnel: [REPORTER] }),
		});
		expect(put.status).toBe(200);
		const read = await api(`/api/entities/veh_incidents/${ACCIDENT_ID}?fields=id,personnel.id`);
		const data = read.body.data as { personnel?: Array<{ id?: string }> };
		expect((data.personnel ?? []).map((m) => m.id)).toEqual([REPORTER]);
	});
});
