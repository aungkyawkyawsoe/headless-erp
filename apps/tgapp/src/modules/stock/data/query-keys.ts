import { STALE_MS } from '@/shared/api/invalidation';

/**
 * TanStack Query key factory for the စတော့ (MRO stock) dashboard.
 *
 * Keyed under `['stock', ...]` — its own namespace: the dashboard reads the RAW
 * `/api/mro/stock/*` report routes through the shared `mroApi` helper (never
 * the entity SDK — the MRO collections have no generated SchemaRow). The ON-HAND
 * report key lives in `shared/hooks/use-on-hand-report` (`ON_HAND_QUERY_KEY`,
 * also `['stock','onhand']`) — the same cache the items list chips read, so the
 * two screens always show the same balances; the expiry feed stays here.
 */

/** Balances move only when an MRO document is confirmed — a 60s window keeps a
 *  revisit from refetching an unchanged report within the same minute (the
 *  shared `module` tier; single source in shared/api/invalidation.ts). */
export const STOCK_STALE_MS = STALE_MS.module;

export const qk = {
	/** The expiry feed — `GET /api/mro/stock/expiring` (the horizon sits in the key;
	 *  `'auto'` = the server derives it from the widest per-model alert window, so a
	 *  different horizon never shares a cache entry). */
	expiring: (days: number | 'auto') => ['stock', 'expiring', days] as const,
	/** The kiosk's SCOPED balance read — the `mro_inventory` rows for exactly the
	 *  item models a search matched (`filter[model][_in]=…`), not the whole report.
	 *  Keyed by the matched ids (sorted, so the same set is one entry) so each
	 *  term's answer caches independently and a revisit is instant. */
	inventory: (modelIds: readonly string[]) => ['stock', 'inventory', [...modelIds].sort()] as const,
	/** ONE SKU's composition — the stock card's inline drill-down
	 *  (`GET /api/mro/stock/items/:modelId`). Nested under `['stock', …]` on
	 *  purpose: the `stock` invalidation domain prefix-matches it, so every
	 *  confirm that moves balances/lots/serials refreshes an OPEN expansion with
	 *  no extra wiring. Keyed per model, so each card's answer caches alone. */
	itemStock: (modelId: string) => ['stock', 'item', modelId] as const,
};
