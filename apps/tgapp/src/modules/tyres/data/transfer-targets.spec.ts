import { describe, expect, it } from 'vitest';

import type { VehicleMasterRow } from '@/shared/lookups/types';
import { custodyDestinationKinds, transferTargetEmployees, transferTargetTrucks, vehicleCarriesTyres } from './transfer-targets';

/**
 * The ONE rule that decides which trucks a governed transfer request may name.
 * A request names a DESTINATION TRUCK, never a wheel position, so the two kinds
 * differ only in which trucks qualify: a TYRE needs a truck it can be worn on
 * (wheel-capable), an ASSET rides loose (any plated truck). Either way the truck
 * already holding the unit is dropped — the no-op the engine rejects. These pin
 * the rule so the filer can never offer a destination the engine would refuse.
 */

const truck = (id: string, plate: string | null, extra: Partial<VehicleMasterRow> = {}): VehicleMasterRow => ({
	id,
	plate_no: plate,
	...extra,
});

const WHEELED = truck('v1', 'TRK-1001', { wheel: 10 });
const WHEELED_B = truck('v2', 'TRK-1002', { wheel_slots: [{ id: 'steer-l' }] });
const NO_WHEELS = truck('v3', 'TRK-1003', { wheel: 0, wheel_slots: [] });
const NO_PLATE = truck('v4', null, { wheel: 6 });
const PLATE_STRING_SLOTS = truck('v5', 'TRK-1005', { wheel_slots: '[{"id":"steer-l"}]' });

const plates = (rows: VehicleMasterRow[]) => rows.map((v) => v.plate_no);

describe('vehicleCarriesTyres — the shared capacity predicate', () => {
	it('accepts a declared wheel count or a non-empty seat list (array or JSON)', () => {
		expect(vehicleCarriesTyres({ wheel: 10 })).toBe(true);
		expect(vehicleCarriesTyres({ wheel_slots: [{ id: 'steer-l' }] })).toBe(true);
		expect(vehicleCarriesTyres({ wheel_slots: PLATE_STRING_SLOTS.wheel_slots })).toBe(true);
	});

	it('rejects a row with no wheels and an empty/absent seat list', () => {
		expect(vehicleCarriesTyres({ wheel: 0, wheel_slots: [] })).toBe(false);
		expect(vehicleCarriesTyres({ wheel_slots: '' })).toBe(false);
		expect(vehicleCarriesTyres({})).toBe(false);
	});
});

describe('transferTargetTrucks — kind-aware destinations', () => {
	const fleet = [WHEELED, WHEELED_B, NO_WHEELS, NO_PLATE, PLATE_STRING_SLOTS];

	it('a TYRE may target only wheel-capable trucks, EXCLUDING the one already holding it', () => {
		const rows = transferTargetTrucks('tyre', fleet, 'TRK-1002');
		expect(plates(rows)).toEqual(['TRK-1001', 'TRK-1005']);
	});

	it('a TYRE with no current truck keeps every wheel-capable truck', () => {
		const rows = transferTargetTrucks('tyre', fleet, null);
		expect(plates(rows)).toEqual(['TRK-1001', 'TRK-1002', 'TRK-1005']);
	});

	it('an ASSET may target any plated truck, EXCLUDING the one already holding it', () => {
		const rows = transferTargetTrucks('asset', fleet, 'TRK-1002');
		expect(plates(rows)).toEqual(['TRK-1001', 'TRK-1003', 'TRK-1005']);
	});

	it('an ASSET held by a person (no current truck) keeps every plated truck', () => {
		const rows = transferTargetTrucks('asset', fleet, null);
		expect(plates(rows)).toEqual(['TRK-1001', 'TRK-1002', 'TRK-1003', 'TRK-1005']);
	});

	it('drops plate-less rows in both modes and returns plates A→Z', () => {
		const shuffled = [PLATE_STRING_SLOTS, NO_PLATE, WHEELED_B, WHEELED];
		expect(plates(transferTargetTrucks('tyre', shuffled, null))).toEqual(['TRK-1001', 'TRK-1002', 'TRK-1005']);
		expect(plates(transferTargetTrucks('asset', shuffled, null))).toEqual(['TRK-1001', 'TRK-1002', 'TRK-1005']);
	});
});

/**
 * The destination-HOLDER rule. This is the half that keeps the filer from ever
 * offering a shape the engine 403s on: a truck-held unit is NEVER offered a
 * person (and vice versa) — that direction has no writer at all, so the only
 * honest thing to say is "return it to store, then issue it".
 */
describe('custodyDestinationKinds — who a held unit may be sent to', () => {
	it('a truck-held unit may go to another truck or back to the store — never to a person', () => {
		expect(custodyDestinationKinds({ plateNo: 'TRK-1001', employeeId: null })).toEqual(['vehicle', 'store']);
	});

	it('a person-held unit may go to another person or back to the store — never to a truck', () => {
		expect(custodyDestinationKinds({ plateNo: null, employeeId: 'e1' })).toEqual(['employee', 'store']);
	});

	it('a unit held by NEITHER has no governed destination (from store every move is direct)', () => {
		expect(custodyDestinationKinds({ plateNo: null, employeeId: null })).toEqual([]);
	});

	it('a blank plate or employee id counts as NO holder (never as a holder named "")', () => {
		expect(custodyDestinationKinds({ plateNo: '   ', employeeId: null })).toEqual([]);
		expect(custodyDestinationKinds({ plateNo: null, employeeId: '' })).toEqual([]);
	});

	it('a truck wins over a stale employee id — a seated unit is not person-held', () => {
		expect(custodyDestinationKinds({ plateNo: 'TRK-1001', employeeId: 'e1' })).toEqual(['vehicle', 'store']);
	});
});

describe('transferTargetEmployees — the person counterpart of the truck list', () => {
	const people = [
		{ id: 'e3', name: 'Zaw Lin' },
		{ id: 'e1', name: 'Aung Kyaw Moe' },
		{ id: 'e2', name: 'Ei Mon' },
	];

	it('drops the person already holding the unit and sorts by name', () => {
		expect(transferTargetEmployees(people, 'e2').map((p) => p.id)).toEqual(['e1', 'e3']);
	});

	it('keeps everyone when the unit is held by nobody (or by a truck)', () => {
		expect(transferTargetEmployees(people, null).map((p) => p.id)).toEqual(['e1', 'e2', 'e3']);
	});
});
