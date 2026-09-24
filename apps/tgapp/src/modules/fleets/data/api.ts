import type { MmbixClient } from '@mmbix/sdk';

import type { CursorPage } from '@/shared/hooks/use-cursor-list';
import { LIST_PAGE_SIZE, SEARCH_LIMIT } from '@/shared/constants';
import { vehicleBrandLabel } from '@/shared/fleet';
import { sdk } from '@/shared/api/sdk';
import { careChipsFor } from './care';
import type { FleetCareChipModel, FleetCardModel, FleetRow, FluidFillRow } from './types';

/**
 * The fleets module's typed client — the same local-cast pattern as the
 * employees / attendance modules: the app-wide client is typed against the
 * placeholder typegen `Schema`, so entity reads here go through a
 * locally-typed view of the same instance. The list reads `veh_fleets`; the
 * per-page care chips additionally read the care collections (`veh_odo_months`
 * current odo via the shared month-row reader + `veh_fluid_fills` newest fill
 * of each kind) this module owns the row vocabulary of. The care WRITES live
 * in the Daily ODO and Fluid apps.
 */
type OpsSchema = {
	veh_fleets: FleetRow;
	veh_fluid_fills: FluidFillRow;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/** `unit_type` value → the uppercase pill label (e.g. `box` → "BOX TRUCK"). */
const UNIT_TYPE_LABELS: Record<string, string> = {
	box: 'BOX TRUCK',
	trailer: 'TRAILER',
	tractor_unit: 'TRACTOR UNIT',
	forklift: 'FORKLIFT',
	others: 'OTHERS',
};

/** A bare 4-digit year — how the live data stores years in `model`. */
const YEAR_PATTERN = /^\d{4}$/;

/**
 * The card's muted year — the live `cms_fleets` data stores the year of
 * manufacture in `model` (free text holding `'2015'`, `'2023'`, …), so a
 * 4-digit `model` wins; otherwise fall back to the `purchase_date` year.
 */
function resolveYear(fleet: FleetRow): string | null {
	if (fleet.model && YEAR_PATTERN.test(fleet.model.trim())) return fleet.model.trim();
	if (fleet.purchase_date && YEAR_PATTERN.test(fleet.purchase_date.slice(0, 4))) return fleet.purchase_date.slice(0, 4);
	return null;
}

/** "10 W" — the wheel count as a compact tag (null when unset). */
function wheelTagLabel(wheel: number | null | undefined): string | null {
	return wheel != null ? `${wheel} W` : null;
}

/** "24 ft" — the box/trailer length as a compact tag (null when unset). */
function feetTagLabel(feet: number | null | undefined): string | null {
	return feet != null ? `${feet} ft` : null;
}

/** "YGN · Hlaing" — the license issuing place + township (either part may be
 *  absent), `—` when neither is on file. */
function licenseLabel(fleet: FleetRow): string {
	const place = fleet.license_place?.trim();
	const township = fleet.license_township?.trim();
	if (place && township) return `${place} · ${township}`;
	return place ?? township ?? '—';
}

/** One master row → its card model. */
function fleetCardOf(fleet: FleetRow): FleetCardModel {
	return {
		id: fleet.id,
		plateNo: fleet.plate_no?.trim() || '—',
		brandLabel: vehicleBrandLabel(fleet.brand),
		year: resolveYear(fleet),
		unitLabel: fleet.unit_type ? (UNIT_TYPE_LABELS[fleet.unit_type] ?? null) : null,
		unitType: fleet.unit_type ?? null,
		wheelLabel: wheelTagLabel(fleet.wheel),
		feetLabel: feetTagLabel(fleet.feet),
		licenseLabel: licenseLabel(fleet),
		image: fleet.image ?? null,
	};
}

/** The list columns — every master field the card renders (plus `id`) and the
 *  three DENORMALIZED care scalars (`last_odo`/`last_engine_oil`/`last_gear_oil`)
 *  the server keeps fresh on every odo/fill write. When those columns exist the
 *  care chips compute from the master alone (one `veh_fleets` fetch); until a
 *  DB is reconciled for them they are silently dropped server-side and the
 *  shared care reader falls back to its batched cross-read (no regression). */
const CARD_FIELDS = [
	'id',
	'plate_no',
	'brand',
	'model',
	'unit_type',
	'wheel',
	'feet',
	'license_place',
	'license_township',
	'purchase_date',
	'image',
	'last_odo',
	'last_engine_oil',
	'last_gear_oil',
] as const;

/**
 * The toolbar search — a server-side `?search=` read across the master's text
 * fields (plate / brand / model), mapped to the SAME card as the list so
 * results always match it.
 */
export async function fetchFleetsSearch(query: string): Promise<FleetCardModel[]> {
	const res = await ops.items('veh_fleets').list({
		fields: [...CARD_FIELDS],
		search: query,
		limit: SEARCH_LIMIT,
	});
	const care = await careChipsFor(res.data);
	return res.data.map((fleet) => withCare(fleetCardOf(fleet), care));
}

/**
 * One page of the fleet — `LIST_PAGE_SIZE` vehicles (plate-sorted), streamed
 * via `useCursorList` + `LoadMoreSentinel`. Every card renders from its
 * `fleets` master row with the page's ONE batched care-chip read attached.
 */
export async function fetchFleetsPage(cursor?: string): Promise<CursorPage<FleetCardModel>> {
	const res = await ops.items('veh_fleets').list({
		fields: [...CARD_FIELDS],
		sort: 'plate_no',
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	const care = await careChipsFor(res.data);
	return {
		rows: res.data.map((fleet) => withCare(fleetCardOf(fleet), care)),
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/** Persist a truck's photo — `image` is the R2 `/api/media/<key>` URL (or null
 *  to clear it). The write envelope invalidates `veh_fleets` reads, so the list
 *  refreshes without a manual cache bump. */
export async function setFleetImage(id: string, image: string | null): Promise<void> {
	await ops.items('veh_fleets').update(id, { image });
}

// ── Card care chips — at-a-glance km-left per fluid (ONE batched request/page) ─

// The per-page km-left chips come from the SHARED reader in `./care`, which
// folds the three cross-collection reads (current odo + newest engine/gear
// fill-due) into ONE `POST /api/query` round trip. `/app/fleets` and
// `/app/fluid` read the identical graph from the same code path, so there is no
// duplicated resolve/fallback logic and no second cache of the care collections.
// Chip failures degrade gracefully — the page renders clean, minus the chips.

/** Attach the computed chips to a card (when this page produced any). */
function withCare(card: FleetCardModel, care: Map<string, FleetCareChipModel>): FleetCardModel {
	const chips = care.get(card.id);
	return chips ? { ...card, care: chips } : card;
}
