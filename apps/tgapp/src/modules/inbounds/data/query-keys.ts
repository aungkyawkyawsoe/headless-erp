import { STALE_MS } from '@/shared/api/invalidation';
import { MRO_SUPPLIERS_QUERY_KEY } from '@/shared/hooks/use-mro-masters';
import type { MroLocation } from '@/shared/mro';
import type { InboundType } from './types';

/**
 * TanStack Query key factory for the inbound document flow (mro_inbounds).
 *
 * Invalidate by PREFIX: `qk.inboundsAll()` (`['mro-inbounds']`) refreshes the
 * list after a create / confirm in one call. The supplier + item-model masters
 * live under the shared `['mro', ...]` prefix — they change rarely, so the
 * 5-minute `MASTER_STALE_MS` window applies and doc mutations never touch them
 * (the supplier key IS the shared masters-hub entry in
 * `shared/hooks/use-mro-masters`, so every supplier picker — inbound form,
 * masters-hub tab, quick-adds in either — collides into ONE cached fetch).
 */

/** Documents move through a workflow (draft → confirmed), so the lists refresh
 *  more eagerly than slow-moving masters.
 *  The value is the shared `module` tier (single source in shared/api/invalidation.ts). */
export const INBOUND_STALE_MS = STALE_MS.module;

export const qk = {
	/** One type + store's cursor-paginated inbound doc list. */
	inbounds: (type: InboundType, location: MroLocation) => ['mro-inbounds', 'list', type, location] as const,
	/** One doc's full-screen detail page read — the receipt's derived facts
	 *  (money, lifecycle) AND the form's seed (the same document as fields). */
	inboundEditor: (id: string) => ['mro-inbounds', 'editor', id] as const,
	/** One receipt's PAYMENT ledger (mro_inbound_payments) — the payment sheet. */
	inboundPayments: (id: string) => ['mro-inbounds', 'payments', id] as const,
	/** Prefix for EVERY type's doc list — invalidate after create/confirm. */
	inboundsAll: () => ['mro-inbounds'] as const,
	/** The `mro_suppliers` master — the create form's supplier picker (aliases
	 *  the shared `['mro','suppliers']` directory in shared/hooks/use-mro-masters). */
	suppliers: () => MRO_SUPPLIERS_QUERY_KEY,
};
