/**
 * Fleet-care care chips — the ONE shared reader behind the km-left chips on the
 * fleets cards (`/app/fleets`) and the Fluid list (`/app/fluid`).
 *
 * Previously every list screen hand-rolled the SAME three reads per page
 * (current odo + each oil kind's newest fill-due) with a duplicated,
 * private copy — fetching the identical `veh_fleets` care graph under separate
 * caches. This module is the single source both apps call. Once `veh_fleets`
 * carries its denormalized care columns the chips compute from the master rows
 * ALONE (zero child reads); only on a DB not yet provisioned for those columns
 * does one page's care cost a single batched round trip (`POST /api/query`
 * fuses the three cross-collection reads), and the fallback + resolve logic
 * lives in one place instead of two.
 *
 * Semantics are unchanged from what each app rendered:
 *   • current odo  = the vehicle's newest-DATE reading across its `veh_odo_months`
 *     month buckets (the shared month-row reader's rule).
 *   • newest fill  = the NEWEST fill row of that kind by `odo_at_fill`
 *     (write-time tie-break), carrying its OWN stored `next_due_odo`.
 *   • km-left      = newest fill's next-due − current odo, null until BOTH inputs
 *     exist (never guessed).
 *
 * Carest failures degrade gracefully: a page that can't load care still renders
 * minus the chips — this module never throws for a care read, it returns the
 * map of what computed.
 */
import type { MmbixClient } from '@mmbix/sdk';
import { serializeQuery } from '@mmbix/sdk';

import { sdk } from '@/shared/api/sdk';
import { WALK_PAGE_SIZE, walkPages } from '@/shared/api/walk-pages';
import type { FleetCareChipModel, FleetRow, FluidFillRow, VehOdoMonthRow } from './types';

/** The local typed view of the shared SDK client (the same cast every module
 *  uses — the app-wide client targets the placeholder typegen `Schema`). */
type OpsSchema = {
	veh_odo_months: VehOdoMonthRow;
	veh_fluid_fills: FluidFillRow;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/** The m2o `vehicle` cell — a bare id, or the lean expanded `{ id }` row the
 *  engine returns for a dotted `vehicle.id` field request. */
function vehicleIdOf(value: unknown): string | null {
	if (typeof value === 'string' && value) return value;
	if (value && typeof value === 'object') {
		const id = (value as { id?: unknown }).id;
		if (typeof id === 'string' && id) return id;
	}
	return null;
}

/** Sort fill rows newest-first — highest fill odo, ties broken by the newest
 *  write (two fills at the same odo keep the later one as the service). */
function newestFillFirst(a: FluidFillRow, b: FluidFillRow): number {
	return (b.odo_at_fill ?? -1) - (a.odo_at_fill ?? -1) || (b.created_at ?? '').localeCompare(a.created_at ?? '');
}

/** One kind's km-left — `newest fill's next due − current odo`, the fleets
 *  chips' + Fluid app's exact read-side arithmetic. Null until BOTH inputs
 *  exist (a chip never guesses). */
export function kmLeftOf(dueOdoKm: number | null, currentOdoKm: number | null): number | null {
	if (dueOdoKm == null || currentOdoKm == null) return null;
	return dueOdoKm - currentOdoKm;
}

/** A resolved "current odo" — the newest-date reading of a vehicle (km + the
 *  reading's date). Mirrors the month-row reader's `LatestOdo`. */
export interface CareOdo {
	km: number | null;
	date: string | null;
}

/** Parse one `veh_odo_months` row's `readings` JSON into reading entries (same
 *  guard as the shared month-row reader: a bad payload never breaks a chip). */
function parseReadings(row: VehOdoMonthRow): Array<{ date: string | null; odo: number | null; at?: string | null }> {
	const raw = typeof row.readings === 'string' && row.readings.trim() !== '' ? row.readings : null;
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(e): e is { date: string; odo: number; at?: string } =>
				!!e &&
				typeof e === 'object' &&
				typeof (e as { date?: unknown }).date === 'string' &&
				typeof (e as { odo?: unknown }).odo === 'number',
		);
	} catch {
		return [];
	}
}

/** The newest-DATE reading of a vehicle's month rows (write-time tie-break). */
function newestReadingOf(rows: VehOdoMonthRow[]): CareOdo | null {
	const entries = rows
		.flatMap(parseReadings)
		.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.at ?? '').localeCompare(a.at ?? ''));
	const head = entries[0];
	return head ? { km: head.odo, date: head.date } : null;
}

