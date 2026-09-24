import type { MmbixClient } from '@mmbix/sdk';

import type { CursorPage } from '@/shared/hooks/use-cursor-list';
import { LIST_PAGE_SIZE, SEARCH_LIMIT } from '@/shared/constants';
import { vehicleBrandLabel } from '@/shared/fleet';
import { fetchVehicleIdentity } from '@/shared/lookups/api';
import { formatEnglishDayMonth } from '@/shared/time/myanmar';
import { sdk } from '@/shared/api/sdk';
import type { FleetRow, FluidFillRow, FluidKind } from '@/modules/fleets/data/types';
import { careChipsFor } from '@/modules/fleets/data/care';
import { SERVICEABLE_VEHICLE_FILTER } from '@/modules/fleets/data/status';
import type { FluidFillHistoryModel, FluidFleetIdentity, FluidListModel } from './types';

/**
 * The Fluid module's typed client — the same local-cast pattern as the fleets
 * and odo modules: the app-wide client is typed against the placeholder typegen
 * `Schema`, so reads here go through a locally-typed view of the same instance.
 * Reads `veh_fleets` (the vehicle list identities, carrying the denormalized
 * care columns) and `veh_fluid_fills` (this module's rows — each fill carries
 * its OWN `next_due_odo`, so service frequency is chosen per fill and there is
 * NO per-vehicle interval field on the fleet master to read). No `veh_odo_months`
 * read exists in this module: a truck's current odo rides the tapped list row's
 * router state into the vehicle page (else the fleet-care columns carry it).
 */
