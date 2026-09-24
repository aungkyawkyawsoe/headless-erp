/**
 * MRO mini-app shared layer — the raw `/api/mro/*` endpoints (confirm actions,
 * on-hand report, expiry feed) plus the label maps every MRO screen shares.
 *
 * The engine's MRO confirm/report routes are NOT entity CRUD, so they go
 * through a small authed fetch (same Bearer token as the app-wide SDK —
 * `shared/auth`), NOT the SDK client. Draft documents, edits and cancels are
 * plain entity operations through `@/shared/api/sdk` with the per-module
 * local-cast pattern (see `modules/store-requests/data/api.ts`).
 */
import { getToken } from './auth';

// ── Locations (store names render in ENGLISH across the MRO layouts) ────────
export const MRO_LOCATIONS = [
	{ value: 'main_store', label: 'Main store' },
	{ value: 'admin_store', label: 'Office store' },
	{ value: 'mandalay_store', label: 'Mandalay store' },
	{ value: 'safety_store', label: 'Safety store' },
	{ value: 'vehicle_store', label: 'Vehicle store' },
] as const;

export type MroLocation = (typeof MRO_LOCATIONS)[number]['value'];

/** Value → label — the whole app reads ONE map so sheet/card wording never drifts. */
export const MRO_LOCATION_LABELS: Record<string, string> = Object.fromEntries(
	MRO_LOCATIONS.map((location) => [location.value, location.label]),
);

// ── Tracking policies (the MRO SKU = `mro_item_model`) ─────────────────────
export const MRO_TRACKING = [
	{ value: 'standard', label: 'Standard — quantity' },
	{ value: 'batch', label: 'Batch — lot + expiry' },
	{ value: 'serial', label: 'Serial — one each' },
] as const;

export type MroTracking = (typeof MRO_TRACKING)[number]['value'];

/**
 * A SKU value as the TWO reads deliver it:
 *
 *  - the PICKER directory (`useMroItemModels`) lifts the policy onto a flat
 *    `tracking`;
 *  - an expanded `item_model` relation (a doc line read) cannot — the policy
 *    belongs to the item NAME, so it arrives nested as `item_name.tracking`.
 *
 * Both are accepted here so a consumer stays shape-agnostic.
 */
export interface MroTrackingCarrier {
	tracking?: string | null;
	item_name?: { tracking?: string | null } | null;
}

/** The SKU's stock policy — the flattened `tracking`, else the expanded item
 *  NAME's (`item_name.tracking`), else null when neither is present. */
export function trackingOfModel(model: MroTrackingCarrier | null | undefined): string | null {
	if (!model) return null;
	return model.tracking ?? model.item_name?.tracking ?? null;
}

/** The SKU's policy normalized to a known `MroTracking` — unknown/absent →
 *  `standard`, the same fallback the engine applies. */
export function policyOfModel(model: MroTrackingCarrier | null | undefined): MroTracking {
	const raw = trackingOfModel(model);
	return MRO_TRACKING.some((tracking) => tracking.value === raw) ? (raw as MroTracking) : 'standard';
}

/**
 * The item-model EDIT route — the ONE definition of "where the SKU's master is
 * edited" (`/app/items/:id/edit`). The catalog card's ⋮ menu and the stock lines
 * page's pencil both resolve it here, so the two can never drift apart.
 */
export const itemModelEditPath = (modelId: string): string => `/app/items/${modelId}/edit`;

/**
 * The SKU's STOCK route — the ONE definition of "where one item model's stock
 * lines are" (`/app/stocks/item/:modelId`): the stock app's cards, the dashboard's
 * on-hand rows and the item form's Balance action all resolve it here, so a tap
 * lands on the same page whichever screen it started from.
 */
export const stockItemPath = (modelId: string): string => `/app/stocks/item/${modelId}`;

export const MRO_TRACKING_LABELS: Record<string, string> = Object.fromEntries(
	MRO_TRACKING.map((tracking) => [tracking.value, tracking.label]),
);

// ── Document statuses (engine-native) ───────────────────────────────────────
export type MroDocStatus = 'draft' | 'confirmed' | 'cancelled';

export const MRO_DOC_STATUS_META: Record<MroDocStatus, { label: string; className: string }> = {
	draft: { label: 'Draft', className: 'bg-status-warning-soft text-status-warning' },
	confirmed: { label: 'Confirmed', className: 'bg-status-success-soft text-status-success' },
	cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
};