/** Lean fill columns — dotted `vehicle.id` narrows the m2o expansion to a bare
 *  id, so a batched page never drags full related fleet rows. */
const FILL_CHIP_FIELDS = ['id', 'vehicle.id', 'fluid_kind', 'next_due_odo', 'created_at'] as const;
/** Lean month-row columns — same selection the shared month-row reader uses. */
const ODO_MONTH_FIELDS = ['id', 'vehicle.id', 'month', 'readings', 'updated_at'] as const;

/** The map of computed per-vehicle care reads — a vehicle present with its
 *  current odo (nullable only when NO reading is on file) + (nullable) km-left
 *  pair. Same shape the fleet `care?` column and the Fluid list rows read. */
export type CareChipMap = Map<string, FleetCareChipModel>;

/** The master's own DENORMALIZED care columns — the fields the fleet row may
 *  already carry so a single `veh_fleets` fetch can compute the chips with NO
 *  cross-collection read. Present only after the backend provisions them: */
interface MasterCare {
	currentOdo: number | null;
	engineDue: number | null;
	gearDue: number | null;
}

/** A fleet master row's built-in care state — non-null odometer fields are the
 *  trust signal that this row is maintained server-side; a row that carries the
 *  care columns all-null means a vehicle with no odo/fill history on file yet
 *  (authoritative — no child read can add anything). */
function masterCareOf(fleet: FleetRow): MasterCare | null {
	const currentOdo = fleet.last_odo ?? null;
	const engineDue = fleet.last_engine_oil ?? null;
	const gearDue = fleet.last_gear_oil ?? null;
	if (currentOdo == null && engineDue == null && gearDue == null) return null;
	return { currentOdo, engineDue, gearDue };
}

/** Compose one fleet's care read from resolved inputs (master columns or
 *  batch/first child rows). An entry is recorded when a chip computed OR a
 *  current odo is on file — the odo ALONE still feeds the Fluid list card's
 *  top-right readout even before the first fill exists (a chip additionally
 *  needs its fill). Null → vehicle has nothing at all on file — no readout,
 *  no chips. */
function careEntryOf(currentOdo: number | null, engineDue: number | null, gearDue: number | null): FleetCareChipModel | null {
	const engineOilKmLeft = kmLeftOf(engineDue, currentOdo);
	const gearOilKmLeft = kmLeftOf(gearDue, currentOdo);
	if (currentOdo == null && engineOilKmLeft == null && gearOilKmLeft == null) return null;
	return { currentOdo, engineOilKmLeft, gearOilKmLeft };
}

/**
 * Resolve care for a set of vehicles with NO denormalized master columns from the
 * care collections directly — ONE batched `POST /api/query` round trip fuses
 * the three cross-collection reads that used to be three parallel GETs (current
 * odo + newest engine + newest gear fills). A vehicle whose newest bucket/fill
 * fell outside the top-N window is picked up by a BATCHED cursor-walk fallback
 * (one `_in` request per page covering ALL still-missing vehicles per source —
 * never a request per vehicle). Returns a map keyed by vehicle id for the ids
 * that computed.
 */
