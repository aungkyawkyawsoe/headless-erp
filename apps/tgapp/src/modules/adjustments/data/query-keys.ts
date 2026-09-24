import { STALE_MS } from '@/shared/api/invalidation';

/**
 * TanStack Query key factory for the MRO adjustment document flow
 * (mro_adjustments). Adjustment is a FLAT list (no type/store tabs — every
 * store's corrections share one feed), so:
 *
 *   - `qk.adjustments(status)` (`['mro-adjustments', status]`) is the ENTIRE
 *     list namespace — invalidating the `['mro-adjustments']` prefix after a
 *     create / authorize refreshes every loaded card in one call. The status is
 *     part of the key because the list is filtered SERVER-side (`?status=`), so
 *     each status is its own paged cache entry;
 *   - the item-model SKU directory is NOT keyed here — it is the shared
 *     `['mro','item-models']` read owned by `shared/hooks/use-mro-item-models`
 *     (one cache entry across every MRO module's pickers).
 *
 * The stock dashboard refresh after an authorize is not keyed here either — the
 * confirm invalidates the whole `stock` domain via the shared registry (see
 * `shared/api/invalidation.ts`), the same lever every stock-moving doc uses.
 */

/** Documents move draft → authorized, so the list refreshes more eagerly than
 *  the slow-moving item-model master. The value is the shared `module` tier
 *  (single source in shared/api/invalidation.ts). */
export const ADJUSTMENT_STALE_MS = STALE_MS.module;

/** The list's cache namespace — every `qk.adjustments(status)` entry nests under it. */
const ADJUSTMENTS_NS = ['mro-adjustments'] as const;

export const qk = {
	/** One status's adjustments list + the `['mro-adjustments']` cache namespace.
	 *  `'all'` = the unfiltered feed. */
	adjustments: (status: string) => [...ADJUSTMENTS_NS, status] as const,
	/** The whole list namespace — invalidate this to refresh EVERY status's cached
	 *  page after a create / authorize. */
	adjustmentsAll: () => ADJUSTMENTS_NS,
	/** ONE adjustment doc — its display facts AND its form seed, read TOGETHER by
	 *  the full-screen detail page. One read, so the card face and the form can
	 *  never describe two different revisions of the document (SAME ns). */
	adjustmentEditor: (id: string) => [...ADJUSTMENTS_NS, 'editor', id] as const,
};
