import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';

import { TyreFitmentRow } from '../components/tyre-fitment-row';
import { fetchMountedTyres } from '../data/api';
import {
	FITMENT_FILTER_LABELS,
	FITMENT_FILTER_OPTIONS,
	FITMENT_FILTER_VALUES,
	matchesBoardSearch,
	matchesFitmentFilter,
	type FitmentFilterValue,
} from '../data/board-filter';
import { buildFleetBoard, type VehicleBoardState } from '../data/board';
import { qk, TYRE_STALE_MS } from '../data/query-keys';
import { GLASS_ICON_BUTTON, GLASS_ICON_BUTTON_IDLE } from '@/shared/components/bottom-action-bar';
import { ListPage } from '@/shared/components/list-page';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';
import { useVehicleMasters } from '@/shared/lookups/hooks';
import { hapticImpact, hapticSelection } from '@/shared/platform/haptics';

/** The board's URL view state — the fitment filter, in the page's ONE container.
 *  `?status=` survives a reload; nuqs `replace` keeps a filter tap out of history. */
const FITMENT_VIEW = {
	[URL_PARAM.status]: enumParam<FitmentFilterValue>(FITMENT_FILTER_VALUES, 'all'),
} as const;

/**
 * တာယာ → On vehicles — the ALL-FLEET fitment BOARD (`/app/tyres/fitment`).
 *
 * Not a scope tab any more (the module's two tabs are By Serial + By Fleet): this
 * browse-all register is reached from By Fleet's idle "Browse all vehicles" link.
 * Every plate that can carry wheels becomes one row; tapping a truck opens the
 * tyre's FULL-SCREEN wheel-position page (`/app/tyres/vehicle/:id` — the former
 * fitment bottom sheet, promoted to a page with a back arrow), which paints its
 * declared wheel-slot layout as N blocks filled by the mounted serial tyres
 * currently seated there (or a dashed vacant gap).
 *
 * The read is the SAME honest data as the search screens, regrouped — the shared
 * plate master (`veh_fleets` incl. `wheel_slots`) plus every CURRENTLY-MOUNTED
 * serial tyre card assembled client-side by `buildFleetBoard`. The mount set is a
 * SERVER-SCOPED selector over the one holder register
 * (`GET /api/mro/assets/holder`, seated tyres only) gated on the plate master so
 * the board never seats empty plates.
 *
 * The bottom action bar is the app's shared list toolbar (`ListPage`): a fitment
 * filter (all / fully / partly / bare — the row badge's own split) on the left, a
 * toolbar search in the pill, and a ↻ refresh on the right. BOTH view rules are
 * LOCAL narrows of the already-complete board (`data/board-filter.ts`) — the whole
 * fleet is in memory, so a search is instant and can never return fewer trucks
 * than the server would. Searching also matches the serial of every mounted tyre,
 * so a serial lookup lands on the truck wearing it.
 */
export default function TyreFitmentPage() {
	const navigate = useNavigate();
	const [view, setView] = useViewState(FITMENT_VIEW);
	const { status: fitmentFilter } = view;

	// The plate master this screen joins — the SHARED vehicle masters read.
	const vehicles = useVehicleMasters();

	// Every CURRENTLY-MOUNTED serial tyre — server-scoped + display-ready (plate,
	// model name + reference tread resolved server-side).
	const mountedQuery = useQuery({
		queryKey: qk.mountedTyres(),
		queryFn: () => fetchMountedTyres(),
		// NOT gated on the plates — the read does not use them (the board joins at
		// render), so both fire in PARALLEL instead of one after the other.
		staleTime: TYRE_STALE_MS,
	});

	const rows: VehicleBoardState[] = useMemo(
		() => buildFleetBoard(vehicles.data ?? [], mountedQuery.data ?? []),
		[vehicles.data, mountedQuery.data],
	);

	// The board is fully in memory, so the toolbar search narrows the SAME rows the
	// list shows — no round trip, and the results can only ever be a subset of what
	// the user could scroll to.
	const searchBoard = useCallback(async (query: string) => rows.filter((vehicle) => matchesBoardSearch(vehicle, query)), [rows]);

	// Tapping a truck opens its FULL-SCREEN wheel-position page — the old
	// fitment bottom sheet is now a real route with a back arrow.
	const openVehicle = useCallback(
		(vehicle: VehicleBoardState) => {
			hapticSelection();
			navigate(`/app/tyres/vehicle/${vehicle.id}`);
		},
		[navigate],
	);
	const renderRow = useCallback(
		(vehicle: VehicleBoardState) => <TyreFitmentRow key={vehicle.id} vehicle={vehicle} onOpen={openVehicle} />,
		[openVehicle],
	);

	return (
		<ListPage
			title="On vehicles"
			rows={rows}
			isPending={mountedQuery.isPending}
			isError={mountedQuery.isError}
			onRetry={() => void mountedQuery.refetch()}
			skeletonVariant="vehicle"
			renderItem={renderRow}
			emptyState={{
				title: 'No vehicle fitment to show',
				hint: "Trucks declare their wheel layout on the plate master; tap a fitted wheel on a truck card to see its serial's history.",
			}}
			searchPlaceholder="Search plate / serial"
			searchScopeNote="Searches the loaded board only — scroll to load more trucks."
			fetchSearch={searchBoard}
			filter={{
				value: fitmentFilter,
				onChange: (value) => setView({ status: value }),
				options: FITMENT_FILTER_OPTIONS,
				centerLabel: FITMENT_FILTER_LABELS[fitmentFilter],
				sheetTitle: 'Filter by fitment',
				matches: matchesFitmentFilter,
				emptyTitle: 'No trucks match this filter',
			}}
			rightExtra={
				<button
					type="button"
					onClick={() => {
						hapticImpact('light');
						void mountedQuery.refetch();
					}}
					disabled={mountedQuery.isRefetching}
					aria-label="Refresh"
					className={`${GLASS_ICON_BUTTON} ${GLASS_ICON_BUTTON_IDLE} disabled:opacity-50`}
				>
					<RefreshCw className={`size-4${mountedQuery.isRefetching ? ' animate-spin' : ''}`} strokeWidth={2.2} aria-hidden />
				</button>
			}
		/>
	);
}