async function resolveCareByChild(vehicleIds: string[], fallbackTopN = 20): Promise<CareChipMap> {
	const chips: CareChipMap = new Map();
	if (vehicleIds.length === 0) return chips;

	const batchedLimit = Math.max(vehicleIds.length * 2, fallbackTopN);

	// ONE batched round trip (the server resolves all three in parallel).
	const res = await ops.queryMany([
		{
			key: 'odo',
			collection: 'veh_odo_months',
			query: serializeQuery<VehOdoMonthRow>({
				fields: [...ODO_MONTH_FIELDS],
				filter: { vehicle: { _in: vehicleIds } },
				sort: '-month',
				limit: batchedLimit,
			}),
		},
		{
			key: 'engine',
			collection: 'veh_fluid_fills',
			query: serializeQuery<FluidFillRow>({
				fields: [...FILL_CHIP_FIELDS],
				filter: { vehicle: { _in: vehicleIds }, fluid_kind: { _eq: 'engine_oil' } },
				sort: '-odo_at_fill',
				limit: batchedLimit,
			}),
		},
		{
			key: 'gear',
			collection: 'veh_fluid_fills',
			query: serializeQuery<FluidFillRow>({
				fields: [...FILL_CHIP_FIELDS],
				filter: { vehicle: { _in: vehicleIds }, fluid_kind: { _eq: 'gear_oil' } },
				sort: '-odo_at_fill',
				limit: batchedLimit,
			}),
		},
	]);
	const byKey = new Map(res.results.map((r) => [r.key, r]));

	// Current odo per vehicle — group each vehicle's month rows, then take its
	// newest-date reading.
	const odoByVehicle = new Map<string, CareOdo>();
	const odoRows = byKey.get('odo')?.ok ? ((byKey.get('odo')!.data as VehOdoMonthRow[] | undefined) ?? []) : [];
	const odoGroups = new Map<string, VehOdoMonthRow[]>();
	for (const row of odoRows) {
		const id = vehicleIdOf(row.vehicle);
		if (!id) continue;
		odoGroups.set(id, [...(odoGroups.get(id) ?? []), row]);
	}
	for (const [id, monthRows] of odoGroups) {
		const reading = newestReadingOf(monthRows);
		if (reading && reading.km != null) odoByVehicle.set(id, reading);
	}

	// Newest next_due_odo per (vehicle, kind) from the batched fill rows.
	const nextDue = new Map<'engine_oil' | 'gear_oil', Map<string, number>>([
		['engine_oil', new Map()],
		['gear_oil', new Map()],
	]);
	// Dedupe tracking per SOURCE — which vehicles the batched top-N window still
	// owes (a vehicle resolving odo in batch but whose newest fill fell past ITS
	// window still gets that fill's fallback, and vice-versa).
	const needOdo = new Set(vehicleIds);
	const needEngine = new Set(vehicleIds);
	const needGear = new Set(vehicleIds);
	for (const kind of ['engine_oil', 'gear_oil'] as const) {
		const key = kind === 'engine_oil' ? 'engine' : 'gear';
		const fillRows = byKey.get(key)?.ok ? ((byKey.get(key)!.data as FluidFillRow[] | undefined) ?? []) : [];
		const perKind = nextDue.get(kind)!;
		for (const row of [...fillRows].sort(newestFillFirst)) {
			const id = vehicleIdOf(row.vehicle);
			if (!id || perKind.has(id) || row.next_due_odo == null) continue;
			perKind.set(id, row.next_due_odo);
		}
	}
	for (const id of vehicleIds) {
		if (odoByVehicle.has(id)) needOdo.delete(id);
		if (nextDue.get('engine_oil')!.has(id)) needEngine.delete(id);
		if (nextDue.get('gear_oil')!.has(id)) needGear.delete(id);
	}

	// A source whose batch spec SUCCEEDED with zero rows proves none of this
	// page's vehicles has any row there — a cursor walk over the same `_in` set
	// can only re-run that empty query, so it is skipped (every page of
	// data-less vehicles used to fire one empty walk request per source). Only
	// sources that returned rows can still owe a vehicle whose newest row ranked
	// past the batch's top-N window. A FAILED spec (ok:false) keeps the old walk
	// fallback — a transient batch error must not silently drop the chips.
	const sourceEmpty = (key: string): boolean => {
		const res = byKey.get(key);
		return res?.ok === true && Array.isArray(res.data) && res.data.length === 0;
	};

	// Vehicles the batched top-N window missed get BATCHED cursor-walk reads —
	// ONE `_in`-filtered request per page covering ALL still-missing vehicles
	// per source (the per-vehicle loop this replaces fired one request per
	// vehicle per source — the N+1 burst on care-heavy pages). Rows arrive
	// sorted newest-first, so a vehicle resolves on first sight; the walk ends
	// when all resolve, rows run out, or the page cap hits.
	if (needOdo.size > 0 && !sourceEmpty('odo')) {
		await walkPages<VehOdoMonthRow>(
			(cursor) =>
				ops.items('veh_odo_months').list({
					fields: [...ODO_MONTH_FIELDS],
					filter: { vehicle: { _in: [...needOdo] } },
					sort: '-month',
					limit: WALK_PAGE_SIZE,
					cursor,
				}),
			(rows) => {
				for (const row of rows) {
					const id = vehicleIdOf(row.vehicle);
					if (!id || !needOdo.has(id)) continue;
					const group = [...(odoGroups.get(id) ?? []), row];
					odoGroups.set(id, group);
					const reading = newestReadingOf(group);
					if (reading && reading.km != null) {
						odoByVehicle.set(id, reading);
						needOdo.delete(id);
					}
				}
				return needOdo.size === 0;
			},
		);
	}
	for (const kind of ['engine_oil', 'gear_oil'] as const) {
		const need = kind === 'engine_oil' ? needEngine : needGear;
		if (need.size === 0) continue;
		const key = kind === 'engine_oil' ? 'engine' : 'gear';
		if (sourceEmpty(key)) continue;
		const perKind = nextDue.get(kind)!;
		await walkPages<FluidFillRow>(
			(cursor) =>
				ops.items('veh_fluid_fills').list({
					fields: [...FILL_CHIP_FIELDS],
					filter: { vehicle: { _in: [...need] }, fluid_kind: { _eq: kind } },
					sort: '-odo_at_fill',
					limit: WALK_PAGE_SIZE,
					cursor,
				}),
			(rows) => {
				for (const row of [...rows].sort(newestFillFirst)) {
					const id = vehicleIdOf(row.vehicle);
					if (!id || !need.has(id) || row.next_due_odo == null) continue;
					perKind.set(id, row.next_due_odo);
					need.delete(id);
				}
				return need.size === 0;
			},
		);
	}

	// Compose the care reads.
	for (const id of vehicleIds) {
		const entry = careEntryOf(
			odoByVehicle.get(id)?.km ?? null,
			nextDue.get('engine_oil')!.get(id) ?? null,
			nextDue.get('gear_oil')!.get(id) ?? null,
		);
		if (entry) chips.set(id, entry);
	}
	return chips;
}

