import type { MmbixClient } from '@mmbix/sdk';

import type { CursorPage } from '@/shared/hooks/use-cursor-list';
import { LIST_PAGE_SIZE, MASTER_STALE_MS, SEARCH_LIMIT } from '@/shared/constants';
import { fetchVehicleIdentity } from '@/shared/lookups/api';
import { vehicleBrandLabel } from '@/shared/fleet';
import { maintenanceDocStatusOf } from './status';
import { formatEnglishDayMonth } from '@/shared/time/myanmar';
import { sdk } from '@/shared/api/sdk';
import { TRUCK_MATCH_LIMIT, searchVehiclePlates } from '@/shared/lookups/api';
import type {
	IssueCategoryRef,
	IssueTypeOption,
	IssueTypeRow,
	MaintenanceLogCardModel,
	MaintenanceLogRow,
	MaintenanceTruckBrowseModel,
	PersonRow,
	TruckMaintenanceMatch,
	TruckMaintenanceSelection,
	VehicleRow,
} from './types';

/**
 * The maintenance module's typed client — the same local-cast pattern as every
 * sibling module: the app-wide client is typed against the placeholder `Schema`,
 * so entity reads here go through a locally-typed view of the SAME instance.
 * Reads/writes the REAL `veh_maintenance_logs` collection (bound to `veh_fleets`,
 * citing a `veh_issue_types` job).
 *
 * Every list read EXPANDS the truck (`fleet.plate_no`) and the cited job
 * (`issues_type.name_en` / `name_mm` / `job_code` / `category`) with dotted
 * `fields`, so each read is ONE self-contained request — no shared fleet or
 * catalog directory call.
 */