// ── Report rows ─────────────────────────────────────────────────────────────
export interface MroOnHandRow {
	id: string | null;
	model: string | null;
	model_name: string | null;
	/** The SKU's R2 photo (`mro_item_model.image`, a `/api/media/<key>` URL) — null
	 *  when the model has no picture yet (the card falls back to a package glyph). */
	model_image?: string | null;
	location: string;
	tracking: string;
	qty_on_hand: number;
	reorder_level: number | null;
	derived_qty: number | null;
	/** The expired slice of this (model, location) — physically present, never
	 *  issuable. Absent on legacy rows (treated as 0). */
	expired_qty?: number;
	drift: boolean;
	below_reorder: boolean;
	/** The model's part-group display name (English-first) so the stock cards can
	 *  show it WITHOUT a separate `mro_item_name` read. Null when unclassified. */
	group_name?: string | null;
	/** The item (group) name's Burmese label — the card's sub-line. Null when the
	 *  group has no `name_mm` (or the SKU is unclassified). */
	group_name_mm?: string | null;
	/** The model's top-level category id (`mro_item_categories`) — null when the
	 *  SKU is unclassified (its part-group has no category). */
	category?: string | null;
	/** The category's display name (English-first) — the funnel option label. */
	category_name?: string | null;
}

/**
 * The quantity physically ON HAND at one store: the server-derived total when it
 * derived one (batch/serial — `derived_qty`) and otherwise the stored balance (a
 * `standard` model's balance IS the truth).
 *
 * This INCLUDES the expired slice, which is why it — not `availableQtyOf` — is the
 * right basis for a REMOVAL that legitimately targets expired stock (a write-off or
 * a disposal).
 */
export function onHandQtyOf(row: Pick<MroOnHandRow, 'derived_qty' | 'qty_on_hand'>): number {
	return row.derived_qty ?? row.qty_on_hand ?? 0;
}

/**
 * The ISSUABLE quantity: on-hand minus the expired slice (expired stock is
 * physically present but can never be issued). This is the ONE definition of
 * "available" — the exact rule `/api/mro/stock/onhand` reports — so a picker, a
 * store request and the stock screen can never disagree about it.
 */
export function availableQtyOf(row: Pick<MroOnHandRow, 'derived_qty' | 'qty_on_hand' | 'expired_qty'>): number {
	return onHandQtyOf(row) - (row.expired_qty ?? 0);
}

/** Which quantity a caller means — the issuable one, or everything on hand. */
export type MroStockBasis = 'available' | 'onHand';

/**
 * `${model}|${location}` → the quantity, built from an on-hand report. ONE index
 * builder so every caller keys the lookup identically (the key format is an
 * implementation detail of the two helpers above, never of each screen).
 *
 * A row with no `model` (a deleted SKU master) is skipped — there is no id to
 * look it up by.
 */
export function mroStockIndexOf(rows: readonly MroOnHandRow[], basis: MroStockBasis): Map<string, number> {
	const map = new Map<string, number>();
	for (const row of rows) {
		if (!row.model) continue;
		map.set(`${row.model}|${row.location}`, basis === 'available' ? availableQtyOf(row) : onHandQtyOf(row));
	}
	return map;
}

/**
 * ONE SKU's stock composition — the read behind the stock item page
 * (`GET /api/mro/stock/items/:modelId`). Server-scoped (NOT the generic entity
 * API): `mro_stock_lots` is not in the Telegram role's config grant list, so a
 * generic read would 403 a real employee.
 *
 * `balances` always reflects the model's `mro_inventory` rows (including
 * ORPHAN locations — stock held with no balance row); `lots` is populated only
 * for `batch` models and `serials` only for `serial` models, so the client
 * renders what it is given and never re-derives the policy itself.
 */
export interface MroItemComposition {
	/** The SKU header — the bilingual name, the photo, the part-group and the
	 *  tracking policy. */
	model: {
		id: string;
		name_en: string | null;
		name_mm: string | null;
		/** The R2 photo (`/api/media/<key>`), or null when the SKU has none. */
		image: string | null;
		group_name: string | null;
		tracking: MroTracking;
	};
	totals: {
		/** Σ (`derived_qty` ?? `qty_on_hand`) across stores — never a drifted balance. */
		on_hand: number;
		/** The expired slice of the same sum (physically present, never available). */
		expired: number;
		any_below_reorder: boolean;
	};
	balances: MroCompositionBalance[];
	lots: MroCompositionLot[];
	serials: MroCompositionSerial[];
}

