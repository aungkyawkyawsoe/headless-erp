import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { StoreRequestCard } from '@/modules/store-requests/components/store-request-card';
import { fetchVehicleRequisitionPage } from '@/modules/store-requests/data/api';
import { qk as storeQk, REQUISITIONS_STALE_MS } from '@/modules/store-requests/data/query-keys';
import type { MroRequisitionCardModel } from '@/modules/store-requests/data/types';
import { EmptyState } from '@/shared/components/empty-state';
import { LoadMoreSentinel } from '@/shared/components/load-more-sentinel';
import { ListSkeleton } from '@/shared/components/skeletons';
import { useCursorList } from '@/shared/hooks/use-cursor-list';
import { hapticSelection } from '@/shared/platform/haptics';

/**
 * The truck's REQUESTS tab — every store requisition BOUND to this plate, newest
 * first, rendered with the SAME `StoreRequestCard` the `/app/store-requests`
 * register uses (so a request reads identically wherever it is seen). Tapping a
 * row opens the request's detail page, where the store keeper approves / issues
 * / rejects it — this tab is a navigation list, never a decision surface.
 *
 * It reads `fetchVehicleRequisitionPage` under the SHARED
 * `storeQk.vehicleRequisitions(vehicleId)` key — the same truck-file cache the
 * maintenance screen would use — so a requisition created / approved / issued
 * anywhere (which invalidates the requisitions prefix) reaches this list with no
 * extra wiring.
 */
export function TruckRequestsPanel({ vehicleId }: { vehicleId: string }) {
	const navigate = useNavigate();

	const list = useCursorList<MroRequisitionCardModel>({
		queryKey: storeQk.vehicleRequisitions(vehicleId),
		fetcher: (cursor) => fetchVehicleRequisitionPage(vehicleId, cursor),
		staleTime: REQUISITIONS_STALE_MS,
		enabled: vehicleId !== '',
	});

	const open = useCallback(
		(request: MroRequisitionCardModel) => {
			hapticSelection();
			navigate(`/app/store-requests/${request.id}`);
		},
		[navigate],
	);

	if (list.isPending) return <ListSkeleton variant="store-request" count={3} />;

	if (list.isError && list.rows.length === 0) {
		return (
			<div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
				<p className="text-sm font-medium leading-myanmar text-status-danger">Couldn't load this truck's requests.</p>
				<button
					type="button"
					onClick={() => void list.refetch()}
					className="mt-2 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm"
				>
					Try again
				</button>
			</div>
		);
	}

	if (list.rows.length === 0) {
		// `fill` — the dashed card OWNS the tab panel, so it stretches to the pane's
		// height instead of floating in a half-empty pane.
		return <EmptyState title="No requests on board" hint="Stock ordered for this truck appears here as it moves through the store." fill />;
	}

	return (
		<>
			<p className="mb-1.5 flex items-baseline justify-between gap-3 px-1">
				<span className="text-meta font-bold uppercase tracking-[0.14em] leading-none text-muted-foreground">Requests</span>
				<span className="text-meta font-medium leading-myanmar text-muted-foreground">
					{list.rows.length} request{list.rows.length === 1 ? '' : 's'}
				</span>
			</p>
			<ul className="flex flex-col gap-3">
				{list.rows.map((request) => (
					<StoreRequestCard key={request.id} request={request} onOpen={() => open(request)} />
				))}
			</ul>
			<LoadMoreSentinel
				hasMore={list.hasNextPage}
				loading={list.isFetchingNextPage}
				onLoadMore={() => void list.fetchNextPage()}
				waitForScroll
			/>
		</>
	);
}
