import type { QueryClient } from '@tanstack/react-query';
import { qk } from './query-keys';
import type { HrRequest } from './types';

/**
 * The cursor-list cache shape under `qk.requestsAll()` (`['hr','requests',...]`)
 * — every request list an infinite query of `{ pages, pageParams }`, each page
 * holding a `rows: HrRequest[]`. After an EDIT we patch the updated row into
 * EVERY cached page so the change shows the moment the user lands back on the
 * list — even when the row sits on a page deeper than the first one (React
 * Query only auto-refetches the first page when an inactive infinite query
 * remounts, so deeper cached pages would otherwise keep showing the stale value
 * until a full reload).
 */
export function reflectEditedRow(queryClient: QueryClient, updated: HrRequest): void {
	queryClient.setQueriesData({ queryKey: qk.requestsAll() }, (oldData: unknown) => {
		// The single-row detail query (`qk.request(id)`) carries a bare row, not a
		// `{ pages }` snapshot — seed it below via setQueryData instead; only patch
		// the cursor-list pages (`{ pages: [...] }`) in place here.
		if (oldData == null || typeof oldData !== 'object' || !('pages' in oldData)) return oldData;
		const query = oldData as { pages: Array<{ rows: HrRequest[] }> };
		const pages = query.pages.map((page) => ({
			...page,
			rows: page.rows.map((row) => (row.id === updated.id ? updated : row)),
		}));
		return { ...query, pages };
	});
	// Seed the single-row detail cache with the row we just wrote — setQueryData
	// (never an invalidation) so nothing re-fetches the row right after the edit.
	queryClient.setQueryData<HrRequest | null>(qk.request(updated.id), updated);
}
