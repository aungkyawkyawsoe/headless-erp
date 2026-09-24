import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { TyreCard } from '../components/tyre-card';
import { TyreModuleScopeNav } from '../components/tyre-module-scope-nav';
import { fetchTyresSearch, type TyreLookups } from '../data/api';
import { qk, TYRE_STALE_MS } from '../data/query-keys';
import type { TyreCardModel } from '../data/types';
import { SearchKiosk } from '@/shared/components/search-kiosk';
import { useMroItemModels } from '@/shared/hooks/use-mro-item-models';
import { useVehicleMasters } from '@/shared/lookups/hooks';

/**
 * တာယာ → By Serial — the serial unit LOOKUP (`/app/tyres/serial`, the module's
 * DEFAULT scope tab: the module root `/app/tyres` redirects here).
 *
 * This tab is deliberately NOT a browse-all register: the shared kiosk asks
 * "what is this tyre's story?" with ONE centred serial-code search (zero reads
 * while idle). Matching serials are suggested as the operator types (debounced
 * server `?search=`), and a single match — or a picked suggestion — opens the
 * tyre's full-screen lifecycle page directly. Several matches list only those
 * cards to pick from; the all-vehicles BOARD lives on the By Fleet tab.
 *
 * The state machine, search pill, suggestion listbox and result states all live
 * in the shared `SearchKiosk`. The scope-tab row rides in its `subheader` so it
 * stays visible across both stages.
 */
export default function TyresPage() {
	const navigate = useNavigate();

	// Scope-tab switches REPLACE the current entry (tabs are view state, not
	// navigation) — flicking By Serial ↔ By Fleet never stacks history.
	const switchScope = useCallback((to: string) => navigate(to, { replace: true }), [navigate]);

	// The join data — the SHARED vehicle masters (plates) + the SHARED
	// `['mro','item-models']` SKU directory (serial-tracked entries are the tyres).
	// Search is gated on both so a result's plate/model names are never blank.
	const vehicles = useVehicleMasters();
	const models = useMroItemModels();
	const lookups: TyreLookups = useMemo(() => ({ vehicles: vehicles.data ?? [], models: models.data ?? [] }), [vehicles.data, models.data]);
	const lookupsReady = !vehicles.isPending && !models.isPending;

	const search = useCallback((query: string) => fetchTyresSearch(lookups, query), [lookups]);

	const openDetails = useCallback(
		(tyre: TyreCardModel) => {
			// The register card rides in router state so the page header paints instantly.
			navigate(`/app/tyres/tyre/${tyre.id}`, { state: { tyre } });
		},
		[navigate],
	);

	return (
		<SearchKiosk<TyreCardModel>
			title="By Serial"
			heading="Find a tyre"
			placeholder="Enter tyre serial code"
			inputLabel="Tyre serial code"
			search={search}
			queryKeyPrefix={qk.serialKiosk()}
			staleTime={TYRE_STALE_MS}
			enabled={lookupsReady}
			subheader={<TyreModuleScopeNav active="serial" onNavigate={switchScope} />}
			keyOf={(tyre) => tyre.id}
			primaryText={(tyre) => tyre.serialNo ?? '—'}
			secondaryText={(tyre) => [tyre.modelName ?? 'Tyre', tyre.plateNo].filter(Boolean).join(' · ')}
			renderResult={(tyre) => <TyreCard key={tyre.id} tyre={tyre} onOpen={openDetails} />}
			onPick={openDetails}
			notFoundHint="Check the serial code and try again — e.g. TY-2026-0001."
			skeletonVariant="tyre"
		/>
	);
}
