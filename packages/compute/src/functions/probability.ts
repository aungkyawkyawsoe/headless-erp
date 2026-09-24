/**
 * Probability & statistics-advanced functions — pure, deterministic.
 *
 * Excel-compatible semantics:
 *   FACTORIAL(5)                      → 120
 *   COMBIN(5, 2)                      → 10
 *   PERMUT(5, 2)                      → 20
 *   BINOMDIST(2, 5, 0.5, false)       → P(exactly 2 successes)
 *   POISSON(3, 2.5, true)             → P(x ≤ 3) cumulative
 *   NORMDIST(60, 50, 10, true)        → CDF at 60
 *   NORMINV(0.975, 0, 1)              → 1.9599…
 *   ZSCORE(60, 50, 10)                → 1
 *   CONFIDENCE(0.05, 10, 100)         → half-width of the 95% CI
 */

import type { EvalFunction } from '@mmbix/core';

const n = (v: unknown): number => Number(v);

/** n! — integer factorial (0! = 1). */
export function factorialOf(value: unknown): number {
	const x = Math.round(n(value));
	if (x < 0 || !isFinite(x)) return NaN;
	if (x <= 1) return 1;
	let out = 1;
	for (let i = 2; i <= x; i++) out *= i;
	return out;
}

/** Combinations: n choose k (multiplicative form — no factorial overflow). */
export function combinOf(nVal: unknown, kVal: unknown): number {
	const N = Math.round(n(nVal));
	const K = Math.round(n(kVal));
	if (N < 0 || K < 0 || K > N) return NaN;
	const k = Math.min(K, N - K);
	let out = 1;
	for (let i = 0; i < k; i++) out = (out * (N - i)) / (i + 1);
	return Math.round(out);
}

/** Permutations: n!/(n−k)!. */
export function permutOf(nVal: unknown, kVal: unknown): number {
	const N = Math.round(n(nVal));
	const K = Math.round(n(kVal));
	if (N < 0 || K < 0 || K > N) return NaN;
	let out = 1;
	for (let i = 0; i < K; i++) out *= N - i;
	return out;
}

/** Binomial distribution — pmf (cumulative=false) or cdf (cumulative=true). */
export function binomDist(kVal: unknown, nVal: unknown, pVal: unknown, cumulative?: unknown): number {
	const K = Math.round(n(kVal));
	const N = Math.round(n(nVal));
	const p = n(pVal);
	if (K < 0 || N < 0 || K > N || p < 0 || p > 1 || isNaN(p)) return NaN;
	const cum = cumulative === true || cumulative === 1;
	if (!cum) {
		return combinOf(N, K) * Math.pow(p, K) * Math.pow(1 - p, N - K);
	}
	let sum = 0;
	for (let i = 0; i <= K; i++) {
		sum += combinOf(N, i) * Math.pow(p, i) * Math.pow(1 - p, N - i);
	}
	return sum;
}

/** Poisson distribution — pmf (cumulative=false) or cdf (cumulative=true). */
export function poissonOf(xVal: unknown, lambdaVal: unknown, cumulative?: unknown): number {
	const X = Math.round(n(xVal));
	const lambda = n(lambdaVal);
	if (X < 0 || lambda <= 0 || !isFinite(lambda)) return NaN;
	const cum = cumulative === true || cumulative === 1;
	if (!cum) {
		return (Math.exp(-lambda) * Math.pow(lambda, X)) / factorialOf(X);
	}
	let sum = 0;
	for (let i = 0; i <= X; i++) {
		sum += (Math.exp(-lambda) * Math.pow(lambda, i)) / factorialOf(i);
	}
	return sum;
}

// ─── Normal distribution ────────────────────────────────

/** Abramowitz–Stegun 7.1.26 error function (max abs error ≈ 1.5e-7). */
function erf(x: number): number {
	const sign = x < 0 ? -1 : 1;
	const ax = Math.abs(x);
	const t = 1 / (1 + 0.3275911 * ax);
	const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
	return sign * y;
}

/** Standard normal CDF via erf. */
function normCdf(z: number): number {
	return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Acklam's rational approximation for the inverse standard normal CDF. */
function normInv(p: number): number {
	if (p <= 0) return -Infinity;
	if (p >= 1) return Infinity;
	if (p === 0.5) return 0;
	const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
	const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
	const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
	const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
	const low = 0.02425;
	const high = 1 - low;
	let q: number;
	if (p < low) {
		q = Math.sqrt(-2 * Math.log(p));
		return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
	}
	if (p > high) {
		q = Math.sqrt(-2 * Math.log(1 - p));
		return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
	}
	q = p - 0.5;
	const r = q * q;
	return (
		((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
		(((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
	);
}

/** Normal distribution — pdf or cdf (cumulative). */
export function normDist(xVal: unknown, meanVal: unknown, sdVal: unknown, cumulative?: unknown): number {
	const x = n(xVal);
	const mean = n(meanVal);
	const sd = n(sdVal);
	if (sd <= 0 || !isFinite(sd)) return NaN;
	if (cumulative === true || cumulative === 1) return normCdf((x - mean) / sd);
	return (1 / (sd * Math.sqrt(2 * Math.PI))) * Math.exp(-((x - mean) ** 2) / (2 * sd * sd));
}

/** Z-score: (x − mean) / sd. */
export function zscoreOf(xVal: unknown, meanVal: unknown, sdVal: unknown): number {
	const sd = n(sdVal);
	if (sd === 0 || !isFinite(sd)) return NaN;
	return (n(xVal) - n(meanVal)) / sd;
}

/** Inverse normal: value at the given cumulative probability. */
export function normInvOf(pVal: unknown, meanVal: unknown, sdVal: unknown): number {
	const sd = n(sdVal);
	if (sd <= 0 || !isFinite(sd)) return NaN;
	return n(meanVal) + sd * normInv(n(pVal));
}

/** Confidence interval half-width: z(1−α/2) · sd / √n. */
export function confidenceOf(alphaVal: unknown, sdVal: unknown, nVal: unknown): number {
	const alpha = n(alphaVal);
	const sd = n(sdVal);
	const size = Math.round(n(nVal));
	if (alpha <= 0 || alpha >= 1 || sd <= 0 || size < 1) return NaN;
	return normInv(1 - alpha / 2) * (sd / Math.sqrt(size));
}

export const probabilityFunctions: Array<[string, EvalFunction]> = [
	['FACTORIAL', (args) => factorialOf(args[0])],
	['COMBIN', (args) => combinOf(args[0], args[1])],
	['PERMUT', (args) => permutOf(args[0], args[1])],
	['BINOMDIST', (args) => binomDist(args[0], args[1], args[2], args[3])],
	['POISSON', (args) => poissonOf(args[0], args[1], args[2])],
	['NORMDIST', (args) => normDist(args[0], args[1], args[2], args[3])],
	['NORMINV', (args) => normInvOf(args[0], args[1], args[2])],
	['ZSCORE', (args) => zscoreOf(args[0], args[1], args[2])],
	['CONFIDENCE', (args) => confidenceOf(args[0], args[1], args[2])],
];
