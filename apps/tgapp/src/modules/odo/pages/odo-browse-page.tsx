import { useCallback } from 'react';

import { OdoRowCard } from '../components/odo-row-card';
import { fetchOdoListPage, fetchOdoSearch } from '../data/api';
import { ODO_LIST_STALE_MS, qk } from '../data/query-keys';
import type { OdoListModel } from '../data/types';
import { ListPage } from '@/shared/components/list-page';
import { listPageErrorProps, useCursorList } from '@/shared/hooks/use-cursor-list';

/**
 * Daily ODO → Browse all vehicles — the FULL serviceable register
 * (`/app/daily-odo/browse`, reached from the Daily ODO kiosk search's "Browse
 * all vehicles" link).
 *
 * The launcher landing (`/app/daily-odo`) is the search-first kiosk: ONE
 * centred plate search, with a single match opening the vehicle page directly.
 * This register is its escape hatch — every vehicle of the fleet master with
 * its LAST ODO (read from the master's denormalized `last_odo` — the list is
 * ONE `veh_fleets` fetch, no child reads), plus the toolbar search for a
 * plate/brand fragment. Tapping a vehicle opens its full-screen Daily ODO page
 * (`/app/daily-odo/:id`); its back arrow returns HERE (this is a real route,
 * so a browse → vehicle round trip never loses the register).
 */
export default function OdoBrowsePage() {
	const list = useCursorList({
		queryKey: qk.list(),
		fetcher: fetchOdoListPage,
		staleTime: ODO_LIST_STALE_MS,
	});

	// Writes happen on the vehicle page (`/app/daily-odo/:id`); its save handler
	// invalidates this list key, so returning always refetches with the new
	// latest odo values.
	const renderVehicle = useCallback((vehicle: OdoListModel) => <OdoRowCard key={vehicle.id} vehicle={vehicle} />, []);

	return (
		<ListPage
			{...listPageErrorProps(list)}
			title="Daily ODO"
			rows={list.rows}
			isPending={list.isPending}
			skeletonVariant="vehicle"
			renderItem={renderVehicle}
			emptyState={{ title: 'No vehicles yet', hint: 'Add vehicles to the fleet first — daily readings appear here.' }}
			pagination={{
				hasNextPage: list.hasNextPage,
				isFetchingNextPage: list.isFetchingNextPage,
				onLoadMore: () => void list.fetchNextPage(),
				// Page only on a real scroll — without this, a page-1 that doesn't fill
				// a tall viewport auto-fetches the NEXT page during the initial paint
				// (a premature cursor request on cold load).
				waitForScroll: true,
			}}
			searchPlaceholder="Plate number / brand"
			fetchSearch={fetchOdoSearch}
			centerText="Vehicles"
		/>
	);
}
