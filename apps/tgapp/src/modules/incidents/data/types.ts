/**
 * Row shapes for the REAL `veh_incidents` accidents & incidents collection.
 *
 * Previously this module read a phantom `vehicle_incidents` collection that the
 * backend never provisioned (the removed legacy vehicle_* shape). It now reads
 * `veh_incidents` — a real engine collection bound to the `veh_fleets` plate
 * directory, with an explicit `kind` (accident | incident) and a `personnel`
 * m2m → `hrm_employees` (provisioned via the MRO schema apply).
 */

/** `kind` — is the record an accident (collision/damage) or a general incident. */
export type IncidentKind = 'accident' | 'incident';

/** `severity` — the urgency tier shown as the card pill. */
export type IncidentSeverity = 'high' | 'medium' | 'low';

/** A lean expanded `veh_fleets` row (the m2o plate, narrowed to the card's
 *  needs by dotted `fields`) — or a bare id when the engine leaves it unexpanded. */
export interface VehicleRow {
	id?: string;
	plate_no?: string | null;
	brand?: string | null;
}

/** An expanded `hrm_employees` row carried on the record's `personnel` m2m —
 *  identity plus the employee's expanded `designation` m2o, whose display `name`
 *  is the role label the card's Personnel grid shows. */
export interface PersonnelRow {
	id?: string;
	name_en?: string | null;
	name_mm?: string | null;
	avatar?: string | null;
	/** The employee's `designation` m2o — its `name` when the engine expanded it
	 *  (dotted `personnel.designation.name`); a bare/unexpanded value otherwise. */
	designation?: { name?: string | null } | null;
}

/** One person shown in the event card's Personnel grid — a lean projection of a
 *  `personnel` m2m member (identity + designation role). */
export interface PersonnelEntry {
	id: string;
	/** Display name — English preferred, Burmese fallback. */
	name: string;
	/** The employee's designation display name ("Safety Supervisor") — null when
	 *  the employee carries none; the grid then shows the name alone. */
	role: string | null;
	/** The staff photo — null renders the lucide fallback, never a letter. */
	photo: string | null;
}

/** `veh_incidents` — one accident/incident record on a fleet vehicle. */
export interface IncidentRow {
	id: string;
	/** m2o to `veh_fleets` — the truck the record is about. Dotted `fields`
	 *  expand it to the LEAN row (`{ id, plate_no, brand }`); otherwise a bare id. */
	vehicle?: string | VehicleRow | null;
	/** `accident` | `incident`. */
	kind?: IncidentKind | null;
	/** m2m to `hrm_employees` — the staff carried on the record (the crew). The
	 *  dotted `fields` expansion returns the lean rows the cards render. */
	personnel?: PersonnelRow[] | null;
	title?: string | null;
	description?: string | null;
	incident_date?: string | null;
	severity?: IncidentSeverity | null;
	location?: string | null;
	/** Estimated cost — number, or a string that may already carry separators. */
	est_cost?: string | number | null;
	created_at?: string | null;
}

/** The identity of a tapped truck — what the per-truck page needs to paint its
 *  app-bar header instantly (plate/brand from the tapped card) and query that
 *  truck's record file (`vehicleId`). Travels via router state on a card tap;
 *  deep links / refreshes fall back to the lean fleet identity read. */
export interface TruckIncidentSelection {
	/** The owning `veh_fleets` id — the per-truck page's read key + URL param. */
	vehicleId: string;
	/** The truck's plate — the app-bar title chip (null renders no chip). */
	plate: string | null;
	/** The truck's brand display label — omitted when null. */
	brand: string | null;
}

/** The card model — one record joined with its vehicle's plate + brand. */
export interface IncidentCardModel {
	id: string;
	/** `created_at` (ISO) — the per-truck file's newest record leads. */
	createdAt?: string | null;
	/** The owning `veh_fleets` id (from the m2o `vehicle`) — null when the record
	 *  is unlinked. The per-truck list keys its groups on this. */
	vehicleId?: string | null;
	/** Plate of the involved vehicle — null when unlinked. */
	plateNo: string | null;
	/** The vehicle brand display label — null when unset (no chip rendered). */
	brandLabel: string | null;
	kind: IncidentKind;
	/** The record's headline — null when the row carries none (cards then fall
	 *  back to `description`). */
	title: string | null;
	/** The account text — `description` when set, else folded with `title` so a
	 *  card always has something to show. */
	description: string | null;
	severity: IncidentSeverity;
	location: string | null;
	/** "12-Aug-2026" — the formatted `incident_date`, null when unset/unparseable. */
	dateLabel: string | null;
	/** "MMK 96,000" — the formatted `est_cost`, null when unset/unparseable. */
	costLabel: string | null;
	/** The staff carried on the record (the `personnel` m2m) — the card's crew
	 *  footer and the event card's Personnel grid. EMPTY when unset. */
	personnel: PersonnelEntry[];
	/** "3 weeks ago" — the relative `created_at` age, null when unset/unparseable. */
	ageLabel: string | null;
}

/** One row of the incidents kiosk search (`/app/incidents`) — a TRUCK whose plate
 *  matched the operator's fragment on the fleet master. The kiosk resolves the
 *  truck ONLY (one `veh_fleets` search); its accident/incident file is read when
 *  the truck's page opens, so no record rides on the match. */
export interface IncidentTruckMatch {
	/** The owning `veh_fleets` id — the per-truck page's read key + URL param. */
	vehicleId: string;
	/** The truck's plate — the row's primary identity chip (always set; the
	 *  lookup drops fleet rows that carry no plate). */
	plate: string;
	/** The truck's brand display label — null when the master carries none. */
	brand: string | null;
}
