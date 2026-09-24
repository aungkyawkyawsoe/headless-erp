import type { MmbixClient } from '@mmbix/sdk';

import { SEARCH_LIMIT } from '@/shared/constants';
import { sdk } from '@/shared/api/sdk';
import { MRO_LOCATION_LABELS, mroApi } from '@/shared/mro';
import type { VehicleMasterRow } from '@/shared/lookups/types';
import type { MroItemModelDirectoryRow } from '@/shared/hooks/use-mro-item-models';
import { tyreStatusOf } from './status';
import { wheelSlotsOfVehicle } from './spec';
import { vehicleCarriesTyres } from './transfer-targets';
import { eventPartyOf } from './labels';
import {
	type TyreCardModel,
	type TyreEventLine,
	type TyreEventRow,
	type TyreEventKind,
	type TyreUnitRow,
	type TyreVehicleRow,
} from './types';

/**
 * The tyres module's typed client — the same local-cast pattern as the
 * store-requests / items modules: the app-wide client is typed against the
 * placeholder typegen `Schema` (no `mro_*` collections), so entity reads here
 * go through a locally-typed view of the same instance. The unit rows come
 * from `mro_stock_serials`; the tyre-SKU directory (`mro_item_model`) is the
 * SHARED `['mro','item-models']` read (`shared/hooks/use-mro-item-models`);
 * the vehicle plates arrive from the SHARED `useVehicleMasters` (`veh_fleets`);
 * and each unit's immutable lifecycle history comes from `mro_serial_events`.
 */
