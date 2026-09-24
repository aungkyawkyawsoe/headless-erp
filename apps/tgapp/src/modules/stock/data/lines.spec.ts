import { describe, expect, it } from 'vitest';

import type { MroCompositionBalance, MroCompositionLot, MroCompositionSerial, MroItemComposition, MroTracking } from '@/shared/mro';

import { linesOf } from './lines';

/**
 * The stock item page's line mapper — the pure half of `/app/stocks/item/:id`.
 * These pin the ONE rule that decides what an operator sees: the line kind
 * follows the SKU's OWN tracking policy, and every store the SKU sits in shows
 * up (each line labelled with its store).
 */

function composition(over: {
	tracking: MroTracking;
	balances?: MroCompositionBalance[];
	lots?: MroCompositionLot[];
	serials?: MroCompositionSerial[];
}): MroItemComposition {
	return {
		model: { id: 'm1', name_en: 'AF-4004', name_mm: null, image: null, group_name: 'Air Filter', tracking: over.tracking },
		totals: { on_hand: 0, expired: 0, any_below_reorder: false },
		balances: over.balances ?? [],
		lots: over.lots ?? [],
		serials: over.serials ?? [],
	};
}

function balance(over: Partial<MroCompositionBalance> & { location: string }): MroCompositionBalance {
	return {
		id: `${over.location}-b`,
		qty_on_hand: 0,
		derived_qty: null,
		expired_qty: 0,
		reorder_level: 0,
		drift: false,
		below_reorder: false,
		...over,
	};
}

function lot(over: Partial<MroCompositionLot> & { id: string }): MroCompositionLot {
	return { location: 'main_store', batch_no: 'LOT-1', expiry_date: null, days_left: null, remaining_qty: 0, expired: false, ...over };
}

function serial(over: Partial<MroCompositionSerial> & { id: string }): MroCompositionSerial {
	return {
		location: 'main_store',
		serial_no: 'SN-1',
		status: 'in_stock',
		vehicle: null,
		plate_no: null,
		slot: null,
		employee: null,
		employee_name: null,
		tread_mm: null,
		psi: null,
		condition: null,
		expiry_date: null,
		days_left: null,
		expired: false,
		...over,
	};
}

describe('linesOf — standard', () => {
	it('lists one balance line per store, using the stored qty (derived is null)', () => {
		const lines = linesOf(
			composition({
				tracking: 'standard',
				balances: [
					balance({ location: 'main_store', qty_on_hand: 9, reorder_level: 15, below_reorder: true }),
					balance({ location: 'safety_store', qty_on_hand: 0 }),
				],
			}),
		);

		expect(lines.map((l) => l.kind)).toEqual(['balance', 'balance']);
		expect(lines.map((l) => l.primary)).toEqual(['Main store', 'Safety store']);
		expect(lines.map((l) => l.qty)).toEqual(['9', '0']);
		// A plain balance row has no row-specific detail to add (the reorder LEVEL is
		// the card's fact, not the row's) — the amber tone is what flags it.
		expect(lines[0].secondary).toBeNull();
		expect(lines[1].secondary).toBeNull();
		// Below reorder → amber; a plain zero balance is not an error.
		expect(lines[0].tone).toBe('warning');
		expect(lines[1].tone).toBe('neutral');
	});

	it('prefers the derived total when the row carries one', () => {
		const lines = linesOf(
			composition({ tracking: 'standard', balances: [balance({ location: 'main_store', qty_on_hand: 9, derived_qty: 7 })] }),
		);
		expect(lines[0].qty).toBe('7');
	});

	it('flags a drifted ledger on the line and says so for an orphan store', () => {
		const lines = linesOf(
			composition({
				tracking: 'standard',
				balances: [
					balance({ location: 'main_store', qty_on_hand: 9, derived_qty: 7, drift: true }),
					// An orphan: stock with no balance row of its own (drift carries the total).
					balance({ id: null, location: 'mandalay_store', qty_on_hand: 0, derived_qty: 4, drift: 4 }),
				],
			}),
		);

		expect(lines[0].secondary).toBe('Ledger 9');
		expect(lines[1].secondary).toBe('No balance row');
		expect(lines[1].qty).toBe('4');
	});
});

describe('linesOf — batch', () => {
	it('lists the lots in the order the server sent them (FEFO), each with its store', () => {
		const lines = linesOf(
			composition({
				tracking: 'batch',
				lots: [
					lot({ id: 'l1', batch_no: 'LOT-2026-01', expiry_date: '2026-10-12', days_left: 28, remaining_qty: 6 }),
					lot({ id: 'l2', location: 'safety_store', batch_no: 'LOT-2026-02', expiry_date: '2027-01-04', days_left: 112, remaining_qty: 3 }),
				],
				balances: [balance({ location: 'main_store', qty_on_hand: 9, derived_qty: 9 })],
			}),
		);

		expect(lines.map((l) => l.kind)).toEqual(['lot', 'lot']);
		expect(lines.map((l) => l.primary)).toEqual(['LOT-2026-01', 'LOT-2026-02']);
		expect(lines.map((l) => l.qty)).toEqual(['6', '3']);
		expect(lines[0].secondary).toBe('Main store · Expires 12-Oct-2026 · 28d');
		expect(lines[1].secondary).toBe('Safety store · Expires 04-Jan-2027 · 112d');
		// 112 days out is not yet an alert; 28 days is.
		expect(lines[0].tone).toBe('warning');
		expect(lines[1].tone).toBe('neutral');
	});

	it('turns an expired lot red and keeps a fractional remainder as-is', () => {
		const lines = linesOf(
			composition({
				tracking: 'batch',
				lots: [lot({ id: 'l1', batch_no: null, expiry_date: '2026-01-01', days_left: -5, remaining_qty: 2.5, expired: true })],
			}),
		);
		expect(lines[0].primary).toBe('No batch no.');
		expect(lines[0].qty).toBe('2.5');
		expect(lines[0].secondary).toBe('Main store · Expired 01-Jan-2026');
		expect(lines[0].tone).toBe('danger');
	});

	it('is EMPTY for a batch model with no active lots — the header total agrees', () => {
		// A tracked model derives its total from the trace rows, so "no lots" means
		// the header says 0 too — the page shows one consistent answer, not a list of
		// balances that would contradict it.
		const lines = linesOf(
			composition({ tracking: 'batch', balances: [balance({ location: 'main_store', qty_on_hand: 9, derived_qty: 0 })] }),
		);
		expect(lines).toEqual([]);
	});
});

