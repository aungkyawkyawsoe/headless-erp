import { MASTER_STALE_MS } from '@/shared/constants';
import { masterQk } from '@/shared/lookups/query-keys';

/**
 * TanStack Query key factory for the Daily ODO app.
 *
 * Keyed under `['odo',...]` — a namespace distinct from the fleets module. The
 * vehicle LIST is the same `veh_fleets` master the fleets page pages over, but
 * each app keeps its own cache so a save here never fights the fleets list's.
 * After a save this module ALSO invalidates the fleets list key (the fleet
 * cards' odo-derived chips must refresh) — see `odo-vehicle-page.tsx`.
 */

/** The vehicle list changes rarely (master rows + latest readings) — the shared
 *  master tier (`MASTER_STALE_MS`, single source in shared/constants). */
export const ODO_LIST_STALE_MS = MASTER_STALE_MS;

export const qk = {
	/** The Daily ODO vehicle list — cursor-paginated master rows + latest odo
	 *  (now the `/app/daily-odo/browse` register — the kiosk's escape hatch). */
	list: () => ['odo', 'list'] as const,
	/** The kiosk search's debounced type-ahead — server `?search=` rows per term
	 *  (plate/brand fragment + the latest odo), cached so re-typing a term never
	 *  re-fires. */
	suggest: (query: string) => ['odo', 'suggest', query] as const,
	/** One vehicle's CURRENT odo + last reading's date — the vehicle page's lean
	 *  board (the card + the record form's floor). No month history here: that
	 *  loads separately under `history` the moment the history screen opens. */
	board: (vehicleId: string) => ['odo', 'board', vehicleId] as const,
	/** One vehicle's CURRENT-MONTH readings — the history screen's read, fetched
	 *  ONLY when `/app/daily-odo/:id/history` opens (deny-by-default: the
	 *  vehicle page never touches it). */
	history: (vehicleId: string) => ['odo', 'history', vehicleId] as const,
	/** One vehicle's lean identity — the deep-link header read (never on a tap). */
	fleet: (vehicleId: string) => masterQk.vehicle(vehicleId),
};
