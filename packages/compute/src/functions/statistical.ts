/**
 * Statistical functions — pure, deterministic.
 *
 * Sample statistics use n−1 (unbiased); population use n. All variadic
 * functions accept nested arrays (a JSON field value works):
 *   MEAN(doc.scores) · SUM(doc.qty, 5) · MEDIAN(doc.scores) · RANK(doc.score, doc.scores)
 */

import type { EvalFunction } from '@mmbix/core';

const nums = (args: unknown[]): number[] => {
	const out: number[] = [];
	for (const a of args) {
		if (Array.isArray(a)) {
			for (const x of a) {
				const n = Number(x);
				if (!isNaN(n)) out.push(n);
			}
		} else {
			const n = Number(a);
			if (!isNaN(n)) out.push(n);
		}
	}
	return out;
};

export function sumOf(values: unknown[]): number {
	return nums(values).reduce((acc, n) => acc + n, 0);
}

export function countOf(values: unknown[]): number {
	return nums(values).length;
}

export function meanOf(values: unknown[]): number {
	const a = nums(values);
	return a.length === 0 ? NaN : a.reduce((acc, n) => acc + n, 0) / a.length;
}

export function minOf(values: unknown[]): number {
	const a = nums(values);
	return a.length === 0 ? NaN : Math.min(...a);
}

export function maxOf(values: unknown[]): number {
	const a = nums(values);
	return a.length === 0 ? NaN : Math.max(...a);
}

