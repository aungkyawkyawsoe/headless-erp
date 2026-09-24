import { useCallback } from 'react';

import { FleetCard } from '../components/fleet-card';
import { fetchFleetsPage, fetchFleetsSearch } from '../data/api';
import { FLEET_STALE_MS, qk } from '../data/query-keys';
import { UNIT_TYPE_LABELS, UNIT_TYPE_OPTIONS, type FleetUnitTypeFilterValue } from '../data/status';
import type { FleetCardModel } from '../data/types';
import { ListPage } from '@/shared/components/list-page';
import { listPageErrorProps, useCursorList } from '@/shared/hooks/use-cursor-list';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';

/**
 * Browse all vehicles — the fleet register at `/app/fleets/browse`.
 *
 * The old `/app/fleets` list page, superseded at the route by the search-first
 * kiosk (`fleets-page.tsx`): the kiosk answers the typical one-truck lookup
 * with ZERO idle reads, so this full cursor list moved behind the kiosk's
 * "Browse all vehicles" escape hatch. Cursor-paginated at `LIST_PAGE_SIZE`
 * vehicles per page (plate-sorted; see `fetchFleetsPage`) — page 1 renders
 * immediately, further pages stream in as the list approaches the bottom via
 * `LoadMoreSentinel`. Every card renders straight from its `fleets` master row
 * (plate + brand · unit-type identity, the model-year chip top-right and the
 * two dotted-leader fact rows: ဘီး · ပေ / လိုင်စင်ထုတ်ပေးသည့်နေရာ) plus its
 * at-a-glance care chips (km left until the engine/gear-oil service, computed
 * READ-SIDE by the page's batched care read). The fixed bottom action bar
 * carries the filtered-list layout — the unit-type filter funnel on the LEFT
 * with the active label in the pill, and the 🔍 search toggle on the RIGHT.
 * There is no create (+) button: vehicles are added from outside the app.
 *
 * The card body opens the truck's on-board inventory (the tyre-vehicle page,
 * `?tab=list`); its photo tile sets/replaces the truck's photo. Fleet care
 * writes (odo readings / oil fills / service intervals) still happen in the
 * two dedicated fleet-care apps — Daily ODO and Fluid — which invalidate this
 * list so the cards' chips always show the freshest remaining/overdue state.
 */

// URL-driven unit-type filter — `?type=` survives reloads; nuqs `replace`
// (default) keeps taps out of history. `'all'` (အားလုံး) shows every vehicle.
const UNIT_TYPE_FILTER = enumParam<FleetUnitTypeFilterValue>(Object.keys(UNIT_TYPE_LABELS) as FleetUnitTypeFilterValue[], 'all');

/** The fleet list's whole URL view state — the unit-type filter, in one container. */
const FLEETS_VIEW = {
	[URL_PARAM.type]: UNIT_TYPE_FILTER,
} as const;

export default function FleetsPage() {
	const list = useCursorList({
		queryKey: qk.fleets(),
		fetcher: fetchFleetsPage,
		staleTime: FLEET_STALE_MS,
	});
	const [view, setView] = useViewState(FLEETS_VIEW);
	const { type: unitFilter } = view;

	/** One card per row — hoisted via `useCallback` (stable identity: the list
	 *  re-renders rows only when the underlying data changes). */
	const renderFleet = useCallback((fleet: FleetCardModel) => <FleetCard key={fleet.id} fleet={fleet} />, []);

	const source: FleetCardModel[] = list.rows;

	return (
		<ListPage
			{...listPageErrorProps(list)}
			title="Vehicles"
			rows={source}
			isPending={list.isPending}
			skeletonVariant="fleet"
			renderItem={renderFleet}
			emptyState={{ title: 'No vehicles yet', hint: 'Check back later.' }}
			pagination={{
				hasNextPage: list.hasNextPage,
				isFetchingNextPage: list.isFetchingNextPage,
				onLoadMore: () => void list.fetchNextPage(),
			}}
			searchPlaceholder="Search plate / type"
			fetchSearch={fetchFleetsSearch}
			filter={{
				value: unitFilter,
				onChange: (value) => setView({ type: value }),
				options: UNIT_TYPE_OPTIONS,
				centerLabel: UNIT_TYPE_LABELS[unitFilter],
				sheetTitle: 'Filter by vehicle type',
				matches: (fleet, value) => fleet.unitType === value,
				emptyTitle: 'No vehicles match this filter',
			}}
		/>
	);
}
