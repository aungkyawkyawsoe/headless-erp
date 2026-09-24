/**
 * Math helpers — beyond the evaluator's built-in Math.* whitelist.
 * Deterministic; Excel-style semantics (INT rounds DOWN, EVEN/ODD round away).
 */

import type { EvalFunction } from '@mmbix/core';

const num = (v: unknown): number => Number(v) || 0;

/** ROUND(x, digits?) — half away from zero. */
export function roundOf(v: unknown, digits?: unknown): number {
	const x = num(v);
	const d = Math.max(-15, Math.min(15, Math.round(Number(digits) || 0)));
	const f = Math.pow(10, d);
	return Math.round((x + Number.EPSILON * Math.sign(x) * 0.5) * f) / f;
}

/** ROUNDUP(x, digits?) — always away from zero. */
export function roundUpOf(v: unknown, digits?: unknown): number {
	const x = num(v);
	const d = Math.max(-15, Math.min(15, Math.round(Number(digits) || 0)));
	const f = Math.pow(10, d);
	return ((x < 0 ? -1 : 1) * Math.ceil(Math.abs(x) * f - Number.EPSILON)) / f;
}

/** ROUNDDOWN(x, digits?) — always toward zero. */
export function roundDownOf(v: unknown, digits?: unknown): number {
	const x = num(v);
	const d = Math.max(-15, Math.min(15, Math.round(Number(digits) || 0)));
	const f = Math.pow(10, d);
	return ((x < 0 ? -1 : 1) * Math.floor(Math.abs(x) * f + Number.EPSILON)) / f;
}

/** MOD(x, y) — remainder with the sign of the divisor (Excel MOD). */
export function modOf(x: unknown, y: unknown): number {
	const a = num(x);
	const b = num(y);
	if (b === 0) return NaN;
	return a - b * Math.floor(a / b);
}

/** INT(x) — rounds DOWN to the nearest integer (Excel INT). */
export function intOf(v: unknown): number {
	return Math.floor(num(v));
}

/** SIGN(x) — -1 | 0 | 1 */
export function signOf(v: unknown): number {
	const x = num(v);
	return x > 0 ? 1 : x < 0 ? -1 : 0;
}

/** EVEN(x) — next even integer away from zero (Excel). */
export function evenOf(v: unknown): number {
	const x = num(v);
	const n = Math.ceil(Math.abs(x));
	const rounded = n % 2 === 0 ? n : n + 1;
	return (x < 0 ? -1 : 1) * rounded;
}

/** ODD(x) — next odd integer away from zero (Excel). */
export function oddOf(v: unknown): number {
	const x = num(v);
	const n = Math.ceil(Math.abs(x));
	const rounded = n % 2 === 1 ? n : n + 1;
	return (x < 0 ? -1 : 1) * rounded;
}

export const mathFunctions: Array<[string, EvalFunction]> = [
	['ROUND', (args) => roundOf(args[0], args[1])],
	['ROUNDUP', (args) => roundUpOf(args[0], args[1])],
	['ROUNDDOWN', (args) => roundDownOf(args[0], args[1])],
	['MOD', (args) => modOf(args[0], args[1])],
	['INT', (args) => intOf(args[0])],
	['SIGN', (args) => signOf(args[0])],
	['EVEN', (args) => evenOf(args[0])],
	['ODD', (args) => oddOf(args[0])],
];