/** One store's balance within a composition — `derived_qty` is null for a
 *  `standard` model (its balance IS the truth) and a number for `batch`/`serial`.
 *  An ORPHAN location (stock with no balance row) arrives with `id: null`,
 *  `qty_on_hand: 0` and `drift` carrying the derived total. */
export interface MroCompositionBalance {
	id: string | null;
	location: string;
	qty_on_hand: number;
	derived_qty: number | null;
	expired_qty: number;
	reorder_level: number;
	/** `true` when the stored ledger disagrees with the derived total; a NUMBER
	 *  for an orphan row (there is no ledger to compare — the drift IS the total). */
	drift: boolean | number;
	below_reorder: boolean;
}

/** One active lot of a `batch` model, FEFO-ordered (soonest expiry first). */
export interface MroCompositionLot {
	id: string;
	location: string;
	batch_no: string | null;
	expiry_date: string | null;
	/** Whole days until `expiry_date` (negative when already expired); null when
	 *  the lot carries no expiry at all. */
	days_left: number | null;
	remaining_qty: number;
	expired: boolean;
}

/** One in-stock unit of a `serial` model, with its holder resolved server-side
 *  (plate + wheel slot for a truck, the employee's name for a person). */
export interface MroCompositionSerial {
	id: string;
	location: string;
	serial_no: string | null;
	/** `in_stock` | `issued` | `scrapped` (only `in_stock` units are returned here). */
	status: string | null;
	vehicle: string | null;
	plate_no: string | null;
	slot: string | null;
	employee: string | null;
	employee_name: string | null;
	tread_mm: number | null;
	psi: number | null;
	condition: string | null;
	expiry_date: string | null;
	/** Days until `expiry_date` (negative = past) — the SAME derivation the lot
	 *  rows carry, so a unit and a lot can never disagree about a date. Null when
	 *  the unit has no expiry. */
	days_left: number | null;
	/** `expiry_date` is in the past — the unit is physically here but unusable. */
	expired: boolean;
}

/** One item-group directory row — `GET /api/mro/catalog/groups`. A whole-set
 *  server-scoped read (masters are bounded): every `mro_item_name` master with
 *  at least one live SKU, plus its live-SKU count. Replaces the old client-side
 *  whole-`mro_item_model`-catalog walk the item-groups hub used to derive the
 *  same list. */
export interface MroCatalogGroupRow {
	id: string;
	/** The display fallback — the master's English name, then the Burmese one.
	 *  The free-text `name` column is gone, so the server derives this from
	 *  `name_en`/`name_mm` and the wire shape stays stable. */
	name: string | null;
	/** The master's English display name (`mro_item_name.name_en`). */
	name_en: string | null;
	/** The master's Myanmar display name (`mro_item_name.name_mm`). */
	name_mm: string | null;
	/** `standard` | `batch` | `serial` — the stock policy every SKU under this
	 *  master inherits. */
	tracking?: string | null;
	/** Live (non-deleted) SKUs under this master. */
	count: number;
	/** The parent category — the hub's nav groups the directory by these.
	 *  Null when the master is unclassified (rendered under "Uncategorized"). */
	category_id: string | null;
	category_name_en: string | null;
	category_name_mm: string | null;
}

export interface MroExpiryRow {
	id: string;
	model: string;
	model_name: string | null;
	location: string;
	kind: 'lot' | 'serial';
	ref: string;
	expiry_date: string;
	qty: number;
	days_left: number;
	model_alert_days: number | null;
	alert: boolean;
}

/** The serial-tracker row — a single `mro_stock_serials` unit with its current
 *  status + the doc that put it here. Returned by the raw `/api/mro/stock/
 *  serials?serial=…` route (a flat read with a single-row mode; the search-by-
 *  serial path returns ONE row for a unique unit, or `[]` for a never-issued
 *  number). */
export interface MroSerialRow {
	id: string;
	model: string | null;
	model_name: string | null;
	location: string;
	serial_no: string;
	/** `in_stock` | `issued` | `scrapped` — the engine's lifecycle (default: in_stock). */
	status: string | null;
	expiry_date: string | null;
	source_inbound: string | null;
	source_line: string | null;
	unit_cost: number | null;
	note: string | null;
}

