/**
 * `veh_odo_months` row reader — the fleet-care odometer store SHARED by the
 * fleets cards' chips, the Fluid app's km-left anchor and the Daily ODO app's
 * boards. Storage model: ONE row per (vehicle, Gregorian month); the row's
 * `readings` column is a JSON TEXT array of daily readings. A vehicle's current
 * odo = the newest-DATE entry across its month rows — the read-side rule every
 * km service interval counts from (never a stored master column).
 *
 * All reads stay generic-engine list calls over `veh_odo_months`. Month buckets
 * keep row counts low (≤ 1 per vehicle per month), so a page's chips need only
 * each vehicle's NEWEST bucket (one batched `_in` read + targeted fallbacks)
 * and a board only the vehicle's recent few buckets.
 *
 * The Daily ODO write (append into a month bucket) lives in `modules/odo`; the
 * Fluid + fleets modules are read-only consumers of the helpers below.
 */
import type { MmbixClient } from '@mmbix/sdk';

import { sdk } from '@/shared/api/sdk';
import { WALK_PAGE_SIZE, walkPages } from '@/shared/api/walk-pages';
import type { FleetRow, VehOdoMonthRow, VehOdoReading } from './types';

/** The local typed view of the shared SDK client (the same cast every module
 *  uses — the app-wide client is typed against the placeholder typegen). */
type OpsSchema = {
	veh_fleets: FleetRow;
	veh_odo_months: VehOdoMonthRow;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/** The month-row columns every read needs — dotted `vehicle.id` narrows the m2o
 *  expansion to a bare id so a batched page never drags full fleet rows. */
const MONTH_ROW_FIELDS = ['id', 'vehicle.id', 'month', 'readings', 'updated_at'] as const;

/** A resolved "current odo" — the newest-date reading of a vehicle. */
export interface LatestOdo {
	/** The odometer in km. */
	km: number | null;
	/** `YYYY-MM-DD` of the newest reading — null when no reading is on file. */
	date: string | null;
}

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

/** Parse one row's `readings` JSON — the stored array, or [] when the column is
 *  missing/empty/corrupt (a bad payload must never break a chips read). */
export function readingsOf(row: VehOdoMonthRow): VehOdoReading[] {
	const raw = typeof row.readings === 'string' && row.readings.trim() !== '' ? row.readings : null;
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(entry): entry is VehOdoReading =>
				!!entry &&
				typeof entry === 'object' &&
				typeof (entry as VehOdoReading).date === 'string' &&
				typeof (entry as VehOdoReading).odo === 'number',
		);
	} catch {
		return [];
	}
}

/** Newest-entry-first comparison — reading DATE, ties broken by the entry's
 *  write time (the array-order analog of the old rows' created_at tie-break). */
function newestEntryFirst(a: VehOdoReading, b: VehOdoReading): number {
	return (b.date ?? '').localeCompare(a.date ?? '') || (b.at ?? '').localeCompare(a.at ?? '');
}

/** A vehicle's readings merged across its month rows, newest first. Bucket rows
 *  arriving unsorted (or split by a create race) are fine — date + write-time
 *  order the merge, so a reading is never dropped from the newest entry. */
export function newestReadingsOf(rows: VehOdoMonthRow[]): VehOdoReading[] {
	return rows.flatMap(readingsOf).sort(newestEntryFirst);
}

/** The current reading of a vehicle's month rows — its newest-DATE entry, or
 *  null when none of the rows carries a readable reading. */
export function latestOdoOf(rows: VehOdoMonthRow[]): LatestOdo | null {
	const newest = newestReadingsOf(rows)[0];
	return newest ? { km: newest.odo, date: newest.date } : null;
}

/** Each vehicle's current odo for a set of vehicles — ONE batched `_in` read
 *  sorted newest-month first (a vehicle's current odo always sits in its newest
 *  bucket, and buckets only exist once a reading was recorded). A vehicle whose
 *  bucket fell outside the top-N window is picked up by a batched cursor walk
 *  over the whole unresolved set (ONE `_in` request per page — never a request
 *  per vehicle). */
export async function latestOdoByVehicle(vehicleIds: string[]): Promise<Map<string, LatestOdo>> {
	const result = new Map<string, LatestOdo>();
	if (vehicleIds.length === 0) return result;

	const batched = await ops.items('veh_odo_months').list({
		fields: [...MONTH_ROW_FIELDS],
		filter: { vehicle: { _in: vehicleIds } },
		sort: '-month',
		limit: Math.max(vehicleIds.length * 2, 20),
	});
	// Group the rows per vehicle then resolve each group — never assume the
	// first row of a vehicle in the batched page is its only/ newest bucket.
	const byVehicle = new Map<string, VehOdoMonthRow[]>();
	for (const row of batched.data) {
		const vehicleId = vehicleIdOf(row.vehicle);
		if (!vehicleId) continue;
		const group = byVehicle.get(vehicleId);
		if (group) group.push(row);
		else byVehicle.set(vehicleId, [row]);
	}
	for (const [vehicleId, rows] of byVehicle) {
		const latest = latestOdoOf(rows);
		if (latest && latest.km != null) result.set(vehicleId, latest);
	}

	// Vehicles the batched window missed — BATCHED cursor walk (one `_in`
	// request per page covering ALL still-unresolved vehicles; rows sorted
	// newest-month first so a vehicle resolves on first sight). A batch that
	// came back EMPTY proves none of these vehicles has a month row at all —
	// the walk over the same `_in` set can only re-run an empty query, so it
	// is skipped (one wasted request per caller otherwise).
	const need = new Set(vehicleIds.filter((id) => !result.has(id)));
	if (need.size > 0 && batched.data.length > 0) {
		const groups = new Map<string, VehOdoMonthRow[]>();
		await walkPages<VehOdoMonthRow>(
			(cursor) =>
				ops.items('veh_odo_months').list({
					fields: [...MONTH_ROW_FIELDS],
					filter: { vehicle: { _in: [...need] } },
					sort: '-month',
					limit: WALK_PAGE_SIZE,
					cursor,
				}),
			(rows) => {
				for (const row of rows) {
					const vehicleId = vehicleIdOf(row.vehicle);
					if (!vehicleId || !need.has(vehicleId)) continue;
					const group = groups.get(vehicleId);
					if (group) group.push(row);
					else groups.set(vehicleId, [row]);
					const latest = latestOdoOf(groups.get(vehicleId)!);
					if (latest && latest.km != null) {
						result.set(vehicleId, latest);
						need.delete(vehicleId);
					}
				}
				return need.size === 0;
			},
		);
	}
	return result;
}

/** A vehicle's recent month buckets, newest month first — the Daily ODO vehicle
 *  page's ONE read. Filtered to `month <= currentMonth` (a future-dated bucket
 *  must never raise the floor) and limited to TWO rows: index 0 is ALWAYS the
 *  vehicle's true newest bucket — its last reading — so the board still knows
 *  the floor when the current month has no bucket yet, while the current month,
 *  once it has one, is never pushed out of the window. */
export async function recentMonthRowsOfVehicle(vehicleId: string, currentMonth: string): Promise<VehOdoMonthRow[]> {
	const res = await ops.items('veh_odo_months').list({
		fields: [...MONTH_ROW_FIELDS],
		filter: { vehicle: { _eq: vehicleId }, month: { _lte: currentMonth } },
		sort: '-month',
		limit: 2,
	});
	return res.data;
}
