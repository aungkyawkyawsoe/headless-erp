import { STALE_MS } from '@/shared/api/invalidation';
import { masterQk } from '@/shared/lookups/query-keys';

/**
 * TanStack Query key factory for the မှတ်တမ်း (accidents & incidents) module
 * reading the REAL `veh_incidents` collection.
 *
 * Keyed under `['incidents', ...]` — its own namespace. The overview list joins
 * the fleet (plate/brand) via the expanded `vehicle` m2o in the same request;
 * the per-truck reads key on the owning vehicle id.
 */
/** Incidents move by days — the shared `module` tier (single source in
 *  shared/api/invalidation.ts), same as the other record feeds. */
export const INCIDENTS_STALE_MS = STALE_MS.module;

/** The query-key namespace prefix every incidents list query shares — the + page
 *  invalidates the whole prefix after a create so every overview refreshes. */
export const incidentsListKey = ['incidents', 'list'] as const;

export const qk = {
	/** The incidents overview — the card list (cursor-paginated). */
	incidents: () => [...incidentsListKey, 'overview'] as const,
	/** The kiosk plate dropdown — one debounced truck lookup per settled term
	 *  (cached per term so retyping an already-searched fragment is instant). */
	suggest: (term: string) => ['incidents', 'suggest', term] as const,
	/** ONE truck's record file — the per-truck page's history feed,
	 *  CURSOR-PAGINATED (`useCursorList` pages under this base key; page 1 feeds
	 *  the truck page's newest-record summary too). Keyed per vehicle so each
	 *  truck keeps its own pages; a save invalidates the prefix so the feed shows
	 *  the new record at the top. */
	truck: (vehicleId: string) => ['incidents', 'truck', vehicleId] as const,
	/** ONE truck's lean fleet identity (plate/brand) — the per-truck page's
	 *  DEEP-LINK header read only (a card tap carries the identity in router
	 *  state, so this never fires on the tap path). */
	// ONE truck identity across every fleet module — see `masterQk.vehicle`.
	fleet: (vehicleId: string) => masterQk.vehicle(vehicleId),
	/** ONE record, RAW — the edit screen's prefill (title/description kept apart,
	 *  date/cost unformatted). Keyed per record AND per VISIT (`visit` is the
	 *  screen's `useId()`): the entry a visit writes is never the entry the NEXT
	 *  visit reads, so a re-open always seeds from a fresh read — while React
	 *  StrictMode's dev remount (same instance ⇒ same id) shares ONE entry and so
	 *  costs ONE request instead of two. */
	record: (id: string, visit: string) => ['incidents', 'record', id, visit] as const,
};