/** One ASSET UNIT currently held somewhere — a tyre or any `assets`-flagged item
 *  name (a jack, a toolbox): `GET /api/mro/assets/holder`. The register's whole
 *  read, server-scoped to ONE holder (`?vehicle=` or `?employee=`) or every holder
 *  when neither is given. The plate, SKU name, item-name pair, custodian and live
 *  readings are resolved SERVER-SIDE — the client maps a display card directly and
 *  never walks the register or joins the masters. The holder is DERIVED server-side
 *  (employee ? person : vehicle ? truck+slot : store). */
export interface MroHolderAssetRow {
	id: string;
	serial_no: string | null;
	/** `in_stock` | `issued` | `scrapped` — the engine's lifecycle (default: in_stock). */
	status: string | null;
	/** The `mro_item_model` id this unit is. */
	model: string | null;
	/** `mro_item_model.name_en` — display-ready, no catalog read needed. */
	model_name: string | null;
	/** The SKU's R2 photo (`mro_item_model.image`, a `/api/media/<key>` URL) — null
	 *  when the model has no picture yet (the card falls back to its kind glyph). */
	model_image: string | null;
	/** The owning `mro_item_name` master id. */
	item_name: string | null;
	/** The item-name master's bilingual display pair. */
	item_name_en: string | null;
	item_name_mm: string | null;
	/** `'tyre'` when the SKU declares a new-tread baseline or the unit sits on a
	 *  wheel, else `'asset'` — lets a register split tabs without a second read. */
	kind: 'tyre' | 'asset';
	/** The `veh_fleets` id the unit is bound to (truck custody). */
	vehicle: string | null;
	/** The vehicle's `plate_no` — null when its fleet row is missing/deleted. */
	plate_no: string | null;
	/** The wheel position on that vehicle — null for a truck's standby spare. */
	slot: string | null;
	/** The `hrm_employees` id holding the unit (person custody) — null otherwise. */
	employee: string | null;
	/** `hrm_employees.name_en` — the custodian's display name. */
	employee_name: string | null;
	location: string | null;
	/** `mro_item_model.reference_tread_mm` — the new-tread baseline (mm). */
	reference_tread_mm: number | null;
	tread_mm: number | null;
	psi: number | null;
	/** Latest graded wear/condition (`good` | `fair` | `poor` | `damaged`). */
	condition: string | null;
	unit_cost: number | null;
}

export type MroDocKind = 'inbounds' | 'outbounds' | 'transfers' | 'adjustments' | 'requisitions';

/**
 * ONE row of the approver-scoped asset-transfer feed
 * (`GET /api/mro/asset-requests`) — the server resolves every m2o to its display
 * field (serial / both plates / both custodians / requester / decider), so the
 * approval card needs no client join. The scope is the SAME rule the decide
 * routes enforce: an admin sees all, anyone else sees only requests filed by
 * their recorded subordinates.
 */
export interface MroAssetRequestRow {
	id: string;
	/** `ATR-00007` — the document number the serial's lifecycle event cites. */
	display_number: string | null;
	/** `requested` | `approved` | `rejected` | `executed`. */
	status: string;
	serial: string | null;
	serial_no: string | null;
	from_vehicle: string | null;
	from_plate: string | null;
	from_slot: string | null;
	from_employee: string | null;
	from_employee_name: string | null;
	to_vehicle: string | null;
	to_plate: string | null;
	to_slot: string | null;
	to_employee: string | null;
	to_employee_name: string | null;
	/** The STORE a RETURN request sends the unit back to — set instead of
	 *  `to_vehicle`/`to_employee`, and the field that makes the request a return. */
	to_location: string | null;
	/** Set on a WRITE-OFF request — the unit is scrapped where it sits, so every
	 *  destination above is null and the execute performs the write-off. */
	write_off: boolean | null;
	requested_by: string | null;
	requested_by_name: string | null;
	approved_by: string | null;
	approved_by_name: string | null;
	approved_at: string | null;
	rejected_reason: string | null;
	executed_at: string | null;
	note: string | null;
	created_at: string | null;
}

export interface MroConfirmResult extends Record<string, unknown> {
	display_number?: string | null;
	doc_status?: string | null;
	already?: boolean;
	line_count?: number | null;
	total_qty?: number | null;
}

/**
 * The document families that have a cancel/reversal endpoint — the ONE cancel verb,
 * now covering all four stock documents. `MroDocKind` is the wider set of document
 * reads; this is the set a `/cancel` call is meaningful for.
 */
export type MroCancellableDocKind = 'inbounds' | 'outbounds' | 'transfers' | 'adjustments';

