import type { MmbixClient } from '@mmbix/sdk';

import type { CursorPage } from '@/shared/hooks/use-cursor-list';
import { LIST_PAGE_SIZE, SEARCH_LIMIT } from '@/shared/constants';
import { fetchVehicleIdentity } from '@/shared/lookups/api';
import { vehicleBrandLabel } from '@/shared/fleet';
import { daysFromTodayMmt } from '@/shared/time/myanmar';
import { sdk } from '@/shared/api/sdk';
import { TRUCK_MATCH_LIMIT, searchVehiclePlates } from '@/shared/lookups/api';
import { deriveStatus, insuranceMoneyValue, insuranceProviderLabel } from './status';
import type {
	FleetRow,
	InsuranceCardModel,
	InsuranceCurrentState,
	InsuranceRow,
	InsuranceTruckMatch,
	TruckInsuranceSelection,
} from './types';

/**
 * The insurances module's typed client — the same local-cast pattern as every
 * sibling module: the app-wide client is typed against the placeholder
 * `Schema = {}`, so entity reads here go through a locally-typed view of the
 * SAME instance.
 *
 * The BROWSE REGISTER (`/app/insurances/browse`) is VEHICLE-FIRST, mirroring
 * the fleets/fluid/odo modules: it cursor-walks `veh_fleets` (ALL vehicles) and
 * asks each truck for its CURRENT policy via the denormalized `last_insurance`
 * pointer (dotted `last_insurance.*` fields expanded in the SAME read). A truck
 * with no policy — or a pointer left stale at a soft-deleted policy — carries
 * `last_insurance: null` and renders the "no policy yet" state rather than
 * omitted. The per-truck HISTORY feed still reads `veh_insurances` directly (a
 * truck's full file); the kiosk lookup and the renew gate read the SAME
 * `last_insurance` pointer, so every surface agrees on which policy is current.
 */
