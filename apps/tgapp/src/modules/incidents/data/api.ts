import type { MmbixClient } from '@mmbix/sdk';

import type { CursorPage } from '@/shared/hooks/use-cursor-list';
import { LIST_PAGE_SIZE, SEARCH_LIMIT } from '@/shared/constants';
import { fetchVehicleIdentity } from '@/shared/lookups/api';
import { vehicleBrandLabel } from '@/shared/fleet';
import { formatEnglishDateLabel, formatRelativeTime } from '@/shared/time/myanmar';
import { sdk } from '@/shared/api/sdk';
import { TRUCK_MATCH_LIMIT, searchVehiclePlates } from '@/shared/lookups/api';
import type {
	IncidentCardModel,
	IncidentKind,
	IncidentRow,
	IncidentSeverity,
	IncidentTruckMatch,
	PersonnelEntry,
	PersonnelRow,
	TruckIncidentSelection,
	VehicleRow,
} from './types';

/**
 * The incidents module's typed client — the same local-cast pattern as every
 * sibling module: the app-wide client is typed against the placeholder
 * `Schema = {}`, so entity reads here go through a locally-typed view of the
 * SAME instance. Reads the REAL `veh_incidents` accidents & incidents
 * `veh_incidents` accidents & incidents
 * collection (bound to `veh_fleets`; its `personnel` m2m → `hrm_employees`).
 *
 * Each row's plate/brand + crew are EXPANDED in the SAME request (the dotted
 * `fields` below pull `vehicle.plate_no` / `vehicle.brand` / `personnel.*`), so
 * every incidents read is ONE self-contained request — no shared fleet or
 * employee directory calls.
 */