/** What `/cancel` answers: the document's real post-call state. `reversed` says the
 *  call actually put stock back (only ever true for a POSTED document), and
 *  `already` says this was a replay of an earlier cancellation. */
export interface MroCancelResult extends Record<string, unknown> {
	display_number?: string | null;
	doc_status?: string | null;
	/** The document was already cancelled — nothing was flipped or reversed. */
	already?: boolean;
	/** The stock effect was undone in this call (a POSTED document only). */
	reversed?: boolean;
	reversed_qty?: number | null;
	cancelled_at?: string | null;
	cancelled_by?: string | null;
}

/** A fresh `Idempotency-Key` (8-255 chars) — a UUID where available, else a
 *  timestamp+random fallback (the SDK's guarded pattern; a bare `crypto` global
 *  is not guaranteed outside a secure browser context). */
function newIdempotencyKey(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** The engine's success envelope is `{ success, data }`; errors `{ error }`.
 *
 * Every WRITE carries a Stripe-style `Idempotency-Key` (the MRO router already
 * mounts the idempotency middleware, so `POST`s are effectively one-shot): a
 * transport-level replay of the SAME request — a proxy/browser retry after a
 * dropped connection, or a future mutation-retry wrapper — is answered from the
 * cached 2xx instead of re-running the stock move. The key is generated once per
 * attempt; a caller that wants its OWN re-tap to dedupe passes a stable
 * `idempotencyKey`. Reads never carry one (the middleware ignores GETs anyway). */
async function mroFetch<T>(path: string, init?: RequestInit, options?: { idempotencyKey?: string }): Promise<T> {
	const token = getToken();
	const method = (init?.method ?? 'GET').toUpperCase();
	const isWrite = method !== 'GET' && method !== 'HEAD';
	const writeKey = isWrite ? (options?.idempotencyKey ?? newIdempotencyKey()) : null;
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...(token ? { Authorization: `Bearer ${token}` } : {}),
		...(writeKey ? { 'Idempotency-Key': writeKey } : {}),
	};
	const res = await fetch(`/api${path}`, {
		...init,
		headers: {
			...headers,
			...(init?.headers ?? {}),
		},
	});
	const body = (await res.json().catch(() => null)) as { success?: boolean; error?: string; data?: T } | null;
	if (!res.ok || body?.success === false) throw new Error(body?.error ?? `HTTP ${res.status}`);
	return body?.data as T;
}

/**
 * POST one raw MRO service route with auth + a fresh Idempotency-Key — the ONE
 * write helper for the small module-local confirm/approve/reject fetches
 * (adjustments, transfers, outbounds, requisitions). Each used to hand-roll the
 * same `getToken` + Content-Type + envelope-unwrap; they now differ only by
 * path + body, and every one inherits replay-safe writes (`mroFetch` keys the
 * POST). Unwraps `{ data }` and throws the engine error verbatim.
 */
export function postMro<T = unknown>(path: string, body?: Record<string, unknown>): Promise<T> {
	return mroFetch<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
}

/**
 * DELETE one raw MRO service route with auth + a fresh Idempotency-Key — the
 * removal twin of `postMro`, for the routes an operator role may reach WITHOUT the
 * generic `can_delete` grant (e.g. removing a mis-keyed receipt payment). A replay
 * — or a double tap — is answered from the cached 2xx, so the delete can never
 * land twice. Unwraps `{ data }` and throws the route's error verbatim.
 */
export function deleteMro<T = unknown>(path: string): Promise<T> {
	return mroFetch<T>(path, { method: 'DELETE' });
}

