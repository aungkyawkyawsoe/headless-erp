/**
 * Row shapes for the REAL vehicle-maintenance collections the ပြင်ဆင် app owns:
 *
 *  - `veh_maintenance_logs` — ONE repair/service job on a `veh_fleets` truck
 *    (dates, odo, costs, vendor, technician, the standard job it cites);
 *  - `veh_issue_types` — the job catalog that log cites (a `job_code` + a
 *    bilingual name + a `category` — an m2o to `mro_item_categories`).
 *
 * Deliberately LOCAL interfaces (not `SchemaRow`): the mini-app's generated
 * `Schema` does not describe the `veh_*` engine collections, so these read
 * against the verified wire contract instead. Both are joined in ONE request via
 * dotted `fields` (e.g. `fleet.plate_no`, `issues_type.name_en`), so the cards
 * never trigger a separate fleet / catalog read.
 */

/** A lean expanded `mro_item_categories` row — the top-level category a job's
 *  issue type files under (the `veh_issue_types.category` m2o, expanded by
 *  dotted `fields`) — or a bare id when the engine leaves it unexpanded. */
export interface IssueCategoryRow {
	id?: string;
	name_en?: string | null;
	name_mm?: string | null;
}

/** The category a job / log files under, flattened for the UI: the m2o's id
 *  (what the filter keys on) plus both names (the label, Myanmar preferred). */
export interface IssueCategoryRef {
	id: string;
	nameEn: string | null;
	nameMm: string | null;
}

/** Who performed the job — the master's `vendor_type` select. */
export type VendorType = 'in_house' | 'external';

/** The log's document state. A row is a `draft` (editable) until CONFIRMED,
 *  after which the engine's `writes.freeze_when` policy makes it read-only. Any
 *  other/absent engine value normalizes to `draft` (the safe, unposted default). */
export type MaintenanceDocStatus = 'draft' | 'confirmed';

/** A lean expanded `veh_fleets` row (the m2o plate, narrowed by dotted `fields`)
 *  — or a bare id when the engine leaves the m2o unexpanded. */
export interface VehicleRow {
	id?: string;
	plate_no?: string | null;
	brand?: string | null;
	/** The vehicle's current odometer (denormalized on `veh_fleets`). */
	last_odo?: number | null;
}

/** A lean expanded `hrm_employees` row (the `driver` m2o, narrowed by dotted
 *  `fields`) — or a bare id when the engine leaves the m2o unexpanded. */
export interface PersonRow {
	id?: string;
	name_en?: string | null;
	name_mm?: string | null;
}

/** An expanded `veh_issue_types` row (the log's `issues_type` m2o). */
export interface IssueTypeRow {
	id: string;
	name_en?: string | null;
	name_mm?: string | null;
	job_code?: string | null;
	/** m2o to `mro_item_categories` — expanded to `{ id, name_en, name_mm }`. */
	category?: string | IssueCategoryRow | null;
}

/** One `veh_maintenance_logs` row. `total_cost` is a STORED formula the engine
 *  owns (parts_cost + labor_cost) — a read returns it, a write must never send it. */
export interface MaintenanceLogRow {
	id: string;
	/** m2o to `veh_fleets` — expanded to `{ id, plate_no, brand }` by dotted fields. */
	fleet?: string | VehicleRow | null;
	/** m2o to `veh_issue_types` — the standard job this log cites. */
	issues_type?: string | IssueTypeRow | null;
	/** The day the job started (`YYYY-MM-DD`). */
	started_at?: string | null;
	/** The day the job finished — null while still in the shop. */
	end_at?: string | null;
	/** The odometer at the job (stored as text — shown verbatim). */
	odo?: string | number | null;
	parts_cost?: number | null;
	labor_cost?: number | null;
	/** The engine-computed stored formula: parts_cost + labor_cost. Read-only. */
	total_cost?: number | null;
	vendor_type?: VendorType | null;
	technician?: string | null;
	note?: string | null;
	/** m2o to `hrm_employees` — who drove the truck in. */
	driver?: string | PersonRow | null;
	/** The engine's system document state — `draft` (editable) until `confirmed`
	 *  (frozen by the collection's `writes.freeze_when` policy). */
	doc_status?: string | null;
}

/** ONE log as the app's card renders it — flat, formatted, self-contained.
 *  Only what the card paints: the form reads the RAW row instead. */
export interface MaintenanceLogCardModel {
	id: string;
	vehicleId: string | null;
	plateNo: string | null;
	brandLabel: string | null;
	/** The job's English name (Burmese fallback) — the card's headline. */
	issueTypeName: string | null;
	jobCode: string | null;
	/** The `mro_item_categories` the job files under — the browse filter keys on
	 *  `category.id`; the label reads `nameMm ?? nameEn`. Null when unset. */
	category: IssueCategoryRef | null;
	/** "20 Aug – 22 Aug 2026" (or "02 Sep 2026 · In progress") — the job window. */
	rangeLabel: string | null;
	/** "4 days" / "Same day" — null while the job is still open. */
	durationLabel: string | null;
	/** "184,500 km" — the odometer at the job, null when unset. */
	odo: string | null;
	/** The odometer as a NUMBER — drives the ledger's km transition between jobs
	 *  (the display label above is formatted for humans, not for arithmetic). */
	odoKm: number | null;
	/** "MMK 250,000" — the formatted costs, null when unset. */
	partsLabel: string | null;
	laborLabel: string | null;
	totalLabel: string | null;
	vendorType: VendorType | null;
	technician: string | null;
	/** The driver's display name (the `driver` m2o), null when unset. */
	driverName: string | null;
	note: string | null;
	/** `draft` while the job is still correctable; `confirmed` once posted — the
	 *  row is then frozen server-side and the UI drops Edit. */
	docStatus: MaintenanceDocStatus;
}

/** The issue-type master row the form's picker renders. */
export interface IssueTypeOption {
	id: string;
	/** Display name — English preferred, Burmese fallback. */
	name: string;
	jobCode: string | null;
	/** The `mro_item_categories` the job files under — null when unset. */
	category: IssueCategoryRef | null;
}

/** The identity of a tapped truck — travels via router state so the per-truck
 *  page paints its app-bar header instantly (no fleet read on the tap path). */
export interface TruckMaintenanceSelection {
	vehicleId: string;
	plate: string | null;
	brand: string | null;
	/** The vehicle's current odometer (denormalized on `veh_fleets`). */
	lastOdo: number | null;
}

/** One row of the maintenance kiosk search (`/app/maintenances`) — a truck whose
 *  plate matched on the fleet master. The kiosk resolves the TRUCK only; its
 *  maintenance file is read when the truck's page opens. */
export interface TruckMaintenanceMatch {
	vehicleId: string;
	plate: string;
	brandLabel: string | null;
}

/** ONE truck on the maintenance register (`/app/maintenances/browse`) — EVERY
 *  truck of the fleet master (with or without a record yet, mirroring the Fluid
 *  register). Deliberately IDENTITY-ONLY: the register is a pure `veh_fleets`
 *  read — no per-truck log join, so a truck with no record still appears and
 *  loading a page costs one read, not a page plus a child summary. */
export interface MaintenanceTruckBrowseModel {
	/** The `veh_fleets` id — the truck's maintenance-file route + group key. */
	id: string;
	/** The plate — the card's primary identity. */
	plate: string;
	/** The truck brand label (e.g. "HINO") — null when unset. */
	brand: string | null;
}
