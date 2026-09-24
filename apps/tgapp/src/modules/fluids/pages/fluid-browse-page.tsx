import { useCallback } from 'react';

import { FluidRowCard } from '../components/fluid-row-card';
import { fetchFluidsListPage, fetchFluidsSearch } from '../data/api';
import { FLUID_LIST_STALE_MS, qk } from '../data/query-keys';
import type { FluidListModel } from '../data/types';
import { ListPage } from '@/shared/components/list-page';
import { listPageErrorProps, useCursorList } from '@/shared/hooks/use-cursor-list';

/**
 * Fluid → Browse all vehicles — the FULL serviceable register (`/app/fluid/
 * browse`, reached from the Fluid kiosk search's "Browse all vehicles" link).
 *
 * The launcher landing (`/app/fluid`) is the search-first kiosk: ONE centred
 * plate search, with a single match opening the vehicle page directly. This
 * register is its escape hatch — every serviceable vehicle of the fleet master
 * with its engine-oil / gear-oil km-left chips (batched read per page — never
 * a per-card board fetch), plus the toolbar search for a plate/brand fragment.
 * Tapping a vehicle opens its full-screen Fluid page (`/app/fluid/:id`); its
 * back arrow returns HERE (this is a real route, so a browse → vehicle round
 * trip never loses the register).
 */
export default function FluidBrowsePage() {
	const list = useCursorList({
		queryKey: qk.list(),
		fetcher: fetchFluidsListPage,
		staleTime: FLUID_LIST_STALE_MS,
	});

	// Writes happen on the vehicle page (`/app/fluid/:id`); its save handler
	// invalidates this list key, so returning always refetches with the new
	// km-left chips.
	const renderVehicle = useCallback((vehicle: FluidListModel) => <FluidRowCard key={vehicle.id} vehicle={vehicle} />, []);

	return (
		<ListPage
			{...listPageErrorProps(list)}
			title="Fluid"
			rows={list.rows}
			isPending={list.isPending}
			skeletonVariant="vehicle"
			renderItem={renderVehicle}
			emptyState={{ title: 'No vehicles yet', hint: 'Add vehicles to the fleet first — oil fills appear here.' }}
			pagination={{
				hasNextPage: list.hasNextPage,
				isFetchingNextPage: list.isFetchingNextPage,
				onLoadMore: () => void list.fetchNextPage(),
			}}
			searchPlaceholder="Plate number / brand"
			fetchSearch={fetchFluidsSearch}
			centerText="Vehicles"
		/>
	);
}
