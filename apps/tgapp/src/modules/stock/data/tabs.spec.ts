import { describe, expect, it } from 'vitest';

import type { MroOnHandRow } from '@/shared/mro';

import { partitionOnHand, STOCK_TABS, STOCK_TAB_VALUES } from './tabs';

/** A minimal on-hand row — only the fields the partition reads. */
function row(over: Partial<MroOnHandRow> & { qty_on_hand: number; below_reorder: boolean }): MroOnHandRow {
	return { id: `r-${Math.random().toString(36).slice(2)}`, location: 'main', model: 'm1', ...over } as MroOnHandRow;
}

/**
 * The စတော့ dashboard's four tabs (In Stock / Reorder / Stock Out / Expiring
 * Soon). These pin the tab set and the DISJOINTNESS of the three quantity
 * partitions — an out-of-stock row must never also count as Reorder.
 *
 * The stock-out and expiring tabs were briefly merged into one "Alerts" tab and
 * have been split back out; the first test guards against that merge returning
 * by accident.
 */

describe('STOCK_TABS', () => {
	it('is exactly four tabs, in render order', () => {
		expect(STOCK_TABS.map((t) => t.value)).toEqual(['in', 'reorder', 'out', 'expiry']);
	});

	it('keeps Stock Out and Expiring Soon as SEPARATE tabs', () => {
		const values = STOCK_TABS.map((t) => t.value) as string[];
		expect(values).toContain('out');
		expect(values).toContain('expiry');
		// The merged "alerts" tab must not come back.
		expect(values).not.toContain('alerts');
	});

	it('labels each tab', () => {
		expect(Object.fromEntries(STOCK_TABS.map((t) => [t.value, t.label]))).toEqual({
			in: 'In Stock',
			reorder: 'Reorder',
			out: 'Stock Out',
			expiry: 'Expiring Soon',
		});
	});

	it('keeps STOCK_TAB_VALUES in lock-step with the tab list', () => {
		expect(STOCK_TAB_VALUES).toEqual(STOCK_TABS.map((t) => t.value));
	});
});

describe('partitionOnHand', () => {
	it('puts a healthy balance in `in` only', () => {
		const p = partitionOnHand([row({ qty_on_hand: 10, below_reorder: false })]);
		expect(p.in).toHaveLength(1);
		expect(p.reorder).toHaveLength(0);
		expect(p.out).toHaveLength(0);
	});

	it('puts a low but stocked balance in `reorder` only', () => {
		const p = partitionOnHand([row({ qty_on_hand: 2, below_reorder: true })]);
		expect(p.in).toHaveLength(0);
		expect(p.reorder).toHaveLength(1);
		expect(p.out).toHaveLength(0);
	});

	it('puts a qty-0 balance in `out` only — never also reorder', () => {
		// A zero balance is necessarily at/below its reorder level, so this is the
		// case the disjointness guard exists for.
		const p = partitionOnHand([row({ qty_on_hand: 0, below_reorder: true })]);
		expect(p.out).toHaveLength(1);
		expect(p.reorder).toHaveLength(0);
		expect(p.in).toHaveLength(0);
	});

	it('treats a qty-0 row flagged NOT below reorder as out too', () => {
		const p = partitionOnHand([row({ qty_on_hand: 0, below_reorder: false })]);
		expect(p.out).toHaveLength(1);
		expect(p.in).toHaveLength(0);
	});

	it('counts a mixed set so in + reorder + out equals the input length', () => {
		const rows = [
			row({ qty_on_hand: 10, below_reorder: false }),
			row({ qty_on_hand: 3, below_reorder: true }),
			row({ qty_on_hand: 0, below_reorder: true }),
			row({ qty_on_hand: 0, below_reorder: true }),
		];
		const p = partitionOnHand(rows);
		expect(p.in).toHaveLength(1);
		expect(p.reorder).toHaveLength(1);
		expect(p.out).toHaveLength(2);
		expect(p.in.length + p.reorder.length + p.out.length).toBe(rows.length);
	});

	it('never places one row in two partitions', () => {
		const rows = [
			row({ qty_on_hand: 0, below_reorder: true }),
			row({ qty_on_hand: 5, below_reorder: true }),
			row({ qty_on_hand: 5, below_reorder: false }),
		];
		const p = partitionOnHand(rows);
		const ids = [...p.in, ...p.reorder, ...p.out].map((r) => r.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('is empty for an empty report', () => {
		expect(partitionOnHand([])).toEqual({ in: [], reorder: [], out: [] });
	});
});
