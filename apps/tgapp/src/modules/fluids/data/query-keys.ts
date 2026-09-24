import { masterQk } from '@/shared/lookups/query-keys';
/**
 * TanStack Query key factory for the Fluid app.
 *
 * Keyed under `['fluids',...]` — a namespace distinct from the fleets and odo
 * modules. The vehicle LIST is the same `veh_fleets` master the fleets page
 * pages over, but each app keeps its own cache so a save here never fights the
 * fleets list's. After a save this module ALSO invalidates the fleets list key
 * (the fleet cards' fill/odo-derived chips must refresh) — see
 * `fluid-vehicle-page.tsx`.
 */

import { MASTER_STALE_MS } from '@/shared/constants';
import type { FluidKind } from '@/modules/fleets/data/types';

/** The vehicle list changes rarely (master rows + latest fills) — the shared
 *  master tier (`MASTER_STALE_MS`, single source in shared/constants). */
export const FLUID_LIST_STALE_MS = MASTER_STALE_MS;

export const qk = {
	/** The Fluid vehicle list — cursor-paginated master rows + km-left chips. */
	list: () => ['fluids', 'list'] as const,
	/** The kiosk search's debounced type-ahead — server `?search=` rows per term
	 *  (plate/brand fragment), cached so re-typing a term never re-fires. */
	suggest: (query: string) => ['fluids', 'suggest', query] as const,
	/** One vehicle's lean fleet identity (plate/brand) — the DEEP-LINK header
	 *  read only (a card tap carries its row in router state, so this never fires). */
	fleet: (vehicleId: string) => masterQk.vehicle(vehicleId),
	/** ONE kind's fill HISTORY — cursor-paginated rows for the vehicle's active
	 *  tab, lazy-loaded as the user scrolls. Keyed per (vehicle, kind) so each
	 *  tab keeps its own pages. Read with `useCursorList` (`useInfiniteQuery`) —
	 *  its `data` is `{ pages, pageParams }`, so a plain `useQuery` MUST NOT
	 *  share this key (see `newest`). */
	history: (vehicleId: string, kind: FluidKind) => ['fluids', 'history', vehicleId, kind] as const,
	/** The RECORD page's newest-fill hint (the previous service's interval) — a
	 *  DEDICATED key, never the vehicle page's infinite `history` feed. A
	 *  `useQuery` and a `useInfiniteQuery` cannot share a key: the cached shapes
	 *  differ (`{ rows }` vs `{ pages, pageParams }`), and opening the record
	 *  page from a vehicle whose feed was already cached read `data.rows` off the
	 *  infinite result — `undefined[0]` — crashing the screen. */
	newest: (vehicleId: string, kind: FluidKind) => ['fluids', 'newest', vehicleId, kind] as const,
	/** ONE fill by id — the record-edit screen's prefill. */
	fill: (id: string) => ['fluids', 'fill', id] as const,
};
