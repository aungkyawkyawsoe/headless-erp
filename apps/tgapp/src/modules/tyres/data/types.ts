/**
 * Row shapes for the MRO serial register consumed by the တာယာ (tyres) screen —
 * the per-unit serial lookup (`/app/tyres/serial`).
 *
 * The screen now reads REAL backend rows: `mro_stock_serials` (one row per
 * physical, serial-tracked unit of a `mro_item_model` SKU that represents a
 * tyre), joined to the `veh_fleets` plate for a mounted unit and to the shared
 * `['mro','item-models']` SKU directory for its model name + tread reference.
 *
 * Deliberately LOCAL interfaces (never `SchemaRow`): the generated headless
 * `Schema` knows no `mro_*` collections (it still describes the dead legacy
 * `vehicle_tyres` demo rows), so these are hand-declared against the verified
 * wire contract — exactly how the sibling MRO modules (store-requests,
 * items, inbounds…) type their reads.
 */

import type { MroLocation } from '@/shared/mro';
import type { TyreStatus } from './status';

/** An m2o FK arrives EITHER EXPANDED (the full related row) or as a bare id
 *  (older clients / plain reads) — the register normalizes both shapes. */
type M2o<T> = T | string | null;

/** `mro_stock_serials` — one physical serial-tracked unit behind a register
 *  card. `model` / `vehicle` are requested as m2o reads; the API may leave them
 *  bare ids that the page's master fetch resolves. */
export interface TyreUnitRow {
	id: string;
	/** The unit's serial number — the register's primary identity. */
	serial_no?: string | null;
	/** `in_stock` | `issued` | `scrapped` — the engine serial lifecycle. */
	status?: string | null;
	/** m2o to `mro_item_model` — the serial-tracked tyre SKU this unit is. */
	model?: M2o<{ id: string; name_en?: string | null; name_mm?: string | null }>;
	/** m2o to `veh_fleets` — the vehicle this unit is bound to (issued). */
	vehicle?: M2o<{ id: string; plate_no?: string | null }>;
	/** m2o to `hrm_employees` — the person holding the unit (issued to a person,
	 *  not fitted to a truck). Resolved so a serial page can name the CURRENT
	 *  holder when filing a transfer request. */
	employee?: M2o<{ id: string }>;
	/** The fitting slot on that vehicle (e.g. "steer-l" / "drive-2") — null when
	 *  the unit is not seated on a vehicle. */
	slot?: string | null;
	/** The store the unit physically sits in (`main_store` … `vehicle_store`). */
	location?: MroLocation | string | null;
	/** Latest measured tread depth (mm) from a `checked` inspection — null until
	 *  the first reading (Slice B). */
	tread_mm?: number | null;
	/** Latest measured pressure (psi) from a `checked` inspection — optional. */
	psi?: number | null;
}

/** `veh_fleets` (the SHARED vehicle master) — the plate a mounted unit joins to. */
export interface TyreVehicleRow {
	id: string;
	plate_no?: string | null;
}

/** Everything one register card renders — an asset unit (a tyre or any
 *  `assets`-flagged item) joined to its SKU, item-name master, holder and live
 *  readings. The holder is DERIVED: a truck (`plateNo` + `slot`) or an employee
 *  (`employeeId` + `employeeName`); a unit with neither is store stock. */
export interface TyreCardModel {
	/** `mro_stock_serials.id`. */
	id: string;
	/** `'tyre'` (a wheel unit) or `'asset'` (a jack, toolbox…) — splits the register
	 *  tabs server-side without a second read. */
	kind: 'tyre' | 'asset';
	/** The tyre SKU display name (`mro_item_model.name_en`) — null when unresolved. */
	modelName: string | null;
	/** The SKU's photo (`mro_item_model.image`, a `/api/media/<key>` URL) — null when
	 *  this SKU has no picture yet, in which case a card keeps its kind glyph.
	 *  Optional like the other report rows' `model_image`: every read that builds a
	 *  card resolves it, but a hand-built fixture need not carry a picture. */
	imageUrl?: string | null;
	/** The unit's serial number — null when unset. */
	serialNo: string | null;
	/** The unit's lifecycle (`in_stock` | `issued` | `scrapped`). */
	status: TyreStatus;
	/** The owning item-name master's bilingual display pair (`mro_item_name`). */
	itemNameEn: string | null;
	itemNameMm: string | null;
	/** The bound vehicle's plate — null when the unit is not on a truck. */
	plateNo: string | null;
	/** The fitting slot label on that vehicle — null when absent. */
	slot: string | null;
	/** The `hrm_employees` id holding the unit (person custody) — null otherwise. */
	employeeId: string | null;
	/** The custodian's display name — null when unset/not a person-held unit. */
	employeeName: string | null;
	/** The `MRO_LOCATION_LABELS` store label — null when the row's value is
	 *  unknown (raw string fallback). */
	locationLabel: string | null;
	/** Latest measured tread depth (mm) from a `checked` inspection — null until
	 *  the first reading (Slice B). */
	treadMm: number | null;
	/** Latest measured inflation pressure (psi) — optional, may be null. */
	psi: number | null;
	/** Latest graded wear/condition of ANY asset (`good` | `fair` | `poor` |
	 *  `damaged`) — null until the first inspection. */
	condition: string | null;
	/** This tyre SKU's NEW-tread baseline (mm) — derived from the catalog row
	 *  (`reference_tread_mm`) so a % remaining can be shown only when both sides
	 *  exist (a reading vs. a known reference). */
	referenceTreadMm: number | null;
}