/** Whether the fetched master rows carry the denormalized care columns — the
 *  engine returns the requested keys (NULL included) when the `veh_fleets`
 *  schema has them and only DROPS the fields when the collection lacks them, so
 *  one row decides for the whole page (the three columns are provisioned as one
 *  unit — see the provision-hr reconcile). */
function careColumnsPresent(fleets: FleetRow[]): boolean {
	return fleets.some((fleet) => fleet.last_odo !== undefined || fleet.last_engine_oil !== undefined || fleet.last_gear_oil !== undefined);
}

/**
 * The ONE shared way both list screens compute a page's care chips.
 *
 * Column-first: when the backend denormalizes care onto `veh_fleets`
 * (`last_odo`/`last_engine_oil`/`last_gear_oil`, kept fresh on every odo/fill
 * write — the insurance/license pattern), each master row already carries what
 * the chips need, so they are computed with ZERO cross-collection read and the
 * whole fleet screen is a single `veh_fleets` fetch. The master row is
 * authoritative whenever the fetch carries the columns — INCLUDING an all-NULL
 * row, which genuinely means a vehicle with no odo/fill history yet (a child
 * read can only re-prove that empty).
 *
 * The batched `/api/query` child read is reserved for a fleet DB whose
 * `veh_fleets` schema is NOT yet provisioned for the care columns (the server
 * drops the requested fields, so no row carries them) — there the children are
 * the only source, and one round trip fuses the three reads for the whole page,
 * so nothing regresses on un-provisioned data.
 *
 * Semantics (identical either way):
 *   • current odo = the vehicle's current odometer (`last_odo`, else the newest
 *     reading across its `veh_odo_months` buckets).
 *   • newest fill = the NEWEST fill of that kind, carrying its OWN stored
 *     `next_due_odo` (`last_engine_oil`/`last_gear_oil`, else the newest fill).
 *   • km-left     = newest due − current odo, null until BOTH exist.
 *
 * Care chips are a best-effort adornment — a failure degrades gracefully to the
 * plain master rows (the fleets/fluid pages render clean, minus the chips). The
 * caller decides whether only-computable vehicles matter (`withCare` on fleets)
 * or every row gets a null pair (fluid's neutral chips).
 */
export async function careChipsFor(fleets: FleetRow[]): Promise<CareChipMap> {
	if (fleets.length === 0) return new Map();
	try {
		const chips: CareChipMap = new Map();
		for (const fleet of fleets) {
			const care = masterCareOf(fleet);
			if (!care) continue;
			const entry = careEntryOf(care.currentOdo, care.engineDue, care.gearDue);
			if (entry) chips.set(fleet.id, entry);
		}
		// Fallback only for a `veh_fleets` schema that still lacks the care
		// columns (every row reads all-null AND carries none of the keys).
		if (careColumnsPresent(fleets)) return chips;
		const missingIds = fleets.filter((fleet) => !chips.has(fleet.id)).map((fleet) => fleet.id);
		for (const [id, chip] of await resolveCareByChild(missingIds)) {
			if (!chips.has(id)) chips.set(id, chip);
		}
		return chips;
	} catch (err) {
		console.warn('[fleet-care] care chips unavailable:', err instanceof Error ? err.message : err);
		return new Map();
	}
}
