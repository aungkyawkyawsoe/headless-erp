import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { LicenseTruckRow } from '../components/license-truck-row';
import { fetchLicenseTruckMatches, permitSummaryOf } from '../data/api';
import { LICENSE_STALE_MS, qk } from '../data/query-keys';
import type { LicenseTruckMatch } from '../data/types';
import { SearchKiosk } from '@/shared/components/search-kiosk';

/**
 * Licenses — the launcher app behind the `licenses` tile (`/app/licenses`),
 * read live from the REAL `veh_permits` collection (bound to the `veh_fleets`
 * plate directory).
 *
 * Search-first, the SAME shared kiosk shape as Fluid / tyre / insurance: it
 * opens BLANK with ONE centred plate search (zero reads while idle) and runs
 * only a debounced lazy read once the operator types. A single match — or a
 * picked suggestion — opens that truck's license page directly; the grouped
 * register stays one tap away at `/app/licenses/browse`.
 *
 * The state machine, search pill, suggestion listbox and result states all live
 * in the shared `SearchKiosk` — this page only supplies the truck row card, its
 * server search and the module's cache tier.
 */
export default function LicensesPage() {
	const navigate = useNavigate();

	const openTruck = useCallback(
		(match: LicenseTruckMatch) => {
			// Hand the matched truck to the per-truck page through router state — its
			// header paints instantly AND the renewal form carries the current permit
			// summary over (number + expiry gate — no read on the record view).
			navigate(`/app/licenses/${match.vehicleId}`, {
				state: {
					row: {
						vehicleId: match.vehicleId,
						plate: match.plate,
						brand: match.brand,
						current: permitSummaryOf(match.record),
					},
				},
			});
		},
		[navigate],
	);

	return (
		<SearchKiosk<LicenseTruckMatch>
			title="Licenses"
			heading="Find a vehicle"
			placeholder="Enter plate no (e.g. 6S-2439)"
			inputLabel="Vehicle plate number"
			search={fetchLicenseTruckMatches}
			queryKeyPrefix={qk.licenses()}
			staleTime={LICENSE_STALE_MS}
			keyOf={(match) => match.vehicleId}
			primaryText={(match) => match.plate}
			secondaryText={(match) => `${match.brand || 'Unit'}${match.record?.licenseNo ? ` · ${match.record.licenseNo}` : ''}`}
			renderResult={(match) => <LicenseTruckRow key={match.vehicleId} match={match} onOpen={openTruck} />}
			onPick={openTruck}
			notFoundHint="Check the plate number and try again — e.g. 6S-2439."
			skeletonVariant="license"
			browse={{ to: '/app/licenses/browse', label: 'Browse all licenses' }}
		/>
	);
}
