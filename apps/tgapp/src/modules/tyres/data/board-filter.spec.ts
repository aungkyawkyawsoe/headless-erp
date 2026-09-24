import { describe, expect, it } from 'vitest';

import type { VehicleBoardState } from './board';
import {
	FITMENT_FILTER_LABELS,
	FITMENT_FILTER_OPTIONS,
	FITMENT_FILTER_VALUES,
	matchesBoardSearch,
	matchesFitmentFilter,
} from './board-filter';
import type { TyreCardModel } from './types';

/** A register unit — the board's search only reads `serialNo`. */
function tyre(over: Partial<TyreCardModel> & { id: string }): TyreCardModel {
	return {
		kind: 'tyre',
		modelName: 'R268',
		serialNo: null,
		status: 'issued',
		itemNameEn: null,
		itemNameMm: null,
		plateNo: '5S-6467',
		slot: null,
		employeeId: null,
		employeeName: null,
		locationLabel: null,
		treadMm: null,
		psi: null,
		condition: null,
		referenceTreadMm: null,
		...over,
	};
}

/** A 4-seat truck; `serials` fill its seats left to right (0 … 4 filled). */
function board(plate: string, serials: string[], over: Partial<VehicleBoardState> = {}): VehicleBoardState {
	const seats = [
		{ id: 'steer-l', label: 'FL1' },
		{ id: 'steer-r', label: 'FR1' },
		{ id: 'drv1-lo', label: 'RL1-O' },
		{ id: 'drv1-ro', label: 'RR1-O' },
	];
	const mount = new Map<string, TyreCardModel>();
	serials.forEach((serialNo, index) => mount.set(seats[index].id, tyre({ id: `t${index}`, serialNo })));
	return { id: plate, plateNo: plate, brandLabel: 'HINO', unitLabel: 'box', wheelCount: seats.length, seats, mount, ...over };
}

const ALL = [board('BARE-1', []), board('PART-1', ['BR-1']), board('FULL-1', ['BR-1', 'BR-2', 'BR-3', 'BR-4'])];

/** The plates a predicate keeps — the board's own row set, narrowed. */
const kept = (value: Parameters<typeof matchesFitmentFilter>[1]) =>
	ALL.filter((vehicle) => matchesFitmentFilter(vehicle, value)).map((vehicle) => vehicle.plateNo);

describe('matchesFitmentFilter', () => {
	it('splits the fleet by how many declared seats wear a tyre', () => {
		expect(kept('all')).toEqual(['BARE-1', 'PART-1', 'FULL-1']);
		expect(kept('bare')).toEqual(['BARE-1']);
		expect(kept('partial')).toEqual(['PART-1']);
		expect(kept('full')).toEqual(['FULL-1']);
	});

	it('reads the SAME fitted/total split the row badge tints', () => {
		// The badge is danger at 0, warning below total, success at total — so the
		// three states are mutually exclusive and together cover every truck.
		for (const vehicle of ALL) {
			const states = FITMENT_FILTER_VALUES.filter((value) => value !== 'all' && matchesFitmentFilter(vehicle, value));
			expect(states, vehicle.plateNo).toHaveLength(1);
		}
	});
});

describe('matchesBoardSearch', () => {
	it('matches on plate / brand / unit type, case-insensitively and on a substring', () => {
		expect(matchesBoardSearch(ALL[1], 'part')).toBe(true);
		expect(matchesBoardSearch(ALL[1], 'hino')).toBe(true);
		expect(matchesBoardSearch(ALL[1], 'BOX')).toBe(true);
		expect(matchesBoardSearch(ALL[1], 'zzz')).toBe(false);
	});

	it('finds the truck by the serial of a tyre it wears — the board is vehicle-first', () => {
		expect(matchesBoardSearch(ALL[2], 'br-4')).toBe(true);
		expect(matchesBoardSearch(ALL[1], 'br-4')).toBe(false);
	});

	it('an empty or whitespace query is "not searching" — every truck passes', () => {
		for (const vehicle of ALL) {
			expect(matchesBoardSearch(vehicle, '')).toBe(true);
			expect(matchesBoardSearch(vehicle, '   ')).toBe(true);
		}
	});
});

describe('the fitment filter vocabulary', () => {
	it('offers All first and one labelled row per value — the bar label IS the sheet row', () => {
		expect(FITMENT_FILTER_OPTIONS.map((option) => option.value)).toEqual([...FITMENT_FILTER_VALUES]);
		expect(FITMENT_FILTER_OPTIONS[0].value).toBe('all');
		for (const option of FITMENT_FILTER_OPTIONS) {
			expect(option.label).toBe(FITMENT_FILTER_LABELS[option.value]);
			expect(option.label.length).toBeGreaterThan(0);
		}
	});
});