/** The /api/mro confirm + report routes — the ONLY raw endpoints the MRO UI needs. */
export const mroApi = {
	onhand: () => mroFetch<{ rows: MroOnHandRow[] }>('/mro/stock/onhand'),
	/** ONE SKU's stock composition — the read behind the stock item page
	 *  (`/app/stocks/item/:modelId`): every store's balance plus the policy's own
	 *  trace (a batch model's FEFO lots, a serial model's in-stock units with
	 *  their holder). Server-scoped on purpose — `mro_stock_lots` is NOT in the
	 *  Telegram role's config grant list, so a generic
	 *  `/api/entities/mro_stock_lots` read would 403 a real employee. 404s an
	 *  unknown/deleted model. */
	itemStock: (modelId: string, location?: string | null) =>
		mroFetch<MroItemComposition>(
			`/mro/stock/items/${encodeURIComponent(modelId)}${location ? `?location=${encodeURIComponent(location)}` : ''}`,
		),
	/** Expired + soon-to-expire lots/serials. Omitting `days` asks the server to
	 *  derive the horizon from the widest per-model `expiry_alert_days`, so a model
	 *  with a longer alert window is never missed by a blanket default. */
	expiring: (days?: number) =>
		mroFetch<{ days: number; expired: MroExpiryRow[]; expiring: MroExpiryRow[] }>(
			`/mro/stock/expiring${days == null ? '' : `?days=${days}`}`,
		),
	/** The item-group catalogue directory — every `mro_item_name` master that has
	 *  at least one live SKU, with its count (the item-groups hub's tab). One
	 *  aggregate read — never the whole-catalog walk the hub used to do. */
	catalogGroups: () => mroFetch<{ rows: MroCatalogGroupRow[] }>('/mro/catalog/groups'),
	confirm: (kind: MroDocKind, id: string) =>
		mroFetch<MroConfirmResult>(`/mro/${kind}/${id}/confirm`, { method: 'POST', body: JSON.stringify({}) }),
	/**
	 * END a document — the ONE verb whose behaviour the DOCUMENT decides, so a client
	 * never chooses between "cancel a draft" and "reverse a posted one" (a wrong pick
	 * would write a conflict into the stock ledger):
	 *
	 *   draft     → a pure lifecycle flip (no stock ever moved)
	 *   confirmed → REVERSED in the same atomic batch (the stock it moved comes back)
	 *   cancelled → an idempotent no-op (`already: true`), so a double tap is harmless
	 *
	 * A reversal that cannot be honest is REFUSED (409) with the server's own reason —
	 * partly consumed stock, a unit that has since moved on, money recorded against the
	 * receipt. That message is prose the API owns: show it verbatim, never re-word it.
	 */
	cancel: (kind: MroCancellableDocKind, id: string) =>
		mroFetch<MroCancelResult>(`/mro/${kind}/${id}/cancel`, { method: 'POST', body: JSON.stringify({}) }),
	/** Serial tracker — a per-unit lookup by `serial_no`. The engine returns
	 *  `{ rows: [...] }` for a unique serial; an empty array means the number
	 *  has never been received (or was fully issued/scrapped). The result is
	 *  intentionally a list (multi-match on partial search is a future knob). */
	serial: (serial: string) => mroFetch<{ rows: MroSerialRow[] }>(`/mro/stock/serials?serial=${encodeURIComponent(serial)}`),
	/** Every ASSET UNIT one holder currently has — a truck (`vehicle`) or an
	 *  employee (`employee`), or every holder when neither is given. THE one
	 *  server-scoped, display-ready register read (`GET /api/mro/assets/holder`):
	 *  tyres AND `assets`-flagged items (jacks, toolboxes) resolved with their SKU,
	 *  plate, custodian + live readings, so a register card needs no catalog/plate
	 *  join. Replaces the old mounted/tray/equipment trio (three reads) with one. */
	holderAssets: (holder: { vehicle?: string | null; employee?: string | null } = {}) => {
		const params = new URLSearchParams();
		if (holder.vehicle) params.set('vehicle', holder.vehicle);
		if (holder.employee) params.set('employee', holder.employee);
		const qs = params.toString();
		return mroFetch<{ rows: MroHolderAssetRow[]; holder: { vehicle: string | null; employee: string | null } }>(
			`/mro/assets/holder${qs ? `?${qs}` : ''}`,
		);
	},
	/** A serial unit's immutable lifecycle history (`mro_serial_events` rows for
	 *  ONE `mro_stock_serials` id, newest first). Read straight from D1 with the
	 *  vehicle/actor m2o values resolved — never the generic filtered entity-list
	 *  (which the engine ignores for these MRO tables). */
	serialEvents: (serialId: string) =>
		mroFetch<{ rows: Array<Record<string, unknown>> }>(`/mro/serials/${encodeURIComponent(serialId)}/events`),
	/** Record ONE real tyre inspection on an issued (in-use) serial unit —
	 *  `POST /api/mro/serials/:id/check`. Updates its live `tread_mm`/`psi`
	 *  snapshot and appends an immutable `checked` history event (Slice B). Never
	 *  an estimate: `treadMm` (or `psi`) must be a measured value. The acting
	 *  storekeeper/technician (`hrm_employees` id) is attributed via `actorId`. */
	recordSerialCheck: (
		serialId: string,
		input: { actorId?: string; treadMm?: number | null; psi?: number | null; condition?: string | null; note?: string },
	) =>
		mroFetch<{
			serialId: string;
			serial_no: string;
			event: 'checked';
			tread_mm?: number | null;
			psi?: number | null;
			condition?: string | null;
		}>(`/mro/serials/${encodeURIComponent(serialId)}/check`, {
			method: 'POST',
			body: JSON.stringify({
				actor_id: input.actorId,
				tread_mm: input.treadMm == null ? null : Number(input.treadMm),
				psi: input.psi == null ? null : Number(input.psi),
				condition: input.condition ?? null,
				note: input.note,
			}),
		}),
	/** Move an ALREADY-ISSUED asset between holders — `POST /api/mro/serials/:id/
	 *  move`. The ONE holder-seam writer: a SAME-truck seat change (`rotated`), a
	 *  truck→tray / tray→wheel (`fitted`), a store-loosed unit binding to a truck
	 *  (`fitted`) or a person (`issued`). `toVehicle` and `toEmployee` are mutually
	 *  exclusive; `toSlot` requires a vehicle. The unit stays `issued` throughout
	 *  (store balances never move). The raw route carries NO custody token, so a move
	 *  that CHANGES the holder (truck→truck, person↔truck) is refused (403) — that is
	 *  the transfer filer's job, not this call's. The acting technician
	 *  (`hrm_employees` id) is attributed via `actorId`; the caller offers only the
	 *  FREE seats on the unit's OWN truck (see the tyre detail sheet's move section). */
	moveSerial: (
		serialId: string,
		input: { actorId?: string; toVehicle?: string | null; toSlot?: string | null; toEmployee?: string | null; note?: string },
	) =>
		mroFetch<{
			serialId: string;
			serial_no: string;
			vehicle: string | null;
			slot: string | null;
			employee: string | null;
			event: 'rotated' | 'refitted' | 'fitted' | 'issued' | 'reissued';
		}>(`/mro/serials/${encodeURIComponent(serialId)}/move`, {
			method: 'POST',
			body: JSON.stringify({
				actor_id: input.actorId,
				to_vehicle: input.toVehicle ?? null,
				to_slot: input.toSlot ?? null,
				to_employee: input.toEmployee ?? null,
				note: input.note,
			}),
		}),
	/** Hand an in-store / loose asset into an employee's custody — `POST /api/mro/
	 *  serials/:id/issue`. An `in_stock` unit leAVES its store's balance; a loose
	 *  issued unit just binds to the person. A unit on a truck must be moved off
	 *  first (`moveSerial`); one already held by the same person is a 409. */
	issueSerial: (serialId: string, input: { actorId?: string; toEmployee: string; note?: string }) =>
		mroFetch<{
			serialId: string;
			serial_no: string;
			employee: string;
			vehicle: null;
			slot: null;
			event: 'issued';
			from_status: string;
		}>(`/mro/serials/${encodeURIComponent(serialId)}/issue`, {
			method: 'POST',
			body: JSON.stringify({ actor_id: input.actorId, to_employee: input.toEmployee, note: input.note }),
		}),
	/** Fit a serial tyre onto a VACANT wheel position OR into a truck's inventory
	 *  tray — `POST /api/mro/serials/:id/fit`. `toSlot` names the wheel to seat it
	 *  on; OMIT it to stage the tyre as that truck's standby spare (issued to the
	 *  truck, no wheel). An `in_stock` unit leaves its store's balance in the same
	 *  batch; an issued-but-unseated spare just takes the truck; a spare already in
	 *  THIS truck's tray can be seated onto one of its wheels. Appends one
	 *  immutable `fitted` history event. A wheel fit requires the seat to be empty. */
	fitSerial: (
		serialId: string,
		input: { actorId?: string; toVehicle: string; toSlot?: string | null; note?: string; eventDate?: string | null },
	) =>
		mroFetch<{ serialId: string; serial_no: string; vehicle: string; slot: string | null; event: 'fitted'; from_status: string }>(
			`/mro/serials/${encodeURIComponent(serialId)}/fit`,
			{
				method: 'POST',
				body: JSON.stringify({
					actor_id: input.actorId,
					to_vehicle: input.toVehicle,
					to_slot: input.toSlot ?? null,
					note: input.note,
					event_date: input.eventDate ?? null,
				}),
			},
		),
	/** Unmount a seated serial tyre back into a STORE — `POST /api/mro/serials/
	 *  :id/return`. Flips `issued` → `in_stock` at the target store (default
	 *  `vehicle_store`), clears the seat, adds ONE unit to that store's balance
	 *  and appends a `returned` history event. */
	returnSerial: (serialId: string, input: { actorId?: string; toLocation?: string; note?: string }) =>
		mroFetch<{
			serialId: string;
			serial_no: string;
			status: 'in_stock';
			vehicle: null;
			slot: null;
			event: 'returned';
			to_location: string;
		}>(`/mro/serials/${encodeURIComponent(serialId)}/return`, {
			method: 'POST',
			body: JSON.stringify({
				actor_id: input.actorId,
				to_location: input.toLocation ?? null,
				note: input.note,
			}),
		}),
	/** Take a SEATED serial tyre off a wheel and keep it on the SAME truck as a
	 *  standby spare — `POST /api/mro/serials/:id/unseat`. Stays `issued` + bound
	 *  to the truck (no store balance moves); only its wheel slot clears and one
	 *  immutable `unseated` history row is appended. From the tray the spare can be
	 *  fitted onto another wheel of the SAME truck, moved to another truck, returned
	 *  to store or written off. */
	unseatSerial: (serialId: string, input: { actorId?: string; note?: string; eventDate?: string | null }) =>
		mroFetch<{ serialId: string; serial_no: string; vehicle: string; slot: null; event: 'unseated' }>(
			`/mro/serials/${encodeURIComponent(serialId)}/unseat`,
			{
				method: 'POST',
				body: JSON.stringify({ actor_id: input.actorId, note: input.note, event_date: input.eventDate ?? null }),
			},
		),
	/** Exchange TWO seated serial tyres ON THE SAME TRUCK — `POST /api/mro/serials/swap`.
	 *  Each takes the other's wheel slot in ONE guarded batch and both log `rotated`.
	 *  A cross-truck exchange is a 400: that move is an approval-gated transfer request. */
	swapSerials: (input: { serialA: string; serialB: string; actorId?: string; note?: string }) =>
		mroFetch<{ event: 'rotated'; swapped: [string, string] }>('/mro/serials/swap', {
			method: 'POST',
			body: JSON.stringify({ serial_a: input.serialA, serial_b: input.serialB, actor_id: input.actorId, note: input.note }),
		}),
	/** The APPROVER-scoped transfer-request feed (`GET /api/mro/asset-requests`) —
	 *  requests THIS session may decide, newest first, keyset-paged. Omit `status`
	 *  for the decide queue (`requested`); a comma list (`approved,executed`) folds
	 *  the tracking view into one page. `search` matches the doc number, serial,
	 *  either plate, or the requester's name server-side. */
	assetRequests: (params: { status?: string; search?: string; cursor?: string } = {}) => {
		const qs = new URLSearchParams();
		if (params.status) qs.set('status', params.status);
		if (params.search) qs.set('search', params.search);
		if (params.cursor) qs.set('cursor', params.cursor);
		const q = qs.toString();
		return mroFetch<{ rows: MroAssetRequestRow[]; nextCursor: string | null }>(`/mro/asset-requests${q ? `?${q}` : ''}`);
	},
	/** Approve a requested transfer — a superior's sign-off; NO stock/holder effect.
	 *  The approver is bound to the SESSION server-side; `actorId` is only honoured
	 *  for an admin naming a decider on a kiosk operator's behalf. */
	approveAssetRequest: (id: string, input: { actorId?: string } = {}) =>
		mroFetch<Record<string, unknown>>(`/mro/asset-requests/${encodeURIComponent(id)}/approve`, {
			method: 'POST',
			body: JSON.stringify({ actor_id: input.actorId }),
		}),
	/** Reject a requested transfer with a recorded reason — no stock effect. */
	rejectAssetRequest: (id: string, input: { actorId?: string; reason?: string } = {}) =>
		mroFetch<Record<string, unknown>>(`/mro/asset-requests/${encodeURIComponent(id)}/reject`, {
			method: 'POST',
			body: JSON.stringify({ actor_id: input.actorId, reason: input.reason }),
		}),
	/** Execute an APPROVED transfer — ONE atomic guarded move pinned to the request's
	 *  recorded source, which also flips the request to `executed`. */
	executeAssetRequest: (id: string, input: { actorId?: string } = {}) =>
		mroFetch<Record<string, unknown>>(`/mro/asset-requests/${encodeURIComponent(id)}/execute`, {
			method: 'POST',
			body: JSON.stringify({ actor_id: input.actorId }),
		}),
};
