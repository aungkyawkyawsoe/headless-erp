/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';

/**
 * VEH relink lifecycle hooks — veh_fleets.last_license / last_insurance are
 * auto-linked to the vehicle's NEWEST document on every create/update:
 *
 *   last_license   ← veh_permits with the latest issue_date
 *   last_insurance ← veh_insurances with the latest expiry_date
 *
 * Registered at boot by mountDomainModules() (domain-modules/mro/veh-relink.ts),
 * so the hooks run on generic entity-API writes. This spec creates the schema
 * through the SAME validated API the provisioning scripts use (never raw SQL),
 * then asserts the pointers through direct D1 reads.
 *
 * The hooks are fire-and-forget on writes (engine after_* semantics), so
 * assertions poll until the pointer lands, and each step pauses briefly so the
 * unawaited hook fully releases the engine's shared hook-depth guard before the
 * next request. `after_delete`/`after_restore` ARE awaited by the delete/restore
 * services (a lost recompute would hide a live document), so those steps repair
 * on their own — no maintenance call.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

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

const field = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
	name,
	type,
	// Engine rule: a field is NOT NULL unless `required: false` is explicit.
	...(extra.required === undefined ? { required: false } : {}),
	...extra,
});

// Fixture ids MUST be UUID v4 — the engine validates m2o values as UUIDs.
const FLEET_A = 'aaaaaaa1-1111-4111-a111-111111111111';
const FLEET_B = 'bbbbbbb2-2222-4222-b222-222222222222';

beforeAll(async () => {
	// Mirrors production provisioning order (no forward m2o references at create):
	// veh_fleets first, doc collections second, then the last_* pointer fields
	// are MERGED onto veh_fleets (the provision-hr reconcile step).
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
	// The two fleet-care child collections — the Daily ODO rows + fluid-fill rows
	// whose writes drive the denormalized care columns below.
	await createCollection('veh_odo_months', 'VEH Odo Months', [
		field('vehicle', 'm2o', { related_collection: 'veh_fleets', required: true }),
		field('month', 'text'),
		field('readings', 'longtext'),
	]);
	await createCollection('veh_fluid_fills', 'VEH Fluid Fills', [
		field('vehicle', 'm2o', { related_collection: 'veh_fleets', required: true }),
		field('fluid_kind', 'text'),
		field('odo_at_fill', 'number'),
		field('next_due_odo', 'number'),
	]);
	// Merge the pointer fields into the CURRENT stored field list (the schema
	// update route replaces fields wholesale, and the stored list carries system
	// fields too — the provision-hr reconcile does exactly this merge).
	const existing = await api('/api/collections/veh_fleets');
	const stored = (existing.body.data as { schema_json?: { fields?: Array<Record<string, unknown>> } } | undefined)?.schema_json?.fields;
	expect(Array.isArray(stored), 'GET veh_fleets returns stored fields').toBe(true);
	const merge = await api('/api/collections/veh_fleets', {
		method: 'PUT',
		body: JSON.stringify({
			fields: [
				...(stored as Array<Record<string, unknown>>),
				field('last_license', 'm2o', { related_collection: 'veh_permits' }),
				field('last_insurance', 'm2o', { related_collection: 'veh_insurances' }),
				// Denormalized care scalars (the veh-care-denorm hooks write these).
				field('last_odo', 'number'),
				field('last_engine_oil', 'number'),
				field('last_gear_oil', 'number'),
			],
		}),
	});
	expect(merge.status, 'merge last_* pointer fields onto veh_fleets').toBeLessThan(300);
	await insert('cms_veh_fleets', { id: FLEET_A, plate_no: 'TRK-A' });
	await insert('cms_veh_fleets', { id: FLEET_B, plate_no: 'TRK-B' });
});

/** Poll a fleet pointer column until it equals `expected` (fire-and-forget hooks). */
async function waitForPointer(fleetId: string, col: string, expected: string | number | null, timeoutMs = 4000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let last: unknown = 'unset';
	while (Date.now() < deadline) {
		const r = await row('cms_veh_fleets', 'id = ?', fleetId);
		last = r ? (r as Record<string, unknown>)[col] : null;
		if (last === expected) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`veh_fleets.${col} of ${fleetId}: expected ${String(expected)}, got ${String(last)}`);
}

