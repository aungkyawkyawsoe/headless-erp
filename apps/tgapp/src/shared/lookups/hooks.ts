import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { readPersistedMasters, writePersistedMasters } from '@/shared/api/persisted-masters';
import { MASTER_STALE_MS } from '@/shared/constants';
import { fetchEmployeeMasters, fetchVehicleMasters } from './api';
import { masterQk } from './query-keys';
import type { EmployeeMasterRow, VehicleMasterRow } from './types';

/**
 * React Query hooks for the shared master lookups — every hook reads the SAME
 * `['masters', ...]` cache entry, so any two modules that join the same master
 * collide into one cached query (see `./query-keys.ts`) and share the same
 * freshness window.
 *
 * The 5-minute `MASTER_STALE_MS` window is the app-wide master-data rule:
 * vehicles / employees change rarely, so every module's join lookups stay
 * fresh for 5 min while each page's LIST query keeps its own tighter window (a
 * revisit refetches only the rows, not the lookups).
 */

export type MasterQueryResult<T> = UseQueryResult<T[], Error>;

function useMasterQuery<T>(
	queryKey: readonly unknown[],
	fetcher: () => Promise<T[]>,
	enabled = true,
	/** Device-copy name — set ONLY for non-personal reference masters (vehicles…).
	 *  The employee directory is deliberately NOT persisted (personal data). */
	persistName?: string,
): MasterQueryResult<T> {
	const seed = useMemo(() => (persistName ? readPersistedMasters<T[]>(persistName) : undefined), [persistName]);
	return useQuery({
		queryKey,
		queryFn: async () => {
			const data = await fetcher();
			if (persistName) writePersistedMasters(persistName, data);
			return data;
		},
		staleTime: MASTER_STALE_MS,
		enabled,
		initialData: seed?.data,
		initialDataUpdatedAt: seed?.at,
	});
}

/** `vehicle_vehicles` — the shared fleet directory. */
export function useVehicleMasters(): MasterQueryResult<VehicleMasterRow> {
	return useMasterQuery(masterQk.vehicles(), fetchVehicleMasters, true, 'veh_fleets');
}

/**
 * `hrm_employees` — the shared employee directory. The whole-set walk is the
 * heaviest master read (each page is capped at 25 rows and the directory has
 * 238+, so it spans several requests) — pass `enabled` to gate it behind an
 * action such as opening a picker sheet (the leave reliever sheet enables it
 * on first tap). The cached result stays shared either way: once any consumer
 * fetches it, every other module collides into the same `['masters', ...]` entry.
 */
export function useEmployeeMasters(enabled = true): MasterQueryResult<EmployeeMasterRow> {
	return useMasterQuery(masterQk.employees(), fetchEmployeeMasters, enabled);
}
