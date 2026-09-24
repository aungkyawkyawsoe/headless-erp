/**
 * TanStack Query key factory for the တာယာ (tyres) module.
 *
 * Keyed under its own `['tyres', ...]` namespace (distinct from the fleet /
 * insurances caches and the sibling MRO modules). The serial-tracked tyre-SKU
 * directory the lookups join is NOT keyed here — it is the shared
 * `['mro','item-models']` read owned by `shared/hooks/use-mro-item-models` (one
 * cache entry across every MRO module's pickers). The serial-unit lookup itself
 * is a direct fetch (no list cache): only the HOLDER REGISTER (the fitment board
 * + a holder's asset register) and each opened unit's lifecycle history are cached.
 */

import { STALE_MS } from '@/shared/api/invalidation';

/** Serial lifecycles move with stock issues — the mounted board + history keep
 *  the tighter 60 s freshness (like the requisition list) so a just-verified
 *  unit appears promptly. The shared read-only-feed tier (`STALE_MS.module`),
 *  single source in shared/api/invalidation.ts. */
export const TYRE_STALE_MS = STALE_MS.module;

export const qk = {
	/** The MOUNTED serial tyres — the fleet-wide fitment board's data (all issued,
	 *  plate-bound, seated cards, read whole for the board grouping). A selector
	 *  over the one holder register; invalidated whenever any holder mutation runs. */
	mountedTyres: () => ['tyres', 'list', 'mounted'] as const,
	/** The serial-register kiosk PREFIX — the By Serial `SearchKiosk` caches one
	 *  debounced server `?search=` answer per typed term under this base
	 *  (`[..., 'search', term]`), so retyping a term never re-fires. */
	serialKiosk: () => ['tyres', 'suggest', 'serial'] as const,
	/** The By Fleet `SearchKiosk` prefix — the plate lookup filters the already
	 *  cached fleet board client-side, so each term's answer is cached here. */
	fleetKiosk: () => ['tyres', 'suggest', 'fleet'] as const,
	/** The tyre's immutable lifecycle history — the serial detail page's timeline. */
	tyreEvents: (serialId: string) => ['tyres', 'events', serialId] as const,
	/** EVERY held asset across the fleet — the base holder-register key. Every
	 *  per-holder key nests UNDER this, so one `invalidateQueries({ queryKey:
	 *  qk.holderAssets() })` refreshes the whole register after any mutation. */
	holderAssets: () => ['tyres', 'holder'] as const,
	/** ONE truck's asset register — tyres + `assets`-flagged items it
	 *  currently holds (`GET /api/mro/assets/holder?vehicle=…`). The wheel-plan
	 *  board, the truck inventory page and the equipment count all read THIS one
	 *  entry. */
	holderAssetsOf: (vehicleId: string) => ['tyres', 'holder', 'vehicle', vehicleId] as const,
	/** ONE employee's asset register — the assets issued into their custody
	 *  (`GET /api/mro/assets/holder?employee=…`). */
	holderAssetsOfEmployee: (employeeId: string) => ['tyres', 'holder', 'employee', employeeId] as const,
	/** ONE serial unit's LIVE snapshot by its `mro_stock_serials` id — the serial
	 *  detail page's header read (a cold deep-link opens on the id alone). */
	tyreUnit: (serialId: string) => ['tyres', 'unit', serialId] as const,
};
