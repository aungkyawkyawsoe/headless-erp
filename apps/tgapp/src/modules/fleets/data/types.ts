/**
 * Row shapes for the `fleets` collection consumed by the ယာဉ် (fleets) module
 * — the fleet master list (`/app/fleets`) and its display-only card.
 *
 * `fleets` (table `cms_fleets`) is the REAL collection behind the screen — the
 * fleet master rebuilt in the live D1 (the legacy `vehicle_vehicles` rows this
 * module was originally built around do not exist on this backend). The row is
 * hand-declared like every module migrated to the new schema (the typegen
 * `Schema` still describes the legacy collections), matching the live columns
 * read by the list/search fetchers below.
 *
 * The module also owns the care-collection row vocabularies the fleet
 * cards' chips + the sibling fleet-care apps read: `veh_odo_months` (ONE
 * (vehicle, Gregorian month) row whose `readings` JSON array holds the month's
 * daily odometer readings) and `veh_fluid_fills` (one engine-oil / gear-oil
 * fill per row). The care WRITE flows live in the Daily ODO (`modules/odo`)
 * and Fluid (`modules/fluids`) apps — the fleets module is read-only for care.
 */

/** `fleets.unit_type` — the verified live enum, plus the two legacy values the
 *  old master still carried (kept so a reintroduced option never renders
 *  blank). */
export type FleetUnitType = 'box' | 'trailer' | 'tractor_unit' | 'forklift' | 'others';

/** `fleets` — one fleet master row (the vehicle behind each card). */
export interface FleetRow {
	id: string;
	/** The license plate — the card's plate chip (e.g. "YGN 9D/2547"). */
	plate_no?: string | null;
	/** The brand value (e.g. `hino`, `nissan_diesel_ud`) — label via `@/shared/fleet`. */
	brand?: string | null;
	/** The model — the live data stores the year of manufacture here (`'2015'`…). */
	model?: string | null;
	/** Unit type — mapped to the uppercase pill label (e.g. `box` → "BOX TRUCK"). */
	unit_type?: FleetUnitType | null;
	/** Wheel count (integer). */
	wheel?: number | null;
	/** Box/trailer length in feet (optional). */
	feet?: number | null;
	/** The plate's issuing place (e.g. "YGN") — the license card's place value. */
	license_place?: string | null;
	/** The plate's issuing township (e.g. "Hlaing"). */
	license_township?: string | null;
	/** Purchase date (`YYYY-MM-DD`) — only used as the year fallback. */
	purchase_date?: string | null;
	/** The truck's photo (`/api/media/<key>`), or null when none is uploaded —
	 *  the card's left tile falls back to a plate monogram, exactly like the
	 *  stock item page does for a SKU without a picture. */
	image?: string | null;
	/** DENORMALIZED current odometer (km) — the vehicle's newest daily reading,
	 *  maintained server-side when a Daily ODO reading is written. Null until a
	 *  reading is on file. When present the care chips read km-left arithmetic
	 *  from the master alone (a one-`veh_fleets`-fetch list). */
	last_odo?: number | null;
	/** DENORMALIZED next-service due odometer of the engine-oil kind — the owning
	 *  vehicle's NEWEST engine fill's stored `next_due_odo`, maintained server-side
	 *  on every engine fill write. km-left = `last_odo`-relative. */
	last_engine_oil?: number | null;
	/** DENORMALIZED next-service due odometer of the gear-oil kind — same rule as
	 *  `last_engine_oil` for the gear fills. */
	last_gear_oil?: number | null;
}

/** Everything one fleet card renders — the joined overview shape. */
export interface FleetCardModel {
	id: string;
	plateNo: string;
	/** Display label for `brand` (e.g. "FAW") — null when unset/unknown. */
	brandLabel: string | null;
	/** Uppercase pill badge label (e.g. "BOX TRUCK") from `unit_type`. */
	unitLabel: string | null;
	/** The raw `unit_type` value — the list filter's matching key. */
	unitType: FleetUnitType | null;
	/** Muted year chip — from `model` (the live year column), falling back to `purchase_date`. */
	year: string | null;
	/** The wheel count as a short tag ("10 W"), null when unset. */
	wheelLabel: string | null;
	/** The box/trailer length as a short tag ("24 ft"), null when unset. */
	feetLabel: string | null;
	/** "YGN · Hlaing" — the license issuing place · township, null when unset. */
	licenseLabel: string | null;
	/** The truck's own photo (`/api/media/<key>`) or null — the card's left tile
	 *  (a plate monogram until one is uploaded). */
	image: string | null;
	/** At-a-glance care chips — km left per km-serviced fluid, computed READ-SIDE
	 *  from the vehicle's latest odo reading + the NEWEST fill of each kind's
	 *  own `next_due_odo` (the per-fill due odometer — no fixed per-vehicle
	 *  interval exists anymore; service frequency is set per fill). Attached by
	 *  the page fetchers via ONE batched care read per page (never a per-card
	 *  board fetch); null when the page had nothing to compute (no fill / odo
	 *  yet) and the card renders clean. */
	care?: FleetCareChipModel | null;
}

