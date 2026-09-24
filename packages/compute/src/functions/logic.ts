/**
 * Logic helpers — conditionals for formula fields and rules.
 *
 *   IF(condition, then, else)   — eager args (both branches evaluate, the
 *                                 unused value is discarded — pure).
 *   COALESCE(a, b, …)           — first value that is not null/undefined
 *                                 (empty string and 0 are kept).
 */

import type { EvalFunction } from '@mmbix/core';

export function ifThen(cond: unknown, thenV: unknown, elseV: unknown): unknown {
	return Boolean(cond) ? thenV : elseV;
}

export function coalesceOf(args: unknown[]): unknown {
	for (const a of args) {
		if (a !== null && a !== undefined) return a;
	}
	return null;
}

// ─── Membership, ranges & validation helpers ─────────────

/** IN(value, list) — membership (list from an array literal or a scope field). */
export function inList(value: unknown, list: unknown): boolean {
	if (!Array.isArray(list)) return false;
	for (const item of list) {
		// Loose match like the evaluator's ==: numbers-as-strings compare equal.
		if (item === value) return true;
		if (item !== null && value !== null && item !== undefined && value !== undefined) {
			const an = Number(item);
			const bn = Number(value);
			if (!isNaN(an) && !isNaN(bn) && an === bn) return true;
			if (String(item) === String(value)) return true;
		}
	}
	return false;
}

/** BETWEEN(x, lo, hi) — inclusive range check. */
export function betweenOf(v: unknown, lo: unknown, hi: unknown): boolean {
	const x = Number(v);
	const a = Number(lo);
	const b = Number(hi);
	if (isNaN(x) || isNaN(a) || isNaN(b)) return false;
	return x >= Math.min(a, b) && x <= Math.max(a, b);
}

/** SWITCH(value, k1, r1, k2, r2, …, default) — first matching key wins. */
export function switchOf(args: unknown[]): unknown {
	const value = args[0];
	for (let i = 1; i + 1 < args.length; i += 2) {
		if (String(args[i]) === String(value)) return args[i + 1];
	}
	// Odd leftover = default (value, k1, r1, …, default)
	return args.length % 2 === 0 ? args[args.length - 1] : null;
}

/** IS_EMPTY(v) — null, undefined, '' or an empty array. */
export function isEmptyOf(v: unknown): boolean {
	return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

/** IS_NULL(v) — null or undefined only. */
export function isNullOf(v: unknown): boolean {
	return v === null || v === undefined;
}

/** IS_NUMBER(v) — a finite number (not a numeric string). */
export function isNumberOf(v: unknown): boolean {
	return typeof v === 'number' && !isNaN(v);
}

/** IS_INTEGER(v) — an integer number. */
export function isIntegerOf(v: unknown): boolean {
	return typeof v === 'number' && Number.isInteger(v);
}

/** IS_TEXT(v) — a string. */
export function isTextOf(v: unknown): boolean {
	return typeof v === 'string';
}

/** IS_BOOLEAN(v) — a boolean. */
export function isBooleanOf(v: unknown): boolean {
	return typeof v === 'boolean';
}

export const logicFunctions: Array<[string, EvalFunction]> = [
	['IF', (args) => ifThen(args[0], args[1], args[2])],
	['COALESCE', (args) => coalesceOf(args)],
	['IN', (args) => inList(args[0], args[1])],
	['BETWEEN', (args) => betweenOf(args[0], args[1], args[2])],
	['SWITCH', (args) => switchOf(args)],
	['IS_EMPTY', (args) => isEmptyOf(args[0])],
	['IS_NULL', (args) => isNullOf(args[0])],
	['IS_NUMBER', (args) => isNumberOf(args[0])],
	['IS_INTEGER', (args) => isIntegerOf(args[0])],
	['IS_TEXT', (args) => isTextOf(args[0])],
	['IS_BOOLEAN', (args) => isBooleanOf(args[0])],
];
