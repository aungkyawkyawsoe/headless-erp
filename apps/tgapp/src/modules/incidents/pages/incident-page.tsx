import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { fetchIncidentTruckMatches } from '../data/api';
import { INCIDENTS_STALE_MS, qk } from '../data/query-keys';
import type { IncidentTruckMatch } from '../data/types';
import { SearchKiosk } from '@/shared/components/search-kiosk';
import { TruckGroupCard } from '@/shared/components/truck-groups';

/**
 * Accidents & Incidents — the launcher app behind the `emergency` tile
 * (`/app/incidents`), read live from the REAL `veh_incidents` collection (bound
 * to the `veh_fleets` plate directory).
 *
 * Search-first, the SAME shared kiosk shape as Fluid / insurance / license /
 * maintenance: it opens BLANK with ONE centred plate search (zero reads while
 * idle) and runs only a debounced lazy read once the operator types. A single
 * match — or a picked suggestion — opens that truck's record file directly; the
 * grouped register stays one tap away at `/app/incidents/browse`.
 *
 * The state machine, search pill, suggestion listbox and result states all live
 * in the shared `SearchKiosk` — this page only supplies the truck row card, its
 * server search and the module's cache tier.
 */
export default function IncidentPage() {
	const navigate = useNavigate();

	const openTruck = useCallback(
		(match: IncidentTruckMatch) => {
			// Hand the matched truck to the per-truck page through router state so its
			// header paints instantly — no identity read on the tap path.
			navigate(`/app/incidents/vehicle/${match.vehicleId}`, {
				state: { row: { vehicleId: match.vehicleId, plate: match.plate, brand: match.brand } },
			});
		},
		[navigate],
	);

	return (
		<SearchKiosk<IncidentTruckMatch>
			title="Accidents & Incidents"
			heading="Find a vehicle"
			placeholder="Enter plate no (e.g. 6S-2439)"
			inputLabel="Vehicle plate number"
			search={fetchIncidentTruckMatches}
			queryKeyPrefix={qk.incidents()}
			staleTime={INCIDENTS_STALE_MS}
			keyOf={(match) => match.vehicleId}
			primaryText={(match) => match.plate}
			secondaryText={(match) => match.brand || 'Unit'}
			renderResult={(match) => (
				<TruckGroupCard
					key={match.vehicleId}
					plate={match.plate}
					brand={match.brand}
					countLabel={null}
					items={[]}
					onOpen={() => openTruck(match)}
					openLabel="view or log an incident"
				/>
			)}
			onPick={openTruck}
			notFoundHint="Check the plate number and try again — e.g. 6S-2439."
			skeletonVariant="incidents"
			browse={{ to: '/app/incidents/browse', label: 'Browse all records' }}
		/>
	);
}
