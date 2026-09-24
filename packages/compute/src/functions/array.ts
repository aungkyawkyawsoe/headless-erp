/**
 * Array helpers — operate on JSON array fields / array literals.
 * Indexes are 1-based (Excel/Excel INDEX convention).
 */

import type { EvalFunction } from '@mmbix/core';

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Number of elements: ARRAY_LENGTH(list) */
export function arrayLength(v: unknown): number {
	return arr(v).length;
}

/** 1-based element access: ARRAY_GET(list, index) → element or null. */
export function arrayGet(v: unknown, index: unknown): unknown {
	const a = arr(v);
	const i = Math.round(Number(index) || 0) - 1;
	return i >= 0 && i < a.length ? a[i] : null;
}

/** First element: ARRAY_FIRST(list) */
export function arrayFirst(v: unknown): unknown {
	const a = arr(v);
	return a.length > 0 ? a[0] : null;
}

/** Last element: ARRAY_LAST(list) */
export function arrayLast(v: unknown): unknown {
	const a = arr(v);
	return a.length > 0 ? a[a.length - 1] : null;
}

/** Deduplicate preserving first-seen order (numbers + strings). */
export function arrayUnique(v: unknown): unknown[] {
	const seen = new Set<string>();
	const out: unknown[] = [];
	for (const item of arr(v)) {
		const key = typeof item === 'number' || typeof item === 'string' || typeof item === 'boolean' ? String(item) : JSON.stringify(item);
		if (!seen.has(key)) {
			seen.add(key);
			out.push(item);
		}
	}
	return out;
}

/** Sorted copy: ARRAY_SORT(list, asc?) — asc default true; 0/false → descending. */
export function arraySort(v: unknown, asc?: unknown): unknown[] {
	const a = arr(v).map((x) => Number(x));
	const up = asc === undefined || asc === true || Number(asc) === 1;
	return a.sort((x, y) => (up ? x - y : y - x));
}

export const arrayFunctions: Array<[string, EvalFunction]> = [
	['ARRAY_LENGTH', (args) => arrayLength(args[0])],
	['ARRAY_GET', (args) => arrayGet(args[0], args[1])],
	['ARRAY_FIRST', (args) => arrayFirst(args[0])],
	['ARRAY_LAST', (args) => arrayLast(args[0])],
	['ARRAY_UNIQUE', (args) => arrayUnique(args[0])],
	['ARRAY_SORT', (args) => arraySort(args[0], args[1])],
];
