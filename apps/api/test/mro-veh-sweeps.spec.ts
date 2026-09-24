/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * VEH maintenance sweeps — the two admin repair routes that rebuild the
 * `veh_fleets` derived columns from their document source of truth.
 *
 *   POST /api/mro/veh/relink       → last_license / last_insurance (newest permit / policy)
 *   POST /api/mro/veh/care/relink  → last_odo / last_engine_oil / last_gear_oil
 *
 * The lifecycle hooks keep these fresh on every write; the sweeps exist because a
 * soft-deleted or re-homed source row (and a legacy import) can leave the master
 * stale. Two properties make them safe to run on a schedule and are pinned here:
 *
 *   HEAL   — a drifted / NULL master is re-derived from the live source set.
 *   NO-OP  — a second sweep on an already-correct fleet writes NOTHING (the guarded
 *            `COALESCE(…) IS NOT COALESCE(…)` UPDATE no-ops, so `updated_at` stays
 *            put; without it, "a repair ran" would be indistinguishable from
 *            "the pointer changed" and the fleet-list lineage would be destroyed).
 *
 * Source rows are seeded with RAW SQL on purpose: a raw write fires NO hook, so the
 * sweep is the only writer in these tests and there is no fire-and-forget race to
 * poll around.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const FLEET_DOC = 'f1000000-0000-4000-8000-0000000000a1';
const FLEET_CARE = 'f1000000-0000-4000-8000-0000000000a2';

// veh_permits rows — the NEWER issue_date must win the pointer.
const PERMIT_OLD = 'f2000000-0000-4000-8000-0000000000b1';
const PERMIT_NEW = 'f2000000-0000-4000-8000-0000000000b2';
const INSURANCE_ONE = 'f3000000-0000-4000-8000-0000000000c1';

// veh_odo_months / veh_fluid_fills rows.
const ODO_MONTH = 'f4000000-0000-4000-8000-0000000000d1';
const FILL_ENGINE_OLD = 'f5000000-0000-4000-8000-0000000000e1';
const FILL_ENGINE_NEW = 'f5000000-0000-4000-8000-0000000000e2';
const FILL_GEAR = 'f5000000-0000-4000-8000-0000000000e3';

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

const field = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
	name,
	type,
	// Engine rule: a field is NOT NULL unless `required: false` is explicit.
	...(extra.required === undefined ? { required: false } : {}),
	...extra,
});

async function createCollection(slug: string, name: string, fields: Array<Record<string, unknown>>) {
	const res = await api('/api/collections', { method: 'POST', body: JSON.stringify({ name, slug, fields }) });
	expect(res.status, `create ${slug}`).toBe(201);
}

async function insert(table: string, row: Record<string, unknown>) {
	const cols = Object.keys(row);
	await env.DB.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
		.bind(...cols.map((c) => row[c] as never))
		.run();
}

async function row(table: string, where: string, ...binds: unknown[]): Promise<Record<string, unknown> | null> {
	return env.DB.prepare(`SELECT * FROM ${table} WHERE ${where}`)
		.bind(...(binds as never[]))
		.first();
}

const fleet = (id: string) => row('cms_veh_fleets', 'id = ?', id);