describe('linesOf — serial', () => {
	it('lists one line per in-stock unit, tapping through to the unit page', () => {
		const lines = linesOf(
			composition({
				tracking: 'serial',
				serials: [
					serial({
						id: 's1',
						serial_no: 'SN-001',
						location: 'vehicle_store',
						plate_no: '36Z-8888',
						slot: 'steer-left',
						tread_mm: 13.8,
						psi: 110,
					}),
					serial({ id: 's2', serial_no: 'SN-002', employee: 'e1', employee_name: 'Aung Aung' }),
				],
			}),
		);

		expect(lines.map((l) => l.kind)).toEqual(['serial', 'serial']);
		expect(lines.map((l) => l.primary)).toEqual(['SN-001', 'SN-002']);
		expect(lines.map((l) => l.serialId)).toEqual(['s1', 's2']);
		// A unit is one each — the right-hand column is never empty (it reads 1).
		expect(lines.map((l) => l.qty)).toEqual(['1', '1']);
		expect(lines[0].secondary).toBe('36Z-8888 · steer-left · Vehicle store · 13.8mm · 110 psi');
		// An employee-held unit reads the custodian, not a plate.
		expect(lines[1].secondary).toBe('Aung Aung · Main store');
	});

	it('flags a worn unit amber and falls back to the store when it is held nowhere', () => {
		const lines = linesOf(
			composition({ tracking: 'serial', serials: [serial({ id: 's1', serial_no: null, location: 'vehicle_store', condition: 'poor' })] }),
		);
		expect(lines[0].primary).toBe('—');
		expect(lines[0].secondary).toBe('Vehicle store');
		expect(lines[0].tone).toBe('warning');
	});

	it('is EMPTY for a serial model with no in-stock units', () => {
		// Same rule as the batch case above — the trace rows ARE the truth here.
		const lines = linesOf(composition({ tracking: 'serial', balances: [balance({ location: 'main_store', qty_on_hand: 0 })] }));
		expect(lines).toEqual([]);
	});
});

describe('linesOf — empty', () => {
	it('is empty for a not-yet-stocked item, so the page can say so', () => {
		expect(linesOf(composition({ tracking: 'standard' }))).toEqual([]);
	});
});

describe('linesOf — a serial unit reads like a lot', () => {
	it('carries the unit qty on the right and its expiry in the facts', () => {
		const lines = linesOf(
			composition({
				tracking: 'serial',
				serials: [serial({ id: 's1', serial_no: 'SN-1', expiry_date: '2026-10-12', days_left: 28 })],
			}),
		);
		expect(lines[0].primary).toBe('SN-1');
		expect(lines[0].qty).toBe('1');
		expect(lines[0].secondary).toContain('Expires 12-Oct-2026');
		expect(lines[0].secondary).toContain('28d');
		expect(lines[0].tone).toBe('warning');
	});

	it('turns an expired unit red, and one with no date stays neutral', () => {
		const expired = linesOf(
			composition({ tracking: 'serial', serials: [serial({ id: 's1', expiry_date: '2026-01-05', days_left: -20, expired: true })] }),
		);
		expect(expired[0].tone).toBe('danger');
		expect(expired[0].secondary).toContain('Expired 05-Jan-2026');
		const undated = linesOf(composition({ tracking: 'serial', serials: [serial({ id: 's2' })] }));
		expect(undated[0].tone).toBe('neutral');
		// No date ⇒ no expiry fact: the line says only where the unit is.
		expect(undated[0].secondary).toBe('Main store');
	});
});

describe('linesOf — a store balance names its expired slice', () => {
	it('spells out the expired qty and turns the line red; no expiry stays neutral', () => {
		// The mapping is policy-agnostic; the SERVER only fills `expired_qty` for a
		// tracked model (a standard model has no dates to expire).
		const lines = linesOf(
			composition({
				tracking: 'standard',
				balances: [balance({ location: 'main_store', qty_on_hand: 10, derived_qty: 10, expired_qty: 3, reorder_level: 2 })],
			}),
		);
		// The reorder LEVEL is not repeated per row — the card above flags
		// "Below reorder" once, so a row carries only what is row-specific.
		expect(lines[0].secondary).toBe('3 expired');
		expect(lines[0].tone).toBe('danger');
		expect(lines[0].qty).toBe('10');

		const clean = linesOf(
			composition({
				tracking: 'standard',
				balances: [balance({ location: 'main_store', qty_on_hand: 4, derived_qty: 4, reorder_level: 0 })],
			}),
		);
		expect(clean[0].secondary).toBeNull();
		expect(clean[0].tone).toBe('neutral');
	});
});
