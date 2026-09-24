import type { MmbixClient } from '@mmbix/sdk';

import type { CursorPage } from '@/shared/hooks/use-cursor-list';
import { LIST_PAGE_SIZE, SEARCH_LIMIT } from '@/shared/constants';
import { fetchVehicleIdentity } from '@/shared/lookups/api';
import { vehicleBrandLabel } from '@/shared/fleet';
import { dateWindowTone, daysFromTodayMmt } from '@/shared/time/myanmar';
import { sdk } from '@/shared/api/sdk';
import { TRUCK_MATCH_LIMIT, searchVehiclePlates } from '@/shared/lookups/api';
import type {
	FleetRow,
	LicenseCardModel,
	LicensePermitRow,
	LicenseStatusTone,
	LicenseTruckMatch,
	TruckCurrentPermit,
	TruckLicenseSelection,
} from './types';

/**
 * The licenses module's typed client — the same local-cast pattern as every
 * sibling module: the app-wide client is typed against the placeholder
 * `Schema = {}`, so entity reads here go through a locally-typed view of the
 * SAME instance.
 *
 * The BROWSE REGISTER (`/app/licenses/browse`) is VEHICLE-FIRST, mirroring the
 * fleets/fluid/odo modules: it cursor-walks `veh_fleets` (ALL vehicles) and asks
 * each truck for its CURRENT permit via the denormalized `last_license`
 * pointer (dotted `last_license.*` fields expanded in the SAME read). A truck
 * with no permit — or a pointer left stale at a soft-deleted permit — carries
 * `last_license: null` and renders the "no license yet" state rather than being
 * omitted. The per-truck HISTORY feed still reads `veh_permits` directly (a
 * truck's full file); the kiosk lookup and the renewal gate read the SAME
 * `last_license` pointer, so every surface agrees on which permit is current.
 */
