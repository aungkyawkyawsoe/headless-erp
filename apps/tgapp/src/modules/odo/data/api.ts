import type { MmbixClient } from '@mmbix/sdk';

import type { CursorPage } from '@/shared/hooks/use-cursor-list';
import { LIST_PAGE_SIZE, SEARCH_LIMIT } from '@/shared/constants';
import { vehicleBrandLabel } from '@/shared/fleet';
import { fetchVehicleIdentity } from '@/shared/lookups/api';
import { sdk } from '@/shared/api/sdk';
import { todayMmtDate } from '@/shared/time/myanmar';
import type { FleetRow, VehOdoMonthRow, VehOdoReading } from '@/modules/fleets/data/types';
import { latestOdoByVehicle, newestReadingsOf, readingsOf, recentMonthRowsOfVehicle } from '@/modules/fleets/data/odo-months';
import { SERVICEABLE_VEHICLE_FILTER } from '@/modules/fleets/data/status';
import type { OdoCurrentModel, OdoReadingsModel, OdoListModel } from './types';

/**
 * The Daily ODO module's typed client — the same local-cast pattern as the
 * fleets module: the app-wide client is typed against the placeholder typegen
 * `Schema`, so reads here go through a locally-typed view of the same instance.
 *
 * The LIST reads `veh_fleets` ONLY — each vehicle row carries its denormalized
 * `last_odo` (the current odometer, kept fresh by the fleet-care denorm hooks on
 * every Daily ODO write), so a page renders with ONE `veh_fleets` fetch and no
 * child read. Only a DB whose `veh_fleets` schema lacks `last_odo` falls back to
 * the `veh_odo_months` reader. The VEHICLE page reads that month-bucket store
 * (the current month's readings + the vehicle's newest bucket, for the current
 * odo / the form's floor) — the line items behind a tapped row.
 *
 * Storage model: ONE `veh_odo_months` row per (vehicle, Gregorian month); the
 * row's `readings` JSON array holds the month's daily readings. Recording a
 * reading APPENDS it to that (vehicle, month) bucket — the record form refuses
 * a date before the last reading or a km below it, so the append stays
 * monotonic.
 */
