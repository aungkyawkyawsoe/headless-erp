import { STALE_MS } from '@/shared/api/invalidation';
import { masterQk } from '@/shared/lookups/query-keys';

/**
 * TanStack Query key factory for the insurances policy list (`/app/insurances`)
 * reading the REAL `veh_insurances` collection.
 *
 * Keyed under `['insurances',...]` — a distinct namespace from the fleet cache
 * because the policy list is its own aggregate read (the insurance rows + the
 * fleet plates joined client-side).
 */

/** Policy data changes rarely (expiry moves by days) — the shared `module` tier
 *  (single source in shared/api/invalidation.ts). */
export const INSURANCE_STALE_MS = STALE_MS.module;

export const qk = {
	/** The joined policy overview — the card list (cursor-paginated). */
	insurances: () => ['insurances', 'list', 'overview'] as const,
	/** The kiosk plate dropdown — one debounced truck lookup per settled term
	 *  (cached per term so retyping an already-searched fragment is instant). */
	suggest: (term: string) => ['insurances', 'suggest', term] as const,
	/** ONE truck's policy file — the per-truck page's history feed,
	 *  CURSOR-PAGINATED (`useCursorList` pages under this base key; page 1 feeds
	 *  the truck page's current-policy summary too). Keyed per vehicle so each
	 *  truck keeps its own pages; a save invalidates the prefix so the feed shows
	 *  the new policy at the top. */
	truck: (vehicleId: string) => ['insurances', 'truck', vehicleId] as const,
	/** ONE truck's CURRENT policy (its newest row — the renew gate's facts) — the
	 *  per-truck page's DEEP-LINK gate read only (a card tap routes the current
	 *  summary in router state, so this never fires on the tap path). */
	current: (vehicleId: string) => ['insurances', 'current', vehicleId] as const,
	/** ONE policy by id — the record-edit screen's prefill. */
	record: (id: string) => ['insurances', 'record', id] as const,
	/** One truck's lean fleet identity (plate/brand) — the per-truck page's
	 *  DEEP-LINK header read only (a card tap carries the identity in router
	 *  state, so this never fires on the tap path). */
	// ONE truck identity across every fleet module — see `masterQk.vehicle`.
	fleet: (vehicleId: string) => masterQk.vehicle(vehicleId),
};