async function createDoc(collection: string, doc: Record<string, unknown>): Promise<string> {
	const res = await api(`/api/entities/${collection}`, { method: 'POST', body: JSON.stringify(doc) });
	expect(res.status, `create ${collection} row: ${res.body.error ?? ''}`).toBe(201);
	const data = res.body.data as { id?: string } | undefined;
	expect(data?.id, 'created row id').toBeTruthy();
	return data!.id as string;
}

/** Let the unawaited after_* hook fully release the engine hook-depth guard. */
const settle = (ms = 150): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

it('newest permit by issue_date links last_license; edits re-rank; vehicles are isolated', async () => {
	// First permit on the truck → pointer lands on it.
	const p1 = await createDoc('veh_permits', {
		vehicle: FLEET_A,
		license_no: 'LIC-2026-01',
		issue_date: '2026-01-01',
		expiry_date: '2026-12-31',
	});
	await waitForPointer(FLEET_A, 'last_license', p1);
	await settle();

	// A LATER issue date (renewal) takes over.
	const p2 = await createDoc('veh_permits', {
		vehicle: FLEET_A,
		license_no: 'LIC-2026-06',
		issue_date: '2026-06-01',
		expiry_date: '2027-05-31',
	});
	await waitForPointer(FLEET_A, 'last_license', p2);
	await settle();

	// A backdated/older permit must never demote the pointer.
	const p3 = await createDoc('veh_permits', {
		vehicle: FLEET_A,
		license_no: 'LIC-2025-12',
		issue_date: '2025-12-01',
		expiry_date: '2026-11-30',
	});
	await settle();
	await waitForPointer(FLEET_A, 'last_license', p2);
	await settle();

	// Editing an older permit to the newest issue date re-ranks it (after_update).
	const upd = await api(`/api/entities/veh_permits/${p3}`, { method: 'PUT', body: JSON.stringify({ issue_date: '2027-01-01' }) });
	expect(upd.status, 'update permit issue_date').toBe(200);
	await waitForPointer(FLEET_A, 'last_license', p3);
	await settle();

	// A permit on ANOTHER truck never touches this pointer (and links its own).
	const pb = await createDoc('veh_permits', {
		vehicle: FLEET_B,
		license_no: 'LIC-B',
		issue_date: '2026-03-01',
		expiry_date: '2027-03-01',
	});
	await settle();
	await waitForPointer(FLEET_A, 'last_license', p3);
	await waitForPointer(FLEET_B, 'last_license', pb);
	await settle();

	// Soft-deleting the CURRENT doc fires `after_delete` → the pointer re-ranks to
	// the next-newest LIVE permit on its own (no maintenance call). This is the
	// licenses bug: a stale pointer aimed at a trashed row reads as "no license"
	// and hides a live permit.
	const del = await api(`/api/entities/veh_permits/${p3}`, { method: 'DELETE' });
	expect(del.status, 'soft-delete current permit').toBe(200);
	await waitForPointer(FLEET_A, 'last_license', p2);

	// Restoring it fires `after_restore` → it is the newest again and re-takes the
	// pointer; the fleet row must never be left ranking a trashed document.
	const restore = await api(`/api/entities/veh_permits/${p3}/restore`, { method: 'POST' });
	expect(restore.status, 'restore current permit').toBe(200);
	await waitForPointer(FLEET_A, 'last_license', p3);
});

