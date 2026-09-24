/**
 * Callable-function introspection — for save-time validation of declarative
 * expressions (formula fields, linkage rules, workflow guards…).
 *
 * A name is callable when it lives in the function registry (built-ins,
 * aggregates, everything @mmbix/compute registers) OR is a deterministic
 * Math.* member from the parser allowlist.
 */
import { getFunction } from './registry';
import { Parser } from './parser';

export function isCallableFunction(name: string): boolean {
	if (getFunction(name)) return true;
	if (name.startsWith('Math.')) return Parser.MATH_FUNCTIONS.has(name.slice(5));
	return false;
}
