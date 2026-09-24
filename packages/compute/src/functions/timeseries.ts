/**
 * Time-series functions — pure, deterministic, for trend/period analysis.
 *
 *   MOVING_AVERAGE(doc.sales, 3)   — trailing 3-period mean (fills window with NaN)
 *   MOVING_SUM(doc.sales, 3)       — trailing 3-period sum
 *   PERCENT_CHANGE(150, 100)       — +50 (%)
 *   YOY_GROWTH(1320, 1200)         — +10 (%, year-over-year semantic alias)
 *
 * All accept nested arrays (a JSON field value works); NaN values are skipped
 * in window calculations so sparse series still compute.
 */

import type { EvalFunction } from '@mmbix/core';

const nums = (values: unknown[]): number[] => {
	const out: number[] = [];
	for (const a of values) {
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

const argValues = (args: unknown[]): number[] => (args.length === 1 && Array.isArray(args[0]) ? nums(args) : nums(args));

/** Trailing-window mean: MOVING_AVERAGE(values, window). NaN while the window isn't full. */
export function movingAverage(values: unknown, window?: unknown): number[] {
	const a = argValues([values]);
	const w = Math.max(1, Math.round(Number(window) || 1));
	const out: number[] = [];
	for (let i = 0; i < a.length; i++) {
		if (i + 1 < w) {
			out.push(NaN); // window not full yet — matches spreadsheet rolling semantics
			continue;
		}
		let sum = 0;
		for (let j = i - w + 1; j <= i; j++) sum += a[j];
		out.push(sum / w);
	}
	return out;
}

/** Trailing-window sum: MOVING_SUM(values, window). NaN while the window isn't full. */
export function movingSum(values: unknown, window?: unknown): number[] {
	const a = argValues([values]);
	const w = Math.max(1, Math.round(Number(window) || 1));
	const out: number[] = [];
	for (let i = 0; i < a.length; i++) {
		if (i + 1 < w) {
			out.push(NaN);
			continue;
		}
		let sum = 0;
		for (let j = i - w + 1; j <= i; j++) sum += a[j];
		out.push(sum);
	}
	return out;
}

/** Percentage change between two periods: (current − previous) / previous × 100. */
export function percentChange(current: unknown, previous: unknown): number {
	const c = Number(current);
	const p = Number(previous);
	if (isNaN(c) || isNaN(p) || p === 0) return NaN;
	return ((c - p) / p) * 100;
}

/** Year-over-year growth — semantic alias of percentChange for period comparisons. */
export function yoyGrowth(current: unknown, previous: unknown): number {
	return percentChange(current, previous);
}

/** Growth ratio: (current − previous) / previous (0.5 = +50%). */
export function growthRate(current: unknown, previous: unknown): number {
	const c = Number(current);
	const p = Number(previous);
	if (isNaN(c) || isNaN(p) || p === 0) return NaN;
	return (c - p) / p;
}

/** Mean absolute deviation — volatility measure for a series. */
export function meanAbsoluteDeviation(values: unknown): number {
	const a = argValues([values]);
	if (a.length === 0) return NaN;
	const m = a.reduce((acc, x) => acc + x, 0) / a.length;
	return a.reduce((acc, x) => acc + Math.abs(x - m), 0) / a.length;
}

export const timeseriesFunctions: Array<[string, EvalFunction]> = [
	['MOVING_AVERAGE', (args) => movingAverage(args[0], args[1])],
	['MOVING_SUM', (args) => movingSum(args[0], args[1])],
	['PERCENT_CHANGE', (args) => percentChange(args[0], args[1])],
	['YOY_GROWTH', (args) => yoyGrowth(args[0], args[1])],
	['GROWTH_RATE', (args) => growthRate(args[0], args[1])],
	['MAD', (args) => meanAbsoluteDeviation(args[0])],
];
