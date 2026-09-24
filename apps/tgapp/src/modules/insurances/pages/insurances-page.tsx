import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { InsuranceTruckRow } from '../components/insurance-truck-row';
import { fetchInsuranceTruckMatches, insuranceCurrentOf } from '../data/api';
import { INSURANCE_STALE_MS, qk } from '../data/query-keys';
import type { InsuranceTruckMatch } from '../data/types';
import { SearchKiosk } from '@/shared/components/search-kiosk';

/**
 * Insurances — the launcher app behind the `insurance` tile (`/app/insurances`),
 * read live from the REAL `veh_insurances` collection (bound to the `veh_fleets`
 * plate directory).
 *
 * Search-first, the SAME shared kiosk shape as Fluid / tyre / license: it opens
 * BLANK with ONE centred plate search (zero reads while idle) and runs only a
 * debounced lazy read once the operator types. A single match — or a picked
 * suggestion — opens that truck's policy page directly; the grouped register
 * stays one tap away at `/app/insurances/browse`.
 *
 * The state machine, search pill, suggestion listbox and result states all live
 * in the shared `SearchKiosk` — this page only supplies the truck row card, its
 * server search and the module's cache tier.
 */
export default function InsurancesPage() {
	const navigate = useNavigate();

	const openTruck = useCallback(
		(match: InsuranceTruckMatch) => {
			// Hand the matched truck to the per-truck page through router state so its
			// header paints instantly AND the record view carries the current policy
			// summary over (the renew gate — no read on the record screen).
			navigate(`/app/insurances/${match.vehicleId}`, {
				state: {
					row: {
						vehicleId: match.vehicleId,
						plate: match.plate,
						brand: match.brand,
						current: insuranceCurrentOf(match.record),
					},
				},
			});
		},
		[navigate],
	);

	return (
		<SearchKiosk<InsuranceTruckMatch>
			title="Insurances"
			heading="Find a vehicle"
			placeholder="Enter plate no (e.g. 6S-2439)"
			inputLabel="Vehicle plate number"
			search={fetchInsuranceTruckMatches}
			queryKeyPrefix={qk.insurances()}
			staleTime={INSURANCE_STALE_MS}
			keyOf={(match) => match.vehicleId}
			primaryText={(match) => match.plate}
			secondaryText={(match) => `${match.brand || 'Unit'}${match.record?.provider ? ` · ${match.record.provider}` : ''}`}
			renderResult={(match) => <InsuranceTruckRow key={match.vehicleId} match={match} onOpen={openTruck} />}
			onPick={openTruck}
			notFoundHint="Check the plate number and try again — e.g. 6S-2439."
			skeletonVariant="insurance"
			browse={{ to: '/app/insurances/browse', label: 'Browse all policies' }}
		/>
	);
}