describe('veh maintenance sweeps — heal drift from the document source of truth, idempotently', () => {
	beforeAll(async () => {
		// The two pointer columns are declared `text`, not `m2o`: the relink SQL stores
		// an id SCALAR, and an m2o here would be a circular collection dependency
		// (veh_permits.vehicle → veh_fleets.last_license → veh_permits).
		await createCollection('veh_fleets', 'VEH Fleets', [
			field('plate_no', 'text', { required: true }),
			field('last_license', 'text'),
			field('last_insurance', 'text'),
			field('last_odo', 'number'),
			field('last_engine_oil', 'number'),
			field('last_gear_oil', 'number'),
		]);
		await createCollection('veh_permits', 'VEH Permits', [
			field('vehicle', 'm2o', { related_collection: 'veh_fleets' }),
			field('issue_date', 'text'),
			field('expiry_date', 'text'),
		]);
		await createCollection('veh_insurances', 'VEH Insurances', [
			field('vehicle', 'm2o', { related_collection: 'veh_fleets' }),
			field('expiry_date', 'text'),
		]);
		await createCollection('veh_odo_months', 'VEH Odo Months', [
			field('vehicle', 'm2o', { related_collection: 'veh_fleets' }),
			field('month', 'text'),
			field('readings', 'longtext'),
		]);
		await createCollection('veh_fluid_fills', 'VEH Fluid Fills', [
			field('vehicle', 'm2o', { related_collection: 'veh_fleets' }),
			field('fluid_kind', 'text'),
			field('odo_at_fill', 'number'),
			field('next_due_odo', 'number'),
		]);
	});

	it('rebuilds last_license / last_insurance from the newest document, then no-ops', async () => {
		// A master whose pointers drift (a stale id and a missing one).
		await insert('cms_veh_fleets', { id: FLEET_DOC, plate_no: 'SWP-1', last_license: 'stale-not-a-permit' });
		await insert('cms_veh_permits', {
			id: PERMIT_OLD,
			vehicle: FLEET_DOC,
			issue_date: '2026-01-01',
			expiry_date: '2027-01-01',
			created_at: '2026-01-01T00:00:00.000Z',
		});
		await insert('cms_veh_permits', {
			id: PERMIT_NEW,
			vehicle: FLEET_DOC,
			issue_date: '2026-06-01',
			expiry_date: '2027-06-01',
			created_at: '2026-06-01T00:00:00.000Z',
		});
		await insert('cms_veh_insurances', {
			id: INSURANCE_ONE,
			vehicle: FLEET_DOC,
			expiry_date: '2027-03-01',
			created_at: '2026-03-01T00:00:00.000Z',
		});

		const sweep = await api('/api/mro/veh/relink', { method: 'POST' });
		expect(sweep.status).toBe(200);
		expect(Number((sweep.body.data as { relinked: number }).relinked)).toBeGreaterThanOrEqual(1);

		const healed = await fleet(FLEET_DOC);
		expect(healed?.last_license, 'the NEWER issue date wins').toBe(PERMIT_NEW);
		expect(healed?.last_insurance).toBe(INSURANCE_ONE);

		// Idempotent: the row is already correct, so the guarded UPDATE no-ops and
		// `updated_at` does NOT move.
		const stamp = healed?.updated_at;
		const again = await api('/api/mro/veh/relink', { method: 'POST' });
		expect(again.status).toBe(200);
		expect((await fleet(FLEET_DOC))?.updated_at, 'a clean fleet is left byte-identical').toBe(stamp);
	});

	it('rebuilds the care scalars (odo + newest engine/gear-oil due), then no-ops', async () => {
		// A master whose three care scalars are all wrong.
		await insert('cms_veh_fleets', {
			id: FLEET_CARE,
			plate_no: 'SWP-2',
			last_odo: 1,
			last_engine_oil: 1,
			last_gear_oil: 1,
		});
		// Two readings in one month bucket — the MAX is the vehicle's current odo.
		await insert('cms_veh_odo_months', {
			id: ODO_MONTH,
			vehicle: FLEET_CARE,
			month: '2026-09',
			readings: JSON.stringify([{ odo: 1000 }, { odo: 4200 }]),
		});
		// Engine oil: the fill with the HIGHER odo_at_fill is "newest" and owns the due.
		await insert('cms_veh_fluid_fills', {
			id: FILL_ENGINE_OLD,
			vehicle: FLEET_CARE,
			fluid_kind: 'engine_oil',
			odo_at_fill: 1000,
			next_due_odo: 5000,
			created_at: '2026-01-01T00:00:00.000Z',
		});
		await insert('cms_veh_fluid_fills', {
			id: FILL_ENGINE_NEW,
			vehicle: FLEET_CARE,
			fluid_kind: 'engine_oil',
			odo_at_fill: 4000,
			next_due_odo: 9000,
			created_at: '2026-05-01T00:00:00.000Z',
		});
		await insert('cms_veh_fluid_fills', {
			id: FILL_GEAR,
			vehicle: FLEET_CARE,
			fluid_kind: 'gear_oil',
			odo_at_fill: 3500,
			next_due_odo: 7000,
			created_at: '2026-04-01T00:00:00.000Z',
		});

		const sweep = await api('/api/mro/veh/care/relink', { method: 'POST' });
		expect(sweep.status).toBe(200);

		const healed = await fleet(FLEET_CARE);
		expect(Number(healed?.last_odo), 'the exact max reading').toBe(4200);
		expect(Number(healed?.last_engine_oil), 'the newest engine-oil fill').toBe(9000);
		expect(Number(healed?.last_gear_oil), 'the newest gear-oil fill').toBe(7000);

		const stamp = healed?.updated_at;
		expect((await api('/api/mro/veh/care/relink', { method: 'POST' })).status).toBe(200);
		expect((await fleet(FLEET_CARE))?.updated_at, 'a clean fleet is left byte-identical').toBe(stamp);
	});

	it('refuses both sweeps without a session', async () => {
		// Admin-gated repair routes: no token → 401, never a silent full-table rewrite.
		for (const path of ['/api/mro/veh/relink', '/api/mro/veh/care/relink']) {
			const res = await SELF.fetch(`${BASE_URL}${path}`, { method: 'POST' });
			expect(res.status, path).toBe(401);
		}
	});
});
