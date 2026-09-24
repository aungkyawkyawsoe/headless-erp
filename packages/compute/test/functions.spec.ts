/**
 * @mmbix/compute — pure function unit tests (deterministic, known values).
 */
import { describe, it, expect } from 'vitest';
import {
	npv,
	irr,
	pmt,
	fv,
	pv,
	sln,
	ddb,
	syd,
	sumOf,
	meanOf,
	medianOf,
	stdevOf,
	percentileOf,
	daysBetween,
	addMonths,
	endOfMonth,
	computeFunctionNames,
} from '../src/index';

describe('financial', () => {
	it('NPV discounts cashflows from t=0 (first value undiscounted)', () => {
		// NPV(0.1, [-1000, 500, 600]) = -1000 + 500/1.1 + 600/1.21 ≈ -49.587
		const v = npv(0.1, -1000, 500, 600);
		expect(v).toBeCloseTo(-49.5868, 4);
		// Array form (a JSON field value) behaves identically.
		expect(npv(0.1, [-1000, 500, 600])).toBeCloseTo(v, 12);
	});

	it('PMT computes a standard installment', () => {
		// PMT(0.015, 12, 120000) ≈ -11,001.60 (loan payment)
		expect(pmt(0.015, 12, 120000)).toBeCloseTo(-11001.6, 1);
		// rate = 0 → simple division
		expect(pmt(0, 12, 1200)).toBeCloseTo(-100, 6);
	});

	it('FV and PV invert each other (end-of-period)', () => {
		const f = fv(0.05, 10, -100, -1000); // saving 100/yr + 1000 now
		expect(f).toBeCloseTo(2886.68, 2);
		// PV(FV) round-trips
		expect(pv(0.05, 10, -100, f)).toBeCloseTo(-1000, 3);
	});

	it('IRR returns the rate where NPV = 0', () => {
		// [-1000, 600, 600] → IRR ≈ 0.13066
		const r = irr(-1000, 600, 600);
		expect(r).toBeGreaterThan(0.13);
		expect(r).toBeLessThan(0.132);
		expect(npv(r, -1000, 600, 600)).toBeCloseTo(0, 5);
		// All-positive flows → no sign change → NaN
		expect(irr(100, 200)).toBeNaN();
	});

	it('depreciation: SLN / DDB / SYD', () => {
		expect(sln(10000, 1000, 5)).toBe(1800);
		// DDB never writes value below salvage — last year lands exactly on it.
		expect(ddb(10000, 1000, 5, 1)).toBe(4000); // 10000 * 2/5
		expect(ddb(10000, 1000, 5, 5)).toBeCloseTo(296, 0); // capped at book - salvage
		expect(syd(10000, 1000, 5, 1)).toBe(3000); // (9000 * 5 * 2) / 30
	});
});

describe('statistical', () => {
	it('mean / median / stdev (sample, n-1)', () => {
		expect(meanOf([1, 2, 3, 4])).toBe(2.5);
		expect(medianOf([1, 2, 3, 4])).toBe(2.5);
		expect(medianOf([1, 2, 3])).toBe(2);
		expect(stdevOf([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4);
	});

	it('sum / min / max / percentile', () => {
		expect(sumOf([1, 2, 3])).toBe(6);
		expect(percentileOf([1, 2, 3, 4, 5], 0.9)).toBeCloseTo(4.6, 6);
		expect(percentileOf([1, 2, 3, 4, 5], 0.5)).toBe(3);
	});
});

describe('datetime', () => {
	it('days between / add months / end of month', () => {
		expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
		expect(daysBetween('2026-01-31', '2026-01-01')).toBe(-30);
		expect(addMonths('2026-01-31', 1)).toBe('2026-02-28'); // clamped
		expect(endOfMonth('2026-01-15')).toBe('2026-01-31');
		expect(endOfMonth('2026-01-15', 1)).toBe('2026-02-28');
	});
});

describe('registry surface', () => {
	it('exposes a stable, documented function list', () => {
		const names = computeFunctionNames();
		for (const expected of ['NPV', 'IRR', 'PMT', 'FV', 'PV', 'SLN', 'DDB', 'SYD', 'MEAN', 'MEDIAN', 'STDEV', 'DAYS_BETWEEN', 'EOMONTH']) {
			expect(names).toContain(expected);
		}
	});
});
