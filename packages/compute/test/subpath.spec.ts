/**
 * Sub-path imports — "import only what you use" is enforced by the exports
 * map. Each group is importable directly (tree-shakable, no core dependency):
 *
 *   import { pmt, npv } from '@mmbix/compute/financial';
 *   import { meanOf } from '@mmbix/compute/statistical';
 *   import { registerComputeFunctions } from '@mmbix/compute';   // whole surface
 */
import { describe, it, expect } from 'vitest';
import { pmt as subPmt, npv as subNpv, roi as subRoi } from '@mmbix/compute/financial';
import { meanOf as subMean, stdevOf as subStdev } from '@mmbix/compute/statistical';
import { daysBetween as subDays, netWorkdays as subNetWorkdays } from '@mmbix/compute/datetime';
import { upperOf as subUpper, maskOf as subMask } from '@mmbix/compute/string';
import { convert as subConvert } from '@mmbix/compute/currency';
import { taxBrackets as subTax } from '@mmbix/compute/tax';
import { roundOf as subRound } from '@mmbix/compute/math';
import { inList as subIn } from '@mmbix/compute/logic';
import { arraySort as subSort } from '@mmbix/compute/array';
import { matchesOf as subMatches } from '@mmbix/compute/pattern';
import { percentOf as subPercent } from '@mmbix/compute/conversion';
// Same values as the package-root exports (single source of truth).
import {
	pmt,
	npv,
	roi,
	meanOf,
	stdevOf,
	daysBetween,
	netWorkdays,
	upperOf,
	maskOf,
	convert,
	taxBrackets,
	roundOf,
	inList,
	arraySort,
	matchesOf,
	percentOf,
} from '@mmbix/compute';

describe('sub-path imports (tree-shakable, group-scoped)', () => {
	it('financial group sub-path matches package root', () => {
		expect(subPmt(0.015, 12, 120000)).toBe(pmt(0.015, 12, 120000));
		expect(subNpv(0.1, [-1000, 500, 600])).toBeCloseTo(npv(0.1, -1000, 500, 600), 10);
		expect(subRoi(1200, 1000)).toBe(roi(1200, 1000));
	});

	it('statistical / datetime / string groups', () => {
		expect(subMean([1, 2, 3])).toBe(meanOf([1, 2, 3]));
		expect(subStdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(stdevOf([2, 4, 4, 4, 5, 5, 7, 9]), 10);
		expect(subDays('2026-01-01', '2026-01-31')).toBe(daysBetween('2026-01-01', '2026-01-31'));
		expect(subNetWorkdays('2026-01-01', '2026-01-31')).toBe(netWorkdays('2026-01-01', '2026-01-31'));
		expect(subUpper('abc')).toBe(upperOf('abc'));
		expect(subMask('1234567890')).toBe(maskOf('1234567890'));
	});

	it('currency / tax / math / logic / array / pattern / conversion', () => {
		expect(subConvert(100, 'USD', 'MMK', 2100)).toBe(convert(100, 'USD', 'MMK', 2100));
		expect(
			subTax(75000, [
				[0, 0],
				[10000, 0.05],
				[50000, 0.1],
			]),
		).toBe(
			taxBrackets(75000, [
				[0, 0],
				[10000, 0.05],
				[50000, 0.1],
			]),
		);
		expect(subRound(2.567, 2)).toBe(roundOf(2.567, 2));
		expect(subIn('a', ['a', 'b'])).toBe(inList('a', ['a', 'b']));
		expect(subSort([3, 1, 2])).toEqual(arraySort([3, 1, 2]));
		expect(subMatches('ABC-1234', '^[A-Z]{3}-[0-9]{4}$')).toBe(matchesOf('ABC-1234', '^[A-Z]{3}-[0-9]{4}$'));
		expect(subPercent(50, 200)).toBe(percentOf(50, 200));
	});
});
