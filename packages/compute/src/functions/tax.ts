/**
 * Tax functions — pure + data-driven (no hardcoded country rules).
 *
 *   TAX(amount, rate)                    → amount × rate            (tax amount)
 *   TAX_TOTAL(amount, rate)              → amount × (1 + rate)      (gross)
 *   TAX_GROSS(gross, rate)               → tax embedded in gross    (net×rate)
 *   TAX_BRACKETS(amount, brackets)       → progressive marginal tax
 *
 * `brackets` is a 2D array from scope, e.g.
 *   doc.brackets = [[0, 0], [10000, 0.05], [50000, 0.10]]
 *   → first 10000 taxed 0%, next 40000 at 5%, remainder at 10%.
 *
 * Country-specific tables (VAT rates, brackets, exemptions) are DATA —
 * store them per tenant and pass them in. No rule is hardcoded here.
 */

import type { EvalFunction } from '@mmbix/core';

const num = (v: unknown): number => Number(v) || 0;

/** Tax amount on a net value: TAX(1000, 0.05) = 50 */
export function tax(amount: unknown, rate: unknown): number {
	return num(amount) * num(rate);
}

/** Net + tax: TAX_TOTAL(1000, 0.05) = 1050 */
export function taxTotal(amount: unknown, rate: unknown): number {
	const a = num(amount);
	return a * (1 + num(rate));
}

/** Tax embedded in a gross value: TAX_GROSS(1050, 0.05) = 50 */
export function taxGross(gross: unknown, rate: unknown): number {
	const g = num(gross);
	const r = num(rate);
	if (1 + r === 0) return NaN;
	return (g * r) / (1 + r);
}

/** Progressive (marginal) tax over brackets: TAX_BRACKETS(amount, brackets) */
export function taxBrackets(amount: unknown, brackets: unknown): number {
	const a = num(amount);
	if (!Array.isArray(brackets)) return NaN;
	const pairs: Array<[number, number]> = [];
	for (const pair of brackets) {
		if (Array.isArray(pair) && pair.length >= 2) {
			const t = Number(pair[0]);
			const r = Number(pair[1]);
			if (!isNaN(t) && !isNaN(r)) pairs.push([t, r]);
		}
	}
	if (pairs.length === 0 || pairs[0][0] !== 0) return NaN;
	pairs.sort((x, y) => x[0] - y[0]);
	let total = 0;
	for (let i = 0; i < pairs.length; i++) {
		const [lower, rate] = pairs[i];
		const upper = i + 1 < pairs.length ? pairs[i + 1][0] : Infinity;
		const taxable = Math.max(0, Math.min(a, upper) - lower);
		total += taxable * rate;
		if (a <= upper) break;
	}
	return total;
}

export const taxFunctions: Array<[string, EvalFunction]> = [
	['TAX', (args) => tax(args[0], args[1])],
	['TAX_TOTAL', (args) => taxTotal(args[0], args[1])],
	['TAX_GROSS', (args) => taxGross(args[0], args[1])],
	['TAX_BRACKETS', (args) => taxBrackets(args[0], args[1])],
];
