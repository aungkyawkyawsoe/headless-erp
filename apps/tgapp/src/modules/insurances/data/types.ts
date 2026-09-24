/**
 * Row shapes for the insurances module (`/app/insurances`) — the REAL
 * `veh_insurances` collection of vehicle insurance policies bound to the
 * `veh_fleets` plate directory.
 *
 * Previously this module read a PHANTOM `vehicle_insurances` collection that
 * the backend never provisioned (the removed legacy vehicle_* shape). It now
 * reads `veh_insurances` — a real engine collection bound to `veh_fleets` via
 * the SAME `vehicle` m2o the incidents/pages modules use (provisioned via the
 * MRO schema apply).
 */

/** Expiry urgency — derived from the `expiry_date` window. */
export type InsuranceStatus = 'valid' | 'expiring' | 'expired';

/** A lean expanded `veh_fleets` row (the m2o plate, narrowed to the card's
 *  needs by dotted `fields`) — or a bare id when the engine leaves it unexpanded.
 *
 *  As the REGISTER's root row it also carries the denormalized `last_insurance`
 *  pointer (expanded by the dotted `last_insurance.*` fields in the SAME read):
 *  the truck's CURRENT policy, kept fresh by the backend's veh-relink hooks.
 *  The engine expands a pointer at a soft-deleted policy to `null` (trashed
 *  targets are hidden), so a stale pointer reveals itself as "no record". */
export interface FleetRow {
	id?: string;
	plate_no?: string | null;
	brand?: string | null;
	/** The CURRENT `veh_insurances` row, expanded from `veh_fleets.last_insurance`
	 *  — `null` when the truck has no policy or the pointer names a soft-deleted one. */
	last_insurance?: InsuranceRow | null;
}

/** A `veh_insurances` policy row. The policy's money fields (`premium_amount`
 *  etc.) are declared NUMBER by the backend schema; reads may still surface them
 *  as strings on older rows, so the row types stay lenient and the card mapper
 *  normalizes them. */
export interface InsuranceRow {
	id?: string;
	/** m2o to `veh_fleets` — the truck the policy covers. Dotted `fields` expand
	 *  it to the LEAN row (`{ id, plate_no, brand }`); otherwise a bare id. */
	vehicle?: string | FleetRow | null;
	/** The insurer — the backend select's CODE (`AYI` / `GGI`); a provider typed
	 *  in freely stores its raw label text. */
	provider?: string | null;
	policy_no?: string | null;
	expiry_date?: string | null;
	betterment?: boolean | number | null;
	windscreen_cover?: number | string | null;
	premium_amount?: number | string | null;
	sum_insured?: number | string | null;
	note?: string | null;
	created_at?: string | null;
}

/** The current-policy facts a tapped truck row already knew — the renew gate's
 *  inputs (a still-valid policy is not due for renewal), routed with the
 *  selection so the per-truck page needs NO read to decide them on the tap path.
 *  `null` current = the truck has no policy on file yet — its first record is
 *  always allowed. */
export interface InsuranceCurrentState {
	/** `YYYY-MM-DD` — the current policy's expiry date; null when undated. */
	expiryDate: string | null;
	/** Whole days from today (MMT) to that expiry — negative when overdue,
	 *  null when the policy is undated. */
	remainingDays: number | null;
	/** The expiry status (valid/expiring/expired) derived from `remainingDays`. */
	status: InsuranceStatus;
}

/** The identity of a tapped truck — what the per-truck page needs to paint its
 *  app-bar header instantly (plate/brand from the tapped card) and query that
 *  truck's policy file (`vehicleId`). Also carries the CURRENT policy summary
 *  (the renew gate), so the record view decides its state with no read. Travels
 *  via router state on a card tap; deep links / refreshes fall back to the lean
 *  fleet identity read PLUS a one-row current-policy read. */
export interface TruckInsuranceSelection {
	/** The owning `veh_fleets` id — the per-truck page's read key + URL param. */
	vehicleId: string;
	/** The truck's plate — the app-bar title chip (null renders no chip). */
	plate: string | null;
	/** The truck's brand display label — omitted when null. */
	brand: string | null;
	/** The truck's CURRENT policy (the tapped row's current-policy pill facts) —
	 *  `null` when the truck has none on file yet; omitted on deep links (the
	 *  page falls back to its own one-row current read). */
	current?: InsuranceCurrentState | null;
}

/** The card model — one policy joined with its vehicle's plate + brand.
 *
 *  The REGISTER (`/app/insurances/browse`) builds these VEHICLE-FIRST: one card
 *  per `veh_fleets` row, its identity from the master and its document facts from
 *  the `last_insurance` pointer. `hasRecord` is then `false` for a truck with no
 *  current policy, so the card renders the "no policy yet" state instead of
 *  vanishing. History/truck reads build the same model from real policy rows
 *  (`hasRecord` omitted ⇒ treated as a record). */
export interface InsuranceCardModel {
	id: string;
	/** `created_at` (ISO) — the truck's NEWEST record is its current policy. */
	createdAt?: string | null;
	/** `false` on a REGISTER card whose vehicle has no current policy (no policy
	 *  on file, or `last_insurance` names a soft-deleted one). Omitted/`true` on
	 *  every card built from a real policy row (history, kiosk lookup). */
	hasRecord?: boolean;
	/** The owning `veh_fleets` id (from the m2o `vehicle`) — null when the policy
	 *  is unlinked. The per-truck list keys its groups on this. */
	vehicleId?: string | null;
	/** Plate of the insured vehicle — null when unlinked. */
	plateNo: string | null;
	/** The vehicle brand display label — null when unset (no chip rendered). */
	brandLabel: string | null;
	/** The provider name — null when unset (fact row shows "—"). */
	provider: string | null;
	/** The policy number — null when unset. */
	policyNo: string | null;
	/** `YYYY-MM-DD` — the policy's expiry date, null when unset. */
	expiryDate: string | null;
	/** Whether the betterment deduction applies — the policy's boolean; null while
	 *  unset (the cards only surface it when true). */
	betterment: boolean | null;
	/** Windscreen cover sum (Ks) — null when unset. */
	windscreenCover: number | null;
	/** The annual premium (Ks) — null when unset. */
	premiumAmount: number | null;
	/** The sum insured (Ks) — null when unset. */
	sumInsured: number | null;
	/** The policy's free-text note — null when unset. */
	note: string | null;
	status: InsuranceStatus;
	/** Whole days from today (MMT) to expiry — negative = overdue, null = no date. */
	remainingDays: number | null;
}

/**
 * One row of the insurance kiosk search (`/app/insurances`) — a TRUCK whose
 * plate matched the operator's fragment on the fleet master, joined to its
 * CURRENT policy (the newest record on file — the register card's own
 * definition), so the suggestion/result row renders the same plate + brand +
 * remaining-days pill the browse register shows.
 */
export interface InsuranceTruckMatch {
	/** The owning `veh_fleets` id — the per-truck page's read key + URL param. */
	vehicleId: string;
	/** The truck's plate — the row's primary identity chip (always set). */
	plate: string;
	/** The truck's brand display label — null when the master carries none. */
	brand: string | null;
	/** The truck's CURRENT policy record (the newest one on file) — null when the
	 *  truck has no policy yet (the row then invites the first record). */
	record: InsuranceCardModel | null;
}