type OpsSchema = {
	veh_maintenance_logs: MaintenanceLogRow;
	veh_issue_types: IssueTypeRow;
	veh_fleets: VehicleRow;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/** "MMK 250,000" — a formatted money label, null when the value is unset/garbage. */
function moneyLabel(value: number | null | undefined): string | null {
	if (value == null || !Number.isFinite(value)) return null;
	return `MMK ${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** The engine-owned total, as a card label. The stored formula coerces unset costs
 *  to 0, so a zero (or missing) total means "nothing priced yet" — never "MMK 0",
 *  which would read as a free job. */
function totalCostLabel(value: number | null | undefined): string | null {
	if (value == null || !Number.isFinite(value) || value === 0) return null;
	return moneyLabel(value);
}

/** "184,500 km" — the odometer text normalized with thousands separators (the row
 *  stores it as text). A non-numeric entry is shown verbatim. */
/** The raw odometer as a number — null when absent/unparseable. Feeds the
 *  ledger's km transition, which needs arithmetic rather than a label. */
function odoNumber(value: string | number | null | undefined): number | null {
	if (value == null) return null;
	const text = String(value).trim();
	if (text === '') return null;
	const amount = Number(text.replace(/[, ]/g, ''));
	return Number.isFinite(amount) ? amount : null;
}

function odoLabel(value: string | number | null | undefined): string | null {
	if (value == null) return null;
	const text = String(value).trim();
	if (text === '') return null;
	const amount = Number(text.replace(/[, ]/g, ''));
	return Number.isFinite(amount) ? `${amount.toLocaleString('en-US')} km` : text;
}

/** "20 Aug – 22 Aug 2026" — the job window, the year printed ONCE (at the end)
 *  when both days share it. A one-day job collapses to "02 Sep 2026" (its
 *  duration already reads "Same day"); an open job reads "02 Sep 2026 · In
 *  progress". Null when the start day is missing/unparsable. */
function rangeLabelOf(started: string | null | undefined, ended: string | null | undefined): string | null {
	const start = formatEnglishDayMonth(started);
	if (!start) return null;
	const startYear = started!.slice(0, 4);
	if (!ended) return `${start} ${startYear} · In progress`;
	const end = formatEnglishDayMonth(ended);
	if (!end || ended.slice(0, 10) === started!.slice(0, 10)) return `${start} ${startYear}`;
	const endYear = ended.slice(0, 4);
	return startYear === endYear ? `${start} – ${end} ${endYear}` : `${start} ${startYear} – ${end} ${endYear}`;
}

/** "4 days" — the job's span in whole days (inclusive of both endpoints), null
 *  while the job is still open or either day is unparseable. "Same day" when the
 *  start and end fall on one day. */
function durationLabel(started: string | null | undefined, ended: string | null | undefined): string | null {
	if (!started || !ended) return null;
	const a = Date.parse(`${started.slice(0, 10)}T00:00:00Z`);
	const b = Date.parse(`${ended.slice(0, 10)}T00:00:00Z`);
	if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
	const days = Math.round((b - a) / 86_400_000) + 1;
	return days <= 1 ? 'Same day' : `${days} days`;
}

/** The log's owning vehicle — a lean expanded row (dotted `fields`), else a bare
 *  id (an un-linked truck → no plate). */
function resolveVehicle(fleet: MaintenanceLogRow['fleet']): {
	vehicleId: string | null;
	plateNo: string | null;
	brandLabel: string | null;
} {
	if (fleet && typeof fleet === 'object') {
		return { vehicleId: fleet.id ?? null, plateNo: fleet.plate_no?.trim() || null, brandLabel: vehicleBrandLabel(fleet.brand) };
	}
	if (typeof fleet === 'string' && fleet) return { vehicleId: fleet, plateNo: null, brandLabel: null };
	return { vehicleId: null, plateNo: null, brandLabel: null };
}

/** The job's `mro_item_categories` m2o → the flat `{ id, nameEn, nameMm }` the
 *  filter keys on — the engine returns the expanded row when the dotted path is
 *  requested, or a bare id string when it is not. */
function categoryRefOf(value: unknown): IssueCategoryRef | null {
	if (typeof value === 'string') return value ? { id: value, nameEn: null, nameMm: null } : null;
	if (value && typeof value === 'object') {
		const row = value as { id?: unknown; name_en?: unknown; name_mm?: unknown };
		if (typeof row.id !== 'string' || !row.id) return null;
		return {
			id: row.id,
			nameEn: typeof row.name_en === 'string' && row.name_en ? row.name_en : null,
			nameMm: typeof row.name_mm === 'string' && row.name_mm ? row.name_mm : null,
		};
	}
	return null;
}

/** The log's cited job — a lean expanded row (dotted `fields`), else a bare id. */
function resolveIssueType(issue: MaintenanceLogRow['issues_type']): {
	name: string | null;
	jobCode: string | null;
	category: IssueCategoryRef | null;
} {
	if (issue && typeof issue === 'object') {
		return {
			name: issue.name_en?.trim() || issue.name_mm?.trim() || null,
			jobCode: issue.job_code?.trim() || null,
			category: categoryRefOf(issue.category),
		};
	}
	return { name: null, jobCode: null, category: null };
}

/** A person m2o's display name — the expanded row's English name, else Burmese.
 *  Null for a bare id (an unexpanded or unlinked person). */
function personName(person: string | PersonRow | null | undefined): string | null {
	if (person && typeof person === 'object') return person.name_en?.trim() || person.name_mm?.trim() || null;
	return null;
}

/** Map one page of rows to the app's flat card models. */
function maintenanceCardsOf(rows: MaintenanceLogRow[]): MaintenanceLogCardModel[] {
	return rows.map((row) => {
		const vehicle = resolveVehicle(row.fleet);
		const issue = resolveIssueType(row.issues_type);
		return {
			id: row.id,
			vehicleId: vehicle.vehicleId,
			plateNo: vehicle.plateNo,
			brandLabel: vehicle.brandLabel,
			issueTypeName: issue.name,
			jobCode: issue.jobCode,
			category: issue.category,
			rangeLabel: rangeLabelOf(row.started_at, row.end_at),
			durationLabel: durationLabel(row.started_at, row.end_at),
			odo: odoLabel(row.odo),
			odoKm: odoNumber(row.odo),
			partsLabel: moneyLabel(row.parts_cost),
			laborLabel: moneyLabel(row.labor_cost),
			totalLabel: totalCostLabel(row.total_cost),
			vendorType: row.vendor_type ?? null,
			technician: row.technician?.trim() || null,
			driverName: personName(row.driver),
			note: row.note?.trim() || null,
			docStatus: maintenanceDocStatusOf(row.doc_status),
		};
	});
}

// ONE field set for EVERY card read. Dotted paths expand the truck + the cited
// job in the SAME payload, so the register, its search and a truck's file all
// paint the same card from one request. `total_cost` is the stored formula the
// engine returns on read.
const LOG_CARD_FIELDS = [
	'id',
	'fleet.plate_no',
	'fleet.brand',
	'issues_type.name_en',
	'issues_type.name_mm',
	'issues_type.job_code',
	'issues_type.category.id',
	'issues_type.category.name_en',
	'issues_type.category.name_mm',
	'started_at',
	'end_at',
	'odo',
	'parts_cost',
	'labor_cost',
	'total_cost',
	'vendor_type',
	'technician',
	'note',
	'doc_status',
	'driver.name_en',
	'driver.name_mm',
] as const;

/** ONE truck's maintenance file page — newest started day first. */
export async function fetchTruckMaintenancePage(vehicleId: string, cursor?: string): Promise<CursorPage<MaintenanceLogCardModel>> {
	const res = await ops.items('veh_maintenance_logs').list({
		fields: LOG_CARD_FIELDS,
		filter: { fleet: { _eq: vehicleId } },
		sort: '-started_at',
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	return { rows: maintenanceCardsOf(res.data), nextCursor: res.meta.next_cursor ?? null, hasMore: res.meta.has_more };
}

// ── The truck register (browse all vehicles) ──────────────────────────────

/** The fleet-master columns the register reads — id + plate + brand only. A
 *  PURE `veh_fleets` read: no per-truck maintenance join, so a truck with no
 *  record yet still appears and one page costs ONE request. */
const TRUCK_LIST_FIELDS = ['id', 'plate_no', 'brand'] as const;

/** Map one fleet master row to the register's truck card. */
function truckBrowseOf(fleet: VehicleRow): MaintenanceTruckBrowseModel {
	return {
		id: fleet.id ?? '',
		plate: fleet.plate_no?.trim() || '—',
		brand: vehicleBrandLabel(fleet.brand),
	};
}

/** The truck register — EVERY truck of the fleet master (cursor-paginated,
 *  plate-sorted), so a truck with no record yet still appears (mirroring the
 *  Fluid register). ONE `veh_fleets` read per page — no child joins. */
export async function fetchMaintenanceBrowsePage(cursor?: string): Promise<CursorPage<MaintenanceTruckBrowseModel>> {
	const res = await ops.items('veh_fleets').list({
		fields: [...TRUCK_LIST_FIELDS],
		sort: 'plate_no',
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	return { rows: res.data.map(truckBrowseOf), nextCursor: res.meta.next_cursor ?? null, hasMore: res.meta.has_more };
}

/** The register's toolbar search — a server-side `?search=` over the fleet
 *  master (plate / brand), mapped to the SAME truck cards as the list so search
 *  and browse always agree. A truck with no record still matches. */
export async function fetchMaintenanceBrowseSearch(query: string): Promise<MaintenanceTruckBrowseModel[]> {
	const res = await ops.items('veh_fleets').list({
		fields: [...TRUCK_LIST_FIELDS],
		search: query,
		sort: 'plate_no',
		limit: SEARCH_LIMIT,
	});
	return res.data.map(truckBrowseOf);
}

/** The issue-type picker's cap — a search page, never the whole catalog. */
const ISSUE_TYPE_SEARCH_LIMIT = 50;

/** One `veh_issue_types` row → the picker option (English name preferred, then
 *  Burmese, then the job code). */
function issueTypeOptionOf(row: IssueTypeRow): IssueTypeOption {
	return {
		id: row.id,
		name: row.name_en?.trim() || row.name_mm?.trim() || row.job_code?.trim() || '—',
		jobCode: row.job_code?.trim() || null,
		category: categoryRefOf(row.category),
	};
}

/** The issue-type master MATCHED server-side — the picker's gated search read.
 *  ONE `?search=` per settled term (the field only asks once the term is long
 *  enough), so an idle sheet issues nothing and a short term never scans the
 *  table. */
export async function fetchIssueTypesSearch(query: string): Promise<IssueTypeOption[]> {
	const res = await ops.items('veh_issue_types').list({
		fields: ['id', 'name_en', 'name_mm', 'job_code', 'category.id', 'category.name_en', 'category.name_mm'],
		search: query,
		sort: 'name_en',
		limit: ISSUE_TYPE_SEARCH_LIMIT,
	});
	return res.data.map(issueTypeOptionOf).filter((option) => option.id);
}

/** The kiosk's LAZY truck lookup (`/app/maintenances`) — ONE `?search=` over the
 *  fleet master (the shared `searchVehiclePlates`, so an idle screen issues
 *  nothing). It reads NO log rows: the truck's file is read when its page opens. */
export async function fetchMaintenanceTruckMatches(query: string): Promise<TruckMaintenanceMatch[]> {
	const hits = await searchVehiclePlates(query, TRUCK_MATCH_LIMIT);
	return hits
		.filter((hit) => hit.plate_no?.trim())
		.map((hit) => ({ vehicleId: hit.id, plate: (hit.plate_no as string).trim(), brandLabel: vehicleBrandLabel(hit.brand) }));
}

/** Deep-link / refresh truck identity — the fleet row ONLY for the header
 *  (a card tap passes its identity through router state, so this never fires). */
export async function fetchTruckIdentity(
	vehicleId: string,
): Promise<Pick<TruckMaintenanceSelection, 'plate' | 'brand' | 'lastOdo'> & { image: string | null }> {
	// Shared with every other fleet module (one key, one cached read) — see
	// `fetchVehicleIdentity`.
	const identity = await fetchVehicleIdentity(vehicleId);
	return { plate: identity.plateNo, brand: identity.brandLabel, lastOdo: identity.lastOdo, image: identity.image };
}

// The log's OWN raw columns — the edit screen's prefill. Unlike the card read
// this keeps the costs/odo raw and the relations expanded to their lean rows, so
// an edit round-trips exactly what was stored.
const LOG_RECORD_FIELDS = [
	'id',
	'fleet.plate_no',
	'fleet.brand',
	'fleet.last_odo',
	'issues_type.name_en',
	'issues_type.name_mm',
	'issues_type.job_code',
	'issues_type.category.id',
	'issues_type.category.name_en',
	'issues_type.category.name_mm',
	'started_at',
	'end_at',
	'odo',
	'parts_cost',
	'labor_cost',
	'total_cost',
	'vendor_type',
	'technician',
	'note',
	'doc_status',
	'driver.name_en',
	'driver.name_mm',
] as const;

/** ONE log by id, RAW — the edit screen's prefill (`/app/maintenances/log/:id`). */
export async function fetchMaintenanceLog(id: string): Promise<MaintenanceLogRow> {
	return ops.items('veh_maintenance_logs').get(id, { fields: LOG_RECORD_FIELDS });
}

/** The writable columns of a log. `total_cost` is deliberately ABSENT — it is the
 *  engine-owned stored formula (parts_cost + labor_cost) and a client must never
 *  send it. */
export interface MaintenanceLogInput {
	/** The bound `veh_fleets` id — set on create, never reassigned on edit. */
	fleet: string;
	issues_type: string | null;
	started_at: string;
	end_at: string | null;
	odo: string | null;
	parts_cost: number | null;
	labor_cost: number | null;
	vendor_type: MaintenanceLogRow['vendor_type'];
	technician: string | null;
	note: string | null;
	/** The `hrm_employees` driver id — null clears the driver. */
	driver: string | null;
}

/** Create one maintenance log — ONE engine-native POST. The engine numbers the
 *  row and computes `total_cost` from parts + labor. */
export async function createMaintenanceLog(input: MaintenanceLogInput): Promise<MaintenanceLogRow> {
	return ops.items('veh_maintenance_logs').create(input as unknown as Partial<MaintenanceLogRow>);
}

/** Update one maintenance log — one engine-native PUT. The owning truck is never
 *  reassigned; `total_cost` recomputes server-side from the new costs. */
export async function updateMaintenanceLog(id: string, input: Omit<MaintenanceLogInput, 'fleet'>): Promise<MaintenanceLogRow> {
	return ops.items('veh_maintenance_logs').update(id, input as unknown as Partial<MaintenanceLogRow>);
}

/** Confirm a draft log — ONE engine-native PUT flipping `doc_status` to
 *  `confirmed`. After this the collection's `writes.freeze_when` policy rejects
 *  every further generic write, so the job is final. `approvedById` (the signed
 *  session employee) is stamped as WHO confirmed when known. */
export async function confirmMaintenanceLog(id: string, approvedById?: string | null): Promise<MaintenanceLogRow> {
	const patch: Record<string, unknown> = { doc_status: 'confirmed' };
	if (approvedById) patch.approved_by = approvedById;
	return ops.items('veh_maintenance_logs').update(id, patch as unknown as Partial<MaintenanceLogRow>);
}

/** The issue-type master changes rarely — the shared master stale tier. */
export const ISSUE_TYPES_STALE_MS = MASTER_STALE_MS;
