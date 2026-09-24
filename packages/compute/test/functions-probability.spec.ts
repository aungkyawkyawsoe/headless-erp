/**
 * @mmbix/compute — probability & advanced statistics (pure, known values).
 */
import { describe, it, expect } from 'vitest';
import { factorialOf, combinOf, permutOf, binomDist, poissonOf, normDist, normInvOf, zscoreOf, confidenceOf } from '../src/index';

describe('probability', () => {
	it('FACTORIAL / COMBIN / PERMUT', () => {
		expect(factorialOf(5)).toBe(120);
		expect(factorialOf(0)).toBe(1);
		expect(combinOf(5, 2)).toBe(10);
		expect(combinOf(10, 3)).toBe(120);
		expect(permutOf(5, 2)).toBe(20);
		expect(permutOf(4, 4)).toBe(24);
	});

	it('BINOMDIST — pmf + cdf', () => {
		// P(X=2) for X~Bin(5, 0.5): C(5,2)*0.5^5 = 10/32
		expect(binomDist(2, 5, 0.5, false)).toBeCloseTo(10 / 32, 10);
		// P(X<=2) = (1+5+10)/32 = 16/32
		expect(binomDist(2, 5, 0.5, true)).toBeCloseTo(16 / 32, 10);
	});

	it('POISSON — pmf + cdf', () => {
		// P(X=3) for λ=2.5: e^-2.5 * 2.5^3 / 3! ≈ 0.2138
		expect(poissonOf(3, 2.5, false)).toBeCloseTo(0.21376, 4);
		// Cumulative P(X<=3) ≈ 0.7576
		expect(poissonOf(3, 2.5, true)).toBeCloseTo(0.75758, 4);
	});

	it('NORMDIST — pdf + cdf', () => {
		// PDF at mean = 1/(sd·√(2π))
		expect(normDist(50, 50, 10, false)).toBeCloseTo(1 / (10 * Math.sqrt(2 * Math.PI)), 10);
		// CDF at mean = 0.5 (erf approx: ±1e-7)
		expect(normDist(50, 50, 10, true)).toBeCloseTo(0.5, 6);
		// CDF at mean+1.96·sd ≈ 0.975 (the classic 95% threshold)
		expect(normDist(69.6, 50, 10, true)).toBeCloseTo(0.975, 2);
	});

	it('NORMINV / ZSCORE / CONFIDENCE', () => {
		expect(normInvOf(0.975, 0, 1)).toBeCloseTo(1.95996, 4);
		expect(zscoreOf(60, 50, 10)).toBeCloseTo(1, 10);
		expect(zscoreOf(50, 50, 10)).toBeCloseTo(0, 10);
		// 95% CI half-width for sd=10, n=100: 1.96·10/10 = 1.96
		expect(confidenceOf(0.05, 10, 100)).toBeCloseTo(1.95996, 4);
	});
});
