/**
 * Default Value Resolver — Dynamic Defaults for Field Definitions
 *
 * Supports:
 *   - Named variables: $NOW, $UUID, $TODAY, $USER_ID, $USER_NAME, $TIMESTAMP
 *   - Expressions:  =TODAY() + 7, =qty * 100
 *   - Functions:     UUID(), NOW(), TODAY()
 *
 * Bundle: ~0.5KB, zero dependencies
 */

import { callBuiltin, evaluateExpression } from './expression';

// ─── Default Context ────────────────────────────────────

export interface DefaultContext {
	user_id?: string;
	user_name?: string;
	user_email?: string;
	role_id?: string;
	role_name?: string;
	tenant?: string;
	[key: string]: unknown;
}

// ─── Named Resolvers ────────────────────────────────────

type NamedResolver = (ctx?: DefaultContext) => unknown;

const NAMED_DEFAULTS: Record<string, NamedResolver> = {
	// The $-named time/id variables resolve THROUGH the evaluator registry — the
	// ONE source of the built-ins (`NOW`/`TODAY`/`UUID`/`TIMESTAMP`), shared with
	// the `NOW()` call path, so the two can never drift into two implementations.
	$NOW: () => callBuiltin('NOW'),
	$TODAY: () => callBuiltin('TODAY'),
	$UUID: () => callBuiltin('UUID'),
	$TIMESTAMP: () => callBuiltin('TIMESTAMP'),
	$USER_ID: (ctx) => ctx?.user_id || null,
	$USER_NAME: (ctx) => ctx?.user_name || null,
	$USER_EMAIL: (ctx) => ctx?.user_email || null,
	$ROLE_ID: (ctx) => ctx?.role_id || null,
	$ROLE_NAME: (ctx) => ctx?.role_name || null,
	$TENANT: (ctx) => ctx?.tenant || null,
};

// ─── Resolver ───────────────────────────────────────────

export class DefaultResolver {
	/**
	 * Resolve a default value string.
	 *
	 * @param defaultValue - The default value (string, number, boolean, or expression)
	 * @param ctx - Optional context for user-scoped variables
	 * @returns The resolved value
	 *
	 * Examples:
	 *   "$NOW"           → "2026-07-31T10:30:00.000Z"
	 *   "$UUID"          → "a1b2c3d4-..."
	 *   "$USER_ID"       → (from ctx)
	 *   "=100 * 2"       → 200
	 *   "=TODAY() + 7"  → (computed)
	 *   "static_value"   → "static_value" (passthrough)
	 */
	static resolve(defaultValue: unknown, ctx?: DefaultContext): unknown {
		// Non-string values passthrough
		if (typeof defaultValue !== 'string') return defaultValue;

		const val = defaultValue;

		// Named variables: $NOW, $UUID, etc.
		if (val.startsWith('$') && !val.startsWith('$CURRENT_USER')) {
			const resolver = NAMED_DEFAULTS[val];
			if (resolver) return resolver(ctx);
		}

		// $CURRENT_USER.field
		if (val.startsWith('$CURRENT_USER.')) {
			const path = val.slice('$CURRENT_USER.'.length);
			if (ctx) {
				return (ctx as Record<string, unknown>)[path] ?? null;
			}
			return null;
		}

		// Expressions: =expression
		if (val.startsWith('=')) {
			return this._evaluateExpression(val.slice(1), ctx);
		}

		// Plain string
		return val;
	}

	/**
	 * Bulk resolve defaults for a set of fields.
	 * Returns the data object with resolved defaults for fields that have no value.
	 */
	static resolveAll(
		fields: Array<{ name: string; default?: unknown }>,
		inputData: Record<string, unknown>,
		ctx?: DefaultContext,
	): Record<string, unknown> {
		const data = { ...inputData };

		for (const field of fields) {
			if (field.default !== undefined && !(field.name in data)) {
				data[field.name] = this.resolve(field.default, ctx);
			}
		}

		return data;
	}

	// ── Private ──────────────────────────────────────────

	private static _evaluateExpression(expr: string, ctx?: DefaultContext): unknown {
		// Function calls (UUID(), NOW(), TODAY(), TIMESTAMP(), parseInt(), …) resolve
		// from the shared evaluator registry — its built-ins are the ONE source; a
		// scope copy only shadowed them (the parser consults the registry first).
		// `Math` stays a scope value because member access (`Math.max`) reads it here.
		const scope: Record<string, unknown> = { ...ctx, Math };

		try {
			// workerd-safe evaluator — new Function()/eval are disallowed in Workers
			return evaluateExpression(expr, scope);
		} catch {
			// If evaluation fails, return the expression as-is
			return `=${expr}`;
		}
	}
}
