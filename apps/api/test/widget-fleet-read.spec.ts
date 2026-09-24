/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';

/**
 * The Fleet & Operations WIDGET's fleet read — the exact projection the launcher
 * board issues, through BOTH read routes, asserting the dotted document POINTERS
 * come back EXPANDED.
 *
 * Why this exists: the board counts License/Insurance alerts from
 * `last_license.expiry_date` / `last_insurance.expiry_date` on the fleet master.
 * If a route returned those as bare ids (or dropped them), `pointer()` yields null
 * and both cells read a structural 0 forever — a silent wrong answer, not an
 * error. The board reads through the BATCH endpoint (`POST /api/query`) while the
 * registers read the DIRECT entity list; both must project identically.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function api(
	path: string,
	init?: RequestInit,
): Promise<{ status: number; body: { success?: boolean; error?: string; data?: unknown } }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, { ...init, headers: { ...JSON_HEADERS, ...ADMIN, ...(init?.headers ?? {}) } });
	return { status: res.status, body: (await res.json().catch(() => null)) ?? {} };
}

const field = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
	name,
	type,
	...(extra.required === undefined ? { required: false } : {}),
	...extra,
});

async function createCollection(slug: string, name: string, fields: Array<Record<string, unknown>>) {
	const res = await api('/api/collections', { method: 'POST', body: JSON.stringify({ name, slug, fields }) });
	expect(res.status, `create ${slug}`).toBe(201);
}

/** The board's projection, verbatim (modules/widgets/data/api.ts FLEET_WIDGET_FIELDS). */
const FLEET_WIDGET_FIELDS = [
	'id',
	'plate_no',
	'last_odo',
	'last_engine_oil',
	'last_gear_oil',
	'last_license.expiry_date',
	'last_insurance.expiry_date',
].join(',');

const FLEET = 'ccccccc3-3333-4333-a333-333333333333';

/** Insert a row with a FIXED id (the pointer hooks key off the m2o value). */
async function insert(table: string, row: Record<string, unknown>) {
	const cols = Object.keys(row);
	await env.DB.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
		.bind(...cols.map((c) => row[c] as never))
		.run();
}

interface FleetRead {
	last_license?: unknown;
	last_insurance?: unknown;
	plate_no?: string;
}

/** The pointer is resolved when the engine hands back the related ROW object. */
function expiryOf(pointer: unknown): string | null {
	if (pointer === null || typeof pointer !== 'object') return null;
	const value = (pointer as { expiry_date?: unknown }).expiry_date;
	return typeof value === 'string' ? value : null;
}

beforeAll(async () => {
	await createCollection('veh_fleets', 'VEH Fleets', [field('plate_no', 'text', { required: true })]);
	await createCollection('veh_permits', 'VEH Permits', [
		field('vehicle', 'm2o', { related_collection: 'veh_fleets' }),
		field('license_no', 'text'),
		field('issue_date', 'date'),
		field('expiry_date', 'date'),
	]);
	await createCollection('veh_insurances', 'VEH Insurances', [
		field('vehicle', 'm2o', { related_collection: 'veh_fleets' }),
		field('policy_no', 'text'),
		field('expiry_date', 'date'),
	]);
	// Merge the pointer fields onto the fleet master (the provision order: the m2o
	// fields cannot exist before their targets).
	const existing = await api('/api/collections/veh_fleets');
	const stored = (existing.body.data as { schema_json?: { fields?: Array<Record<string, unknown>> } } | undefined)?.schema_json?.fields;
	expect(Array.isArray(stored)).toBe(true);
	const merge = await api('/api/collections/veh_fleets', {
		method: 'PUT',
		body: JSON.stringify({
			fields: [
				...(stored as Array<Record<string, unknown>>),
				field('last_license', 'm2o', { related_collection: 'veh_permits' }),
				field('last_insurance', 'm2o', { related_collection: 'veh_insurances' }),
				field('last_odo', 'number'),
				field('last_engine_oil', 'number'),
				field('last_gear_oil', 'number'),
			],
		}),
	});
	expect(merge.status, 'merge last_* pointers onto veh_fleets').toBeLessThan(300);

	await insert('cms_veh_fleets', { id: FLEET, plate_no: 'TRK-W1' });

	// A permit running to 2027 and a policy that ALREADY LAPSED — the two states the
	// board's License/Insurance cells exist to distinguish.
	await api('/api/entities/veh_permits', {
		method: 'POST',
		body: JSON.stringify({ vehicle: FLEET, license_no: 'YGN/1', issue_date: '2026-06-29', expiry_date: '2027-06-29' }),
	});
	await api('/api/entities/veh_insurances', {
		method: 'POST',
		body: JSON.stringify({ vehicle: FLEET, policy_no: 'AYA/1', expiry_date: '2026-06-30' }),
	});

	// The pointer hooks are fire-and-forget — poll until both land.
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		const read = await api(`/api/entities/veh_fleets/${FLEET}?fields=id,last_license,last_insurance`);
		const row = read.body.data as { last_license?: unknown; last_insurance?: unknown } | undefined;
		if (row?.last_license && row?.last_insurance) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error('the last_license/last_insurance pointers never landed');
});