/** One card's at-a-glance care read — the vehicle's current odo PLUS km left
 *  until each fluid's service (negative = the current odo already passed the
 *  due odo). Each km-left side stays null until the newest fill of that kind
 *  has a due odo AND a current odo exist, mirroring the Fluid apps' km-left
 *  rule so a chip never guesses. The current odo alone
 *  is still a valid read (the Fluid list card's top-right odometer shows it
 *  even before the first fill is on file). */
export interface FleetCareChipModel {
	/** The vehicle's current odometer — newest-DATE `veh_odo_months` reading (or
	 *  the master's denormalized `last_odo` when provisioned). Null only when no
	 *  reading is on file at all. */
	currentOdo: number | null;
	engineOilKmLeft: number | null;
	gearOilKmLeft: number | null;
}

/** `veh_fluid_fills.fluid_kind` — the two km-serviced fluids the care chips
 *  and the Fluid app track. */
export type FluidKind = 'engine_oil' | 'gear_oil';

/** A `veh_odo_months` row — ONE (vehicle, Gregorian month) bucket. Its
 *  `readings` column is a JSON TEXT array of `VehOdoReading` — the month's
 *  daily odometer readings. A vehicle's current odo = the newest-DATE entry
 *  across its month rows (the read-side rule every km service interval counts
 *  from; never a stored master column). The Daily ODO app owns the writes. */
export interface VehOdoMonthRow {
	id?: string;
	/** m2o to `veh_fleets` — the vehicle this month's readings belong to. */
	vehicle?: string | FleetRow | null;
	/** `YYYY-MM` — the Gregorian month this row buckets. */
	month?: string | null;
	/** JSON TEXT of `VehOdoReading[]` — the month's daily readings. */
	readings?: string | null;
	/** `created_at` (ISO) — the bucket's creation time. */
	created_at?: string | null;
	/** `updated_at` (ISO) — the last append to the bucket. */
	updated_at?: string | null;
}

/** ONE daily odometer reading inside a `veh_odo_months.readings` JSON array. */
export interface VehOdoReading {
	/** `YYYY-MM-DD` — the day the reading was taken. */
	date: string;
	/** The odometer in km. */
	odo: number;
	/** Optional note (e.g. "End-of-day reading"). */
	note?: string | null;
	/** `created_at` (ISO) — deterministic order when two readings share a date. */
	at?: string | null;
}

/** A `veh_fluid_fills` row — ONE engine-oil / gear-oil fill at a known odo,
 *  carrying the odo at which the NEXT service of that kind is due. */
export interface FluidFillRow {
	id?: string;
	/** m2o to `veh_fleets` — the vehicle the fill belongs to. */
	vehicle?: string | FleetRow | null;
	fluid_kind?: FluidKind | null;
	/** The odometer (km) at which the service happened. */
	odo_at_fill?: number | null;
	/** Fill quantity in liters. */
	qty_liters?: number | null;
	/** The effective service date (`YYYY-MM-DD`) — the day the service was
	 *  performed. Rows recorded before the column existed are null → their
	 *  history date falls back to `created_at`. */
	date?: string | null;
	/** The odometer at which the NEXT service of this kind is due — chosen per
	 *  fill (`odo_at_fill` + the interval the operator types at record time), so
	 *  service frequency can vary per need instead of a fixed per-vehicle
	 *  interval. Read-side km-left = this newest-fill due − current odo. */
	next_due_odo?: number | null;
	note?: string | null;
	/** `created_at` (ISO) — newest fill ranks as the current service. */
	created_at?: string | null;
	/** The engine's system document state (draft → pending_review → approved /
	 *  cancelled). Every row defaults to `draft`; fills surface it as the card's
	 *  Pending / Confirmed badge + the confirm action. */
	doc_status?: string | null;
}
