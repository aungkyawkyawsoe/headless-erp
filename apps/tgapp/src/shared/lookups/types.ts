/**
 * Row shapes for the app-wide MASTER collections — the small, slow-moving
 * lookup tables (vehicles, employees) that several modules join against.
 *
 * These are the UNION of every column the module lookups read, so ONE shared
 * cached fetch (see `./api.ts`) serves all of them: a module mapper only reads
 * the columns its own row type declared, and TypeScript's structural typing
 * lets the shared rows stand in for the per-module row types.
 *
 * The deprecated `store_categories` / `store_locations` / `store_item_models` /
 * `store_purchases` / `hr_departments` lookups were removed — the MRO modules
 * that replaced the legacy store modules read their masters through
 * `shared/hooks/use-mro-masters` (`mro_suppliers` /
 * `mro_item_name`) and the `['mro','item-models']` SKU directory
 * (`shared/hooks/use-mro-item-models`), so nothing outside this folder consumed
 * those rows any more.
 */

/** `fleets` — the fleet lookup (plate + brand for the cards, plus the vehicle's
 *  own license place/township — the လိုင်စင် module's fallback when the permit
 *  row carries no place). The REAL collection (table `cms_fleets`) replaced the
 *  legacy `vehicle_vehicles` master; like the `employees` directory it keeps a
 *  local shape because the typegen `Schema` still describes the legacy
 *  collections. */
export interface VehicleMasterRow {
	id: string;
	plate_no?: string | null;
	brand?: string | null;
	/** Engine `veh_fleets.image` — the truck's photo, a `/api/media/<key>` R2 URL
	 *  (public GET, no auth header) — or null while the truck has no photo. */
	image?: string | null;
	/** Engine `veh_fleets.wheel` — how many wheels the unit seats (6/10/22…). */
	wheel?: number | null;
	/** Engine `veh_fleets.wheel_slots` — ordered wheel seats [{id,label}]. The fitment
	 *  board renders one block per seat (length == wheel when configured) and keys
	 *  each mounted serial to its `id`. */
	wheel_slots?: Array<{ id: string; label?: string | null }> | string | null;
	/** Engine `veh_fleets.unit_type` — box/trailer/tractor_unit/forklift/others. */
	unit_type?: string | null;
	/** Engine `veh_fleets.model` — the vehicle's model/year label (a text field). */
	model?: string | null;
	license_place?: string | null;
	license_township?: string | null;
	/** Engine `veh_fleets.last_odo` — the vehicle's current odometer (denormalized). */
	last_odo?: number | null;
}

/** `hr_employees` — the directory lookup (names, eid, tg link, photo, summary). */
export interface EmployeeMasterRow {
	id: string;
	name_mm?: string | null;
	name_en?: string | null;
	eid?: string | null;
	tg_id?: string | null;
	photo_url?: string | null;
	/** Denormalized role/department label (e.g. "Vehicle · Incharge"), when populated. */
	summary?: string | null;
	/** Denormalized department label (e.g. "Vehicle"), when populated. */
	department?: string | null;
}
