/**
 * Safe Expression Evaluator — public API.
 *
 * Split into modules (code clarity, no giant file):
 *   registry.ts   — callable-function registry (single source of truth)
 *   tokenizer.ts  — string → tokens
 *   parser.ts     — recursive-descent parser + evaluator
 *
 * `new Function()` / `eval` are disallowed in the Workers runtime — this
 * evaluator never uses them. Identifiers resolve from a provided scope object
 * only; functions resolve from the explicit registry. Array literals are
 * supported (IN(doc.status, ['new', 'approved'])).
 */

export { registerFunction, getFunction, listRegisteredFunctions, callBuiltin, type EvalFunction } from './registry';
export { evaluateWith, validateExpressionComplexity, assertComplexity, MAX_EXPRESSION_LENGTH, MAX_EXPRESSION_TOKENS } from './parser';
export { isCallableFunction } from './callable';
export { Parser } from './parser';

import { evaluateWith } from './parser';

/**
 * Safely evaluate an expression against a scope of field values.
 * Throws on syntax errors or unknown functions.
 */
export function evaluateExpression(expression: string, scope: Record<string, unknown> = {}): unknown {
	return evaluateWith(expression, scope);
}

/** Convenience: evaluate a boolean expression (for validation/linkage conditions). */
export function evaluateBoolean(expression: string, scope: Record<string, unknown> = {}): boolean {
	return Boolean(evaluateWith(expression, scope));
}

/** Convenience: evaluate a numeric expression. */
export function evaluateNumber(expression: string, scope: Record<string, unknown> = {}): number {
	const v = evaluateWith(expression, scope);
	if (typeof v === 'number') return v;
	const n = Number(v);
	return isNaN(n) ? 0 : n;
}