type OpsSchema = {
	veh_fleets: FleetRow;
	veh_permits: LicensePermitRow;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/**
 * Expiry-window tone for a permit — the same shared `dateWindowTone` rule
 * (MMT-calendar based, used by incidents and the store cards), with a default
 * of `ok` when no date is set (an undated row is not an overdue one).
 */
function dueTone(expiry: string | null | undefined): LicenseStatusTone {
	if (!expiry) return 'ok';
	return dateWindowTone(expiry);
}

/** The permit's m2o vehicle — a lean expanded row when the engine expands it
 *  (dotted `fields`), else a bare-id string (an un-linked vehicle → no plate). */
function vehicleOf(permit: LicensePermitRow): FleetRow | undefined {
	const fk = permit.vehicle;
	if (fk && typeof fk === 'object') return fk;
	return undefined;
}

/** The permit's owning vehicle id — the m2o id whether the engine expanded the
 *  row (dotted `fields`) or returned a bare id; null when un-linked. */
function vehicleIdOf(permit: LicensePermitRow): string | null {
	const fk = permit.vehicle;
	if (!fk) return null;
	return typeof fk === 'string' ? fk : (fk.id ?? null);
}

/** Map one page of permits to cards — plate + brand ride along on each permit's
 *  EXPANDED m2o `vehicle`, so no shared fleet-directory read is needed. */
function licenseCardsOf(permits: LicensePermitRow[]): LicenseCardModel[] {
	return permits.map((permit) => {
		const vehicle = vehicleOf(permit);
		const expiry = permit.expiry_date ?? null;
		return {
			id: permit.id ?? '',
			createdAt: permit.created_at ?? null,
			vehicleId: vehicleIdOf(permit),
			plate: vehicle?.plate_no?.trim() || null,
			brand: vehicleBrandLabel(vehicle?.brand),
			licenseNo: permit.license_no?.trim() || null,
			place: permit.place?.trim() || null,
			expiryDate: expiry,
			remainingDays: expiry ? daysFromTodayMmt(expiry) : null,
			tone: dueTone(expiry),
		};
	});
}

// `vehicle` uses DOT-paths (`vehicle.plate_no` / `vehicle.brand`) so the engine
// returns exactly those two columns of the related fleet row — the whole truck
// row (wheels, model, slots…) never leaves the DB. The dotted expansion means
// every license lands with its plate + brand already inside the SAME payload.
const LICENSE_FIELDS = [
	'id',
	'vehicle.plate_no',
	'vehicle.brand',
	'license_no',
	'place',
	'issue_date',
	'expiry_date',
	'created_at',
] as const;

/** The VEHICLE-FIRST register projection — the fleet master's identity columns
 *  PLUS the denormalized `last_license` pointer expanded to exactly the document
 *  fields a register card renders (number, place, expiry, write time). The whole
 *  permit row never leaves the DB, and the pointer carries the SAME card facts a
 *  `veh_permits` read would. This ONE projection is the single source of "current
 *  license" — the register, the kiosk lookup and the per-truck renewal gate all
 *  read it, so they can never disagree. */
const LICENSE_POINTER_FIELDS = [
	'last_license.license_no',
	'last_license.place',
	'last_license.expiry_date',
	'last_license.created_at',
] as const;

const REGISTER_FIELDS = ['id', 'plate_no', 'brand', ...LICENSE_POINTER_FIELDS] as const;

/**
 * One `veh_fleets` master row → its register card: the VEHICLE's identity plus
 * its CURRENT license from the expanded `last_license` pointer.
 *
 * STALENESS: the engine resolves an m2o at a SOFT-DELETED target to `null`
 * (`resolveM2O` hides trashed rows), and a null FK stays null — so a pointer
 * left stale by a delete simply reads as `last_license == null` and the card
 * renders the "no license yet" state. A deleted document can therefore never be
 * shown as current, and the read never crashes on a dangling pointer.
 *
 * The card `id` is the VEHICLE id (one card per truck, stable across renewals);
 * the document's own facts live in the license fields. Pure — unit-tested in
 * `register.spec.ts`.
 */
export function licenseCardOf(fleet: FleetRow): LicenseCardModel {
	const doc = fleet.last_license && typeof fleet.last_license === 'object' ? fleet.last_license : null;
	const plate = fleet.plate_no?.trim() || null;
	const expiry = doc?.expiry_date ?? null;
	return {
		id: fleet.id ?? '',
		createdAt: doc?.created_at ?? null,
		vehicleId: fleet.id ?? null,
		plate,
		brand: vehicleBrandLabel(fleet.brand),
		licenseNo: doc?.license_no?.trim() || null,
		place: doc?.place?.trim() || null,
		expiryDate: expiry,
		remainingDays: expiry ? daysFromTodayMmt(expiry) : null,
		tone: dueTone(expiry),
		hasRecord: doc != null,
	};
}

/** The toolbar search — a server-side `?search=` over the fleet master's OWN
 *  text fields (plate / brand), mapped to the SAME vehicle-first card as the
 *  list, so results always match it. Searching by permit number is deliberately
 *  gone: the register is keyed by vehicle, not by document. */
export async function fetchLicensesSearch(query: string): Promise<LicenseCardModel[]> {
	const res = await ops.items('veh_fleets').list({ fields: [...REGISTER_FIELDS], search: query, sort: 'plate_no', limit: SEARCH_LIMIT });
	return res.data.map(licenseCardOf);
}

/** One page of the vehicle-first register — `LIST_PAGE_SIZE` VEHICLES
 *  (plate-sorted), each carrying its current license (or the no-record state). */
export async function fetchLicensesPage(cursor?: string): Promise<CursorPage<LicenseCardModel>> {
	const res = await ops.items('veh_fleets').list({
		fields: [...REGISTER_FIELDS],
		sort: 'plate_no',
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	return {
		rows: res.data.map(licenseCardOf),
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/**
 * One plate-search hit → its kiosk row, built from the SAME `last_license`
 * pointer the browse register reads (so a kiosk suggestion and the register card
 * for that truck can never disagree, and the kiosk pays NO second collection
 * join). `record` is null — not an empty card — when the truck has no permit on
 * file, because the kiosk hands that null straight to the renewal gate. Pure —
 * unit-tested in `register.spec.ts`.
 */
export function licenseMatchOf(fleet: FleetRow): LicenseTruckMatch | null {
	const plate = fleet.plate_no?.trim();
	if (!plate) return null;
	const card = licenseCardOf(fleet);
	return {
		vehicleId: fleet.id ?? '',
		plate,
		brand: vehicleBrandLabel(fleet.brand),
		record: card.hasRecord ? card : null,
	};
}

/**
 * The license kiosk's LAZY truck lookup (`/app/licenses`, the search-first
 * landing) — ONE lazy `?search=` over the fleet master (the shared
 * `searchVehiclePlates`) that ALSO projects each matched truck's `last_license`
 * pointer, so every hit is decorated with its CURRENT license from the SAME
 * single request — no `veh_permits` join at all (the join this replaced picked
 * the newest-by-WRITE row, which disagreed with the register on a backdated
 * renewal). Each result row therefore carries the SAME plate + brand +
 * remaining-days pill a browse truck card shows, and a tap can hand the current
 * permit number to the truck page's renewal form with no extra read.
 */
export async function fetchLicenseTruckMatches(query: string): Promise<LicenseTruckMatch[]> {
	const hits = await searchVehiclePlates(query, TRUCK_MATCH_LIMIT, LICENSE_POINTER_FIELDS);
	return hits.map((hit) => licenseMatchOf(hit.raw as unknown as FleetRow)).filter((match): match is LicenseTruckMatch => match !== null);
}

/**
 * ONE truck's license file page — a CURSOR page of that truck's `veh_permits`
 * rows (newest-ISSUED first, so `[0]` of page 1 is the CURRENT license — the
 * SAME `issue_date`-ranked rule `veh_fleets.last_license` uses), read by the
 * per-truck page's `useCursorList` feed. Deliberately NOT part of the list read:
 * the overview loads only what its cards render (the current license + count),
 * and history rows stream in here, only when the user opens that truck's page.
 */
export async function fetchTruckLicensePage(vehicleId: string, cursor?: string): Promise<CursorPage<LicenseCardModel>> {
	const res = await ops.items('veh_permits').list({
		fields: LICENSE_FIELDS,
		filter: { vehicle: { _eq: vehicleId } },
		sort: '-issue_date',
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	return {
		rows: licenseCardsOf(res.data),
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/**
 * Deep-link / refresh truck identity — read the fleet master row ONLY for the
 * plate/brand the per-truck page's header needs. Used ONLY when no routed list
 * row backed the page (a card tap passes its identity through router state, so
 * this never fires there). Throws when the truck is not on the fleet master.
 */
export async function fetchTruckIdentity(
	vehicleId: string,
): Promise<Pick<TruckLicenseSelection, 'plate' | 'brand'> & { image: string | null }> {
	// Shared with every other fleet module (one key, one cached read) — see
	// `fetchVehicleIdentity`. The truck PHOTO rides along, so the per-truck page
	// leads with the truck itself on every open.
	const identity = await fetchVehicleIdentity(vehicleId);
	return { plate: identity.plateNo, brand: identity.brandLabel, image: identity.image ?? null };
}

/**
 * The current-permit summary a tapped register row routes to the truck page —
 * the row's pill facts + the carried license number, so the renewal form can
 * carry the number AND gate on the expiry with NO read. Null when the truck has
 * no permit on file (its first record is always allowed).
 */
export function permitSummaryOf(card: LicenseCardModel | null | undefined): TruckCurrentPermit | null {
	if (!card) return null;
	return {
		licenseNo: card.licenseNo,
		expiryDate: card.expiryDate,
		remainingDays: card.remainingDays,
		tone: card.tone,
	};
}

/**
 * ONE lean read of the truck's CURRENT permit — the fleet master's
 * `last_license` pointer (NOT the newest-by-write `veh_permits` row, which
 * disagreed with the register on a backdated renewal). Used ONLY on the
 * per-truck page's DEEP-LINK path — a card tap routes the current summary in
 * router state (`permitSummaryOf`), so the tap path never fires this. Returns
 * null when the truck has no permit on file yet.
 */
export async function fetchTruckCurrentPermit(vehicleId: string): Promise<LicenseCardModel | null> {
	const res = await ops.items('veh_fleets').list({
		fields: [...REGISTER_FIELDS],
		filter: { id: { _eq: vehicleId } },
		limit: 1,
	});
	const fleet = res.data[0];
	if (!fleet) return null;
	const card = licenseCardOf(fleet);
	return card.hasRecord ? card : null;
}

/**
 * Create a license record — one engine-native POST on `veh_permits` bound to a
 * `veh_fleets` vehicle. The renewal extras (fee / agent / mobile / note) ride
 * along only when the operator set them.
 */
export interface CreatePermitInput {
	vehicle: string;
	license_no?: string;
	place?: string;
	issue_date?: string;
	expiry_date?: string;
	/** The road-tax / permit fee (Ks) paid for this record — null when unset. */
	license_fee?: number;
	/** The agent who processed the renewal — free text. */
	agent?: string;
	/** The agent's contact number — free text. */
	mobile?: string;
	/** A free-text note on this renewal record. */
	note?: string;
}

export async function createPermit(input: CreatePermitInput): Promise<LicensePermitRow> {
	return ops.items('veh_permits').create(input as unknown as Record<string, unknown>);
}

/** The editable permit columns — the record-edit screen's prefill (every field
 *  the form can change, including the ones the truck CREATE form hides). */
const PERMIT_EDIT_FIELDS = [
	'id',
	'vehicle',
	'license_no',
	'place',
	'issue_date',
	'expiry_date',
	'license_fee',
	'agent',
	'mobile',
	'note',
] as const;

/** ONE permit by id — the edit screen's prefill. A bare `vehicle` id comes back
 *  un-expanded (the screen only needs it to key the truck's caches). */
export async function fetchPermitById(id: string): Promise<LicensePermitRow> {
	const res = await ops.items('veh_permits').list({
		fields: [...PERMIT_EDIT_FIELDS],
		filter: { id: { _eq: id } },
		limit: 1,
	});
	const row = res.data[0];
	if (!row) throw new Error('License not found.');
	return row;
}

/** The permit fields a CORRECTION may change. The owning vehicle never moves,
 *  and a cleared field is sent as `null` so blanks actually clear. */
export interface UpdatePermitInput {
	license_no: string | null;
	place: string | null;
	issue_date: string | null;
	expiry_date: string | null;
	license_fee: number | null;
	agent: string | null;
	mobile: string | null;
	note: string | null;
}

/** Correct an existing permit (the vehicle's NEWEST record only). */
export async function updatePermit(id: string, input: UpdatePermitInput): Promise<LicensePermitRow> {
	return ops.items('veh_permits').update(id, input as unknown as Record<string, unknown>);
}

/** The vehicle id a permit row points at — a bare id, or the expanded row's id. */
export function permitVehicleId(row: LicensePermitRow): string | null {
	const fk = row.vehicle;
	if (!fk) return null;
	return typeof fk === 'string' ? fk : (fk.id ?? null);
}