type OpsSchema = {
	veh_fleets: FleetRow;
	veh_odo_months: VehOdoMonthRow;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/** The identity columns the deep-link header read needs (plate/brand only —
/** The vehicle-LIST projection — the master facts the rows render PLUS the
 *  denormalized `last_odo` (the current odometer) so the card's odo shows from
 *  the master alone (a one-`veh_fleets`-fetch list). Until a DB is reconciled
 *  for the column it is dropped server-side and the reader falls back to its
 *  batched `veh_odo_months` cross-read (no regression). */
const LIST_VEHICLE_FIELDS = ['id', 'plate_no', 'brand', 'last_odo'] as const;

/** One master row → its list model (the odo read fills latestKm/latestDate). */
function odoListOf(fleet: FleetRow): OdoListModel {
	return {
		id: fleet.id,
		plateNo: fleet.plate_no?.trim() || '—',
		brandLabel: vehicleBrandLabel(fleet.brand),
		latestKm: null,
		latestDate: null,
	};
}

/** A stable React key for one reading — the month-bucket entries have no row id
 *  of their own, so the (date · odo · write-time) triple stands in for one. */
function readingIdOf(entry: VehOdoReading): string {
	return `${entry.date}~${entry.odo}~${entry.at ?? ''}`;
}

/** Attach each page row's current odo — COLUMN-FIRST from the master's
 *  denormalized `last_odo`, so a page renders from ONE `veh_fleets` fetch with
 *  ZERO child reads (a vehicle with no reading yet keeps its neutral null). Only
 *  a `veh_fleets` schema without `last_odo` (the server drops the requested
 *  field, so no row carries the key) falls back to the batched `veh_odo_months`
 *  read — which additionally carries each reading's date. */
async function attachLatestReadings(rows: FleetRow[]): Promise<OdoListModel[]> {
	if (rows.length === 0) return [];
	if (rows.some((fleet) => fleet.last_odo !== undefined)) {
		return rows.map((fleet) => ({ ...odoListOf(fleet), latestKm: fleet.last_odo ?? null }));
	}
	try {
		const latest = await latestOdoByVehicle(rows.map((f) => f.id));
		return rows.map((fleet) => {
			const reading = latest.get(fleet.id);
			const model = odoListOf(fleet);
			if (reading) {
				model.latestKm = reading.km;
				model.latestDate = reading.date;
			}
			return model;
		});
	} catch (err) {
		// Reading statuses must never break the vehicle list — degrade to master rows.
		console.warn('[odo] latest readings unavailable:', err instanceof Error ? err.message : err);
		return rows.map(odoListOf);
	}
}

/** One page of the Daily ODO list — serviceable vehicles (plate-sorted; trailers
 *  excluded via `SERVICEABLE_VEHICLE_FILTER`), each carrying its current odo
 *  (from the master's `last_odo` when provisioned). */
export async function fetchOdoListPage(cursor?: string): Promise<CursorPage<OdoListModel>> {
	const res = await ops.items('veh_fleets').list({
		fields: [...LIST_VEHICLE_FIELDS],
		sort: 'plate_no',
		filter: SERVICEABLE_VEHICLE_FILTER,
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	return {
		rows: await attachLatestReadings(res.data),
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/** The toolbar search — server-side `?search=` over the serviceable master,
 *  mapped to the SAME list rows (current odo attached; trailers excluded). */
export async function fetchOdoSearch(query: string): Promise<OdoListModel[]> {
	const res = await ops.items('veh_fleets').list({
		fields: [...LIST_VEHICLE_FIELDS],
		search: query,
		filter: SERVICEABLE_VEHICLE_FILTER,
		limit: SEARCH_LIMIT,
	});
	return attachLatestReadings(res.data);
}

/** ONE vehicle's CURRENT odo + last reading's date — the vehicle page's ONLY
 *  per-visit API read when a list row was tapped. Reads the vehicle's TWO newest
 *  month buckets (one bounded request) and keeps only the current odo + its
 *  date — the card's facts and the record form's floor. The month's READINGS
 *  (the history) are deliberately NOT returned: they load only when the history
 *  screen opens (`fetchOdoReadings`). */
export async function fetchOdoCurrent(vehicleId: string): Promise<OdoCurrentModel> {
	const monthRows = await recentMonthRowsOfVehicle(vehicleId, todayMmtDate().slice(0, 7));
	const latest = newestReadingsOf(monthRows)[0] ?? null;
	return { currentOdo: latest?.odo ?? null, latestOdoDate: latest?.date ?? null };
}

/**
 * ONE vehicle's odo reading HISTORY — the history screen's read
 * (`/app/daily-odo/:id/history`), requested ONLY when that screen opens (the
 * vehicle page itself keeps to the lean `fetchOdoCurrent`). Reads the vehicle's
 * TWO newest month buckets (one bounded request): the history is the CURRENT
 * MMT month, while the current odo is the newest-DATE entry across those
 * buckets — so a last reading logged in an earlier month still floors the
 * record form.
 */
export async function fetchOdoReadings(vehicleId: string): Promise<OdoReadingsModel> {
	const currentMonth = todayMmtDate().slice(0, 7);
	const monthRows = await recentMonthRowsOfVehicle(vehicleId, currentMonth);

	// The history is the CURRENT month only; the current reading is the newest
	// reading across the rows read — the newest bucket is always in the window,
	// so a last reading logged in an earlier month still floors the record form.
	const readings = newestReadingsOf(monthRows.filter((row) => row.month === currentMonth));
	const latest = newestReadingsOf(monthRows)[0] ?? null;

	return {
		id: vehicleId,
		currentOdo: latest?.odo ?? null,
		latestOdoDate: latest?.date ?? null,
		readings: readings.map((entry) => ({
			id: readingIdOf(entry),
			date: entry.date ?? null,
			km: entry.odo ?? null,
			note: entry.note ?? null,
		})),
	};
}

/** A vehicle's lean IDENTITY (plate/brand) — the deep-link-only header read.
 *  The tap path skips this entirely (identity comes from the routed row). */
export interface OdoFleetIdentity {
	plateNo: string;
	brandLabel: string | null;
}

/** Deep-link identity — read the fleet master row ONLY for plate/brand (used
 *  when no routed row backed the page, e.g. a refresh or a direct open). Throws
 *  when the vehicle is not on the directory. */
export async function fetchOdoFleetIdentity(vehicleId: string): Promise<OdoFleetIdentity> {
	// Shared with every other fleet module (one key, one cached read).
	const identity = await fetchVehicleIdentity(vehicleId);
	return { plateNo: identity.plateNo ?? '—', brandLabel: identity.brandLabel };
}

export interface CreateOdoLogInput {
	/** `YYYY-MM-DD` — defaults to today in the record form. */
	reading_date: string;
	/** The odometer in km (the form guards it is ≥ the vehicle's current). */
	odometer: number;
	note?: string;
}

/** Ascending (reading date, write-time) — the order a bucket's `readings` is
 *  stored in (the write-time only breaks same-day ties). */
function sortReadingsAsc(a: VehOdoReading, b: VehOdoReading): number {
	return a.date.localeCompare(b.date) || (a.at ?? '').localeCompare(b.at ?? '');
}

/** Record one daily reading — append it to the vehicle's (month) bucket row. */
export async function createOdoLog(vehicleId: string, input: CreateOdoLogInput): Promise<VehOdoMonthRow> {
	const month = input.reading_date.slice(0, 7);
	const entry: VehOdoReading = {
		date: input.reading_date,
		odo: input.odometer,
		...(input.note?.trim() ? { note: input.note.trim() } : {}),
		at: new Date().toISOString(),
	};

	// Read-or-create the (vehicle, month) bucket, then merge the new reading in
	// and store the array date-sorted (write-time tie-break).
	const existing = await ops.items('veh_odo_months').list({
		fields: ['id', 'readings'],
		filter: { vehicle: { _eq: vehicleId }, month: { _eq: month } },
		limit: 1,
	});
	const row = existing.data[0];
	if (!row?.id) {
		return ops.items('veh_odo_months').create({
			vehicle: vehicleId,
			month,
			readings: JSON.stringify([entry]),
		});
	}
	const next = [...readingsOf(row), entry].sort(sortReadingsAsc);
	return ops.items('veh_odo_months').update(row.id, { readings: JSON.stringify(next) });
}

/** The vehicle's newest reading PLUS the one it follows — the correction
 *  screen's context. `previous` floors the corrected value (a correction may sit
 *  below its own old number, but never below the reading before it). */
export interface OdoReadingEditContext {
	latest: VehOdoReading;
	previous: VehOdoReading | null;
}

/** The vehicle's newest reading (across its newest buckets) + the reading
 *  before it. Throws when the vehicle has no reading to correct. */
export async function fetchOdoReadingForEdit(vehicleId: string): Promise<OdoReadingEditContext> {
	const monthRows = await recentMonthRowsOfVehicle(vehicleId, todayMmtDate().slice(0, 7));
	const readings = newestReadingsOf(monthRows);
	const latest = readings[0];
	if (!latest) throw new Error('No reading on file.');
	return { latest, previous: readings[1] ?? null };
}

/** A correction to the newest reading — the entry is matched inside its bucket by
 *  its original (date, write-time), so a same-day duplicate is corrected
 *  precisely. Changing the DATE across a month boundary moves the entry to its
 *  new bucket. */
export interface UpdateOdoReadingInput {
	original: VehOdoReading;
	date: string;
	odometer: number;
}

/** Correct the vehicle's newest reading in place. */
export async function updateLastOdoReading(vehicleId: string, input: UpdateOdoReadingInput): Promise<VehOdoMonthRow | null> {
	const originalMonth = input.original.date.slice(0, 7);
	const targetMonth = input.date.slice(0, 7);
	const corrected: VehOdoReading = {
		date: input.date,
		odo: input.odometer,
		...(input.original.note?.trim() ? { note: input.original.note.trim() } : {}),
		at: input.original.at ?? new Date().toISOString(),
	};

	const originalRows = await ops.items('veh_odo_months').list({
		fields: ['id', 'readings'],
		filter: { vehicle: { _eq: vehicleId }, month: { _eq: originalMonth } },
		limit: 1,
	});
	const originalRow = originalRows.data[0];
	if (!originalRow?.id) return null;

	// Drop the exact original entry (date + write-time) from its bucket.
	const remaining = readingsOf(originalRow).filter(
		(entry) => !(entry.date === input.original.date && (entry.at ?? '') === (input.original.at ?? '')),
	);

	if (originalMonth === targetMonth) {
		return ops
			.items('veh_odo_months')
			.update(originalRow.id, { readings: JSON.stringify([...remaining, corrected].sort(sortReadingsAsc)) });
	}

	// The corrected DATE left its month: rewrite the original bucket without it,
	// then read-or-create the target month's bucket and append there.
	await ops.items('veh_odo_months').update(originalRow.id, { readings: JSON.stringify(remaining) });
	const targetRows = await ops.items('veh_odo_months').list({
		fields: ['id', 'readings'],
		filter: { vehicle: { _eq: vehicleId }, month: { _eq: targetMonth } },
		limit: 1,
	});
	const targetRow = targetRows.data[0];
	if (!targetRow?.id) {
		return ops.items('veh_odo_months').create({
			vehicle: vehicleId,
			month: targetMonth,
			readings: JSON.stringify([corrected]),
		});
	}
	return ops
		.items('veh_odo_months')
		.update(targetRow.id, { readings: JSON.stringify([...readingsOf(targetRow), corrected].sort(sortReadingsAsc)) });
}
