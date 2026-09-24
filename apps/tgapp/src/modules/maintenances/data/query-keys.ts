import { STALE_MS } from '@/shared/api/invalidation';
import { masterQk } from '@/shared/lookups/query-keys';

/**
 * TanStack Query key factory for the ပြင်ဆင် (vehicle maintenance) module reading
 * the REAL `veh_maintenance_logs` + `veh_issue_types` collections.
 *
 * Keyed under `['maintenances', ...]` — its own namespace. Every list reads the
 * owning truck (plate/brand) + the cited job EXPANDED in the same request, so a
 * card never triggers a separate fleet / catalog read; the per-truck feed keys on
 * the vehicle id and a save invalidates the whole list prefix.
 */
export const MAINTENANCE_STALE_MS = STALE_MS.module;

/** The list-query namespace prefix every maintenance feed shares — a write
 *  invalidates this once and every overview (register + per-truck) refreshes. */
export const maintenanceListKey = ['maintenances', 'list'] as const;

export const qk = {
	/** The register — every maintenance log (cursor-paginated, newest first).
	 *  `categoryId` (a `mro_item_categories` id, `'all'` = unfiltered) is part of
	 *  the key: the server scopes the read, so each scope is its own cache entry. */
	logs: (categoryId = 'all') => [...maintenanceListKey, categoryId || 'all'] as const,
	/** The TRUCK register (`/app/maintenances/browse`) — every fleet truck with
	 *  its maintenance summary, scoped by the same category filter. */
	trucks: (categoryId = 'all') => ['maintenances', 'trucks', categoryId || 'all'] as const,
	/** ONE truck's maintenance file — the per-truck page's feed. */
	truck: (vehicleId: string) => ['maintenances', 'truck', vehicleId] as const,
	/** ONE truck's lean fleet identity (plate/brand) — the per-truck page's
	 *  DEEP-LINK header read only (a card tap carries the identity in router state). */
	// ONE truck identity across every fleet module — see `masterQk.vehicle`.
	fleet: (vehicleId: string) => masterQk.vehicle(vehicleId),
	/** The issue-type picker's server MATCH — cached per settled term. */
	issueTypeSearch: (term: string) => ['maintenances', 'issue-types', 'search', term] as const,
	/** The kiosk plate dropdown's debounced truck lookup — cached per settled term. */
	suggest: (term: string) => ['maintenances', 'suggest', term] as const,
	/** ONE log, RAW — the edit screen's prefill. Keyed per log AND per VISIT
	 *  (`visit` is the screen's `useId()`): a re-open can never seed the form from
	 *  a previous visit's row while a StrictMode remount still shares one request. */
	record: (id: string, visit: string) => ['maintenances', 'record', id, visit] as const,
};
