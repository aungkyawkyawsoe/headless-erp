import { STALE_MS } from '@/shared/api/invalidation';
import type { MroLocation } from '@/shared/mro';
import type { MroOutboundType } from './types';

/**
 * TanStack Query key factory for the outbound document flow — the ONE cache
 * identity shared by the goods-issues / write-offs / scrapes screens (they are
 * the same `mro_outbounds` reads with a different `type` filter).
 *
 * Invalidate by PREFIX: `qk.outboundsAll()` (`['mro-outbounds']`) refreshes
 * every type's list after a create / confirm, in one call. The item-model SKU
 * directory is NOT keyed here — it is the shared `['mro','item-models']` read
 * owned by `shared/hooks/use-mro-item-models` (one cache entry across every MRO
 * module's pickers, on the 5-minute master window).
 */

/** Documents move through a workflow (draft → confirmed), so the lists refresh
 *  more eagerly than slow-moving masters — same rule as the requisition list.
 *  The value is the shared `module` tier (single source in shared/api/invalidation.ts). */
export const OUTBOUND_STALE_MS = STALE_MS.module;

export const qk = {
	/** One type + store's cursor-paginated doc list. */
	outbounds: (type: MroOutboundType, location: MroLocation) => ['mro-outbounds', 'list', type, location] as const,
	/** One doc's full-screen detail page read — its display facts AND the form's
	 *  seed (the same document as fields), read together so the two can never
	 *  describe different revisions. */
	outboundEditor: (id: string) => ['mro-outbounds', 'editor', id] as const,
	/** Prefix for EVERY type's doc list — invalidate after create/confirm. */
	outboundsAll: () => ['mro-outbounds'] as const,
};
