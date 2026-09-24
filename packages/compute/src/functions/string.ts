/**
 * String functions — pure, deterministic. All inputs coerce to string
 * (missing/null → ''). Indexes are 1-based (Excel-style).
 */

import type { EvalFunction } from '@mmbix/core';

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export function upperOf(v: unknown): string {
	return s(v).toUpperCase();
}

export function lowerOf(v: unknown): string {
	return s(v).toLowerCase();
}

/** Title case: "hello WORLD" → "Hello World" */
export function titleCaseOf(v: unknown): string {
	return s(v)
		.toLowerCase()
		.replace(/(^|\s)([a-z])/g, (m) => m.toUpperCase());
}

export function trimOf(v: unknown): string {
	return s(v).trim();
}

export function ltrimOf(v: unknown): string {
	return s(v).replace(/^\s+/, '');
}

export function rtrimOf(v: unknown): string {
	return s(v).replace(/\s+$/, '');
}

export function lenOf(v: unknown): number {
	return s(v).length;
}

/** LEFT(text, n) — first n chars. */
export function leftOf(v: unknown, n: unknown): string {
	return s(v).slice(0, Math.max(0, Math.round(Number(n) || 0)));
}

/** RIGHT(text, n) — last n chars. */
export function rightOf(v: unknown, n: unknown): string {
	const str = s(v);
	const k = Math.max(0, Math.round(Number(n) || 0));
	return str.slice(Math.max(0, str.length - k));
}

/** MID(text, start, len) — from 1-based start, len chars. */
export function midOf(v: unknown, start: unknown, len: unknown): string {
	const str = s(v);
	const st = Math.max(0, Math.round(Number(start) || 0) - 1);
	const l = Math.max(0, Math.round(Number(len) || 0));
	return str.slice(st, st + l);
}

/** CONCAT(a, b, …) — joins all args with no separator. */
export function concatOf(args: unknown[]): string {
	return args.map(s).join('');
}

/** REPLACE(text, find, replace) — replaces ALL occurrences. */
export function replaceOf(v: unknown, find: unknown, replace: unknown): string {
	return s(v).split(s(find)).join(s(replace));
}

export function startsWithOf(v: unknown, prefix: unknown): boolean {
	return s(v).startsWith(s(prefix));
}

export function endsWithOf(v: unknown, suffix: unknown): boolean {
	return s(v).endsWith(s(suffix));
}

export function containsOf(v: unknown, sub: unknown): boolean {
	return s(v).includes(s(sub));
}

/** PAD_LEFT(text, width, char?) */
export function padLeftOf(v: unknown, width: unknown, char?: unknown): string {
	const str = s(v);
	const w = Math.max(0, Math.round(Number(width) || 0));
	return str.padStart(w, s(char) || ' ');
}

/** PAD_RIGHT(text, width, char?) */
export function padRightOf(v: unknown, width: unknown, char?: unknown): string {
	const str = s(v);
	const w = Math.max(0, Math.round(Number(width) || 0));
	return str.padEnd(w, s(char) || ' ');
}

/** REPEAT(text, n) */
export function repeatOf(v: unknown, n: unknown): string {
	const k = Math.max(0, Math.round(Number(n) || 0));
	return s(v).repeat(k);
}

/** JOIN(values, separator?) — joins an array (or spread args). */
export function joinOf(values: unknown, separator?: unknown): string {
	const arr = Array.isArray(values) ? values : [values];
	return arr.map(s).join(s(separator));
}

// ─── Text utilities (display, search, masking) ───────────

/** SPLIT(text, sep, index?) — returns the array, or one element at `index` (0-based). */
export function splitOf(v: unknown, sep: unknown, index?: unknown): unknown {
	const parts = s(v).split(s(sep));
	if (index === undefined || index === null) return parts;
	const i = Math.round(Number(index) || 0);
	return parts[i] ?? '';
}

/** 0-based position of the first occurrence (or -1). */
export function indexOf(v: unknown, sub: unknown): number {
	return s(v).indexOf(s(sub));
}

/** 0-based position of the last occurrence (or -1). */
export function lastIndexOf(v: unknown, sub: unknown): number {
	return s(v).lastIndexOf(s(sub));
}

/** REVERSE(text) */
export function reverseOf(v: unknown): string {
	return [...s(v)].reverse().join('');
}

/** Unicode NFC normalization (search/compare safety). */
export function normalizeOf(v: unknown): string {
	return s(v).normalize('NFC');
}

/** Mask everything but the last `visible` chars: MASK('1234567890') → '******7890'. */
export function maskOf(v: unknown, visible?: unknown, maskChar?: unknown): string {
	const str = s(v);
	const keep = Math.max(0, Math.round(Number(visible) || 4));
	const m = s(maskChar) || '*';
	if (str.length <= keep) return str;
	return m.repeat(str.length - keep) + str.slice(str.length - keep);
}

/** URL/identifier slug: 'Hello World!' → 'hello-world'. */
export function slugifyOf(v: unknown): string {
	return s(v)
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** TRUNCATE(text, maxLen, suffix?) — truncates with an ellipsis by default. */
export function truncateOf(v: unknown, maxLen: unknown, suffix?: unknown): string {
	const str = s(v);
	const max = Math.max(0, Math.round(Number(maxLen) || 0));
	const suf = suffix === undefined ? '...' : s(suffix);
	if (str.length <= max) return str;
	return str.slice(0, Math.max(0, max - suf.length)) + suf;
}

export const stringFunctions: Array<[string, EvalFunction]> = [
	['UPPER', (args) => upperOf(args[0])],
	['LOWER', (args) => lowerOf(args[0])],
	['TITLE_CASE', (args) => titleCaseOf(args[0])],
	['TRIM', (args) => trimOf(args[0])],
	['LTRIM', (args) => ltrimOf(args[0])],
	['RTRIM', (args) => rtrimOf(args[0])],
	['LEN', (args) => lenOf(args[0])],
	['LEFT', (args) => leftOf(args[0], args[1])],
	['RIGHT', (args) => rightOf(args[0], args[1])],
	['MID', (args) => midOf(args[0], args[1], args[2])],
	['CONCAT', (args) => concatOf(args)],
	['REPLACE', (args) => replaceOf(args[0], args[1], args[2])],
	['STARTS_WITH', (args) => startsWithOf(args[0], args[1])],
	['ENDS_WITH', (args) => endsWithOf(args[0], args[1])],
	['CONTAINS', (args) => containsOf(args[0], args[1])],
	['PAD_LEFT', (args) => padLeftOf(args[0], args[1], args[2])],
	['PAD_RIGHT', (args) => padRightOf(args[0], args[1], args[2])],
	['REPEAT', (args) => repeatOf(args[0], args[1])],
	['JOIN', (args) => joinOf(args[0], args[1])],
	['SPLIT', (args) => splitOf(args[0], args[1], args[2])],
	['INDEX_OF', (args) => indexOf(args[0], args[1])],
	['LAST_INDEX_OF', (args) => lastIndexOf(args[0], args[1])],
	['REVERSE', (args) => reverseOf(args[0])],
	['NORMALIZE', (args) => normalizeOf(args[0])],
	['MASK', (args) => maskOf(args[0], args[1], args[2])],
	['SLUGIFY', (args) => slugifyOf(args[0])],
	['TRUNCATE', (args) => truncateOf(args[0], args[1], args[2])],
];
