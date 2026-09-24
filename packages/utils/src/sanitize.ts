/**
 * SQL Identifier Sanitizer
 *
 * Prevents SQL injection by validating table/column names.
 * Only allows safe identifiers matching: ^[a-zA-Z_][a-zA-Z0-9_]*$
 *
 * Values (data) should NEVER go through this function —
 * they must use D1 parameterized bindings instead.
 */

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export class SanitizeError extends Error {
	constructor(identifier: string, context?: string) {
		const msg = context ? `Invalid SQL identifier "${identifier}" in ${context}` : `Invalid SQL identifier: "${identifier}"`;
		super(msg);
		this.name = 'SanitizeError';
		Object.setPrototypeOf(this, SanitizeError.prototype);
	}
}

/**
 * Validates that `name` is a safe SQL identifier.
 * Throws `SanitizeError` if invalid.
 * Returns the same `name` if valid (for chaining).
 */
export function sanitizeIdentifier(name: string, context?: string): string {
	if (!name || typeof name !== 'string') {
		throw new SanitizeError(String(name), context);
	}
	if (!IDENTIFIER_RE.test(name)) {
		throw new SanitizeError(name, context);
	}
	return name;
}
