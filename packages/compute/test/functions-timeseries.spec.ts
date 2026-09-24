/**
 * @mmbix/compute — time-series functions (pure, known values).
 */
import { describe, it, expect } from 'vitest';
import { movingAverage, movingSum, percentChange, yoyGrowth, growthRate, meanAbsoluteDeviation } from '../src/index';

describe('timeseries', () => {
	it('MOVING_AVERAGE fills the window then rolls', () => {
		// window=3 over [1,2,3,4,5] → [NaN, NaN, 2, 3, 4]
		const avg = movingAverage([1, 2, 3, 4, 5], 3);
		expect(avg[0]).toBeNaN();
		expect(avg[1]).toBeNaN();
		expect(avg[2]).toBeCloseTo(2, 10);
		expect(avg[3]).toBeCloseTo(3, 10);
		expect(avg[4]).toBeCloseTo(4, 10);
		// window=1 → identity
		expect(movingAverage([10, 20], 1)).toEqual([10, 20]);
	});

	it('MOVING_SUM rolls the trailing window', () => {
		const sum = movingSum([1, 2, 3, 4], 2);
		expect(sum[0]).toBeNaN();
		expect(sum[1]).toBeCloseTo(3, 10);
		expect(sum[2]).toBeCloseTo(5, 10);
		expect(sum[3]).toBeCloseTo(7, 10);
	});

	it('PERCENT_CHANGE / YOY_GROWTH / GROWTH_RATE', () => {
		expect(percentChange(150, 100)).toBeCloseTo(50, 10); // +50%
		expect(percentChange(80, 100)).toBeCloseTo(-20, 10); // -20%
		expect(yoyGrowth(1320, 1200)).toBeCloseTo(10, 10);
		expect(growthRate(150, 100)).toBeCloseTo(0.5, 10);
		// Division by zero → NaN (never Infinity)
		expect(percentChange(10, 0)).toBeNaN();
	});

	it('MAD measures volatility', () => {
		// MAD([1,2,3]) = (|1-2|+|2-2|+|3-2|)/3 = 2/3
		expect(meanAbsoluteDeviation([1, 2, 3])).toBeCloseTo(2 / 3, 10);
	});
});
