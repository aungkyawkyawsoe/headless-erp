import type { MmbixClient } from '@mmbix/sdk';

import { MRO_LOCATIONS, MRO_LOCATION_LABELS, mroApi, type MroExpiryRow, type MroOnHandRow } from '@/shared/mro';
import { fetchAllPages } from '@/shared/api/fetch-all';
import { sdk } from '@/shared/api/sdk';

import type { OnHandGroup, OnHandReport } from './types';

/**
 * The စတော့ module's data access — the dashboard loads the ENTIRE stock view from
 * a SINGLE `/api/mro/stock/onhand` report (components stay dumb; grouping/sorting
 * lives in `stockReportOf` and the expiry mapper below). The on-hand rows arrive
 * already carrying each model's part-group + category via the backend JOIN, so
 * the category funnel and the row cards need NO separate `mro_item_name` /
 * `mro_item_model` / `mro_item_categories` entity reads.
 */

/**
 * The `mro_inventory` balance row with its relations EXPANDED — the raw shape the
 * engine returns for the dotted `fields` in `INVENTORY_FIELDS` below (the model,
 * its part-group, and the part-group's tracking policy all ride the SAME row).
 */
interface InventoryBalanceRow {
	id: string;
	location?: string | null;
	qty_on_hand?: number | null;
	reorder_level?: number | null;
	model?:
		| {
				id?: string;
				name_en?: string | null;
				name_mm?: string | null;
				image?: string | null;
				item_name?: { name_en?: string | null; name_mm?: string | null; tracking?: string | null } | string | null;
		  }
		| string
		| null;
}

type InventorySchema = { mro_inventory: InventoryBalanceRow } & Record<string, Record<string, unknown>>;
const inventoryOps = sdk as unknown as MmbixClient<InventorySchema>;

// Dot paths expand the model + its part-group in the SAME request, so a scoped
// balance read needs no follow-up directory call.
const INVENTORY_FIELDS = [
	'id',
	'location',
	'qty_on_hand',
	'reorder_level',
	'model.name_en',
	'model.name_mm',
	'model.image',
	'model.item_name.name_en',
	'model.item_name.name_mm',
	'model.item_name.tracking',
] as const;

/** The expanded model relation — a lean row when the engine expanded it, else a
 *  bare id (or null). */
function expandedModel(model: InventoryBalanceRow['model']): Exclude<InventoryBalanceRow['model'], string | null | undefined> | null {
	return model && typeof model === 'object' ? model : null;
}

/** The part-group relation nested under the model — expanded to its lean row, or
 *  null when the engine left it as a bare id / the SKU carries none. */
function expandedGroup(
	model: ReturnType<typeof expandedModel>,
): { name_en?: string | null; name_mm?: string | null; tracking?: string | null } | null {
	const group = model?.item_name;
	return group && typeof group === 'object' ? group : null;
}

/** Map ONE expanded `mro_inventory` row onto the stock report's row shape, so the
 *  kiosk renders it through the SAME card as the dashboard. `drift`/`derived_qty`
 *  stay at their neutral values: proving drift needs the lot/serial aggregates the
 *  server computes in `/stock/onhand`, which a scoped search deliberately skips. */
function onHandRowOf(row: InventoryBalanceRow): MroOnHandRow {
	const model = expandedModel(row.model);
	const group = expandedGroup(model);
	const reorderLevel = row.reorder_level ?? null;
	const qty = Number(row.qty_on_hand ?? 0);
	return {
		id: row.id,
		model: model?.id ?? null,
		model_name: model?.name_en ?? model?.name_mm ?? null,
		model_image: model?.image ?? null,
		location: row.location ?? '',
		tracking: group?.tracking ?? 'standard',
		qty_on_hand: qty,
		reorder_level: reorderLevel,
		derived_qty: null,
		drift: false,
		below_reorder: reorderLevel != null && reorderLevel > 0 && qty <= reorderLevel,
		group_name: group?.name_en ?? group?.name_mm ?? null,
		// The item (group) name's Burmese label — the card's sub-line.
		group_name_mm: group?.name_mm ?? null,
	};
}

/**
 * The balance rows for a KNOWN set of item models — read straight from the
 * `mro_inventory` balance table, scoped by `filter[model][_in]=…`, with the model
 * + part-group relations expanded in the same request.
 *
 * This is the stock kiosk's search source (replacing the whole-collection
 * `/api/mro/stock/onhand` report it used to download and filter client-side): the
 * search first resolves WHICH items match on the catalog (see
 * `useMroItemModels`), then asks for exactly those models' balances — so one term
 * costs one page of balances, never the entire stock table.
 *
 * Models that match but hold no balance row are simply ABSENT here (this reports
 * what is in the balance table); the caller renders them as not-yet-stocked.
 */