type OpsSchema = {
	veh_fleets: FleetRow;
	veh_insurances: InsuranceRow;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/** The policy's owning vehicle — a lean expanded row when the engine expands it
 *  (dotted `fields`), else a bare-id string (an un-linked vehicle → no plate).
 *  The vehicle id rides along so the per-truck list groups on the real truck. */
function resolveVehicle(vehicle: InsuranceRow['vehicle']): {
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

/** Map one policy page to cards — plate/provider/policy/expiry + the policy's
 *  optional terms (betterment flag, the Ks amounts, the note). The provider is
 *  stored as the backend select's CODE (AYI / GGI) but rendered by its LABEL
 *  (AYA / GGI) — unknown legacy strings stay as stored; the money columns are
 *  normalized to numbers so the cards can format them. */
function insuranceCardsOf(rows: InsuranceRow[]): InsuranceCardModel[] {
	return rows.map((row): InsuranceCardModel => {
		const expiry = row.expiry_date ?? null;
		// A garbage date can't parse (NaN) → treat as "no date on file" (expired).
		const rawDays = expiry ? daysFromTodayMmt(expiry) : null;
		const remainingDays = rawDays !== null && !Number.isNaN(rawDays) ? rawDays : null;
		const vehicle = resolveVehicle(row.vehicle);
		return {
			id: row.id ?? '',
			createdAt: row.created_at ?? null,
			vehicleId: vehicle.vehicleId,
			plateNo: vehicle.plate,
			brandLabel: vehicle.brandLabel,
			provider: insuranceProviderLabel(row.provider),
			policyNo: row.policy_no ?? null,
			expiryDate: expiry,
			betterment: row.betterment == null ? null : Boolean(row.betterment),
			windscreenCover: insuranceMoneyValue(row.windscreen_cover),
			premiumAmount: insuranceMoneyValue(row.premium_amount),
			sumInsured: insuranceMoneyValue(row.sum_insured),
			note: row.note?.trim() || null,
			remainingDays,
			status: deriveStatus(remainingDays),
		};
	});
}

// `vehicle` uses DOT-paths (`vehicle.plate_no` / `vehicle.brand`) so the engine
// returns exactly those two columns of the related fleet row — the whole truck
// row (wheels, model, slots…) never leaves the DB. The dotted expansion means
// every policy lands with its plate + brand already inside the SAME payload.
// Used by the per-truck reads and the kiosk lookup (the register uses
// `REGISTER_FIELDS` below — the `veh_fleets` master + its `last_insurance`).
const INSURANCE_FIELDS = [
	'id',
	'vehicle.plate_no',
	'vehicle.brand',
	'provider',
	'policy_no',
	'expiry_date',
	'betterment',
	'windscreen_cover',
	'premium_amount',
	'sum_insured',
	'note',
	'created_at',
] as const;

/** The VEHICLE-FIRST register projection — the fleet master's identity columns
 *  PLUS the denormalized `last_insurance` pointer expanded to exactly the policy
 *  fields a register card renders. The whole policy row never leaves the DB, and
 *  the pointer carries the SAME card facts a `veh_insurances` read would. This
 *  ONE projection is the single source of "current policy" — the register, the
 *  kiosk lookup and the per-truck renewal gate all read it, so they can never
 *  disagree. */
const INSURANCE_POINTER_FIELDS = [
	'last_insurance.provider',
	'last_insurance.policy_no',
	'last_insurance.expiry_date',
	'last_insurance.betterment',
	'last_insurance.windscreen_cover',
	'last_insurance.premium_amount',
	'last_insurance.sum_insured',
	'last_insurance.note',
	'last_insurance.created_at',
] as const;

const REGISTER_FIELDS = ['id', 'plate_no', 'brand', ...INSURANCE_POINTER_FIELDS] as const;

/**
 * One `veh_fleets` master row → its register card: the VEHICLE's identity plus
 * its CURRENT policy from the expanded `last_insurance` pointer.
 *
 * STALENESS: the engine resolves an m2o at a SOFT-DELETED target to `null`
 * (`resolveM2O` hides trashed rows), and a null FK stays null — so a pointer
 * left stale by a delete simply reads as `last_insurance == null` and the card
 * renders the "no policy yet" state. A deleted policy can therefore never be
 * shown as current, and the read never crashes on a dangling pointer.
 *
 * The card `id` is the VEHICLE id (one card per truck, stable across renewals);
 * the policy's own facts live in the policy fields. Pure — unit-tested in
 * `register.spec.ts`.
 */
export function insuranceCardOf(fleet: FleetRow): InsuranceCardModel {
	const doc = fleet.last_insurance && typeof fleet.last_insurance === 'object' ? fleet.last_insurance : null;
	const expiry = doc?.expiry_date ?? null;
	// A garbage date can't parse (NaN) → treat as "no date on file" (expired).
	const rawDays = expiry ? daysFromTodayMmt(expiry) : null;
	const remainingDays = rawDays !== null && !Number.isNaN(rawDays) ? rawDays : null;
	return {
		id: fleet.id ?? '',
		createdAt: doc?.created_at ?? null,
		vehicleId: fleet.id ?? null,
		plateNo: fleet.plate_no?.trim() || null,
		brandLabel: vehicleBrandLabel(fleet.brand),
		provider: doc ? insuranceProviderLabel(doc.provider) : null,
		policyNo: doc?.policy_no ?? null,
		expiryDate: expiry,
		betterment: doc?.betterment == null ? null : Boolean(doc.betterment),
		windscreenCover: insuranceMoneyValue(doc?.windscreen_cover),
		premiumAmount: insuranceMoneyValue(doc?.premium_amount),
		sumInsured: insuranceMoneyValue(doc?.sum_insured),
		note: doc?.note?.trim() || null,
		remainingDays,
		status: deriveStatus(remainingDays),
		hasRecord: doc != null,
	};
}

/** The toolbar search — a server-side `?search=` over the fleet master's OWN
 *  text fields (plate / brand), mapped to the SAME vehicle-first card as the
 *  list, so results always match it. Searching by policy number is deliberately
 *  gone: the register is keyed by vehicle, not by document. */
export async function fetchInsurancesSearch(query: string): Promise<InsuranceCardModel[]> {
	const res = await ops.items('veh_fleets').list({
		fields: [...REGISTER_FIELDS],
		search: query,
		sort: 'plate_no',
		limit: SEARCH_LIMIT,
	});
	return sortInsurancesByUrgency(res.data.map(insuranceCardOf));
}

/** One page of the vehicle-first register — `LIST_PAGE_SIZE` VEHICLES
 *  (plate-sorted), each carrying its current policy (or the no-record state),
 *  re-ordered most-urgent-first within the page. */
export async function fetchInsurancesPage(cursor?: string): Promise<CursorPage<InsuranceCardModel>> {
	const res = await ops.items('veh_fleets').list({
		fields: [...REGISTER_FIELDS],
		sort: 'plate_no',
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	return {
		rows: sortInsurancesByUrgency(res.data.map(insuranceCardOf)),
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/**
 * One plate-search hit → its kiosk row, built from the SAME `last_insurance`
 * pointer the browse register reads (so a kiosk suggestion and the register card
 * for that truck can never disagree, and the kiosk pays NO second collection
 * join). `record` is null — not an empty card — when the truck has no policy on
 * file, because the kiosk hands that null straight to the renew gate. Pure —
 * unit-tested in `register.spec.ts`.
 */
export function insuranceMatchOf(fleet: FleetRow): InsuranceTruckMatch | null {
	const plate = fleet.plate_no?.trim();
	if (!plate) return null;
	const card = insuranceCardOf(fleet);
	return {
		vehicleId: fleet.id ?? '',
		plate,
		brand: vehicleBrandLabel(fleet.brand),
		record: card.hasRecord ? card : null,
	};
}

/**
 * The insurance kiosk's LAZY truck lookup (`/app/insurances`, the search-first
 * landing) — ONE lazy `?search=` over the fleet master (the shared
 * `searchVehiclePlates`) that ALSO projects each matched truck's `last_insurance`
 * pointer, so every hit is decorated with its CURRENT policy from the SAME single
 * request — no `veh_insurances` join at all (the join this replaced picked the
 * newest-by-WRITE row, which disagreed with the register on a backdated policy).
 * Each result row therefore carries the SAME plate + brand + remaining-days pill
 * a browse truck card shows.
 */
export async function fetchInsuranceTruckMatches(query: string): Promise<InsuranceTruckMatch[]> {
	const hits = await searchVehiclePlates(query, TRUCK_MATCH_LIMIT, INSURANCE_POINTER_FIELDS);
	return hits
		.map((hit) => insuranceMatchOf(hit.raw as unknown as FleetRow))
		.filter((match): match is InsuranceTruckMatch => match !== null);
}

/**
 * ONE truck's policy file page — a CURSOR page of that truck's `veh_insurances`
 * rows (furthest-EXPIRY first, so `[0]` of page 1 is the CURRENT policy — the
 * SAME `expiry_date`-ranked rule `veh_fleets.last_insurance` uses), read by the
 * per-truck page's `useCursorList` feed. Unlike the overview, the feed keeps
 * document order (the CURRENT policy leads) rather than the urgency sort.
 * Deliberately NOT part of the list read: the overview loads only what its
 * cards render (the current policy + count), and history rows stream in here,
 * only when the user opens that truck's page.
 */
export async function fetchTruckPolicyPage(vehicleId: string, cursor?: string): Promise<CursorPage<InsuranceCardModel>> {
	const res = await ops.items('veh_insurances').list({
		fields: INSURANCE_FIELDS,
		filter: { vehicle: { _eq: vehicleId } },
		sort: '-expiry_date',
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	return {
		rows: insuranceCardsOf(res.data),
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
): Promise<Pick<TruckInsuranceSelection, 'plate' | 'brand'> & { image: string | null }> {
	// Shared with every other fleet module (one key, one cached read) — see
	// `fetchVehicleIdentity`. The truck PHOTO rides along, so the per-truck page
	// leads with the truck itself on every open.
	const identity = await fetchVehicleIdentity(vehicleId);
	return { plate: identity.plateNo, brand: identity.brandLabel, image: identity.image ?? null };
}

/**
 * Most-urgent-first — the policy list's display order (overdue → expiring →
 * valid; policies without an end date sink last). Applied across ALL loaded
 * pages so the list always leads with what needs attention.
 */
export function sortInsurancesByUrgency(cards: InsuranceCardModel[]): InsuranceCardModel[] {
	return [...cards].sort((a, b) => {
		const aDays = a.remainingDays ?? Number.POSITIVE_INFINITY;
		const bDays = b.remainingDays ?? Number.POSITIVE_INFINITY;
		return aDays - bDays;
	});
}

/** The current-policy summary a tapped register row routes to the truck page —
 *  the row's pill facts, so the record view can gate the renew form with NO
 *  read. Null when the truck has no policy on file (its first record is always
 *  allowed). */
export function insuranceCurrentOf(card: InsuranceCardModel | null | undefined): InsuranceCurrentState | null {
	if (!card) return null;
	return {
		expiryDate: card.expiryDate,
		remainingDays: card.remainingDays,
		status: card.status,
	};
}

/**
 * ONE lean read of the truck's CURRENT policy — the fleet master's
 * `last_insurance` pointer (NOT the newest-by-write `veh_insurances` row, which
 * disagreed with the register on a backdated policy). Used ONLY on the per-truck
 * page's DEEP-LINK path — a card tap routes the current summary in router state
 * (`insuranceCurrentOf`), so the tap path never fires this. Returns null when
 * the truck has no policy on file yet.
 */
export async function fetchTruckCurrentPolicy(vehicleId: string): Promise<InsuranceCardModel | null> {
	const res = await ops.items('veh_fleets').list({
		fields: [...REGISTER_FIELDS],
		filter: { id: { _eq: vehicleId } },
		limit: 1,
	});
	const fleet = res.data[0];
	if (!fleet) return null;
	const card = insuranceCardOf(fleet);
	return card.hasRecord ? card : null;
}

/**
 * Create a policy — one engine-native POST on `veh_insurances` bound to a
 * `veh_fleets` vehicle. The backend's `provider` select is REQUIRED, so every
 * caller must resolve a provider CODE (see `INSURANCE_PROVIDER_OPTIONS`)
 * before submitting. The optional terms (amounts, betterment, note) ride along
 * only when the operator set them.
 */
export interface CreatePolicyInput {
	vehicle: string;
	/** The stored provider code (AYI / GGI) — the backend select's VALUE. */
	provider: string;
	policy_no?: string;
	expiry_date?: string;
	betterment?: boolean;
	windscreen_cover?: number;
	premium_amount?: number;
	sum_insured?: number;
	note?: string;
}

export async function createPolicy(input: CreatePolicyInput): Promise<InsuranceRow> {
	return ops.items('veh_insurances').create(input as unknown as Record<string, unknown>);
}

/** The editable policy columns — the record-edit screen's prefill (every field
 *  the form can change, unlike the lean history-card projection). */
const POLICY_EDIT_FIELDS = [
	'id',
	'vehicle',
	'provider',
	'policy_no',
	'expiry_date',
	'betterment',
	'windscreen_cover',
	'premium_amount',
	'sum_insured',
	'note',
] as const;

/** ONE policy by id — the edit screen's prefill. A bare `vehicle` id comes back
 *  un-expanded (the screen only needs it to key the truck's caches). */
export async function fetchPolicyById(id: string): Promise<InsuranceRow> {
	const res = await ops.items('veh_insurances').list({
		fields: [...POLICY_EDIT_FIELDS],
		filter: { id: { _eq: id } },
		limit: 1,
	});
	const row = res.data[0];
	if (!row) throw new Error('Policy not found.');
	return row;
}

/** The policy fields a CORRECTION may change. The owning vehicle never moves,
 *  and a cleared field is sent as `null` so blanks actually clear. */
export interface UpdatePolicyInput {
	provider: string;
	policy_no: string | null;
	expiry_date: string | null;
	betterment: boolean;
	windscreen_cover: number | null;
	premium_amount: number | null;
	sum_insured: number | null;
	note: string | null;
}

/** Correct an existing policy (the vehicle's NEWEST record only). */
export async function updatePolicy(id: string, input: UpdatePolicyInput): Promise<InsuranceRow> {
	return ops.items('veh_insurances').update(id, input as unknown as Record<string, unknown>);
}

/** The vehicle id a policy row points at — a bare id, or the expanded row's id. */
export function policyVehicleId(row: InsuranceRow): string | null {
	const fk = row.vehicle;
	if (!fk) return null;
	return typeof fk === 'string' ? fk : (fk.id ?? null);
}
