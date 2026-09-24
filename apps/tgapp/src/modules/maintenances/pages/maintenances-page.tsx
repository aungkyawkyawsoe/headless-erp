import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { MaintenanceTruckRow } from '../components/maintenance-truck-row';
import { fetchMaintenanceTruckMatches } from '../data/api';
import { MAINTENANCE_STALE_MS, qk } from '../data/query-keys';
import type { TruckMaintenanceMatch } from '../data/types';
import { SearchKiosk } from '@/shared/components/search-kiosk';

/**
 * ပြင်ဆင် — the vehicle-maintenance app behind the `maintenance` tile
 * (`/app/maintenances`).
 *
 * Search-first, the SAME shared kiosk shape as Fluid / insurance / license: it
 * opens BLANK with ONE centred plate search (zero reads while idle) and runs
 * only a debounced lazy read once the operator types. A single match — or a
 * picked suggestion — opens that truck's maintenance file directly; the tabbed
 * register stays one tap away at `/app/maintenances/browse`.
 *
 * The state machine, search pill, suggestion listbox and result states all live
 * in the shared `SearchKiosk` — this page only supplies the truck row card, its
 * server search and the module's cache tier.
 */
export default function MaintenancesPage() {
	const navigate = useNavigate();

	const openTruck = useCallback(
		(match: TruckMaintenanceMatch) => {
			// Hand the matched truck to the per-truck page through router state so its
			// header paints instantly (plate/brand) — the file itself is fetched there.
			navigate(`/app/maintenances/vehicle/${match.vehicleId}`, {
				state: { row: { vehicleId: match.vehicleId, plate: match.plate, brand: match.brandLabel } },
			});
		},
		[navigate],
	);

	return (
		<SearchKiosk<TruckMaintenanceMatch>
			title="Vehicle maintenance"
			heading="Find a vehicle"
			placeholder="Enter plate no (e.g. 6S-2439)"
			inputLabel="Vehicle plate number"
			search={fetchMaintenanceTruckMatches}
			queryKeyPrefix={qk.logs()}
			staleTime={MAINTENANCE_STALE_MS}
			keyOf={(match) => match.vehicleId}
			primaryText={(match) => match.plate}
			secondaryText={(match) => match.brandLabel || 'Unit'}
			renderResult={(match) => <MaintenanceTruckRow key={match.vehicleId} match={match} onOpen={openTruck} />}
			onPick={openTruck}
			notFoundHint="Check the plate number and try again — e.g. 6S-2439."
			skeletonVariant="maintenance"
			browse={{ to: '/app/maintenances/browse', label: 'Browse all vehicles' }}
		/>
	);
}
