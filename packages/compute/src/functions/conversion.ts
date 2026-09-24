/**
 * Explicit type conversions (the evaluator's Number() coerces to 0 on failure;
 * these surface NaN instead) + simple percentage math.
 */

import type { EvalFunction } from '@mmbix/core';

/** PERCENT(value, total) — value/total × 100 (total 0 → NaN). */
export function percentOf(value: unknown, total: unknown): number {
	const t = Number(total);
	if (isNaN(t) || t === 0) return NaN;
	return (Number(value) / t) * 100;
}

/** TO_NUMBER(v) — Number(v), NaN when not numeric (no coercion). */
export function toNumberOf(v: unknown): number {
	return Number(v);
}

/** TO_TEXT(v) — String(v) (null/undefined → ''). */
export function toTextOf(v: unknown): string {
	return v === null || v === undefined ? '' : String(v);
}

/** TO_BOOLEAN(v) — true for true/'true'/'1'/1, else false. */
export function toBooleanOf(v: unknown): boolean {
	if (typeof v === 'boolean') return v;
	if (typeof v === 'number') return v !== 0;
	if (typeof v === 'string') return v.toLowerCase() === 'true' || v === '1' || v.toLowerCase() === 'yes';
	return false;
}

export const conversionFunctions: Array<[string, EvalFunction]> = [
	['PERCENT', (args) => percentOf(args[0], args[1])],
	['TO_NUMBER', (args) => toNumberOf(args[0])],
	['TO_TEXT', (args) => toTextOf(args[0])],
	['TO_BOOLEAN', (args) => toBooleanOf(args[0])],
];