type OpsSchema = {
	veh_fleets: FleetRow;
	veh_fluid_fills: FluidFillRow;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/** One fill's full columns — the board's newest-fill facts (qty + due + the
 *  effective service date + the engine's system doc_status). */
const FILL_READ_FIELDS = ['id', 'fluid_kind', 'odo_at_fill', 'qty_liters', 'next_due_odo', 'date', 'doc_status', 'created_at'] as const;

/** The per-vehicle km-left chips on the LIST rows come from the SHARED reader in
 *  `@/modules/fleets/data/care`. It is COLUMN-FIRST: when the master fetch already
 *  carries the denormalized care scalars (`last_odo`/`last_engine_oil`/
 *  `last_gear_oil`) the chips compute from the master rows alone — a LIST becomes
 *  ONE `veh_fleets` fetch (`LIST_VEHICLE_FIELDS` below projects them). Until a DB
 *  is reconciled for those columns they are dropped server-side and the reader
 *  falls back to its one batched `/api/query` cross-read (no regression). This
 *  module only shapes the chip result into its list rows via `attachChips`. The
 *  history reader keeps its own newest-fill sort below. */

/** The vehicle-LIST projection — the master facts the rows render PLUS the three
 *  denormalized care scalars (`last_odo`/`last_engine_oil`/`last_gear_oil`) so
 *  `careChipsFor` can run column-first (zero child reads) once the backend keeps
 *  them. Until a DB reconciles for them they are dropped server-side and the
 *  reader falls back to its batched cross-read. The fleet page + toolbar search
 *  select these. */
const LIST_VEHICLE_FIELDS = ['id', 'plate_no', 'brand', 'last_odo', 'last_engine_oil', 'last_gear_oil'] as const;

/** One row's EFFECTIVE day (`YYYY-MM-DD`) — its `date` column when set, else
 *  the calendar day of `created_at` (rows recorded before the date column
 *  existed; the same fallback the history card's label shows). */
function fillDayOf(fill: FluidFillRow): string {
	return fill.date?.trim() || (fill.created_at ? fill.created_at.slice(0, 10) : '');
}

/** Sort a fill history newest-EFFECTIVE-DATE first; fills sharing one day break
 *  by the newest write, then by odo (a page boundary could otherwise reorder
 *  two fills recorded on the same day). */
function newestFillDateFirst(a: FluidFillRow, b: FluidFillRow): number {
	return (
		fillDayOf(b).localeCompare(fillDayOf(a)) ||
		(b.created_at ?? '').localeCompare(a.created_at ?? '') ||
		(b.odo_at_fill ?? -1) - (a.odo_at_fill ?? -1)
	);
}

/** One master row → its list model (the care read fills the current odo + the
 *  km-left pairs). */
function fluidListOf(fleet: FleetRow): FluidListModel {
	return {
		id: fleet.id,
		plateNo: fleet.plate_no?.trim() || '—',
		brandLabel: vehicleBrandLabel(fleet.brand),
		currentOdo: null,
		engineOilKmLeft: null,
		gearOilKmLeft: null,
	};
}

/** Attach one page's computed care reads to its list rows (a vehicle the read
 *  missed keeps its neutral null odo + chips). */
async function attachChips(rows: FleetRow[]): Promise<FluidListModel[]> {
	if (rows.length === 0) return [];
	const care = await careChipsFor(rows);
	return rows.map((fleet) => {
		const entry = care.get(fleet.id);
		const model = fluidListOf(fleet);
		if (entry) {
			model.currentOdo = entry.currentOdo;
			model.engineOilKmLeft = entry.engineOilKmLeft;
			model.gearOilKmLeft = entry.gearOilKmLeft;
		}
		return model;
	});
}

/** One page of the Fluid list — serviceable vehicles (plate-sorted; trailers
 *  excluded via `SERVICEABLE_VEHICLE_FILTER`), each carrying its per-kind
 *  km-left chips. */
export async function fetchFluidsListPage(cursor?: string): Promise<CursorPage<FluidListModel>> {
	const res = await ops.items('veh_fleets').list({
		fields: [...LIST_VEHICLE_FIELDS],
		sort: 'plate_no',
		filter: SERVICEABLE_VEHICLE_FILTER,
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	return {
		rows: await attachChips(res.data),
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/** The toolbar search — server-side `?search=` over the serviceable master,
 *  mapped to the SAME list rows (chips attached; trailers excluded). */
export async function fetchFluidsSearch(query: string): Promise<FluidListModel[]> {
	const res = await ops.items('veh_fleets').list({
		fields: [...LIST_VEHICLE_FIELDS],
		search: query,
		filter: SERVICEABLE_VEHICLE_FILTER,
		limit: SEARCH_LIMIT,
	});
	return attachChips(res.data);
}

/** Deep-link / refresh identity — read the fleet master row ONLY for the plate/
 *  brand the header needs. Used ONLY when no routed list row backed the page
 *  (a card tap passes its row through router state, so this never fires there).
 *  Throws when the vehicle is not on the fleet master. */
export async function fetchFluidFleetIdentity(vehicleId: string): Promise<FluidFleetIdentity> {
	// Shared with every other fleet module (one key, one cached read).
	// The truck PHOTO rides along, so the per-vehicle page leads with the truck
	// itself on every open.
	const identity = await fetchVehicleIdentity(vehicleId);
	return {
		plateNo: identity.plateNo ?? '—',
		brandLabel: identity.brandLabel,
		image: identity.image ?? null,
		lastOdo: identity.lastOdo ?? null,
	};
}

/**
 * ONE fill page of a kind's HISTORY — cursor-paginated, read newest-by-odo for
 * a stable server order, then re-sorted client-side by EFFECTIVE date (each
 * fill's `date` — the day its service was performed — falling back to the day
 * of `created_at`), so the list reads as a true service timeline and rows
 * recorded before the date column interleave by their record day. Loaded ONLY
 * for the ACTIVE tab and grown lazily as the user scrolls
 * (`useCursorList` + the history view's sentinel) — never deep-read at once.
 */
export async function fetchFluidHistoryPage(
	vehicleId: string,
	kind: FluidKind,
	cursor?: string,
): Promise<CursorPage<FluidFillHistoryModel>> {
	const res = await ops.items('veh_fluid_fills').list({
		fields: [...FILL_READ_FIELDS],
		filter: { vehicle: { _eq: vehicleId }, fluid_kind: { _eq: kind } },
		sort: '-odo_at_fill',
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	return {
		rows: [...res.data].sort(newestFillDateFirst).map(fillHistoryOf),
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/** One fill row → its display row in a kind's history (odo · the next-service
 *  due it set · qty · an English day-month date — the fill's EFFECTIVE `date`
 *  when it set one, else the day of `created_at` for rows recorded before the
 *  date column existed). */
function fillHistoryOf(fill: FluidFillRow): FluidFillHistoryModel {
	// `created_at` is a full ISO datetime — slice to the calendar day before the
	// day-month label when no explicit effective date is on the row.
	const when = fill.date ?? (fill.created_at ? fill.created_at.slice(0, 10) : null);
	return {
		id: fill.id ?? '',
		odo: fill.odo_at_fill ?? null,
		nextDueOdo: fill.next_due_odo ?? null,
		qtyLiters: fill.qty_liters ?? null,
		createdLabel: when ? formatEnglishDayMonth(when) : null,
		docStatus: fill.doc_status ?? null,
	};
}

/** Record one fluid fill — a `veh_fluid_fills` create. The NEW service model:
 *  the operator types the per-fill service INTERVAL (km), which this derives
 *  into a stored ABSOLUTE `next_due_odo` (`odo_at_fill` + interval), so the next
 *  due travels with THIS fill and future fills can pick a different frequency. */
export interface CreateFluidFillInput {
	fluid_kind: FluidKind;
	/** The effective service date (`YYYY-MM-DD`, MMT calendar day) — the day the
	 *  service was performed. Older backends without the column keep it in the
	 *  row's `_meta` until the schema is synced (the create never fails on it). */
	date?: string;
	/** The odometer at which the service happened (`odo_at_fill`). */
	odo_at_fill: number;
	/** The per-fill interval in km — how long until the NEXT service of this
	 *  kind. Stored on the fill as `next_due_odo = odo_at_fill + interval`. */
	nextDueIntervalKm: number;
	qty_liters?: number;
	note?: string;
}

export async function createFluidFill(vehicleId: string, input: CreateFluidFillInput): Promise<FluidFillRow> {
	return ops.items('veh_fluid_fills').create({
		vehicle: vehicleId,
		fluid_kind: input.fluid_kind,
		odo_at_fill: input.odo_at_fill,
		next_due_odo: input.odo_at_fill + input.nextDueIntervalKm,
		...(input.date?.trim() ? { date: input.date.trim() } : {}),
		...(input.qty_liters != null ? { qty_liters: input.qty_liters } : {}),
		...(input.note?.trim() ? { note: input.note.trim() } : {}),
	});
}

/** The editable fill columns — the record-edit screen's prefill (adds the
 *  owning vehicle + note the history projection drops). */
const FILL_EDIT_FIELDS = [
	'id',
	'vehicle',
	'fluid_kind',
	'odo_at_fill',
	'qty_liters',
	'next_due_odo',
	'date',
	'note',
	'doc_status',
] as const;

/** ONE fill by id — the edit screen's prefill. A bare `vehicle` id comes back
 *  un-expanded (the screen only needs it to key the vehicle's caches). */
export async function fetchFluidFillById(id: string): Promise<FluidFillRow> {
	const res = await ops.items('veh_fluid_fills').list({
		fields: [...FILL_EDIT_FIELDS],
		filter: { id: { _eq: id } },
		limit: 1,
	});
	const row = res.data[0];
	if (!row) throw new Error('Fill not found.');
	return row;
}

/** The fill fields a CORRECTION may change. `next_due_odo` is the ABSOLUTE due
 *  (the screen re-derives it from the operator's interval), and the owning
 *  vehicle + kind never move. A cleared field is sent as `null`. */
export interface UpdateFluidFillInput {
	date: string | null;
	odo_at_fill: number;
	next_due_odo: number;
	qty_liters: number | null;
	note: string | null;
}

/** Correct an existing fill (the vehicle's NEWEST fill of that kind only). */
export async function updateFluidFill(id: string, input: UpdateFluidFillInput): Promise<FluidFillRow> {
	return ops.items('veh_fluid_fills').update(id, input as unknown as Record<string, unknown>);
}

/** The vehicle id a fill row points at — a bare id, or the expanded row's id. */
export function fluidFillVehicleId(row: FluidFillRow): string | null {
	const fk = row.vehicle;
	if (!fk) return null;
	return typeof fk === 'string' ? fk : (fk.id ?? null);
}

/**
 * Confirm a fill — walk the engine's `doc_status` ladder to `approved` (the
 * row's Confirmed state) through the SAME generic update the approvals app
 * uses: the engine validates each hop server-side (draft → pending_review →
 * approved; submitted/pending_review → approved) and, for a non-admin actor,
 * the `approve` business permission on `veh_fluid_fills`. Already-confirmed
 * rows are a no-op. No-op rows throw nothing — the caller can always refetch.
 */
export async function confirmFluidFill(fillId: string, currentDocStatus: string | null | undefined): Promise<void> {
	const s = String(currentDocStatus ?? '').toLowerCase();
	if (s === 'approved' || s === 'confirmed' || s.startsWith('approved_l')) return;
	const opsClient = ops.items('veh_fluid_fills');
	if (s === 'submitted' || s === 'pending_review') {
		await opsClient.update(fillId, { doc_status: 'approved' } as never);
		return;
	}
	// '' / null / 'draft' — the engine only permits one hop per update, so a
	// draft climbs draft → pending_review → approved.
	await opsClient.update(fillId, { doc_status: 'pending_review' } as never);
	await opsClient.update(fillId, { doc_status: 'approved' } as never);
}
