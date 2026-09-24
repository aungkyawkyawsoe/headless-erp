import { MASTER_STALE_MS } from '@/shared/constants';

/**
 * TanStack Query key factory for the ယာဉ် (fleets) module.
 *
 * Keyed under `['fleets',...]` — a distinct namespace from the other modules'
 * caches because the fleet master is its own aggregate read (one page of
 * `fleets` rows per query). The care WRITES no longer live here — the Daily ODO
 * and Fluid apps own them and invalidate this list key after a save, so the
 * fleet cards' odo/fill-derived chips always refresh.
 */

/** The fleet master changes rarely — the shared master tier (`MASTER_STALE_MS`,
 *  single source in shared/constants). */
export const FLEET_STALE_MS = MASTER_STALE_MS;

export const qk = {
	/** The fleet master list — the ယာဉ် card list (cursor-paginated). */
	fleets: () => ['fleets', 'master', 'list'] as const,
};