type OpsSchema = {
	mro_stock_serials: TyreUnitRow;
	mro_serial_events: TyreEventRow;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/**
 * A declared m2o FK arrives either EXPANDED (a full row) or as a bare id string
 * (older clients / plain reads) — normalize to the id, resolving a raw string to
 * the row against a fetched map (the same rule the tyres module used before).
 */
function rowOf<T extends { id: string }>(fk: T | string | null | undefined, byId: Map<string, T>): T | undefined {
	if (fk && typeof fk === 'object') return fk as T;
	return typeof fk === 'string' ? byId.get(fk) : undefined;
}

/** The lookup's join rows — vehicle plates (SHARED vehicles master) + the
 *  serial-tracked tyre SKU directory, built by the page and passed in so each
 *  serial search joins against the SAME cached masters it rendered from. */
export interface TyreLookups {
	/** `veh_fleets` plates — joined from the shared `useVehicleMasters`. */
	vehicles: TyreVehicleRow[];
	/** `mro_item_model` — the full SKU directory (serial-filtered client-side). */
	models: MroItemModelDirectoryRow[];
}

/**
 * Map one serial-unit page to register cards. A row is ONLY a tyre when its
 * `model` resolves in the fetched `mro_item_model` catalog to a `tracking:
 * 'serial'` SKU — the unit's plate (when mounted) resolves through the shared
 * vehicle masters; the model line from the catalog (falling back to an expanded
 * model name when the catalog hasn't loaded yet).
 */
function tyreUnitsOf(units: TyreUnitRow[], lookups: TyreLookups): TyreCardModel[] {
	const vehicleById = new Map(lookups.vehicles.map((vehicle) => [vehicle.id, vehicle]));
	// Only serial-tracked SKUs represent tyres — everything else is filtered out.
	const serialModelById = new Map(lookups.models.filter((model) => model.tracking === 'serial').map((model) => [model.id, model]));
	const cards: TyreCardModel[] = [];
	for (const unit of units) {
		if (!unit.model) continue;
		// Resolve the SKU id whether the m2o arrived expanded or as a bare id, then
		// take the serial-tracked directory row (the ONLY row carrying `tracking`
		// + `reference_tread_mm`). A unit is a TYRE only when its SKU is in that
		// serial catalog — anything else is filtered out. (The pages already gate
		// this fetch on the catalog having loaded, so no stub fallback is needed
		// here.)
		const modelId = typeof unit.model === 'object' && unit.model ? unit.model.id : unit.model;
		const modelRef = modelId ? serialModelById.get(modelId) : undefined;
		if (!modelRef) continue;
		// An EXPANDED m2o arrives as `{ id }` (no plate) — resolve it back through
		// the master so a mounted unit always carries its plate (the combobox uses
		// it to keep already-seated / not-on-a-wheel tyres out of fit candidates).
		const rawVehicle = unit.vehicle && typeof unit.vehicle === 'object' ? unit.vehicle : rowOf(unit.vehicle, vehicleById);
		const plateNo =
			rawVehicle && typeof rawVehicle === 'object'
				? (vehicleById.get(rawVehicle.id)?.plate_no ?? rawVehicle.plate_no)?.trim() || null
				: null;
		const modelName = modelRef.name_en?.trim() || modelRef.name_mm?.trim() || null;
		// The SKU's picture rides on the SAME catalog row the name came from — so a
		// card built from a search hit paints what the register list paints.
		const imageUrl = modelRef.image?.trim() || null;
		const location = unit.location;
		const treadMm = unit.tread_mm == null ? null : Number(unit.tread_mm);
		const psi = unit.psi == null ? null : Number(unit.psi);
		const referenceTreadMm = modelRef.reference_tread_mm == null ? null : Number(modelRef.reference_tread_mm);
		const slot = unit.slot?.trim() || null;
		// The person holder — a serial-unit read may carry the `employee` m2o either
		// expanded (`{ id }`) or bare; resolve to the id so the serial page knows the
		// unit's CURRENT custodian when it files a transfer request.
		const employeeId =
			unit.employee && typeof unit.employee === 'object'
				? (unit.employee.id ?? null)
				: typeof unit.employee === 'string'
					? unit.employee
					: null;
		cards.push({
			id: unit.id,
			// Mirrors the server's derivation: a wheel unit (a new-tread baseline on the
			// SKU, or a seated slot) is a tyre; anything else is a plain asset.
			kind: referenceTreadMm != null || slot != null ? 'tyre' : 'asset',
			modelName,
			imageUrl,
			serialNo: unit.serial_no?.trim() || null,
			status: tyreStatusOf(unit.status),
			itemNameEn: modelRef.group_name_en?.trim() || null,
			itemNameMm: modelRef.group_name_mm?.trim() || null,
			plateNo,
			slot,
			employeeId,
			employeeName: null,
			locationLabel: location ? (MRO_LOCATION_LABELS[location] ?? location) : null,
			treadMm,
			psi,
			condition: null,
			referenceTreadMm,
		});
	}
	return cards;
}

/** The register projection — every column a register card reads (both m2o FKs
 *  requested so the API may expand them; a bare id resolves via the lookups). */
const UNIT_FIELDS = ['id', 'serial_no', 'status', 'vehicle', 'slot', 'employee', 'location', 'model', 'tread_mm', 'psi'] as const;

/**
 * The serial search — a server-side `?search=` read across the unit's text
 * fields (its serial number), mapped to the SAME card shape the rest of the
 * module renders (live snapshot + plate + SKU name) so a lookup result is
 * indistinguishable from a fitment-board tyre.
 */
export async function fetchTyresSearch(lookups: TyreLookups, query: string): Promise<TyreCardModel[]> {
	const res = await ops.items('mro_stock_serials').list({
		fields: UNIT_FIELDS,
		search: query,
		limit: SEARCH_LIMIT,
	});
	return tyreUnitsOf(res.data, lookups);
}

/**
 * Read ONE serial unit by its `mro_stock_serials` id — the serial detail page's
 * authoritative snapshot (`/app/tyres/tyre/:id`, reached cold on a deep link /
 * reload where only the id is known). The same generic entity single-read
 * (`GET /entities/mro_stock_serials/:id` with the register projection) feeds
 * the SAME `tyreUnitsOf` card build as the search list, so a detail-page header
 * is indistinguishable from the searched tyre that opened it. Throws when the
 * unit cannot be read; returns null when the row is not a serial-tracked tyre.
 */
export async function fetchTyreUnit(lookups: TyreLookups, id: string): Promise<TyreCardModel | null> {
	const row = await ops.items('mro_stock_serials').get(id, { fields: UNIT_FIELDS });
	return tyreUnitsOf([row], lookups)[0] ?? null;
}

/**
 * ONE holder's ASSET REGISTER — tyres AND `assets`-flagged items (a jack, a
 * toolbox), `GET /api/mro/assets/holder`. The ONE server-scoped, display-ready
 * read: the holder is DERIVED server-side (employee ? person : vehicle ?
 * truck+slot : store) and every card carries its SKU, item-name pair, plate,
 * custodian + live readings, so the client never walks the register or joins the
 * masters. `kind` splits tyres from assets without a second read. Omit the holder
 * for every held asset across the fleet (the fitment board's mounted set).
 */
export async function fetchHolderAssets(holder: { vehicle?: string | null; employee?: string | null } = {}): Promise<TyreCardModel[]> {
	const { rows } = await mroApi.holderAssets(holder);
	return rows.map((unit) => ({
		id: unit.id,
		kind: unit.kind,
		modelName: unit.model_name?.trim() || null,
		imageUrl: unit.model_image?.trim() || null,
		serialNo: unit.serial_no?.trim() || null,
		status: tyreStatusOf(unit.status),
		itemNameEn: unit.item_name_en?.trim() || null,
		itemNameMm: unit.item_name_mm?.trim() || null,
		plateNo: unit.plate_no?.trim() || null,
		slot: unit.slot?.trim() || null,
		employeeId: unit.employee?.trim() || null,
		employeeName: unit.employee_name?.trim() || null,
		locationLabel: unit.location ? (MRO_LOCATION_LABELS[unit.location] ?? unit.location) : null,
		treadMm: unit.tread_mm == null ? null : Number(unit.tread_mm),
		psi: unit.psi == null ? null : Number(unit.psi),
		condition: unit.condition?.trim() || null,
		referenceTreadMm: unit.reference_tread_mm == null ? null : Number(unit.reference_tread_mm),
	}));
}

/**
 * Every serial TYRE currently SEATED on a wheel — the fitment board's data. A
 * server-scoped selector over the one holder read (`fetchHolderAssets`): only
 * issued, tyres (kind) with a wheel slot and a resolved plate. Optional
 * `vehicleId` scopes it to ONE truck; omitted, it is the whole fleet (the move
 * picker's occupied-seat map — a swap never needs one, it stays on its truck).
 * Stored tyres and tyres that are not on a wheel never qualify.
 */
export async function fetchMountedTyres(vehicleId?: string | null): Promise<TyreCardModel[]> {
	const assets = await fetchHolderAssets(vehicleId ? { vehicle: vehicleId } : {});
	return assets.filter((unit) => unit.kind === 'tyre' && unit.slot != null && unit.plateNo != null);
}

// ── Serial lifecycle timeline (the serial detail page) ───────────────────────

/**
 * Every lifecycle event's leading copy — the timeline's TITLE.
 *
 * Burmese, deliberately: this list is the store floor's own record of a unit, read
 * at a glance ("where has this tyre been"), so the labels are the operator's
 * language while the engine identifiers stay one level down (the canonical kind set
 * is `mro_serial_events.event` in schema-defs.json).
 *
 * A `Record<TyreEventKind, string>` rather than a `switch` for two reasons: the
 * mapping is EXHAUSTIVE BY CONSTRUCTION (a new kind that reaches this module is a
 * COMPILE error here, never a silently label-less row), and the map IS the runtime
 * kind set (`isTyreEventKind` reads its keys), so the union, the label and the guard
 * can never drift apart.
 */
export const TYRE_EVENT_LABELS: Record<TyreEventKind, string> = {
	purchased: 'စတိုသို့ရောက်ရှိ',
	returned: 'စတိုသို့ပြန်ပို့',
	issued: 'ဝန်ထမ်းသို့ပစည်းထုတ်ပေး',
	reissued: 'အခြားတစ်ဦးထံ ပစ္စည်းလွဲပြောင်း',
	fitted: 'ပစ္စည်းထုတ်ယူ',
	store_transferred: 'အခြား စတိုသို့ လွဲပြောင်းခြင်း',
	rotated: 'ကားတွင်း နေရာရွှေ့',
	refitted: 'အခြားကားသို့ ပြောင်းရွေ့',
	unseated: 'ကားတွင် ခနဖြုတ်သိမ်း',
	written_off: 'စွန့်ပစ် / ဖျက်သိမ်း',
	adjusted: 'စာရင်းညှိ ပယ်ဖျက်',
	checked: 'တိုင်းတာစစ်ဆေးခြင်း',
};

/** The run-time kind set — the label map's own keys, so the guard cannot list a kind
 *  the union does not have (or miss one it does). */
const TYRE_EVENT_KINDS = Object.keys(TYRE_EVENT_LABELS) as readonly string[];

function isTyreEventKind(value: string | null | undefined): value is TyreEventKind {
	return !!value && TYRE_EVENT_KINDS.includes(value);
}

/** A seat-less `fitted` is a PLACEMENT ON THE TRUCK — the unit rides it but is not
 *  yet on a wheel — so it must NOT read as a wheel fit. Same title slot, so it
 *  carries the same language. */
const TRAY_FITTED_LABEL = 'ကားတွင် ဖြုတ်သိမ်း';

function refsOf(fk: TyreEventRow['from_vehicle'] | TyreEventRow['to_vehicle']): { id: string | null; plate: string | null } {
	if (fk && typeof fk === 'object') return { id: fk.id, plate: fk.plate_no?.trim() || null };
	return { id: typeof fk === 'string' ? fk : null, plate: null };
}

/** The person a from/to employee m2o resolves to — the custodian display name. */
function empNameOf(fk: TyreEventRow['from_employee'] | TyreEventRow['to_employee'] | TyreEventRow['approved_by']): string | null {
	if (fk && typeof fk === 'object') return fk.name_en?.trim() || fk.name_mm?.trim() || null;
	return null;
}

/** The person a `by_user` / `approved_by` m2o resolves to — a display name plus the
 *  directory photo. `null` when the row names nobody (a kiosk action from a
 *  controller-less session, an inbound receipt) or the referenced employee is gone,
 *  so the caller can fall back to its next candidate instead of rendering a nameless
 *  person. A photo-less employee still yields their NAME — they acted, we just
 *  cannot picture them. */
function personOf(fk: TyreEventRow['by_user'] | TyreEventRow['approved_by']): { name: string; photo: string | null } | null {
	if (!fk || typeof fk !== 'object') return null;
	const name = fk.name_en?.trim() || fk.name_mm?.trim() || null;
	if (!name) return null;
	return { name, photo: fk.avatar?.trim() || null };
}

/** Two-letter monogram for a person the directory cannot picture — "U Hla Tun" →
 *  "UH", the same shape the projects module's assignee avatars use. Burmese names
 *  are usually one unspaced token, so this often lands on a SINGLE glyph, which is
 *  exactly right: one letter still names the person, whereas the event's abstract
 *  icon is identical on every row of that kind and therefore names nobody. */
function monogramOf(name: string): string {
	return (
		name
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('') || '?'
	);
}

/** The row's leading PERSON, chosen ONCE: the actor when the directory can picture
 *  them, else the approver when it can, else whichever of the two the row actually
 *  has — a photo-less name still beats an abstract glyph, because the slot is there
 *  to say WHO. `null` only when nobody is on the row at all (a kiosk action, an
 *  inbound receipt), which is the one case the event glyph is the honest answer.
 *
 *  Decided HERE rather than in JSX, so the priority is unit-testable and the name can
 *  never drift from the photo (or the monogram) that labels it. */
function faceOf(
	actor: { name: string; photo: string | null } | null,
	approver: { name: string; photo: string | null } | null,
): { name: string; photo: string | null; monogram: string } | null {
	const pictured = (actor?.photo ? actor : null) ?? (approver?.photo ? approver : null);
	const person = pictured ?? actor ?? approver;
	return person ? { name: person.name, photo: person.photo, monogram: monogramOf(person.name) } : null;
}

function placeLabel(value: string | null | undefined): string | null {
	return value ? (MRO_LOCATION_LABELS[value] ?? value) : null;
}

/** The calendar day of a timestamp (`YYYY-MM-DD`) — null when it is unparseable. */
function dayOf(value: string | null | undefined): string | null {
	const raw = value?.trim() ?? '';
	return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

/**
 * The DAY a lifecycle row TOOK EFFECT — the calendar date the row prints, and the
 * date everything about the row is measured against.
 *
 * `event_date` is the row's effective day, resolved by the API for every event:
 * the operator's chosen PHYSICAL wear day for a back-dated fit/un-seat; otherwise the
 * date of the DOCUMENT that authorised the movement (a receipt's `purchase_date`, an
 * issue's `effective_date`, a transfer's `transfer_date`, an adjustment's
 * `adjustment_date`) — stock bought in June and booked in today took effect in JUNE;
 * and otherwise the day the row was recorded (a kiosk chore, an inspection, an ATR
 * execution happen when they happen). The local fallback to `created_at` is for a row
 * that predates the field (or a fixture) — never for "no date at all".
 */
export function effectiveDateOf(row: Pick<TyreEventRow, 'event_date' | 'created_at'>): string | null {
	return dayOf(row.event_date) ?? dayOf(row.created_at);
}

/**
 * The moment a lifecycle row is AGED (and ordered) from — its EFFECTIVE date, never
 * the time the row was recorded.
 *
 * A day alone cannot say WHEN inside that day, so:
 *
 *   · the effective day IS the day the row was recorded ⇒ `created_at` is that same
 *     moment with its time, and it is used (so today's rows keep minute precision —
 *     "5 min ago", not "12 hrs ago" from midnight);
 *   · the effective day differs (a back-dated wear, a document dated earlier) ⇒ the
 *     effective day wins, so a wear dated last month ages from last month.
 *
 * A row with neither date falls back to whichever of the two it has — never to nothing.
 */
export function effectiveAtOf(row: Pick<TyreEventRow, 'event_date' | 'created_at'>): string | null {
	const created = row.created_at?.trim() || null;
	const effective = effectiveDateOf(row);
	if (!effective) return created;
	return created && dayOf(created) === effective ? created : effective;
}

/** The detail copy for one event — a short title + compact subtitle of where it
 *  moved (store / vehicle + slot / employee) + its source document / age. */
function eventLineOf(row: TyreEventRow): TyreEventLine | null {
	const kind = isTyreEventKind(row.event) ? row.event : null;
	if (!kind) return null;

	const fromVeh = kind === 'rotated' || kind === 'refitted' || kind === 'unseated' ? refsOf(row.from_vehicle) : { id: null, plate: null };
	const toVeh = kind === 'fitted' || kind === 'rotated' || kind === 'refitted' ? refsOf(row.to_vehicle) : { id: null, plate: null };
	const fromEmp = kind === 'issued' || kind === 'reissued' || kind === 'fitted' ? empNameOf(row.from_employee) : null;
	const toEmp = kind === 'issued' || kind === 'reissued' ? empNameOf(row.to_employee) : null;
	const fromLoc = kind === 'returned' || kind === 'store_transferred' || kind === 'issued' ? placeLabel(row.from_location) : null;
	const toLoc = kind === 'purchased' || kind === 'returned' || kind === 'store_transferred' ? placeLabel(row.to_location) : null;
	const fromSlot = row.from_slot?.trim() || null;
	const toSlot = row.to_slot?.trim() || null;

	const fromPlace = fromVeh.plate ? `${fromVeh.plate}${fromSlot ? ` · ${fromSlot}` : ''}` : (fromEmp ?? fromLoc);
	const toPlace = toVeh.plate ? `${toVeh.plate}${toSlot ? ` · ${toSlot}` : ''}` : (toEmp ?? toLoc);

	let detail: string;
	// An unseat keeps the unit on the SAME truck — it is simply no longer ON a wheel.
	// The vocabulary is deliberate and closed: a tyre is ON A WHEEL or NOT YET on one
	// ("spare" is not a state this module says — it names a stockroom, not a wheel).
	if (kind === 'unseated' && fromVeh.plate) {
		detail = `${fromPlace} → not on a wheel`;
	} else if (fromPlace && toPlace) {
		detail = `${fromPlace} → ${toPlace}`;
	} else if (toPlace) {
		detail = toPlace;
	} else if (fromPlace) {
		detail = `from ${fromPlace}`;
	} else {
		detail = '';
	}

	const reference = row.ref_doc?.trim() || null;
	const readingIsChecked = kind === 'checked' && (row.tread_mm != null || row.psi != null || row.condition != null);
	const actor = personOf(row.by_user);
	const approver = personOf(row.approved_by);
	return {
		id: row.id,
		kind,
		// A seat-less `fitted` is a PLACEMENT ON THE TRUCK (the unit rides it, not yet on a
		// wheel) — never narrate it as a wheel fit.
		title: kind === 'fitted' && !toSlot && toVeh.plate ? TRAY_FITTED_LABEL : TYRE_EVENT_LABELS[kind],
		// WHO and by whose authority: the actor is the row's identity, the approver
		// its lineage. Both are read as PRESENT-OR-ABSENT — an event that recorded no
		// actor, or that no document authorised (a kiosk fit, an inbound receipt),
		// renders no name rather than a placeholder that would imply one. Both are
		// PICTS as well as names, and `faceOf` picks which of the two fronts the row.
		actor,
		approvedBy: approver?.name ?? null,
		// The row's RIGHT half — the other PERSON on it, or nobody: ONE rule in
		// `data/labels.ts` (an approval outranks a hand-off; a row whose movement
		// carried nobody but its reporter renders no right-hand side at all).
		party: eventPartyOf({
			kind,
			reporter: actor?.name ?? null,
			approvedBy: approver?.name ?? null,
			handedTo: toEmp,
		}),
		face: faceOf(actor, approver),
		detail,
		reference,
		treadMm: readingIsChecked ? (row.tread_mm == null ? null : Number(row.tread_mm)) : null,
		psi: readingIsChecked ? (row.psi == null ? null : Number(row.psi)) : null,
		condition: readingIsChecked ? row.condition?.trim() || null : null,
		// The day the transition TOOK EFFECT — what the row PRINTS. Resolved by the API
		// per event (the operator's back-dated wear day, else the governing document's
		// own date, else the day it was recorded), so the timeline shows a receipt for
		// June stock as June rather than the day someone typed it in.
		effectiveDate: effectiveDateOf(row),
		// …and the moment the row is AGED from: the effective day at the finest
		// precision it carries (`effectiveAtOf`), so the date a row prints, the age
		// beside it and the order it sits in are ONE fact, never three.
		timestamp: effectiveAtOf(row),
	};
}

/** Read the ONE serial unit's immutable lifecycle history from the dedicated
 *  `/api/mro/serials/:id/events` read (a direct D1 query joining vehicle + actor
 *  display fields). The page renders the array AS IT ARRIVES, so the order it
 *  arrives in IS the page's order: NEWEST FIRST, by the timestamp each row
 *  displays — a back-dated fit/un-seat is ordered by its physical `event_date`
 *  (`eventLineOf` prints that too), with the append order breaking a
 *  same-millisecond tie (one confirm writes several events at once). This
 *  deliberately does NOT go through the SDK's filtered entity-list, because the
 *  generic `?filter=` is IGNORED for these service-owned MRO tables and would
 *  silently return OTHER tyres' history. A serial with no history returns an
 *  EMPTY array (the page shows an empty-history state), not an error. */
export async function fetchTyreEvents(serialId: string): Promise<TyreEventLine[]> {
	const { rows } = await mroApi.serialEvents(serialId);
	const lines: TyreEventLine[] = [];
	for (const unsafe of rows) {
		const line = eventLineOf(unsafe as unknown as TyreEventRow);
		if (line) lines.push(line);
	}
	return lines;
}

// ── Slice B: record a REAL inspection (the reading is a measurement) ─────────

/**
 * The result of a recorded inspection — the live snapshot the caller can use to
 * confirm the just-measured reading landed (fetchTyreEvents/register refetch the
 * truth directly).
 */
export interface TyreCheckResult {
	serialId: string;
	serial_no: string | null;
	event: 'checked';
	tread_mm?: number | null;
	psi?: number | null;
	condition?: string | null;
}

/**
 * Record ONE tyre tread inspection on an issued serial unit through the real
 * engine route (`POST /api/mro/serials/:id/check`). `actorId` is the acting
 * technician (`hrm_employees` id) — resolved from the session by
 * `fetchCurrentEmployee()` by the caller, sent as `actor_id`. The measured tread
 * is CAPPED at the SKU's `reference_tread_mm` (the engine rejects a thicker
 * reading — a tyre is never thicker than brand new). Guards (non-issued / moved /
 * empty reading) bubble up as clear errors that the detail page surfaces. This is
 * the ONLY writer for a Slice-B wear reading — never a screen PATCH of the live
 * `tread_mm`. Pressure is not part of a tread check, so no `psi` is ever sent.
 */
export async function recordTyreCheck(
	serialId: string,
	input: { actorId?: string; treadMm?: number | null; condition?: string | null; note?: string },
): Promise<TyreCheckResult> {
	return mroApi.recordSerialCheck(serialId, input) as Promise<TyreCheckResult>;
}

// ── Move an issued asset between holders (rotate / refit / issue / reassign) ───

/** The result of a holder move — the new live holder the caller can rely on. */
export interface TyrePositionResult {
	serialId: string;
	serial_no: string | null;
	vehicle: string | null;
	slot: string | null;
	employee: string | null;
	event: 'rotated' | 'refitted' | 'fitted' | 'issued' | 'reissued';
}

/**
 * Move an ALREADY-ISSUED tyre to another FREE SEAT ON ITS OWN TRUCK through the
 * real engine route (`POST /api/mro/serials/:id/move`) — a `rotated` rotation.
 *
 * SAME HOLDER ONLY. The raw `/move` route carries no custody authorization, so a
 * move that CHANGES the holder (truck→truck, truck↔person) is refused (403) by
 * `assertCustodyChangeAllowed`: those are the transfer filer's job
 * (`TransferRequestSection`), performed later by an approved request's execute.
 * The caller therefore offers ONLY `freeFitmentTargets(...).filter((t) =>
 * t.sameVehicle)` — offering another truck's seat here would be a dead button.
 * Guards (not-issued / missing target / concurrent move) bubble up verbatim.
 */
export async function moveTyrePosition(
	serialId: string,
	input: { actorId?: string; toVehicle?: string | null; toSlot?: string | null; toEmployee?: string | null; note?: string },
): Promise<TyrePositionResult> {
	return mroApi.moveSerial(serialId, input) as Promise<TyrePositionResult>;
}

/**
 * Issue an in-store / loose asset into an EMPLOYEE's custody through the real
 * engine route (`POST /api/mro/serials/:id/issue`). An `in_stock` unit leaves its
 * store's balance; a loose issued unit just binds to the person. A unit on a
 * truck must be moved off first (`moveTyrePosition`). The acting storekeeper is
 * attributed via `actorId`.
 */
export async function issueAsset(
	serialId: string,
	input: { actorId?: string; toEmployee: string; note?: string },
): Promise<{ serialId: string; serial_no: string; employee: string; event: 'issued'; from_status: string }> {
	return mroApi.issueSerial(serialId, input) as Promise<{
		serialId: string;
		serial_no: string;
		employee: string;
		event: 'issued';
		from_status: string;
	}>;
}

/** One selectable destination for a `rotate`/`refit` move. */
export interface FitmentTarget {
	/** Destination vehicle (`veh_fleets.id`). */
	vehicleId: string;
	/** Destination vehicle plate — the option's label. */
	plateNo: string;
	/** Destination seat id (the serial's stored `slot`), e.g. "steer-l". */
	slotId: string;
	/** Destination seat label, e.g. "Steer Right". */
	slotLabel: string;
	/** True when moving within the SAME vehicle already seated (a `rotated` swap). */
	sameVehicle: boolean;
}

/**
 * Enumerate every FREE seat a seated tyre could occupy across the fleet — occupied
 * seats come from the live mounted cards, and the tyre's own current (vehicle, slot)
 * is excluded. Sorted most-useful-first, so `sameVehicle` entries lead.
 *
 * This is the RAW enumeration, NOT one writer's option list: each caller keeps the
 * rule its verb obeys. The DIRECT `moveTyrePosition` keeps only `sameVehicle`
 * targets — a seat change that keeps the truck keeps the HOLDER, which is the only
 * move the raw `/move` route authorizes — while the transfer FILER is what offers
 * the cross-truck ones (the filer, not this helper, decides that). No `wheel_slots`
 * → the unit-type seat plan is used (mirrors the board).
 */
export function freeFitmentTargets(
	current: Pick<TyreCardModel, 'plateNo' | 'slot'>,
	vehicles: VehicleMasterRow[],
	mounted: TyreCardModel[],
): FitmentTarget[] {
	// plateNo + slot → which seats are already claimed by OTHER mounted serials.
	const occupied = new Set<string>(
		mounted.map((t) => (t.plateNo && t.slot ? `${t.plateNo}::${t.slot}` : null)).filter((s): s is string => Boolean(s)),
	);
	// The current (plate, slot) the tyre sits on — excluded from its own targets.
	const ownKey = current.plateNo && current.slot ? `${current.plateNo}::${current.slot}` : '';

	const targets: FitmentTarget[] = [];
	for (const v of vehicles) {
		const plate = v.plate_no?.trim();
		if (!plate) continue;
		// Only wheel-capable trucks can seat a tyre — the board's scope rule.
		if (!vehicleCarriesTyres(v)) continue;
		const seats = wheelSlotsOfVehicle(v.wheel_slots, v.wheel, v.unit_type);
		for (const seat of seats) {
			const key = `${plate}::${seat.id}`;
			// Skip the seat this tyre currently holds + any seat already filled.
			if (key === ownKey) continue;
			if (occupied.has(key)) continue;
			targets.push({
				vehicleId: v.id,
				plateNo: plate,
				slotId: seat.id,
				slotLabel: seat.label,
				sameVehicle: plate === current.plateNo,
			});
		}
	}
	// Most useful first: same-truck free seats, then the other trucks alphabetically.
	targets.sort((a, b) => {
		if (a.sameVehicle !== b.sameVehicle) return a.sameVehicle ? -1 : 1;
		return a.plateNo === b.plateNo ? a.slotLabel.localeCompare(b.slotLabel) : a.plateNo.localeCompare(b.plateNo);
	});
	return targets;
}

// ── Kiosk chore — the fitment board's tap-to-act writers ────────────────────
// These mirror the wheel-plan management actions on `/app/tyres/vehicle/:id`:
// seat an un-worn tyre on a VACANT wheel (fit), return a seated tyre to a store,
// write a seated tyre off, and swap two seated tyres ON THE SAME TRUCK (a
// `rotated` rotation — a cross-truck move is an approval-gated transfer
// request). Every writer appends an immutable `mro_serial_events` row, so the
// serial full page keeps narrating the whole lifecycle no matter which board
// gesture started the change.

/** Fit one serial tyre onto a VACANT wheel position. `toVehicle` is the target
 *  `veh_fleets.id`, `toSlot` its declared seat id (the seat the board drew). A
 *  tyre reaches a truck's un-worn tray by being taken OFF a wheel
 *  (`unseatTyreToTray`), never by a fit with no seat — store stock arrives through
 *  the requisition the truck raises, so this writer always names a wheel. */
export async function fitTyreToSeat(
	serialId: string,
	input: { actorId?: string; toVehicle: string; toSlot: string; note?: string; eventDate?: string | null },
): Promise<{ serialId: string; serial_no: string; vehicle: string; slot: string | null; event: 'fitted'; from_status: string }> {
	return mroApi.fitSerial(serialId, input) as Promise<{
		serialId: string;
		serial_no: string;
		vehicle: string;
		slot: string | null;
		event: 'fitted';
		from_status: string;
	}>;
}

/** Take a SEATED tyre off its wheel and keep it on the SAME truck, off every
 *  wheel — the wheel-plan's "take it off the wheel (not on a wheel)" writer. It stays
 *  issued and truck-bound; only the wheel slot clears (it now lives in the truck's
 *  inventory tray), and an immutable `unseated` history row is appended. */
export async function unseatTyreToTray(
	serialId: string,
	input: { actorId?: string; note?: string; eventDate?: string | null },
): Promise<{ serialId: string; serial_no: string; vehicle: string; slot: null; event: 'unseated' }> {
	return mroApi.unseatSerial(serialId, input) as Promise<{
		serialId: string;
		serial_no: string;
		vehicle: string;
		slot: null;
		event: 'unseated';
	}>;
}

/** Unmount a seated tyre back into a store (defaults to the vehicle store). */
export async function returnTyreToStore(
	serialId: string,
	input: { actorId?: string; toLocation?: string; note?: string },
): Promise<{ serialId: string; serial_no: string; event: 'returned'; to_location: string }> {
	return mroApi.returnSerial(serialId, input) as Promise<{
		serialId: string;
		serial_no: string;
		event: 'returned';
		to_location: string;
	}>;
}

/** Exchange TWO seated tyres on the SAME truck — a rotation: each takes the
 *  other's wheel slot and both log a `rotated` event. A cross-truck exchange is a
 *  400 (the board never offers one); moving a tyre onto another truck is the
 *  approval-gated transfer request instead. */
export async function swapTyreSeats(
	serialA: string,
	serialB: string,
	input: { actorId?: string; note?: string },
): Promise<{ event: 'rotated'; swapped: [string, string] }> {
	return mroApi.swapSerials({ serialA, serialB, ...input }) as Promise<{ event: 'rotated'; swapped: [string, string] }>;
}