export async function fetchInventoryForModels(modelIds: readonly string[]): Promise<MroOnHandRow[]> {
	if (modelIds.length === 0) return [];
	const rows = await fetchAllPages((cursor, pageSize) =>
		inventoryOps.items('mro_inventory').list({
			fields: INVENTORY_FIELDS,
			filter: { model: { _in: [...modelIds] } },
			limit: pageSize,
			cursor,
		}),
	);
	return rows.map(onHandRowOf);
}

/** The expiry horizon token — the dashboard asks the SERVER to derive the window
 *  from the widest per-model `expiry_alert_days` (never a blanket 30), so an item
 *  that configures a longer alert window is not silently missed. */
export const EXPIRY_WINDOW = 'auto' as const;

/** The expiry rows that need action — expired first, then soonest-expiring.
 *  The feed buckets by calendar date but can include horizon rows OUTSIDE the
 *  model's alert window (`alert: false`); those are dropped so the section only
 *  lists the server's per-item "act now" set. */
export async function fetchAlertingExpiry(days?: number): Promise<MroExpiryRow[]> {
	const feed = await mroApi.expiring(days);
	return [...feed.expired, ...feed.expiring]
		.filter((row) => row.alert)
		.sort((a, b) => {
			// Expired (negative days_left) first, then ascending days_left.
			const aExpired = a.days_left < 0 ? 0 : 1;
			const bExpired = b.days_left < 0 ? 0 : 1;
			if (aExpired !== bExpired) return aExpired - bExpired;
			return a.days_left - b.days_left;
		});
}

/** Display order of the store groups — the shared MRO_LOCATIONS order. A
 *  location added server-side before this client ships its label sorts after
 *  the known stores (by value). */
const LOCATION_RANK = new Map<string, number>(MRO_LOCATIONS.map((location, index) => [location.value, index]));

/** Balance rows ordered for one store — the "act now" flags first (below
 *  reorder, then drift), each tier alphabetical by model name (rows whose
 *  master row is gone sort last in their tier — the `\uffff` name key). */
function compareRows(a: MroOnHandRow, b: MroOnHandRow): number {
	const aTier = a.below_reorder ? 0 : a.drift ? 1 : 2;
	const bTier = b.below_reorder ? 0 : b.drift ? 1 : 2;
	if (aTier !== bTier) return aTier - bTier;
	const aName = (a.model_name ?? '').trim().toLowerCase() || '\uffff';
	const bName = (b.model_name ?? '').trim().toLowerCase() || '\uffff';
	return aName < bName ? -1 : aName > bName ? 1 : 0;
}

/** The flat on-hand rows grouped by location — store order (MRO_LOCATIONS),
 *  rows warnings-first, plus the summary strip's headline counts. */
export function stockReportOf(rows: MroOnHandRow[]): OnHandReport {
	const byLocation = new Map<string, MroOnHandRow[]>();
	for (const row of rows) {
		const locationRows = byLocation.get(row.location);
		if (locationRows) locationRows.push(row);
		else byLocation.set(row.location, [row]);
	}

	const groups: OnHandGroup[] = [...byLocation.entries()]
		.sort(([a], [b]) => {
			const rankA = LOCATION_RANK.get(a) ?? Number.MAX_SAFE_INTEGER;
			const rankB = LOCATION_RANK.get(b) ?? Number.MAX_SAFE_INTEGER;
			if (rankA !== rankB) return rankA - rankB;
			return a < b ? -1 : a > b ? 1 : 0;
		})
		.map(([location, locationRows]) => {
			const ordered = [...locationRows].sort(compareRows);
			return {
				location,
				label: MRO_LOCATION_LABELS[location] ?? location,
				rows: ordered,
				belowReorderCount: ordered.reduce((count, row) => count + (row.below_reorder ? 1 : 0), 0),
			};
		});

	// SKUs = distinct item models across the report (a null model — a deleted
	// master — still counts once: it is one traced stock identity).
	const modelIds = new Set(rows.map((row) => row.model ?? 'unknown'));
	return {
		groups,
		totals: {
			skuCount: modelIds.size,
			locationCount: groups.length,
			belowReorderCount: groups.reduce((sum, group) => sum + group.belowReorderCount, 0),
		},
	};
}
