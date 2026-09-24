import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { OdoRowCard } from '../components/odo-row-card';
import { fetchOdoSearch } from '../data/api';
import { ODO_LIST_STALE_MS, qk } from '../data/query-keys';
import type { OdoListModel } from '../data/types';
import { SearchKiosk } from '@/shared/components/search-kiosk';

/**
 * Daily ODO — the launcher app behind the `daily-odo` tile (`/app/daily-odo`).
 *
 * Search-first, the SAME shared kiosk shape as Fluid / tyre / insurance /
 * license / maintenance: it opens BLANK with ONE centred plate search (zero
 * reads while idle) and runs only a debounced server `?search=` read once the
 * operator types. A single match — or a picked suggestion — opens that
 * vehicle's record page directly; the full register stays one tap away at
 * `/app/daily-odo/browse`.
 *
 * The state machine, search pill, suggestion listbox and result states all live
 * in the shared `SearchKiosk` — this page only supplies the ODO row card, its
 * server search and the module's cache tier. (It used to carry a ~130-line
 * hand-rolled copy of the kiosk, one per module.)
 */
export default function OdoListPage() {
	const navigate = useNavigate();

	const openVehicle = useCallback(
		(vehicle: OdoListModel) => {
			// Hand the tapped row to the vehicle page through router state so its
			// header AND the record form's odo prefill never refetch.
			navigate(`/app/daily-odo/${vehicle.id}`, { state: { row: vehicle } });
		},
		[navigate],
	);

	return (
		<SearchKiosk<OdoListModel>
			title="Daily ODO"
			heading="Find a vehicle"
			placeholder="Enter plate no (e.g. 6S-2439)"
			inputLabel="Vehicle plate number"
			search={fetchOdoSearch}
			queryKeyPrefix={qk.list()}
			staleTime={ODO_LIST_STALE_MS}
			keyOf={(vehicle) => vehicle.id}
			primaryText={(vehicle) => vehicle.plateNo}
			secondaryText={(vehicle) =>
				`${vehicle.brandLabel || 'Unit'}${vehicle.latestKm != null ? ` · ${vehicle.latestKm.toLocaleString()} km` : ''}`
			}
			renderResult={(vehicle) => <OdoRowCard key={vehicle.id} vehicle={vehicle} />}
			onPick={openVehicle}
			notFoundHint="Check the plate number and try again — e.g. 6S-2439."
			skeletonVariant="vehicle"
			browse={{ to: '/app/daily-odo/browse', label: 'Browse all vehicles' }}
		/>
	);
}