/** `mro_serial_events` — ONE immutable lifecycle-history row for a serial unit.
 *  The tyre register card is its live snapshot (`mro_stock_serials`); tapping it
 *  shows these rows NEWEST-first as the tyre's timeline. The m2o columns arrive
 *  either EXPANDED or as bare ids — the detail page resolves ids via shared
 *  masters. */

export type TyreEventKind =
	| 'purchased'
	| 'returned'
	| 'fitted'
	| 'store_transferred'
	| 'rotated'
	| 'refitted'
	| 'unseated'
	| 'issued'
	| 'reissued'
	| 'written_off'
	| 'adjusted'
	| 'checked';

/** m2o FK — a related row may arrive expanded (`{ id, … }`) or as a bare id. */
type EvM2o<T> = T | string | null;

/** The `veh_fleets` plate + its fit slot reference on an event. */
interface TyreEventVehicleRef {
	id: string;
	/** plate_no (mapped at read time) — only present when expanded. */
	plate_no?: string | null;
}

/** An `hrm_employees` person ref that carries a DIRECTORY PHOTO — `by_user` (the
 *  actor) and `approved_by` (the document's approver). Both are read by the
 *  timeline's leading avatar slot, so both must state their photo; the
 *  name-only custodian refs below are never pictured. */
interface TyreEventActorRef {
	id: string;
	name_en?: string | null;
	name_mm?: string | null;
	/** The directory photo (`/api/media/<key>`) — absent for most staff, so the
	 *  timeline falls back to the row's NEXT picturable person, and only then to
	 *  the event's own glyph rather than a nameless person. */
	avatar?: string | null;
}

/** `hrm_employees` actor / custodian reference on an event (m2o). */
interface TyreEventEmployeeRef {
	id: string;
	name_en?: string | null;
	name_mm?: string | null;
}

/** One `mro_serial_events` row (the wire shape the detail page reads). */
export interface TyreEventRow {
	id: string;
	/** Serial-unit m2o — always expanded to the owning serial in the page's read. */
	serial?: EvM2o<{ id: string }>;
	/** The lifecycle event (`purchased` … `adjusted`). */
	event?: string | null;
	/** m2o → `veh_fleets` — the vehicle the unit left (rotate/refit/…). */
	from_vehicle?: EvM2o<TyreEventVehicleRef>;
	/** m2o → `veh_fleets` — the vehicle the unit arrived on. */
	to_vehicle?: EvM2o<TyreEventVehicleRef>;
	/** m2o → `hrm_employees` — the person the unit left (issue/reassign). */
	from_employee?: EvM2o<TyreEventEmployeeRef>;
	/** m2o → `hrm_employees` — the person the unit arrived with. */
	to_employee?: EvM2o<TyreEventEmployeeRef>;
	/** Free-text fit slot names on the from/to positions (e.g. "steer-l"). */
	from_slot?: string | null;
	to_slot?: string | null;
	/** `MRO_LOCATIONS` value — the store the unit left/arrived at. */
	from_location?: string | null;
	to_location?: string | null;
	/** Doc kind the event came from (`purchase`/`goods_issue`/`transfer`/…). */
	ref_kind?: string | null;
	/** The source doc's display number (`INB-…`, `OUT-…`, `TRF-…`, `AJT-…`). */
	ref_doc?: string | null;
	/** m2o → `hrm_employees` — who performed the change.
	 *  NOTE: the engine stores this as an m2o but legacy/null rows may arrive as a
	 *  plain string id or a bare text — the page tolerates each shape. */
	by_user?: EvM2o<TyreEventActorRef>;
	/** m2o → `hrm_employees` — the approver of the DOCUMENT that authorised the
	 *  movement (the API resolves `ref_doc` ↔ `display_number` across the four doc
	 *  families that record one). Null for a kiosk action or an INB- receipt —
	 *  nobody approved those, and the page must not imply otherwise. */
	approved_by?: EvM2o<TyreEventActorRef>;
	/** The physical day a back-dated fit/un-seat happened (`YYYY-MM-DD`) — empty
	 *  for every other event, whose history date falls back to `created_at`. */
	event_date?: string | null;
	/** Measured tread depth (mm) carried by a `checked` inspection event. */
	tread_mm?: number | null;
	/** Measured inflation pressure (psi) carried by a `checked` inspection event. */
	psi?: number | null;
	/** Graded wear/condition carried by a `checked` inspection event. */
	condition?: string | null;
	note?: string | null;
	/** Engine timestamps. */
	created_at?: string | null;
}