it('newest insurance by expiry_date links last_insurance', async () => {
	const i1 = await createDoc('veh_insurances', { vehicle: FLEET_A, policy_no: 'POL-1', expiry_date: '2026-06-30' });
	await waitForPointer(FLEET_A, 'last_insurance', i1);
	await settle();

	// Renewal with the further expiry takes over.
	const i2 = await createDoc('veh_insurances', { vehicle: FLEET_A, policy_no: 'POL-2', expiry_date: '2027-06-30' });
	await waitForPointer(FLEET_A, 'last_insurance', i2);
	await settle();

	// An expired/older policy never demotes.
	const i3 = await createDoc('veh_insurances', { vehicle: FLEET_A, policy_no: 'POL-3', expiry_date: '2025-12-31' });
	await settle();
	await waitForPointer(FLEET_A, 'last_insurance', i2);
	expect(i3).toBeTruthy();
});

it('a Daily ODO write raises veh_fleets.last_odo; a backdated/lower one never regresses it', async () => {
	// A fresh odo bucket (insert) → last_odo lands on its reading.
	const r1 = [
		{ date: '2026-09-01', odo: 12000, at: '2026-09-01T00:00:00.000Z' },
		{ date: '2026-09-02', odo: 12100, at: '2026-09-02T00:00:00.000Z' },
	];
	const m1 = await createDoc('veh_odo_months', { vehicle: FLEET_A, month: '2026-09', readings: JSON.stringify(r1) });
	await waitForPointer(FLEET_A, 'last_odo', 12100);
	await settle();

	// Appending a lower/backdated entry must NOT regress the cumulative odo.
	const next = [...r1, { date: '2026-09-01', odo: 6000, at: '2026-09-01T12:00:00.000Z' }];
	await api(`/api/entities/veh_odo_months/${m1}`, { method: 'PUT', body: JSON.stringify({ readings: JSON.stringify(next) }) });
	await settle();
	await waitForPointer(FLEET_A, 'last_odo', 12100);
	await settle();

	// A LATER (higher) reading on ANOTHER vehicle never touches A's odo.
	await createDoc('veh_odo_months', {
		vehicle: FLEET_B,
		month: '2026-09',
		readings: JSON.stringify([{ date: '2026-09-03', odo: 990001 }]),
	});
	await settle();
	const a = await row('cms_veh_fleets', 'id = ?', FLEET_A);
	expect((a as Record<string, unknown>).last_odo).toBe(12100);
});

it('correcting the CURRENT odo reading DOWN lowers veh_fleets.last_odo (exact recompute, not monotonic)', async () => {
	// A bucket whose max is a bad over-read (50,000).
	const m = await createDoc('veh_odo_months', {
		vehicle: FLEET_A,
		month: '2026-10',
		readings: JSON.stringify([
			{ date: '2026-10-01', odo: 49000, at: '2026-10-01T00:00:00.000Z' },
			{ date: '2026-10-02', odo: 50000, at: '2026-10-02T00:00:00.000Z' },
		]),
	});
	await waitForPointer(FLEET_A, 'last_odo', 50000);
	await settle();

	// The operator edits the bad reading away — the master must follow the true
	// max of what REMAINS (the monotonic guard would have kept 50,000 forever).
	await api(`/api/entities/veh_odo_months/${m}`, {
		method: 'PUT',
		body: JSON.stringify({ readings: JSON.stringify([{ date: '2026-10-01', odo: 49000, at: '2026-10-01T00:00:00.000Z' }]) }),
	});
	await settle();
	await waitForPointer(FLEET_A, 'last_odo', 49000);
	await settle();
});

