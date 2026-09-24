import { describe, expect, it } from 'vitest';

import { availableQtyOf, mroStockIndexOf, onHandQtyOf, policyOfModel, trackingOfModel, type MroOnHandRow } from './mro';

/**
 * The policy used to live ON the SKU (`mro_item_model.tracking`). It now lives on
 * the item NAME, which leaves the two reads delivering it differently: the picker
 * directory flattens it onto `tracking`, while an expanded `item_model` relation
 * carries it nested as `item_name.tracking`. These pin the one seam that accepts
 * both, so a doc-line badge can never silently fall back to `standard`.
 */
describe('policyOfModel', () => {
	it('reads the flattened directory shape', () => {
		expect(policyOfModel({ tracking: 'serial' })).toBe('serial');
	});

	it('reads the expanded relation shape (policy nested under item_name)', () => {
		expect(policyOfModel({ item_name: { tracking: 'batch' } })).toBe('batch');
	});

	it('prefers the flattened value when both are present', () => {
		expect(policyOfModel({ tracking: 'batch', item_name: { tracking: 'serial' } })).toBe('batch');
	});

	it('falls back to standard for an unknown or absent policy', () => {
		expect(policyOfModel({ tracking: 'nonsense' })).toBe('standard');
		expect(policyOfModel({ item_name: null })).toBe('standard');
		expect(policyOfModel({})).toBe('standard');
		expect(policyOfModel(null)).toBe('standard');
		expect(policyOfModel(undefined)).toBe('standard');
	});

	it('exposes the raw value (null, not a fallback) through trackingOfModel', () => {
		expect(trackingOfModel({ item_name: { tracking: 'serial' } })).toBe('serial');
		expect(trackingOfModel({})).toBeNull();
	});
});

/** One `/stock/onhand` row, with every unrelated column filled in. */
function onHandRow(over: Partial<MroOnHandRow>): MroOnHandRow {
	return {
		id: 'inv-1',
		model: 'model-a',
		model_name: 'Model A',
		location: 'main_store',
		tracking: 'standard',
		qty_on_hand: 0,
		reorder_level: null,
		derived_qty: null,
		drift: false,
		below_reorder: false,
		...over,
	};
}

/**
 * The two quantities a stock-moving screen may draw on. These pin the MECE split
 * that keeps the outbound picker correct per kind: an ISSUE may only take usable
 * stock, while a write-off / disposal exists precisely to remove the expired slice.
 */
describe('stock quantity basis', () => {
	it('prefers the derived total and falls back to the stored balance', () => {
		expect(onHandQtyOf(onHandRow({ derived_qty: 7, qty_on_hand: 3 }))).toBe(7);
		expect(onHandQtyOf(onHandRow({ derived_qty: null, qty_on_hand: 3 }))).toBe(3);
		expect(onHandQtyOf(onHandRow({ derived_qty: null, qty_on_hand: 0 }))).toBe(0);
	});

	it('subtracts the expired slice for the issuable figure but keeps it on hand', () => {
		const partlyExpired = onHandRow({ derived_qty: 10, expired_qty: 4 });
		expect(availableQtyOf(partlyExpired)).toBe(6);
		expect(onHandQtyOf(partlyExpired)).toBe(10);
	});

	it('reports an expired-ONLY SKU as available 0 and still on hand', () => {
		// The write-off / disposal case — the row those screens exist to offer. A single
		// "available" number would hide it and strand the stock.
		const expiredOnly = onHandRow({ derived_qty: 4, expired_qty: 4 });
		expect(availableQtyOf(expiredOnly)).toBe(0);
		expect(onHandQtyOf(expiredOnly)).toBe(4);
	});

	it('treats a missing expired slice as 0 (legacy rows)', () => {
		expect(availableQtyOf(onHandRow({ derived_qty: 5 }))).toBe(5);
		expect(availableQtyOf(onHandRow({ derived_qty: 5, expired_qty: undefined }))).toBe(5);
	});
});

describe('mroStockIndexOf', () => {
	it('keys by model|location and skips a row whose model master is gone', () => {
		const index = mroStockIndexOf(
			[
				onHandRow({ model: 'a', location: 'main_store', derived_qty: 5, expired_qty: 1 }),
				onHandRow({ model: 'b', location: 'vehicle_store', derived_qty: 2 }),
				onHandRow({ model: null, location: 'main_store', derived_qty: 9 }),
			],
			'available',
		);
		expect(index.get('a|main_store')).toBe(4);
		expect(index.get('b|vehicle_store')).toBe(2);
		expect(index.size, 'the null-model row has no id to look up by').toBe(2);
	});

	it('switches basis without changing the key format', () => {
		const rows = [onHandRow({ model: 'a', location: 'main_store', derived_qty: 5, expired_qty: 1 })];
		expect(mroStockIndexOf(rows, 'available').get('a|main_store')).toBe(4);
		expect(mroStockIndexOf(rows, 'onHand').get('a|main_store')).toBe(5);
	});

	it('separates the same SKU across stores', () => {
		const index = mroStockIndexOf(
			[
				onHandRow({ model: 'a', location: 'main_store', derived_qty: 5 }),
				onHandRow({ model: 'a', location: 'mandalay_store', derived_qty: 9 }),
			],
			'available',
		);
		expect(index.get('a|main_store')).toBe(5);
		expect(index.get('a|mandalay_store')).toBe(9);
	});
});
