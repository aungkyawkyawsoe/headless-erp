import { STALE_MS } from '@/shared/api/invalidation';
import { masterQk } from '@/shared/lookups/query-keys';

/**
 * TanStack Query key factory for the licenses module (`/app/licenses`) reading
 * the REAL `veh_permits` collection.
 *
 * Keyed under `['licenses', ...]` — its own namespace; the list joins the fleet
 * (plate/brand) via the expanded `vehicle` m2o in the same request.
 */

/** License renewals move by days — the shared `module` tier (single source in
 *  shared/api/invalidation.ts), same as the other record feeds. */
export const LICENSE_STALE_MS = STALE_MS.module;

export const qk = {
	/** The joined licenses list — the card list (cursor-paginated). */
	licenses: () => ['licenses', 'overview'] as const,
	/** The kiosk plate dropdown — one debounced truck lookup per settled term
	 *  (cached per term so retyping an already-searched fragment is instant). */
	suggest: (term: string) => ['licenses', 'suggest', term] as const,
	/** ONE truck's license file — the per-truck page's history feed,
	 *  CURSOR-PAGINATED (`useCursorList` pages under this base key; page 1 feeds
	 *  the truck page's current-license summary too). Keyed per vehicle so each
	 *  truck keeps its own pages; a save invalidates the prefix so the feed shows
	 *  the new permit at the top. */
	truck: (vehicleId: string) => ['licenses', 'truck', vehicleId] as const,
	/** ONE truck's CURRENT permit (its newest row — the renew gate's facts) — the
	 *  per-truck page's DEEP-LINK gate read only (a card tap routes the current
	 *  summary in router state, so this never fires on the tap path). */
	current: (vehicleId: string) => ['licenses', 'current', vehicleId] as const,
	/** ONE permit by id — the record-edit screen's prefill. */
	record: (id: string) => ['licenses', 'record', id] as const,
	/** One truck's lean fleet identity (plate/brand) — the per-truck page's
	 *  DEEP-LINK header read only (a card tap carries the identity in router
	 *  state, so this never fires on the tap path). */
	// ONE truck identity across every fleet module — see `masterQk.vehicle`.
	fleet: (vehicleId: string) => masterQk.vehicle(vehicleId),
};
