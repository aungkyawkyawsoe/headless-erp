/**
 * @mmbix/compute — enterprise gap-fill tests (round 2).
 * Covers business ratios, regression/forecasting, calendar helpers, text
 * utilities, membership/validation, array ops, pattern matching, conversions —
 * plus evaluator integration with inline array literals.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { evaluateBoolean, evaluateExpression } from '@mmbix/core';
import { registerComputeFunctions } from '../src/index';
import {
	roi,
	margin,
	markup,
	cagr,
	simpleInterest,
	compoundInterest,
	breakeven,
	wacc,
	payback,
	loanBalance,
	weightedAvgOf,
	correlOf,
	slopeOf,
	interceptOf,
	forecastOf,
	percentRankOf,
	clampOf,
	weekdayOf,
	startOfMonth,
	endOfQuarter,
	endOfYear,
	hoursBetween,
	minutesBetween,
	isWeekend,
	ageYears,
	splitOf,
	indexOf,
	lastIndexOf,
	reverseOf,
	normalizeOf,
	maskOf,
	slugifyOf,
	truncateOf,
	inList,
	betweenOf,
	switchOf,
	isEmptyOf,
	isNullOf,
	isNumberOf,
	isIntegerOf,
	isTextOf,
	isBooleanOf,
	arrayLength,
	arrayGet,
	arrayFirst,
	arrayLast,
	arrayUnique,
	arraySort,
	matchesOf,
	percentOf,
	toNumberOf,
	toTextOf,
	toBooleanOf,
} from '../src/index';

describe('business ratios (financial)', () => {
	it('ROI / MARGIN / MARKUP / CAGR', () => {
		expect(roi(1200, 1000)).toBeCloseTo(0.2, 6);
		expect(margin(120, 100)).toBeCloseTo(0.1667, 3);
		expect(markup(120, 100)).toBeCloseTo(0.2, 6);
		expect(cagr(1000, 2000, 5)).toBeCloseTo(0.1487, 3);
	});

	it('interest, breakeven, WACC, payback, balance', () => {
		expect(simpleInterest(1000, 0.05, 3)).toBe(150);
		expect(compoundInterest(1000, 0.05, 3)).toBeCloseTo(157.625, 3);
		expect(breakeven(10000, 50, 30)).toBe(500);
		expect(wacc(60, 40, 0.12, 0.08, 0.2)).toBeCloseTo(0.0976, 6);
		expect(payback(1000, [400, 400, 400])).toBeCloseTo(2.5, 6);
		expect(payback(1000, [200, 200])).toBeNaN();
		expect(loanBalance(0.015, 12, 120000, 1)).toBeCloseTo(110798.4, 1);
	});
});

describe('regression & forecasting (statistical)', () => {
	it('weighted average', () => {
		expect(weightedAvgOf([70, 80, 90], [1, 1, 2])).toBeCloseTo(82.5, 6);
		expect(weightedAvgOf([70, 80], [1])).toBeNaN(); // length mismatch
	});

	it('correlation / slope / intercept / forecast', () => {
		expect(correlOf([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1, 6);
		expect(correlOf([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 6);
		expect(correlOf([1, 2, 3, 4], [2, 1, 4, 3])).toBeCloseTo(0.6, 6);
		expect(slopeOf([2, 4, 6], [1, 2, 3])).toBeCloseTo(2, 6);
		expect(interceptOf([2, 4, 6], [1, 2, 3])).toBeCloseTo(0, 6);
		expect(forecastOf(5, [2, 4, 6], [1, 2, 3])).toBeCloseTo(10, 6);
	});

	it('percent rank + clamp', () => {
		expect(percentRankOf([1, 2, 3, 4], 2.5)).toBeCloseTo(0.5, 6);
		expect(percentRankOf([1, 2, 3, 4], 1)).toBe(0);
		expect(percentRankOf([1, 2, 3, 4], 10)).toBe(1);
		expect(clampOf(15, 0, 10)).toBe(10);
		expect(clampOf(-5, 0, 10)).toBe(0);
	});
});

describe('calendar helpers (datetime)', () => {
	it('weekday / start / end of period', () => {
		expect(weekdayOf('2026-01-01')).toBe(5); // Thursday, 1=Sunday
		expect(startOfMonth('2026-03-15')).toBe('2026-03-01');
		expect(endOfQuarter('2026-02-15')).toBe('2026-03-31');
		expect(endOfYear('2026-06-01')).toBe('2026-12-31');
	});

	it('hour/minute differences + weekend + age', () => {
		expect(hoursBetween('2026-01-01T00:00:00Z', '2026-01-02T06:00:00Z')).toBe(30);
		expect(minutesBetween('2026-01-01T00:00:00Z', '2026-01-01T01:30:00Z')).toBe(90);
		expect(isWeekend('2026-01-03')).toBe(true); // Saturday
		expect(isWeekend('2026-01-05')).toBe(false); // Monday
		expect(ageYears('2000-06-15', '2026-01-01')).toBe(25);
		expect(ageYears('2000-01-01', '2026-01-01')).toBe(26);
	});
});

describe('text utilities (string)', () => {
	it('split / index / reverse / normalize', () => {
		expect(splitOf('a,b,c', ',')).toEqual(['a', 'b', 'c']);
		expect(splitOf('a,b,c', ',', 1)).toBe('b');
		expect(indexOf('hello', 'll')).toBe(2);
		expect(lastIndexOf('hello', 'l')).toBe(3);
		expect(reverseOf('abc')).toBe('cba');
		expect(normalizeOf('e\u0301')).toBe('\u00e9'); // NFC
	});

	it('mask / slugify / truncate', () => {
		expect(maskOf('1234567890')).toBe('******7890');
		expect(maskOf('1234567890', 2)).toBe('********90');
		expect(slugifyOf('Hello World!')).toBe('hello-world');
		expect(truncateOf('Hello World', 5)).toBe('He...');
		expect(truncateOf('Hi', 5)).toBe('Hi');
	});
});

describe('membership / validation (logic)', () => {
	it('IN / BETWEEN / SWITCH', () => {
		expect(inList('approved', ['new', 'approved'])).toBe(true);
		expect(inList('rejected', ['new', 'approved'])).toBe(false);
		expect(betweenOf(5, 1, 10)).toBe(true);
		expect(betweenOf(15, 1, 10)).toBe(false);
		expect(switchOf(['b', 'a', 1, 'b', 2, 0])).toBe(2);
		expect(switchOf(['x', 'a', 1, 'b', 2, 0])).toBe(0); // default
	});

	it('type checks', () => {
		expect(isEmptyOf('')).toBe(true);
		expect(isEmptyOf(null)).toBe(true);
		expect(isEmptyOf([])).toBe(true);
		expect(isEmptyOf(0)).toBe(false);
		expect(isNullOf(null)).toBe(true);
		expect(isNullOf('')).toBe(false);
		expect(isNumberOf(5)).toBe(true);
		expect(isNumberOf('5')).toBe(false);
		expect(isIntegerOf(5)).toBe(true);
		expect(isIntegerOf(5.5)).toBe(false);
		expect(isTextOf('x')).toBe(true);
		expect(isBooleanOf(true)).toBe(true);
	});
});

describe('array helpers', () => {
	it('length / get / first / last / unique / sort', () => {
		expect(arrayLength(['a', 'b', 'c'])).toBe(3);
		expect(arrayGet(['a', 'b', 'c'], 1)).toBe('a'); // 1-based
		expect(arrayGet(['a', 'b', 'c'], 9)).toBeNull();
		expect(arrayFirst([1, 2])).toBe(1);
		expect(arrayLast([1, 2])).toBe(2);
		expect(arrayUnique([1, 2, 2, 3, 1])).toEqual([1, 2, 3]);
		expect(arraySort([3, 1, 2])).toEqual([1, 2, 3]);
		expect(arraySort([3, 1, 2], 0)).toEqual([3, 2, 1]);
	});
});

describe('pattern + conversion', () => {
	it('MATCHES', () => {
		expect(matchesOf('ABC-1234', '^[A-Z]{3}-[0-9]{4}$')).toBe(true);
		expect(matchesOf('abc', '^[A-Z]+$')).toBe(false);
		expect(matchesOf('x', '(')).toBe(false); // invalid pattern → false
	});

	it('PERCENT / TO_*', () => {
		expect(percentOf(50, 200)).toBe(25);
		expect(percentOf(1, 0)).toBeNaN();
		expect(toNumberOf('42')).toBe(42);
		expect(toNumberOf('x')).toBeNaN();
		expect(toTextOf(42)).toBe('42');
		expect(toBooleanOf('true')).toBe(true);
		expect(toBooleanOf('no')).toBe(false);
	});
});

describe('evaluator integration — inline array literals', () => {
	beforeAll(() => {
		registerComputeFunctions();
	});

	it('IN with an inline list (new array literal support)', () => {
		expect(evaluateBoolean("IN(doc.status, ['new', 'approved'])", { doc: { status: 'approved' } })).toBe(true);
		expect(evaluateBoolean("IN(doc.status, ['new', 'approved'])", { doc: { status: 'rejected' } })).toBe(false);
	});

	it('TAX_BRACKETS with inline brackets', () => {
		expect(evaluateExpression('TAX_BRACKETS(75000, [[0, 0], [10000, 0.05], [50000, 0.1]])', {})).toBeCloseTo(4500, 6);
	});

	it('NPV with inline cashflows + nested arrays', () => {
		expect(evaluateExpression('NPV(0.1, [-1000, 500, 600])', {})).toBeCloseTo(-49.5868, 4);
		expect(evaluateExpression('ARRAY_GET([[1, 2], [3, 4]], 2)', {})).toEqual([3, 4]);
	});

	it('realistic guard composition', () => {
		expect(
			evaluateBoolean(
				"BETWEEN(doc.score, 0, 100) && IN(doc.status, ['new', 'review']) && MATCHES(doc.code, '^[A-Z]{2}[0-9]{4}$') && doc.total <= TAX_TOTAL(doc.net, 0.05)",
				{ doc: { score: 80, status: 'review', code: 'AB1234', total: 105, net: 100 } },
			),
		).toBe(true);
	});
});
