/**
 * Row shapes for the licenses module (`/app/licenses`) — the REAL `veh_permits`
 * collection of vehicle license/permit records bound to the `veh_fleets` plate
 * directory.
 *
 * Previously this module read a PHANTOM `vehicle_permits` collection that the
 * backend never provisioned (the removed legacy vehicle_* shape). It now reads
 * `veh_permits` — a real engine collection bound to `veh_fleets` via the SAME
 * `vehicle` m2o the incidents module uses (provisioned via the MRO schema apply).
 */

/** The license's renewal urgency — derived from the `expiry_date` window. */
export type LicenseStatusTone = 'ok' | 'warn' | 'alert';

/** A lean expanded `veh_fleets` row (the m2o plate, narrowed to the card's
 *  needs by dotted `fields`) — or a bare id when the engine leaves it unexpanded.
 *
 *  As the REGISTER's root row it also carries the denormalized `last_license`
 *  pointer (expanded by the dotted `last_license.*` fields in the SAME read):
 *  the truck's CURRENT permit, kept fresh by the backend's veh-relink hooks.
 *  The engine expands a pointer at a soft-deleted permit to `null` (trashed
 *  targets are hidden), so a stale pointer reveals itself as "no record". */
export interface FleetRow {
	id?: string;
	plate_no?: string | null;
	brand?: string | null;
	/** The CURRENT `veh_permits` row, expanded from `veh_fleets.last_license` —
	 *  `null` when the truck has no permit or the pointer names a soft-deleted one. */
	last_license?: LicensePermitRow | null;
}

/** A `veh_permits` license row. */
export interface LicensePermitRow {
	id?: string;
	/** m2o to `veh_fleets` — the truck the license belongs to. Dotted `fields`
	 *  expand it to the LEAN row (`{ id, plate_no, brand }`); otherwise a bare id. */
	vehicle?: string | FleetRow | null;
	license_no?: string | null;
	place?: string | null;
	issue_date?: string | null;
	expiry_date?: string | null;
	/** The road-tax / permit fee (Ks) paid for this record — null when unset. */
	license_fee?: number | string | null;
	/** The agent who processed the renewal — free text. */
	agent?: string | null;
	/** The agent's contact number — free text. */
	mobile?: string | null;
	/** A free-text note on this renewal record. */
	note?: string | null;
	created_at?: string | null;
}

/** The current-permit facts a tapped truck row already knew — the renewal form's
 *  carry-over license number AND the renew gate (a still-valid permit is not due
 *  for renewal), routed with the selection so the per-truck page needs NO read
 *  to decide them on the tap path. `null` current = the truck has no permit on
 *  file yet — its first record is always allowed. */
export interface TruckCurrentPermit {
	/** The truck's CURRENT permit number (the newest record on the tapped list's
	 *  truck card) — carried onto the renewal record; null when none on file. */
	licenseNo?: string | null;
	/** `YYYY-MM-DD` — the current permit's expiry date; null when undated. */
	expiryDate: string | null;
	/** Whole days from today (MMT) to that expiry — negative when overdue, null
	 *  when the permit is undated. */
	remainingDays: number | null;
	/** The expiry-window tone (ok/warn/alert) derived from `remainingDays`. */
	tone: LicenseStatusTone;
}

/** The identity of a tapped truck — what the per-truck page needs to paint its
 *  app-bar header instantly (plate/brand from the tapped card), carry the
 *  CURRENT permit summary onto the renewal form (no read needed on the record
 *  view), and query that truck's permit file (`vehicleId`). Travels via router
 *  state on a card tap; deep links / refreshes fall back to the lean fleet
 *  identity read PLUS a one-row current-permit read (their renewal then carries
 *  the current number and gates the same way). */
export interface TruckLicenseSelection {
	/** The owning `veh_fleets` id — the per-truck page's read key + URL param. */
	vehicleId: string;
	/** The truck's plate — the app-bar title chip (null renders no chip). */
	plate: string | null;
	/** The truck's brand display label — omitted when null. */
	brand: string | null;
	/** The truck's CURRENT permit (the tapped row's current-license pill facts,
	 *  number included) — `null` when the truck has none on file yet; omitted on
	 *  deep links (the page falls back to its own one-row current read). */
	current?: TruckCurrentPermit | null;
}

/** The card model — one license joined with its vehicle's plate + brand.
 *
 *  The REGISTER (`/app/licenses/browse`) builds these VEHICLE-FIRST: one card per
 *  `veh_fleets` row, its identity from the master and its document facts from the
 *  `last_license` pointer. `hasRecord` is then `false` for a truck with no current
 *  license, so the card renders the "no license yet" state instead of vanishing.
 *  History/truck reads build the same model from real permit rows (`hasRecord`
 *  omitted ⇒ treated as a record). */
export interface LicenseCardModel {
	id: string;
	/** `created_at` (ISO) — the truck's NEWEST record is its current license. */
	createdAt?: string | null;
	/** `false` on a REGISTER card whose vehicle has no current license (no permit
	 *  on file, or `last_license` names a soft-deleted one). Omitted/`true` on every
	 *  card built from a real permit row (history, kiosk lookup). */
	hasRecord?: boolean;
	/** The owning `veh_fleets` id (from the expanded m2o `vehicle`) — null when
	 *  the license is unlinked. The per-truck list keys its groups on this. */
	vehicleId?: string | null;
	/** The vehicle's plate (နံပါတ်ပြား) — e.g. "7S-6158". */
	plate: string | null;
	/** The vehicle brand — e.g. "HINO" — null when unset (no chip rendered). */
	brand: string | null;
	/** The license document number — null when unset. */
	licenseNo: string | null;
	/** Where the license was issued — null when unset (the row shows "—"). */
	place: string | null;
	/** `YYYY-MM-DD` — the expiry date; null when unset. */
	expiryDate: string | null;
	/** Days left until expiry — negative when overdue, null when undated. */
	remainingDays: number | null;
	/** Renewal urgency — derived from `remainingDays` (alert → warn → ok). */
	tone: LicenseStatusTone;
}

/**
 * One row of the license kiosk search (`/app/licenses`) — a TRUCK whose plate
 * matched the operator's fragment on the fleet master, joined to its CURRENT
 * permit (the newest record on file — the register card's own definition), so
 * the suggestion/result row renders the same plate + brand + remaining-days pill
 * the browse register shows and a tap can hand the current number to the truck
 * page's renewal form with no extra read.
 */
export interface LicenseTruckMatch {
	/** The owning `veh_fleets` id — the per-truck page's read key + URL param. */
	vehicleId: string;
	/** The truck's plate — the row's primary identity chip (always set). */
	plate: string;
	/** The truck's brand display label — null when the master carries none. */
	brand: string | null;
	/** The truck's CURRENT permit record (the newest one on file) — null when the
	 *  truck has no license yet (the row then invites the first record). */
	record: LicenseCardModel | null;
}