/** The row's OTHER half — the other PERSON on the movement: who approved it, or who
 *  it was handed to. Resolved once at the data layer (`eventPartyOf`) so the row
 *  never invents wording per event kind, and `null` whenever the row carries nobody
 *  but its reporter (the common case — a kiosk fit, an inspection, a receipt). */
export interface TyreEventParty {
	/** The verb that ties the name to the movement — `Approved by` / `Issued to`. */
	label: string;
	name: string;
}

/** The tyre detail page's ONE event column — already resolved to display copy. */
export interface TyreEventLine {
	id: string;
	/** Which event — drives the icon + copy. */
	kind: TyreEventKind;
	/** The page's leading human label — Burmese, the operator's language (e.g.
	 *  "ပစ္စည်းထုတ်ယူ" for a wheel fit); the map that produces it is
	 *  `TYRE_EVENT_LABELS` in `data/api.ts`. */
	title: string;
	/** Who PERFORMED it (`by_user`) — the row's leading avatar, and the name that
	 *  rides beside the movement. `null` when the writer recorded no actor (a
	 *  kiosk action from a controller-less session, an inbound receipt), in which
	 *  case the row keeps its event-kind glyph instead of a nameless person. */
	actor: { name: string; photo: string | null } | null;
	/** The approver of the source document — the row's data lineage. `null`
	 *  whenever no document authorised the movement (see `approved_by` on the row),
	 *  so an approval line appears only where an approval really happened. */
	approvedBy: string | null;
	/** The PERSON the unit was handed to, when the event was one (`issued` /
	 *  `reissued`) — the row's other party after the reporter. The label is resolved
	 *  here so the row never invents wording per event kind; a movement to a TRUCK
	 *  carries none (a plate is not a person — it is already on the detail line). */
	/** The row's OTHER half — the person who approved it, or the person it was handed
	 *  to (`eventPartyOf` in `data/labels.ts` owns the precedence; the row merely
	 *  renders what it gets). `null` when nobody but the reporter is on the row. */
	party: TyreEventParty | null;
	/** The row's leading avatar — WHOSE face, decided ONCE here rather than in JSX.
	 *  The actor when the directory has a photo for them (who did the thing IS the
	 *  row's identity), else the approver when it has one, else whichever of the two
	 *  the row HAS — a photo-less person still gets their `monogram`, which names them,
	 *  where the event glyph would say nothing. `null` only when nobody is on the row
	 *  (a kiosk action, an inbound receipt), and the component then keeps that glyph.
	 *  Name, photo and monogram travel TOGETHER so the image's alt text can never name
	 *  the wrong person — the one bug a bare photo string would invite. */
	face: { name: string; photo: string | null; monogram: string } | null;
	/** A compact subtitle: the store/vehicle/person it moved between (with slot). */
	detail: string;
	/** The source document (`INB-00001`) or serial when nothing else applies. */
	reference: string | null;
	/** Measured tread depth (mm) from a `checked` reading, when this event was one. */
	treadMm: number | null;
	/** Measured inflation pressure (psi) from a `checked` reading, when present. */
	psi: number | null;
	/** Graded condition from a `checked` reading, when present. */
	condition: string | null;
	/** The EFFECTIVE date of the transition (`YYYY-MM-DD`) — the day it took effect,
	 *  which is the day the row PRINTS. The API resolves it for every event: the
	 *  operator's chosen physical wear day for a back-dated fit/un-seat, else the
	 *  governing document's own date (a receipt's `purchase_date`, an issue's
	 *  `effective_date`, a transfer's `transfer_date`, an adjustment's
	 *  `adjustment_date`), else the day it was recorded. `null` only for a row with
	 *  neither an effective date nor a record time. */
	effectiveDate: string | null;
	/** The moment the row is AGED from — the effective date at the finest precision
	 *  it carries: the recorded instant when the effective day IS the record day (so
	 *  today's rows read "5 min ago", not "12 hrs ago"), else the effective day
	 *  itself, so a back-dated wear ages from its own date. `data/api.ts`'s
	 *  `effectiveAtOf` is the ONE rule; a row's order and its age always agree. */
	timestamp: string | null;
}
