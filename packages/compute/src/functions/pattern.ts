/**
 * Pattern matching — deterministic regex tests for validation guards.
 * `new RegExp(...)` is allowed on workerd (this is NOT eval). Patterns are
 * provided as data (admin-authored rules); invalid patterns return false.
 */

import type { EvalFunction } from '@mmbix/core';

/** MATCHES(text, pattern) — full RegExp.test; invalid pattern → false. */
export function matchesOf(text: unknown, pattern: unknown): boolean {
	if (typeof text !== 'string' || typeof pattern !== 'string' || pattern === '') return false;
	try {
		return new RegExp(pattern).test(text);
	} catch {
		return false;
	}
}

export const patternFunctions: Array<[string, EvalFunction]> = [['MATCHES', (args) => matchesOf(args[0], args[1])]];
