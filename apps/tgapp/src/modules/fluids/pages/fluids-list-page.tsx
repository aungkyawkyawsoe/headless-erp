import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { FluidRowCard } from '../components/fluid-row-card';
import { fetchFluidsSearch } from '../data/api';
import { FLUID_LIST_STALE_MS, qk } from '../data/query-keys';
import type { FluidListModel } from '../data/types';
import { SearchKiosk } from '@/shared/components/search-kiosk';

/**
 * Fluid — the launcher app behind the `fluid` tile (`/app/fluid`).
 *
 * Search-first, the SAME shared kiosk shape as Daily ODO / tyre / insurance /
 * license: it opens BLANK with ONE centred plate search (zero reads while idle)
 * and runs only a debounced server `?search=` read once the operator types. A
 * single match — or a picked suggestion — opens that vehicle's service page
 * directly; the full register stays one tap away at `/app/fluid/browse`.
 *
 * The state machine, search pill, suggestion listbox and result states all live
 * in the shared `SearchKiosk` — this page only supplies the vehicle row card,
 * its server search and the module's cache tier.
 */
export default function FluidsListPage() {
	const navigate = useNavigate();

	const openVehicle = useCallback(
		(vehicle: FluidListModel) => {
			// Hand the tapped row to the vehicle page through router state so its
			// header + hero paint instantly (plate/brand/odo) — never refetch.
			navigate(`/app/fluid/${vehicle.id}`, { state: { row: vehicle } });
		},
		[navigate],
	);

	return (
		<SearchKiosk<FluidListModel>
			title="Fluid"
			heading="Find a vehicle"
			placeholder="Enter plate no (e.g. 6S-2439)"
			inputLabel="Vehicle plate number"
			search={fetchFluidsSearch}
			queryKeyPrefix={qk.list()}
			staleTime={FLUID_LIST_STALE_MS}
			keyOf={(vehicle) => vehicle.id}
			primaryText={(vehicle) => vehicle.plateNo}
			secondaryText={(vehicle) =>
				`${vehicle.brandLabel || 'Unit'}${vehicle.currentOdo != null ? ` · ${vehicle.currentOdo.toLocaleString()} km` : ''}`
			}
			renderResult={(vehicle) => <FluidRowCard key={vehicle.id} vehicle={vehicle} />}
			onPick={openVehicle}
			notFoundHint="Check the plate number and try again — e.g. 6S-2439."
			skeletonVariant="vehicle"
			browse={{ to: '/app/fluid/browse', label: 'Browse all vehicles' }}
		/>
	);
}