it("a fluid fill sets its kind's last_*_oil = the newest fill's next_due_odo; edits re-rank", async () => {
	// Newest engine fill (highest odo) drives last_engine_oil.
	await createDoc('veh_fluid_fills', { vehicle: FLEET_A, fluid_kind: 'engine_oil', odo_at_fill: 10000, next_due_odo: 16000 });
	await waitForPointer(FLEET_A, 'last_engine_oil', 16000);
	await settle();
	// A newer (higher odo) engine fill takes over.
	const eNew = await createDoc('veh_fluid_fills', { vehicle: FLEET_A, fluid_kind: 'engine_oil', odo_at_fill: 12000, next_due_odo: 18000 });
	await waitForPointer(FLEET_A, 'last_engine_oil', 18000);
	await settle();

	// Gear stays independent of engine.
	await createDoc('veh_fluid_fills', { vehicle: FLEET_A, fluid_kind: 'gear_oil', odo_at_fill: 11000, next_due_odo: 21000 });
	await waitForPointer(FLEET_A, 'last_gear_oil', 21000);
	await settle();
	expect(((await row('cms_veh_fleets', 'id = ?', FLEET_A)) as Record<string, unknown>).last_engine_oil).toBe(18000);

	// Editing an OLDER engine fill's due must never demote (newest by odo wins).
	await api(`/api/entities/veh_fluid_fills/${eNew}`, { method: 'PUT', body: JSON.stringify({ next_due_odo: 70000 }) });
	await waitForPointer(FLEET_A, 'last_engine_oil', 70000);
	await settle();

	// A fill on ANOTHER vehicle never touches this truck (and links its own).
	await createDoc('veh_fluid_fills', { vehicle: FLEET_B, fluid_kind: 'gear_oil', odo_at_fill: 5000, next_due_odo: 50000 });
	await waitForPointer(FLEET_B, 'last_gear_oil', 50000);
	await settle();
	expect(((await row('cms_veh_fleets', 'id = ?', FLEET_A)) as Record<string, unknown>).last_gear_oil).toBe(21000);

	// SOFT-DELETING the current engine fill fires `after_delete` → the care scalars
	// are recomputed from the REMAINING fills (the duplicate may NOT keep its due).
	await api(`/api/entities/veh_fluid_fills/${eNew}`, { method: 'DELETE' });
	await waitForPointer(FLEET_A, 'last_engine_oil', 16000);
	// Gear is untouched by an engine-fill delete (exact recompute, not a blanket reset).
	expect(((await row('cms_veh_fleets', 'id = ?', FLEET_A)) as Record<string, unknown>).last_gear_oil).toBe(21000);
});

it('moving a document to another vehicle repairs BOTH owners (after_update `_existing`)', async () => {
	// Fresh vehicles keep this isolated from the shared FLEET_A/FLEET_B state above.
	const FLEET_C = 'ccccccc3-3333-4333-8333-333333333333';
	const FLEET_D = 'ddddddd4-4444-4444-9444-444444444444';
	await insert('cms_veh_fleets', { id: FLEET_C, plate_no: 'TRK-C' });
	await insert('cms_veh_fleets', { id: FLEET_D, plate_no: 'TRK-D' });

	// C: an older fallback permit plus the newer one that will become current.
	const cOld = await createDoc('veh_permits', {
		vehicle: FLEET_C,
		license_no: 'C-OLD',
		issue_date: '2026-01-01',
		expiry_date: '2026-12-31',
	});
	await settle();
	const cNew = await createDoc('veh_permits', {
		vehicle: FLEET_C,
		license_no: 'C-NEW',
		issue_date: '2026-06-01',
		expiry_date: '2027-06-30',
	});
	await waitForPointer(FLEET_C, 'last_license', cNew);
	await settle();

	// D already has its own (older) permit.
	const dOwn = await createDoc('veh_permits', {
		vehicle: FLEET_D,
		license_no: 'D-OWN',
		issue_date: '2026-02-01',
		expiry_date: '2027-02-01',
	});
	await waitForPointer(FLEET_D, 'last_license', dOwn);
	await settle();

	// MOVE C's current permit to D. It is newer than D's own, so D re-ranks to it
	// AND C — the owner it LEFT — must re-rank to its remaining permit. Without the
	// pre-update row C would keep pointing at a permit that now belongs to D, and
	// its card would show a foreign license.
	const move = await api(`/api/entities/veh_permits/${cNew}`, { method: 'PUT', body: JSON.stringify({ vehicle: FLEET_D }) });
	expect(move.status, 'move permit to another vehicle').toBe(200);

	await waitForPointer(FLEET_D, 'last_license', cNew);
	await waitForPointer(FLEET_C, 'last_license', cOld);
});