type OpsSchema = {
	veh_fleets: VehicleRow;
	veh_incidents: IncidentRow;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/** "MMK 96,000" — the estimated cost with thousands separators (normalized). */
function costLabel(cost: string | number | null | undefined): string | null {
	if (cost == null || cost === '') return null;
	const amount = Number.parseFloat(String(cost).replace(/[^0-9.-]/g, ''));
	if (!Number.isFinite(amount)) return null;
	return `MMK ${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** "3 weeks ago" — the relative age from `created_at`, null when unset/unparseable. */
function ageLabel(createdAt: string | null | undefined): string | null {
	if (!createdAt) return null;
	const ms = Date.parse(createdAt);
	if (Number.isNaN(ms)) return null;
	return formatRelativeTime(ms);
}

/** Map the record's expanded `personnel` m2m to the card's / form's entries.
 *  Absent (a read that doesn't request it) degrades to an EMPTY list, never
 *  `undefined`; a member with no resolvable name is dropped. Shared by the card
 *  mapping and the edit form's picker prefill. */
export function personnelEntries(rows: IncidentRow['personnel']): PersonnelEntry[] {
	if (!Array.isArray(rows)) return [];
	return rows
		.filter((row): row is PersonnelRow => row != null && typeof row === 'object')
		.map((row) => ({
			id: String(row.id ?? ''),
			name: String(row.name_en ?? row.name_mm ?? '').trim(),
			// The employee's designation — the role label the grid shows beside the name.
			role: row.designation?.name?.trim() || null,
			photo: row.avatar?.trim() || null,
		}))
		.filter((person) => person.name !== '');
}

/** The record's owning vehicle — a lean expanded row when the engine expands it
 *  (dotted `fields`), else a bare-id string (an un-linked vehicle → no plate).
 *  The vehicle id rides along so the per-truck list groups on the real truck. */
function resolveVehicle(vehicle: IncidentRow['vehicle']): {
	vehicleId: string | null;
	plate: string | null;
	brandLabel: string | null;
} {
	if (vehicle && typeof vehicle === 'object') {
		return {
			vehicleId: vehicle.id ?? null,
			plate: vehicle.plate_no ?? null,
			brandLabel: vehicleBrandLabel(vehicle.brand),
		};
	}
	if (vehicle && typeof vehicle === 'string') return { vehicleId: vehicle, plate: null, brandLabel: null };
	return { vehicleId: null, plate: null, brandLabel: null };
}

/** Map one page to cards — plate/brand, kind, title/description, severity,
 *  location, date, cost, crew + age. Each row self-carries its expanded
 *  `vehicle` / `personnel`, so the mapping needs no shared masters. */
function incidentCardsOf(rows: IncidentRow[]): IncidentCardModel[] {
	return rows.map((row) => {
		const vehicle = resolveVehicle(row.vehicle);
		// `title` stays distinct (the event card's headline); `description` folds in the
		// title as a last resort so every card still has an account line to show.
		const title = row.title?.trim() || null;
		const description = row.description?.trim() || title;
		return {
			id: row.id,
			createdAt: row.created_at ?? null,
			vehicleId: vehicle.vehicleId,
			plateNo: vehicle.plate,
			brandLabel: vehicle.brandLabel,
			kind: row.kind === 'accident' ? 'accident' : row.kind === 'incident' ? 'incident' : 'incident',
			title,
			description,
			severity: row.severity ?? 'low',
			location: row.location?.trim() || null,
			dateLabel: formatEnglishDateLabel(row.incident_date),
			costLabel: costLabel(row.est_cost),
			personnel: personnelEntries(row.personnel),
			ageLabel: ageLabel(row.created_at),
		};
	});
}

// ONE field set for EVERY incident card read. `vehicle` / `personnel` use
// DOT-paths (`vehicle.plate_no`, `personnel.designation.name`) so the engine
// returns ONLY the columns the cards render — never whole fleet rows or full
// employee profiles — and both expansions land inside the SAME payload, so each
// read is a single request. The register, its toolbar search and a truck's file
// all paint the same card, so they request the SAME columns (one version of the
// truth); the `personnel` m2m feeds both the card's crew footer and the event
// card's Personnel grid.
const INCIDENT_CARD_FIELDS = [
	'id',
	'vehicle.plate_no',
	'vehicle.brand',
	'kind',
	'title',
	'description',
	'incident_date',
	'severity',
	'location',
	'est_cost',
	'personnel.name_en',
	'personnel.name_mm',
	'personnel.avatar',
	'personnel.designation.name',
	'created_at',
] as const;

/** The toolbar search — `?search=` across the record's text fields (title /
 *  description / location / plate-ish via title), mapped to the SAME card so
 *  results always match the list. */
export async function fetchIncidentsSearch(query: string): Promise<IncidentCardModel[]> {
	const res = await ops.items('veh_incidents').list({
		fields: INCIDENT_CARD_FIELDS,
		search: query,
		limit: SEARCH_LIMIT,
	});
	return incidentCardsOf(res.data);
}

/** One page of the incidents register — `LIST_PAGE_SIZE` records, newest first.
 *  Its truck-group cards are identity-only and ignore the record fields, but the
 *  SAME page feeds the unassigned record cards, so it carries the one shared
 *  card field set. */
export async function fetchIncidentsPage(cursor?: string): Promise<CursorPage<IncidentCardModel>> {
	const res = await ops.items('veh_incidents').list({
		fields: INCIDENT_CARD_FIELDS,
		sort: '-created_at',
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	return {
		rows: incidentCardsOf(res.data),
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/**
 * ONE truck's record file page — a CURSOR page of that truck's `veh_incidents`
 * rows (newest first, so `[0]` of page 1 is the newest record on file), read by
 * the per-truck page's `useCursorList` feed. The register deliberately loads
 * only the truck identity + count per group, and a truck's full file streams in
 * here — the shared card fields including the expanded `personnel` m2m that
 * feeds each event card's Personnel grid — only after the user opens that truck.
 */
export async function fetchTruckIncidentPage(vehicleId: string, cursor?: string): Promise<CursorPage<IncidentCardModel>> {
	const res = await ops.items('veh_incidents').list({
		fields: INCIDENT_CARD_FIELDS,
		filter: { vehicle: { _eq: vehicleId } },
		sort: '-created_at',
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	return {
		rows: incidentCardsOf(res.data),
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/**
 * The incidents kiosk's LAZY truck lookup (`/app/incidents`, the search-first
 * landing) — ONE `?search=` over the `veh_fleets` plate master (the shared
 * `searchVehiclePlates`, so an idle screen issues nothing and a typed fragment
 * fetches only close plates).
 *
 * It deliberately reads NO `veh_incidents` rows: at this point the kiosk only
 * resolves WHICH truck the operator means, and that truck's record file is read
 * when its page opens (`/app/incidents/vehicle/:id`). So typing costs one fleet
 * query — never a joined record read — and the lookup never claims a record
 * state it hasn't read.
 */
export async function fetchIncidentTruckMatches(query: string): Promise<IncidentTruckMatch[]> {
	const hits = await searchVehiclePlates(query, TRUCK_MATCH_LIMIT);
	return hits
		.filter((hit) => hit.plate_no?.trim())
		.map((hit) => ({
			vehicleId: hit.id,
			plate: (hit.plate_no as string).trim(),
			brand: vehicleBrandLabel(hit.brand),
		}));
}

/**
 * Deep-link / refresh truck identity — read the fleet master row ONLY for the
 * plate/brand the per-truck page's header needs. Used ONLY when no routed list
 * row backed the page (a card tap passes its identity through router state, so
 * this never fires there). Throws when the truck is not on the fleet master.
 */
export async function fetchTruckIdentity(
	vehicleId: string,
): Promise<Pick<TruckIncidentSelection, 'plate' | 'brand'> & { image: string | null }> {
	// Shared with every other fleet module (one key, one cached read) — see
	// `fetchVehicleIdentity`. The truck PHOTO rides along, so the per-truck page
	// leads with the truck itself on every open.
	const identity = await fetchVehicleIdentity(vehicleId);
	return { plate: identity.plateNo, brand: identity.brandLabel, image: identity.image ?? null };
}

/**
 /** Create an accident/incident record — one engine-native POST on `veh_incidents`
  * bound to a `veh_fleets` vehicle with the current login employee as reporter.
  * `personnel` is the crew m2m (an array of `hrm_employees` ids) the engine writes
  * as junction rows in the SAME atomic batch as the parent insert.
  */
export interface CreateIncidentInput {
	vehicle?: string;
	kind: IncidentKind;
	reported_by: string;
	title: string;
	description?: string;
	incident_date?: string;
	severity?: IncidentRow['severity'];
	location?: string;
	est_cost?: number;
	/** The crew involved — `hrm_employees` ids (the `personnel` m2m). */
	personnel?: string[];
}

export async function createIncident(input: CreateIncidentInput): Promise<IncidentRow> {
	return ops.items('veh_incidents').create(input as unknown as Record<string, unknown>);
}

// The record's OWN columns, RAW — the edit screen's prefill. Unlike the list
// read this keeps `title` and `description` distinct (the card folds them) and
// the date/cost unformatted, so an edit round-trips exactly what was stored.
// `vehicle` is expanded to the lean plate/brand row only so the edit screen can
// title itself without a second fleet read.
const INCIDENT_RECORD_FIELDS = [
	'id',
	'vehicle.plate_no',
	'vehicle.brand',
	'kind',
	'title',
	'description',
	'incident_date',
	'severity',
	'location',
	'est_cost',
	// The crew m2m — expanded so the edit form's personnel picker seeds with the
	// people already on the record (ids + display identity).
	'personnel.id',
	'personnel.name_en',
	'personnel.name_mm',
	'personnel.avatar',
	'created_at',
] as const;

/** ONE record by id, RAW — the record edit screen's prefill (`/app/incidents/record/:id`). */
export async function fetchIncidentRecord(id: string): Promise<IncidentRow> {
	return ops.items('veh_incidents').get(id, { fields: INCIDENT_RECORD_FIELDS });
}

/** The editable columns of a record — deliberately EXCLUDES the owning vehicle
 *  and the original `reported_by`, which an edit must never reassign. `personnel`
 *  is the crew m2m: the engine REPLACES the junction rows with this exact set in
 *  the SAME atomic batch as the update (an empty array clears them). */
export interface UpdateIncidentInput {
	kind: IncidentKind;
	title: string;
	description: string | null;
	incident_date: string | null;
	severity: IncidentSeverity;
	location: string | null;
	est_cost: number | null;
	/** The crew involved — `hrm_employees` ids (the `personnel` m2m). */
	personnel: string[];
}

/** Update one accident/incident record — one engine-native PUT on `veh_incidents`.
 *  The crew rides as an id array on the wire (the `personnel` m2m), so the payload
 *  is cast past the read-shaped `IncidentRow` — the same boundary `createIncident`
 *  uses for its relation writes. */
export async function updateIncident(id: string, input: UpdateIncidentInput): Promise<IncidentRow> {
	return ops.items('veh_incidents').update(id, input as unknown as Partial<IncidentRow>);
}
