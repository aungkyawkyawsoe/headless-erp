import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { TyreFitmentRow } from '../components/tyre-fitment-row';
import { TyreModuleScopeNav } from '../components/tyre-module-scope-nav';
import { fetchMountedTyres } from '../data/api';
import { buildFleetBoard, type VehicleBoardState } from '../data/board';
import { qk, TYRE_STALE_MS } from '../data/query-keys';
import { SearchKiosk } from '@/shared/components/search-kiosk';
import { useVehicleMasters } from '@/shared/lookups/hooks';

/**
 * တာယာ → By Fleet — the plate-search-first fleet lookup (`/app/tyres/fleet`,
 * the module's second scope tab after By Serial).
 *
 * Like By Serial this is NOT a browse-all register: the shared `SearchKiosk`
 * opens with ONE centred plate search (zero reads while idle) whose suggestions
 * are a pure client filter over the already-cached fleet board — no request
 * fires per keystroke. A single match — or a picked suggestion — opens the
 * truck's full-screen wheel-position page directly; the all-vehicles BOARD
 * stays reachable from the idle "Browse all vehicles" link (`/app/tyres/fitment`).
 *
 * The state machine, search pill, suggestion listbox and result states all live
 * in the shared `SearchKiosk`. The scope-tab row rides in its `subheader`.
 */
export default function TyreFleetPage() {
	const navigate = useNavigate();

	// Scope-tab switches REPLACE the current entry (tabs are view state, not
	// navigation) — flicking By Serial ↔ By Fleet never stacks history.
	const switchScope = useCallback((to: string) => navigate(to, { replace: true }), [navigate]);

	// The plate master this tab joins — the SHARED vehicle masters read. Search
	// is gated on it so a result's plate/brand names are never blank.
	const vehicles = useVehicleMasters();

	// Every CURRENTLY-MOUNTED serial tyre — the same server-scoped read the board
	// uses (shared cache), so each matched plate can show its fitted/total count
	// and the full wheel page opens without a second read.
	const mountedQuery = useQuery({
		queryKey: qk.mountedTyres(),
		queryFn: () => fetchMountedTyres(),
		// NOT gated on the plates — this read does not use them (the board joins at
		// render), so firing both in PARALLEL avoids a serial round trip on first load.
		staleTime: TYRE_STALE_MS,
	});

	const ready = !vehicles.isPending && !mountedQuery.isPending;

	// The whole plate board — filtered by the submitted query below. Only plates
	// that can carry wheels appear (the board's own rule).
	const boardRows: VehicleBoardState[] = useMemo(
		() => buildFleetBoard(vehicles.data ?? [], mountedQuery.data ?? []),
		[vehicles.data, mountedQuery.data],
	);

	const matchesFor = useCallback(
		async (code: string): Promise<VehicleBoardState[]> => {
			const needle = code.trim().toLowerCase();
			if (!needle) return [];
			return boardRows.filter((vehicle) => vehicle.plateNo.toLowerCase().includes(needle));
		},
		[boardRows],
	);

	const openVehicle = useCallback(
		(vehicle: VehicleBoardState) => {
			navigate(`/app/tyres/vehicle/${vehicle.id}`);
		},
		[navigate],
	);

	return (
		<SearchKiosk<VehicleBoardState>
			title="By Fleet"
			heading="Find a vehicle"
			placeholder="Enter plate no (e.g. 2H/1234)"
			inputLabel="Vehicle plate number"
			search={matchesFor}
			queryKeyPrefix={qk.fleetKiosk()}
			staleTime={TYRE_STALE_MS}
			enabled={ready}
			subheader={<TyreModuleScopeNav active="fleet" onNavigate={switchScope} />}
			keyOf={(vehicle) => vehicle.id}
			primaryText={(vehicle) => vehicle.plateNo}
			secondaryText={(vehicle) =>
				`${[vehicle.brandLabel, vehicle.unitLabel].filter((part): part is string => Boolean(part)).join(' · ') || 'Unit'} · ${vehicle.seats.length} wheels`
			}
			renderResult={(vehicle) => <TyreFitmentRow key={vehicle.id} vehicle={vehicle} onOpen={openVehicle} />}
			onPick={openVehicle}
			notFoundHint="Check the plate number and try again — e.g. 2H/1234."
			skeletonVariant="vehicle"
			browse={{ to: '/app/tyres/fitment', label: 'Browse all vehicles' }}
		/>
	);
}
