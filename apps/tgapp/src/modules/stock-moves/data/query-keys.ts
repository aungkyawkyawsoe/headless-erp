import { STALE_MS } from '@/shared/api/invalidation';

/**
 * TanStack Query key factory for the location-transfer document flow
 * (mro_transfers).
 *
 * Invalidate by PREFIX: `qk.transfersAll()` (`['mro-transfers']`) refreshes the
 * list after a create / confirm in one call. The item-model master lives under
 * the shared `['mro', ...]` prefix (same key string as the sibling modules'
 * read, so every picker collides into ONE cached fetch).
 */

/** Documents move through a workflow (draft → confirmed), so the lists refresh
 *  more eagerly than slow-moving masters (the shared `module` tier; single
 *  source in shared/api/invalidation.ts). */
export const TRANSFER_STALE_MS = STALE_MS.module;

/** The list's cache namespace — every `qk.transfers(status)` entry nests under it. */
const TRANSFERS_NS = ['mro-transfers'] as const;

export const qk = {
	/** One status's transfer list — `'all'` = the unfiltered feed. The status is
	 *  part of the key because the list is filtered SERVER-side (`?status=`), so
	 *  each status is its own paged cache entry. */
	transfers: (status: string) => [...TRANSFERS_NS, 'list', status] as const,
	/** Prefix for the doc list + detail — invalidate after create/confirm. */
	transfersAll: () => TRANSFERS_NS,
	/** A single transfer doc's full-screen detail page read — its display facts
	 *  AND the form's seed (the same document as fields), read together so the two
	 *  can never describe different revisions. */
	transferEditor: (id: string) => [...TRANSFERS_NS, 'editor', id] as const,
};
