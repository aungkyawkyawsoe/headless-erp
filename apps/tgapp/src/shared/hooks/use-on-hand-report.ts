import { useQuery } from '@tanstack/react-query';
import { STALE_MS } from '@/shared/api/invalidation';
import { mroApi, type MroOnHandRow } from '@/shared/mro';

/**
 * The whole-app on-hand report — ONE cache entry (`GET /api/mro/stock/onhand`,
 * keyed `['stock','onhand']`) shared by every screen that renders balances (the
 * stock dashboard's quantity tabs). The stock-moving confirms invalidate the
 * whole `stock` domain write-through (see `shared/api/invalidation.ts`), so the
 * report is never stale past the moment a balance actually changed — the 60s
 * module tier only prices in passive revisits.
 *
 * The dashboard needs this FULL report because its tabs partition on server-
 * computed `drift` + `below_reorder` over every balance. The items list used to
 * layer a cheaper `GROUP BY model` aggregate on top of it for per-card qty chips;
 * that read is gone with the chip (an aggregate per list visit to print a number
 * the STOCK page shows properly).
 */
export const ON_HAND_QUERY_KEY = ['stock', 'onhand'] as const;

/** The one cached read — plain rows (one per model+location). */
export function useOnHandReport() {
	return useQuery({
		queryKey: ON_HAND_QUERY_KEY,
		queryFn: async (): Promise<MroOnHandRow[]> => (await mroApi.onhand()).rows,
		staleTime: STALE_MS.module,
	});
}
