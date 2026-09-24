import type { MroOnHandRow } from '@/shared/mro';

/**
 * The စတော့ dashboard's tab vocabulary + row partition — the pure half of
 * `/app/stocks/browse`, split out so the four-tab shape and the disjointness
 * rule can be unit tested without mounting the page or hitting the reports.
 *
 * FOUR tabs. The three quantity tabs (`in`, `reorder`, `out`) partition the
 * ON-HAND report so a row lives in exactly ONE of them; `expiry` is a separate
 * feed (its rows come from lots/serials, not balances) and loads only when its
 * tab is opened.
 *
 * `out` and `expiry` were briefly merged into one "Alerts" tab and are now
 * separate again — kept as two tabs so a stock-out balance (nothing to issue)
 * and an aging lot (units left, going bad) each get their own list.
 */

/** The stock-state views — the tab values (also the `?tab=` URL values). */
export type StockTab = 'in' | 'reorder' | 'out' | 'expiry';

/** Tab value → label, in render order (`In Stock` leads). */
export const STOCK_TABS: ReadonlyArray<{ value: StockTab; label: string }> = [
	{ value: 'in', label: 'In Stock' },
	{ value: 'reorder', label: 'Reorder' },
	{ value: 'out', label: 'Stock Out' },
	{ value: 'expiry', label: 'Expiring Soon' },
];

/** Every tab value — the URL parse's membership list. */
export const STOCK_TAB_VALUES: readonly StockTab[] = STOCK_TABS.map((tab) => tab.value);

/** The on-hand row partition behind the tabs. */
export interface StockPartition {
	/** qty > 0 and above the reorder level — healthy. */
	in: MroOnHandRow[];
	/** qty > 0 at/below the reorder level — low but stocked. */
	reorder: MroOnHandRow[];
	/** qty == 0 — the Stock Out tab. */
	out: MroOnHandRow[];
}

/**
 * Partition the (already store/category-scoped) on-hand rows.
 *
 * The three partitions are DISJOINT: `in`, `reorder` and `out` never share a row.
 * The `qty_on_hand === 0 ? false : …` guard on `reorder` is what enforces that —
 * without it an out-of-stock row (necessarily at/below its reorder level) would
 * be counted as BOTH low and out.
 */
export function partitionOnHand(rows: MroOnHandRow[]): StockPartition {
	return {
		in: rows.filter((row) => row.qty_on_hand > 0 && !row.below_reorder),
		reorder: rows.filter((row) => (row.qty_on_hand === 0 ? false : row.below_reorder)),
		out: rows.filter((row) => row.qty_on_hand === 0),
	};
}