it('moving a fluid fill repairs the truck it left (care scalars recomputed exactly)', async () => {
	const FLEET_E = 'eeeeeee5-5555-4555-a555-555555555555';
	const FLEET_F = 'fffffff6-6666-4666-b666-666666666666';
	await insert('cms_veh_fleets', { id: FLEET_E, plate_no: 'TRK-E' });
	await insert('cms_veh_fleets', { id: FLEET_F, plate_no: 'TRK-F' });

	// E's only engine fill is the source of its last_engine_oil.
	const fill = await createDoc('veh_fluid_fills', {
		vehicle: FLEET_E,
		fluid_kind: 'engine_oil',
		odo_at_fill: 1000,
		next_due_odo: 5000,
	});
	await waitForPointer(FLEET_E, 'last_engine_oil', 5000);

	// Move it to F → E's live set no longer implies any due, so its scalar must
	// clear (the exact recompute, not the write-path advance).
	const move = await api(`/api/entities/veh_fluid_fills/${fill}`, { method: 'PUT', body: JSON.stringify({ vehicle: FLEET_F }) });
	expect(move.status, 'move fill to another vehicle').toBe(200);

	await waitForPointer(FLEET_F, 'last_engine_oil', 5000);
	await waitForPointer(FLEET_E, 'last_engine_oil', null);
});

it('GET /api/hook-registry exposes the registered relink code hooks (Studio viewer)', async () => {
	const res = await api('/api/hook-registry');
	expect(res.status, 'hook-registry is admin-readable').toBe(200);
	const hooks = res.body.data as
		| Array<{
				plugin_id: string;
				collection: string;
				event: string;
				description: string | null;
				writes_to: string[];
		  }>
		| undefined;
	expect(Array.isArray(hooks), 'registry returns a list').toBe(true);
	// Doc-pointer relink + fleet-care denorm register under ONE shared plugin id
	// (VEH_FLEET_RELINK_PLUGIN) so the Studio viewer groups them as a single
	// "keep this collection fresh" panel: permits + insurances (licenses/policies)
	// and odo-months + fluid-fills (care scalars) × four events each
	// (after_insert/after_update recompute from THE WRITTEN ROW; after_delete/
	// after_restore recompute from THE REMAINING SET).
	const fleet = (hooks ?? []).filter((h) => h.plugin_id === 'veh-fleet-relink');
	expect(fleet.length, 'sixteen registrations under the shared veh-fleet-relink plugin').toBe(16);
	expect(
		fleet.every((h) => h.writes_to.includes('veh_fleets')),
		'every relink/care hook rewrites veh_fleets',
	).toBe(true);
	expect(
		fleet.some((h) => h.collection === 'veh_permits' && h.event === 'after_insert' && !!h.description),
		'veh_permits.after_insert carries a human description',
	).toBe(true);
	expect(
		fleet.some((h) => h.collection === 'veh_insurances' && h.event === 'after_update'),
		'veh_insurances.after_update is registered',
	).toBe(true);
	expect(
		fleet.some((h) => h.collection === 'veh_odo_months' && h.event === 'after_insert' && !!h.description),
		'veh_odo_months.after_insert carries a human description',
	).toBe(true);
	expect(
		fleet.some((h) => h.collection === 'veh_fluid_fills' && h.event === 'after_update'),
		'veh_fluid_fills.after_update is registered',
	).toBe(true);
	expect(
		fleet.some((h) => h.collection === 'veh_permits' && h.event === 'after_delete'),
		'veh_permits.after_delete is registered (a trashed current permit re-points the fleet)',
	).toBe(true);
	expect(
		fleet.some((h) => h.collection === 'veh_insurances' && h.event === 'after_restore'),
		'veh_insurances.after_restore is registered',
	).toBe(true);
});
