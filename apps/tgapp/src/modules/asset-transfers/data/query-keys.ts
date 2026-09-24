/**
 * TanStack Query key factory for the asset-transfer (ATR) approval feed.
 *
 * Keyed under its own `['asset-transfers', ...]` namespace. The `asset-transfers`
 * feed domain is registered in `shared/api/invalidation.ts`, so a generic entity
 * write to `mro_asset_requests` (a requester filing) auto-invalidates this whole
 * prefix; the raw decide/execute routes call `invalidateDomain` explicitly.
 */
import { STALE_MS } from '@/shared/api/invalidation';

/** The transfer feed moves with a superior's decision — the module tier. */
export const TRANSFERS_STALE_MS = STALE_MS.module;

/** The active status scope is part of the key: switching the filter chip reads a
 *  different server slice and must not serve the previous chip's rows. */
export const qk = {
	transfers: (status: string) => ['asset-transfers', 'list', { status }] as const,
	transfersAll: () => ['asset-transfers'] as const,
};
