import { describe, expect, it } from 'vitest';

import { odoJumpsOf } from './odo-section';
import type { OdoReadingModel } from '../data/types';

const reading = (id: string, km: number | null): OdoReadingModel => ({ id, km, date: '2026-09-01', note: null });

/**
 * The ledger's transition line. Readings arrive NEWEST-first, so a row's jump is
 * its km minus the NEXT (older) entry's km — the series' momentum. The oldest row
 * has no predecessor.
 */
describe('odoJumpsOf — the km transition between readings', () => {
	it('reports each row’s gain over the next-older reading', () => {
		const readings = [reading('c', 120_500), reading('b', 119_800), reading('a', 119_000)];
		const jumps = odoJumpsOf(readings);

		expect(jumps.get('c')).toBe(700);
		expect(jumps.get('b')).toBe(800);
		// The oldest row has nothing older to compare against.
		expect(jumps.get('a')).toBeNull();
	});

	it('is null (never a fabricated 0) when either side has no odometer', () => {
		const jumps = odoJumpsOf([reading('b', null), reading('a', 119_000)]);
		expect(jumps.get('b')).toBeNull();
	});

	it('keeps a negative jump — a corrected/mistyped earlier reading is real signal', () => {
		const jumps = odoJumpsOf([reading('b', 100), reading('a', 119_000)]);
		expect(jumps.get('b')).toBe(-118_900);
	});
});
