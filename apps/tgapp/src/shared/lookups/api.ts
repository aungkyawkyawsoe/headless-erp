import type { MmbixClient } from '@mmbix/sdk';

import { fetchAllPages } from '@/shared/api/fetch-all';
import { sdk } from '@/shared/api/sdk';
import { vehicleBrandLabel } from '@/shared/fleet';
import type { EmployeeMasterRow, VehicleMasterRow } from './types';

/**
 * The shared master fetchers.
 *
 * Every master collection is read WHOLE via `fetchAllPages` (the entities API
 * hard-caps `limit` at 100 rows, so a single read would silently truncate any
 * master past 100 rows — the employee directory has 238) and cached under the
 * shared `['masters', ...]` query keys (see `./query-keys.ts`), so modules that
 * join the same master collide into ONE request instead of each fetching its
 * own truncated copy.
 *
 * The typed-client cast is the same local pattern every module uses: the
 * app-wide client is typed against the placeholder `Schema = {}`, so these
 * reads go through a locally-typed view of the same authenticated instance.
 */
type OpsSchema = {
	/** The `veh_fleets` master (table `cms_veh_fleets`) — the legacy
	 *  `vehicle_vehicles` rows this lookup originally read do not exist on the
	 *  current backend. */
	veh_fleets: VehicleMasterRow;
	/** The NATIVE `hrm_employees` row — has `etg_id` (Telegram link) + `avatar`, NOT
	 *  the mapped `tg_id`/`photo_url` names; `fetchEmployeeMasters` maps below. */
	hrm_employees: NativeEmployeeRow;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/** The native `hrm_employees` collection row (table `cms_hrm_employees`) — the
 *  Telegram link lives on `etg_id` and the avatar on `avatar` (no `tg_id`/
 *  `photo_url`). */
interface NativeEmployeeRow {
	id: string;
	name_mm?: string | null;
	name_en?: string | null;
	eid?: string | null;
	etg_id?: string | null;
	avatar?: string | null;
	/** m2o → `hrm_designations` — a bare id, or `{ id, name }` when projected.
	 *  The driver lookup filters on `designation.name`. */
	designation?: string | { id?: string; name?: string | null } | null;
}

/** The minimal `veh_fleets` identity every fleet module's per-truck page needs. */
export interface VehicleIdentity {
	plateNo: string | null;
	brandLabel: string | null;
	/** The vehicle's current odometer (denormalized on `veh_fleets`). */
	lastOdo: number | null;
	/** The truck's photo (`/api/media/<key>`, public GET) — or null while the
	 *  fleet card has none uploaded. Fetched with the identity so the per-truck
	 *  hero shows the truck, still ONE canonical read and ONE cache key. */
	image: string | null;
}

/**
 * ONE truck's identity, by id — the per-truck header's read.
 *
 * Six modules (insurance / license / maintenance / incident / odo / fluid) each
 * had their own copy of this read under their OWN query key, so naming the same
 * truck from two modules fetched `veh_fleets` twice and cached it twice. They now
 * share `masterQk.vehicle(id)`: the projection is identical across all six
 * (`id, plate_no, brand, last_odo, image`), only the local mapping differed.
 */
export async function fetchVehicleIdentity(vehicleId: string): Promise<VehicleIdentity> {
	const res = await ops.items('veh_fleets').list({
		fields: ['id', 'plate_no', 'brand', 'last_odo', 'image'],
		filter: { id: { _eq: vehicleId } },
		limit: 1,
	});
	const fleet = res.data[0];
	if (!fleet) throw new Error('Vehicle not found.');
	return {
		plateNo: fleet.plate_no?.trim() || null,
		brandLabel: vehicleBrandLabel(fleet.brand),
		lastOdo: fleet.last_odo ?? null,
		image: fleet.image?.trim() || null,
	};
}

/** `veh_fleets` — the plate (+ brand, + license place) directory. */
export async function fetchVehicleMasters(): Promise<VehicleMasterRow[]> {
	return fetchAllPages((cursor, pageSize) =>
		ops.items('veh_fleets').list({
			fields: ['id', 'plate_no', 'brand', 'wheel', 'wheel_slots', 'unit_type', 'model', 'license_place', 'license_township'],
			sort: 'plate_no',
			limit: pageSize,
			cursor,
		}),
	);
}

/** One hit of the SEARCH-FIRST kiosk plate lookups — the fleet master projected
 *  to exactly the plate/brand a suggestion row renders, plus the RAW row so a
 *  caller that asked for `extraFields` can read them from the SAME request. */
export interface VehiclePlateSearchHit {
	id: string;
	/** The plate — trimmed; null when the row carries none (callers drop those). */
	plate_no: string | null;
	brand: string | null;
	/** The RAW `veh_fleets` row as the engine projected it — read `extraFields`
	 *  (e.g. the `last_license` / `last_insurance` pointer) from here. */
	raw: Record<string, unknown>;
}

/**
 * The kiosk plate dropdown's truck cap — enough to pick from, never a list. The
 * ONE cap every plate-search kiosk (licenses / insurances / incidents /
 * maintenances) shares, so they can never drift apart.
 */
export const TRUCK_MATCH_LIMIT = 8;

/**
 * The search-first kiosks' LAZY plate lookup (`/app/fluid`, `/app/licenses`,
 * `/app/insurances`…) — a SERVER-side `?search=` over the `veh_fleets` master,
 * capped small. This is deliberately NOT `fetchVehicleMasters`: opening a kiosk
 * must not walk the whole fleet directory — a typed fragment returns only the
 * close plates, so an imperfect memory still lands on the right truck and an
 * idle screen issues nothing.
 *
 * `extraFields` rides ALONG in the same projection (dot-paths allowed) so a
 * caller that needs the master's denormalized `last_*` document pointer — the
 * licenses / insurances kiosks — reads it here instead of paying a second
 * `_in` join over the document collection.
 */
export async function searchVehiclePlates(
	query: string,
	limit = TRUCK_MATCH_LIMIT,
	extraFields: readonly string[] = [],
): Promise<VehiclePlateSearchHit[]> {
	const trimmed = query.trim();
	if (!trimmed) return [];
	const res = await ops.items('veh_fleets').list({
		fields: ['id', 'plate_no', 'brand', ...extraFields],
		search: trimmed,
		sort: 'plate_no',
		limit,
	});
	return res.data.map((row) => ({
		id: row.id,
		plate_no: row.plate_no?.trim() ?? null,
		brand: row.brand ?? null,
		raw: row as unknown as Record<string, unknown>,
	}));
}

/** `hrm_employees` — the directory (names/eid/etg link/photo). The real
 *  collection (table `cms_hrm_employees`) has no `tg_id`/`photo_url`/`summary`
 *  columns — it stores the Telegram link on `etg_id` and the avatar image on
 *  `avatar`, both mapped onto the shared row shape at this boundary
 *  (`tg_id`/`photo_url`). `department`/`summary` stay empty (fallbacks). */
export async function fetchEmployeeMasters(): Promise<EmployeeMasterRow[]> {
	const res = await fetchAllPages((cursor, pageSize) =>
		ops.items('hrm_employees').list({
			fields: ['id', 'name_mm', 'name_en', 'eid', 'etg_id', 'avatar'],
			sort: 'name_en',
			limit: pageSize,
			cursor,
		}),
	);
	return res.map((row) => ({
		id: row.id,
		name_mm: row.name_mm ?? null,
		name_en: row.name_en ?? null,
		eid: row.eid ?? null,
		tg_id: row.etg_id ?? null,
		photo_url: row.avatar ?? null,
	}));
}

/** One hit of the LAZY employee lookup — exactly the identity a picker row / chip
 *  renders (display name already resolved, English preferred). */
export interface EmployeeSearchHit {
	id: string;
	/** Display name — `name_en` preferred, Burmese fallback; never empty. */
	name: string;
	/** The Burmese name, when the row carries one (the row's secondary line). */
	name_mm: string | null;
	/** The staff id (EID), when set. */
	eid: string | null;
	/** `/api/media/…` avatar, or null (the caller renders an icon fallback). */
	photo: string | null;
}

/** How to narrow the employee lookup — never walks the directory. */
export interface EmployeeSearchOptions {
	/** Max hits (default 20). */
	limit?: number;
	/** Restrict to people whose `designation.name` contains this fragment
	 *  (case-insensitive) — e.g. `driver` matches BOTH “Driver” and
	 *  “Ferry Driver”. Omit to search the whole directory (a crew / holder field). */
	designationContains?: string;
}

/**
 * The LAZY employee lookup — a SERVER-side `?search=` over the `hrm_employees`
 * directory, capped small. Deliberately NOT `fetchEmployeeMasters`: a personnel
 * picker must not walk the whole 200+ person directory (≈10 paginated requests)
 * just to assign a few names — a typed fragment returns only the close matches,
 * so an idle picker issues nothing and a search costs ONE request per term.
 *
 * `designationContains` adds ONE nested relation filter
 * (`filter[designation][name][_icontains]=…`), which the engine resolves as an
 * IN-subquery — so a driver picker offers drivers without a second read or a
 * client-side pass over a truncated page.
 */
export async function searchEmployees(query: string, options: EmployeeSearchOptions = {}): Promise<EmployeeSearchHit[]> {
	const trimmed = query.trim();
	if (!trimmed) return [];
	const { limit = 20, designationContains } = options;
	const res = await ops.items('hrm_employees').list({
		fields: ['id', 'name_en', 'name_mm', 'eid', 'avatar'],
		search: trimmed,
		...(designationContains ? { filter: { designation: { name: { _icontains: designationContains } } } } : {}),
		sort: 'name_en',
		limit,
	});
	return res.data
		.map((row) => ({
			id: row.id,
			name: (row.name_en ?? row.name_mm ?? '').trim(),
			name_mm: row.name_mm?.trim() ?? null,
			eid: row.eid?.trim() ?? null,
			photo: row.avatar?.trim() ?? null,
		}))
		.filter((hit) => hit.name !== '');
}