export function medianOf(values: unknown[]): number {
	const a = nums(values).sort((x, y) => x - y);
	if (a.length === 0) return NaN;
	const mid = Math.floor(a.length / 2);
	return a.length % 2 === 1 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** Sample standard deviation (n−1 — spreadsheet-compatible). */
export function stdevOf(values: unknown[]): number {
	const v = varianceOf(values, true);
	return isNaN(v) ? NaN : Math.sqrt(v);
}

/** Population standard deviation (n). */
export function stdevpOf(values: unknown[]): number {
	const v = varianceOf(values, false);
	return isNaN(v) ? NaN : Math.sqrt(v);
}

/** Variance — sample (n−1) by default, population when `sample=false`. */
export function varianceOf(values: unknown[], sample = true): number {
	const a = nums(values);
	const n = a.length;
	if (n < (sample ? 2 : 1)) return NaN;
	const m = a.reduce((acc, x) => acc + x, 0) / n;
	const ss = a.reduce((acc, x) => acc + (x - m) * (x - m), 0);
	return ss / (sample ? n - 1 : n);
}

/** Geometric mean (requires all values > 0). */
export function geomeanOf(values: unknown[]): number {
	const a = nums(values);
	if (a.length === 0 || a.some((x) => x <= 0)) return NaN;
	return Math.pow(
		a.reduce((acc, x) => acc * x, 1),
		1 / a.length,
	);
}

/** Harmonic mean (requires all values > 0). */
export function harmeanOf(values: unknown[]): number {
	const a = nums(values);
	if (a.length === 0 || a.some((x) => x <= 0)) return NaN;
	return a.length / a.reduce((acc, x) => acc + 1 / x, 0);
}

/** Most frequent value (first maximum wins). */
export function modeOf(values: unknown[]): number {
	const a = nums(values);
	if (a.length === 0) return NaN;
	const counts = new Map<number, number>();
	let best = a[0];
	let bestCount = 0;
	for (const x of a) {
		const c = (counts.get(x) ?? 0) + 1;
		counts.set(x, c);
		if (c > bestCount) {
			bestCount = c;
			best = x;
		}
	}
	return best;
}

/** Linear-interpolated percentile (Excel PERCENTILE.INC style), 0–1. */
export function percentileOf(values: unknown[], p: unknown): number {
	const a = nums(values).sort((x, y) => x - y);
	if (a.length === 0) return NaN;
	const k = Number(p);
	if (isNaN(k) || k < 0 || k > 1) return NaN;
	const idx = k * (a.length - 1);
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return a[lo];
	return a[lo] + (idx - lo) * (a[hi] - a[lo]);
}

/** Quartile (0–4): QUARTILE(values, q) = PERCENTILE(values, q/4). */
export function quartileOf(values: unknown[], q: unknown): number {
	const k = Number(q);
	if (isNaN(k) || k < 0 || k > 4) return NaN;
	return percentileOf(values, k / 4);
}

/** k-th largest value (1-based): LARGE(values, k). */
export function largeOf(values: unknown[], k: unknown): number {
	const a = nums(values).sort((x, y) => y - x);
	const i = Math.round(Number(k)) - 1;
	return i >= 0 && i < a.length ? a[i] : NaN;
}

/** k-th smallest value (1-based): SMALL(values, k). */
export function smallOf(values: unknown[], k: unknown): number {
	const a = nums(values).sort((x, y) => x - y);
	const i = Math.round(Number(k)) - 1;
	return i >= 0 && i < a.length ? a[i] : NaN;
}

/**
 * Rank of a value within a set (1-based). Default descending (largest = 1);
 * pass order=1 for ascending. Ties share the same rank.
 */
export function rankOf(value: unknown, values: unknown[], order: unknown = 0): number {
	const a = nums(values);
	const v = numRank(value);
	if (a.length === 0) return NaN;
	const asc = numRank(order) === 1;
	let rank = 1;
	for (const x of a) {
		const better = asc ? x < v : x > v;
		if (better) rank++;
	}
	return rank;
}

const numRank = (v: unknown): number => Number(v) || 0;

// ─── Regression & forecasting (deterministic least squares) ──

/** Weighted average: WEIGHTED_AVG(values, weights) */
export function weightedAvgOf(values: unknown, weights: unknown): number {
	const vs = nums(Array.isArray(values) ? values : [values]);
	const ws = nums(Array.isArray(weights) ? weights : [weights]);
	if (vs.length === 0 || vs.length !== ws.length) return NaN;
	const sumW = ws.reduce((a, b) => a + b, 0);
	if (sumW === 0) return NaN;
	let acc = 0;
	for (let i = 0; i < vs.length; i++) acc += vs[i] * ws[i];
	return acc / sumW;
}

/** Pearson correlation coefficient: CORREL(ys, xs) */
export function correlOf(ys: unknown, xs: unknown): number {
	const y = nums(Array.isArray(ys) ? ys : [ys]);
	const x = nums(Array.isArray(xs) ? xs : [xs]);
	if (y.length < 2 || y.length !== x.length) return NaN;
	const my = y.reduce((a, b) => a + b, 0) / y.length;
	const mx = x.reduce((a, b) => a + b, 0) / x.length;
	let num = 0;
	let dy = 0;
	let dx = 0;
	for (let i = 0; i < y.length; i++) {
		const yd = y[i] - my;
		const xd = x[i] - mx;
		num += yd * xd;
		dy += yd * yd;
		dx += xd * xd;
	}
	if (dy === 0 || dx === 0) return NaN;
	return num / Math.sqrt(dy * dx);
}

/** Regression slope (y = a + b·x): SLOPE(ys, xs) */
export function slopeOf(ys: unknown, xs: unknown): number {
	const y = nums(Array.isArray(ys) ? ys : [ys]);
	const x = nums(Array.isArray(xs) ? xs : [xs]);
	if (y.length < 2 || y.length !== x.length) return NaN;
	const my = y.reduce((a, b) => a + b, 0) / y.length;
	const mx = x.reduce((a, b) => a + b, 0) / x.length;
	let num = 0;
	let den = 0;
	for (let i = 0; i < y.length; i++) {
		num += (x[i] - mx) * (y[i] - my);
		den += (x[i] - mx) * (x[i] - mx);
	}
	return den === 0 ? NaN : num / den;
}

/** Regression intercept: INTERCEPT(ys, xs) */
export function interceptOf(ys: unknown, xs: unknown): number {
	const y = nums(Array.isArray(ys) ? ys : [ys]);
	const x = nums(Array.isArray(xs) ? xs : [xs]);
	if (y.length < 2 || y.length !== x.length) return NaN;
	const my = y.reduce((a, b) => a + b, 0) / y.length;
	const mx = x.reduce((a, b) => a + b, 0) / x.length;
	return my - slopeOf(ys, xs) * mx;
}

/** Linear forecast: FORECAST(x, ys, xs) = a + b·x */
export function forecastOf(x: unknown, ys: unknown, xs: unknown): number {
	const b = slopeOf(ys, xs);
	const a = interceptOf(ys, xs);
	return a + b * numRank(x);
}

/** Percent rank (Excel PERCENTRANK.INC): 0–1, linear-interpolated. */
export function percentRankOf(values: unknown, value: unknown): number {
	const a = nums(Array.isArray(values) ? values : [values]).sort((p, q) => p - q);
	if (a.length === 0) return NaN;
	const v = numRank(value);
	if (v <= a[0]) return 0;
	if (v >= a[a.length - 1]) return 1;
	for (let i = 0; i < a.length - 1; i++) {
		if (a[i] <= v && v <= a[i + 1]) {
			const span = a[i + 1] - a[i];
			const pos = span === 0 ? i : i + (v - a[i]) / span;
			return pos / (a.length - 1);
		}
	}
	return NaN;
}

/** Clamp a value into [lo, hi]. */
export function clampOf(v: unknown, lo: unknown, hi: unknown): number {
	const x = numRank(v);
	const min = numRank(lo);
	const max = numRank(hi);
	return Math.min(Math.max(x, Math.min(min, max)), Math.max(min, max));
}

export const statisticalFunctions: Array<[string, EvalFunction]> = [
	['SUM', (args) => sumOf(args)],
	['COUNT', (args) => countOf(args)],
	['MEAN', (args) => meanOf(args)],
	['MIN', (args) => minOf(args)],
	['MAX', (args) => maxOf(args)],
	['MEDIAN', (args) => medianOf(args)],
	['STDEV', (args) => stdevOf(args)],
	['STDEVP', (args) => stdevpOf(args)],
	['VARIANCE', (args) => varianceOf(args)],
	['GEOMEAN', (args) => geomeanOf(args)],
	['HARMEAN', (args) => harmeanOf(args)],
	['MODE', (args) => modeOf(args)],
	['PERCENTILE', (args) => percentileOf(args.slice(0, -1), args[args.length - 1])],
	['QUARTILE', (args) => quartileOf(args.slice(0, -1), args[args.length - 1])],
	['LARGE', (args) => largeOf(args.slice(0, -1), args[args.length - 1])],
	['SMALL', (args) => smallOf(args.slice(0, -1), args[args.length - 1])],
	[
		'RANK',
		(args) => {
			const rest = args.slice(1);
			const last = rest[rest.length - 1];
			const hasOrder = typeof last === 'number' && rest.length >= 2 && Array.isArray(rest[rest.length - 2]);
			const values = hasOrder ? rest.slice(0, -1).flat() : rest.flat();
			return rankOf(args[0], values as unknown[], hasOrder ? last : 0);
		},
	],
	['WEIGHTED_AVG', (args) => weightedAvgOf(args[0], args[1])],
	['CORREL', (args) => correlOf(args[0], args[1])],
	['SLOPE', (args) => slopeOf(args[0], args[1])],
	['INTERCEPT', (args) => interceptOf(args[0], args[1])],
	['FORECAST', (args) => forecastOf(args[0], args[1], args[2])],
	['PERCENTRANK', (args) => percentRankOf(args[0], args[1])],
	['CLAMP', (args) => clampOf(args[0], args[1], args[2])],
];
