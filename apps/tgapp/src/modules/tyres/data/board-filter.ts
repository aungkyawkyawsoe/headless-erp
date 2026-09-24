/**
 * The fitment board's two view rules — the status filter's matcher and the
 * toolbar search's needle test. Pure functions over `VehicleBoardState`, so both
 * are unit-tested without a running app.
 *
 * Both narrow LOCALLY by design: `buildFleetBoard` assembles the whole board in
 * memory from the plate master + the mounted register, so the fleet is already
 * complete on screen — a round trip could only ever return rows the client is
 * holding anyway, and a local narrow keeps a plate lookup instant.
 */
import type { VehicleBoardState } from './board';

/** The board's fitment-state filter — the row badge's own three states, plus the
 *  `'all'` inactive sentinel every list filter in the app shares. */
export type FitmentFilterValue = 'all' | 'full' | 'partial' | 'bare';

/** Union membership — the `enumParam` value list (the URL parser + the sheet). */
export const FITMENT_FILTER_VALUES: readonly FitmentFilterValue[] = ['all', 'full', 'partial', 'bare'];

/** Filter value → the bar pill's center label AND the sheet row's copy — one
 *  source, so the two can never disagree. */
export const FITMENT_FILTER_LABELS: Record<FitmentFilterValue, string> = {
	all: 'All',
	full: 'Fully fitted',
	partial: 'Partly fitted',
	bare: 'Bare (no tyres)',
};

/** The sheet's rows — `All` first, then the domain values (the shared order). */
export const FITMENT_FILTER_OPTIONS: ReadonlyArray<{ value: FitmentFilterValue; label: string }> = FITMENT_FILTER_VALUES.map((value) => ({
	value,
	label: FITMENT_FILTER_LABELS[value],
}));

/** How many of a truck's declared seats currently wear a tyre. */
export function fittedCount(vehicle: VehicleBoardState): number {
	return vehicle.mount.size;
}

/**
 * Does this truck's fitment state equal `value`? `'all'` matches everything (the
 * list shell short-circuits it too, but the predicate stays total over its own
 * type). `bare` = nothing fitted, `full` = every declared seat shod, `partial` =
 * somewhere in between — the same split the row's fitted/total badge tints.
 */
export function matchesFitmentFilter(vehicle: VehicleBoardState, value: FitmentFilterValue): boolean {
	if (value === 'all') return true;
	const fitted = fittedCount(vehicle);
	if (value === 'bare') return fitted === 0;
	if (value === 'full') return fitted === vehicle.seats.length;
	return fitted > 0 && fitted < vehicle.seats.length;
}

/**
 * Does the truck match the toolbar search? Plate, brand and unit type, PLUS the
 * serial number of every tyre it wears — the board is vehicle-first, so a serial
 * lookup ("TYR-5S6467-03") must find the truck carrying it, not just the trucks
 * whose own identity happens to start with those characters. An empty/whitespace
 * query matches everything (the "not searching" contract).
 */
export function matchesBoardSearch(vehicle: VehicleBoardState, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (needle === '') return true;
	if ([vehicle.plateNo, vehicle.brandLabel, vehicle.unitLabel].some((field) => field?.toLowerCase().includes(needle))) return true;
	for (const tyre of vehicle.mount.values()) {
		if (tyre.serialNo?.toLowerCase().includes(needle)) return true;
	}
	return false;
}