it('the DIRECT entity list projects the dotted document pointers', async () => {
	const res = await api(`/api/entities/veh_fleets?fields=${FLEET_WIDGET_FIELDS}&limit=100&sort=plate_no`);
	expect(res.status).toBe(200);
	const rows = (res.body.data ?? []) as FleetRead[];
	const fleet = rows.find((r) => r.plate_no === 'TRK-W1');
	expect(fleet, 'the fleet is in the list').toBeTruthy();
	expect(expiryOf(fleet?.last_license), 'last_license.expiry_date resolved').toBe('2027-06-29');
	expect(expiryOf(fleet?.last_insurance), 'last_insurance.expiry_date resolved').toBe('2026-06-30');
});

it('the BATCH /api/query route projects them identically (what the widget board reads)', async () => {
	const res = await api('/api/query', {
		method: 'POST',
		body: JSON.stringify({
			queries: [
				{
					key: 'fleets',
					collection: 'veh_fleets',
					params: { fields: FLEET_WIDGET_FIELDS, limit: '100', sort: 'plate_no' },
				},
			],
		}),
	});
	expect(res.status).toBe(200);
	const results = (res.body.data as { results?: Array<{ key: string; ok: boolean; data?: FleetRead[] }> } | undefined)?.results ?? [];
	const fleets = results.find((r) => r.key === 'fleets');
	expect(fleets?.ok, `batch query ok (${JSON.stringify(fleets)})`).toBe(true);
	const fleet = (fleets?.data ?? []).find((r) => r.plate_no === 'TRK-W1');
	expect(fleet, 'the fleet is in the batch page').toBeTruthy();
	// These two assertions ARE the widget's License/Insurance cells.
	expect(expiryOf(fleet?.last_license), 'last_license.expiry_date resolved through the batch route').toBe('2027-06-29');
	expect(expiryOf(fleet?.last_insurance), 'last_insurance.expiry_date resolved through the batch route').toBe('2026-06-30');
});

it('the two routes return the SAME projected row for the same fleet', async () => {
	const direct = await api(`/api/entities/veh_fleets?fields=${FLEET_WIDGET_FIELDS}&limit=100&sort=plate_no`);
	const batch = await api('/api/query', {
		method: 'POST',
		body: JSON.stringify({ queries: [{ key: 'fleets', collection: 'veh_fleets', params: { fields: FLEET_WIDGET_FIELDS, limit: '100' } }] }),
	});
	const directRows = (direct.body.data ?? []) as FleetRead[];
	const batchRows = ((batch.body.data as { results?: Array<{ data?: FleetRead[] }> } | undefined)?.results?.[0]?.data ?? []) as FleetRead[];
	const pick = (rows: FleetRead[]) => rows.find((r) => r.plate_no === 'TRK-W1');
	expect(pick(batchRows)).toEqual(pick(directRows));
});

/**
 * The batch route must honour the spec's `limit` — the board asks for 100 rows
 * (MAX_PAGE_SIZE). If the route fell back to the 25-row DEFAULT page, the board
 * would silently count alerts over only the first 25 vehicles: a wrong number,
 * not an error.
 */
it('honours the spec limit (no silent fall-back to the 25-row default page)', async () => {
	const ids: string[] = [];
	for (let i = 1; i <= 30; i++) {
		const id = `dddddd${String(i).padStart(2, '0')}-4444-4444-8444-4444444444${String(i).padStart(2, '0')}`;
		ids.push(id);
		await insert('cms_veh_fleets', { id, plate_no: `PAGE-${String(i).padStart(2, '0')}` });
	}
	try {
		const batch = await api('/api/query', {
			method: 'POST',
			body: JSON.stringify({
				queries: [{ key: 'fleets', collection: 'veh_fleets', params: { fields: 'id,plate_no', limit: '100', sort: 'plate_no' } }],
			}),
		});
		const rows = ((batch.body.data as { results?: Array<{ data?: unknown[] }> } | undefined)?.results?.[0]?.data ?? []) as unknown[];
		expect(rows.length, 'all 31 fleets returned, not the 25-row default page').toBe(31);
	} finally {
		await env.DB.prepare(`DELETE FROM cms_veh_fleets WHERE id IN (${ids.map(() => '?').join(',')})`)
			.bind(...(ids as never[]))
			.run();
	}
});

/**
 * A malformed `queries` (a map, a string) is a CLIENT error and must answer 4xx.
 * It used to 500 — `requested.slice is not a function` — because the handler
 * assumed an array, which makes a bad request look like a server fault.
 */
it('rejects a non-array `queries` with a 4xx, never a 500', async () => {
	for (const bad of [{ fleets: { collection: 'veh_fleets' } }, 'nope', 42, null]) {
		const res = await api('/api/query', { method: 'POST', body: JSON.stringify({ queries: bad }) });
		expect(res.status, `queries=${JSON.stringify(bad)} must be a client error`).toBeGreaterThanOrEqual(400);
		expect(res.status, `queries=${JSON.stringify(bad)} must not be a 5xx`).toBeLessThan(500);
	}
});
