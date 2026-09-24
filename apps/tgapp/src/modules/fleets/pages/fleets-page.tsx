import { useCallback } from 'react';
import { FleetCard } from '../components/fleet-card';
import { fetchFleetsSearch } from '../data/api';
import { FLEET_STALE_MS, qk } from '../data/query-keys';
import { UNIT_TYPE_LABELS } from '../data/status';
import type { FleetCardModel } from '../data/types';
import { SearchKiosk } from '@/shared/components/search-kiosk';

/**
 * ယာဉ် — the fleet lookup (`/app/fleets`, launcher tile `vehicles`), now the
 * app's search-first KIOSK shape (same as Daily ODO): it opens BLANK with one
 * centred plate search and runs ZERO reads while idle — the old page-1 read of
 * the whole catalog is gone for a screen whose typical job is to find ONE
 * truck. Only a settled typed term fires the bounded server `?search=` read
 * (`fetchFleetsSearch` — plate / brand / model, the SAME card the browse
 * register renders, care chips included).
 *
 * The full vehicle register is NOT gone — "Browse all vehicles" (idle stage)
 * opens it at `/app/fleets/browse`, where the old cursor list lives with its
 * unit-type filter. There is no per-vehicle detail page; a suggestion only
 * FILLS the field, and pressing Search lists the matched trucks below — each
 * card's body opens the truck's on-board inventory, and its photo tile sets
 * the truck's photo.
 */
export default function FleetsPage() {
	const renderResult = useCallback((fleet: FleetCardModel) => <FleetCard key={fleet.id} fleet={fleet} />, []);

	return (
		<SearchKiosk<FleetCardModel>
			title="Vehicles"
			heading="Find a vehicle"
			placeholder="Enter plate / brand / model"
			inputLabel="Vehicle plate, brand or model"
			search={fetchFleetsSearch}
			queryKeyPrefix={qk.fleets()}
			staleTime={FLEET_STALE_MS}
			keyOf={(fleet) => fleet.id}
			primaryText={(fleet) => fleet.plateNo}
			secondaryText={(fleet) => {
				const unitLabel = fleet.unitType ? (UNIT_TYPE_LABELS[fleet.unitType] ?? null) : null;
				return [fleet.brandLabel || 'Unit', unitLabel].filter(Boolean).join(' · ') || null;
			}}
			renderResult={renderResult}
			notFoundHint="Check the plate number and try again — e.g. 6S-2439."
			skeletonVariant="fleet"
			browse={{ to: '/app/fleets/browse', label: 'Browse all vehicles' }}
		/>
	);
}
