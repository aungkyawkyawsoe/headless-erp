/**
 * Lightweight Input Validation Utilities
 *
 * Enterprise-grade validation without heavy dependencies.
 * Provides type-safe validators for common CMS input scenarios.
 *
 * All validators return either:
 *   - `{ valid: true; value: T }` on success
 *   - `{ valid: false; error: string }` on failure
 *
 * Use with the error system for consistent error responses.
 */

import { ValidationError } from './errors/index';
import { VALID_FIELD_TYPES } from './field-types';
import { MAX_PAGE_SIZE } from './constants';

// ─── Validation Result Types ───────────────────────────

export type ValidationSuccess<T> = { valid: true; value: T };
export type ValidationFailure = { valid: false; error: string };
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

// ─── Shared Regexes ────────────────────────────────────
// Centralized here so @mmbix/core (field-utils, validator) doesn't re-declare them.

/** Simple email shape check: local@domain.tld */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** RFC 4122 v4 UUID (variant bits [89ab]) */
export const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── SQL Reserved Keywords ──────────────────────────────
// SQLite reserved keywords that break unquoted identifiers when used as
// collection slugs (→ table names) or field names (→ column names).
// Source: https://sqlite.org/lang_keywords.html (superset — safe to over-block).
// Case-insensitive: `IN`, `in`, `In` all match.

export const RESERVED_SQL_WORDS: ReadonlySet<string> = new Set(
	[
		// Core statement keywords
		'select',
		'from',
		'where',
		'insert',
		'into',
		'values',
		'update',
		'set',
		'delete',
		'create',
		'drop',
		'alter',
		'table',
		'index',
		'view',
		'trigger',
		// Clauses / operators (verified against sqlite3: these FAIL as unquoted column names)
		'in',
		'on',
		'as',
		'and',
		'or',
		'not',
		'null',
		'is',
		'between',
		'exists',
		'escape',
		'collate',
		'case',
		'when',
		'then',
		'else',
		'union',
		'all',
		'distinct',
		'group',
		'order',
		'having',
		'limit',
		'using',
		'join',
		'returning',
		'nothing',
		'add',
		// Constraint keywords
		'primary',
		'foreign',
		'references',
		'check',
		'unique',
		'default',
		'constraint',
		'autoincrement',
		// Transactions / misc
		'commit',
		'transaction',
		'to',
		'current_date',
		'current_time',
		'current_timestamp',
		'rowid',
		'oid', // usable unquoted, but shadowing rowid is never what you want
	].map((w) => w.toLowerCase()),
);

/**
 * Returns true when `name` (case-insensitive) is a SQL reserved keyword that
 * should be rejected as a collection slug or field name.
 */
export function isReservedSqlWord(name: string): boolean {
	return RESERVED_SQL_WORDS.has(name.trim().toLowerCase());
}

// ─── Reusable Validators ───────────────────────────────

export const validators = {
	/**
	 * Validate a non-empty string (slug, name, etc.)
	 */
	slug(value: unknown, field = 'slug'): ValidationResult<string> {
		if (typeof value !== 'string' || value.trim().length === 0) {
			return { valid: false, error: `${field} must be a non-empty string` };
		}
		const slug = value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_|_$/g, '');
		if (slug.length === 0) {
			return { valid: false, error: `${field} contains no valid characters` };
		}
		if (!/^[a-z][a-z0-9_]*$/.test(slug)) {
			return { valid: false, error: `${field} must start with a letter` };
		}
		if (isReservedSqlWord(slug)) {
			return {
				valid: false,
				error: `"${slug}" is a reserved SQL keyword and cannot be used as a ${field} (e.g. use "check_${slug}" or "${slug}_time" instead)`,
			};
		}
		return { valid: true, value: slug };
	},

	/**
	 * Reject SQL reserved keywords for identifier-shaped names (field names,
	 * collection names used as columns/tables). Case-insensitive.
	 */
	reservedWord(value: string, field = 'name'): ValidationResult<string> {
		if (isReservedSqlWord(value)) {
			return {
				valid: false,
				error: `"${value}" is a reserved SQL keyword and cannot be used as a ${field} (e.g. use "check_${value.trim().toLowerCase()}" or "${value.trim().toLowerCase()}_time" instead)`,
			};
		}
		return { valid: true, value: value.trim() };
	},

	/**
	 * Validate a SQL-safe identifier (table/column names)
	 */
	identifier(value: unknown, field = 'identifier'): ValidationResult<string> {
		if (typeof value !== 'string' || value.trim().length === 0) {
			return { valid: false, error: `${field} must be a non-empty string` };
		}
		if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
			return { valid: false, error: `${field} contains invalid characters` };
		}
		return { valid: true, value: value.trim() };
	},

	/**
	 * Validate a human-readable name (allows spaces, letters, digits).
	 */
	roleName(value: unknown, field = 'role name'): ValidationResult<string> {
		if (typeof value !== 'string' || value.trim().length === 0) {
			return { valid: false, error: `${field} must be a non-empty string` };
		}
		if (!/^[a-zA-Z][a-zA-Z0-9_\- ]*$/.test(value.trim())) {
			return { valid: false, error: `${field} contains invalid characters` };
		}
		return { valid: true, value: value.trim() };
	},

	/**
	 * Validate an email address
	 */
	email(value: unknown, field = 'email'): ValidationResult<string> {
		if (typeof value !== 'string' || value.trim().length === 0) {
			return { valid: false, error: `${field} must be a non-empty string` };
		}
		if (!EMAIL_RE.test(value.trim())) {
			return { valid: false, error: `${field} must be a valid email address` };
		}
		return { valid: true, value: value.trim().toLowerCase() };
	},

	/**
	 * Validate a UUID (v4)
	 */
	uuid(value: unknown, field = 'id'): ValidationResult<string> {
		if (typeof value !== 'string' || value.trim().length === 0) {
			return { valid: false, error: `${field} must be a non-empty string` };
		}
		const uuid = value.trim();
		if (!UUID_V4_RE.test(uuid)) {
			return { valid: false, error: `${field} must be a valid UUID v4` };
		}
		return { valid: true, value: uuid };
	},

	/**
	 * Validate a positive integer
	 */
	positiveInt(value: unknown, field = 'value'): ValidationResult<number> {
		const num = typeof value === 'number' ? value : Number(value);
		if (!Number.isInteger(num) || num < 0) {
			return { valid: false, error: `${field} must be a non-negative integer` };
		}
		return { valid: true, value: num };
	},

	/**
	 * Validate a limit value (1-100)
	 */
	limit(value: unknown): ValidationResult<number> {
		const parsed = parseInt(String(value), 10);
		if (isNaN(parsed) || parsed < 1) {
			return { valid: false, error: `limit must be a positive integer, got "${String(value)}"` };
		}
		return { valid: true, value: Math.min(MAX_PAGE_SIZE, parsed) };
	},

	/**
	 * Validate field type
	 */
	fieldType(value: unknown): ValidationResult<string> {
		if (typeof value !== 'string' || !VALID_FIELD_TYPES.has(value)) {
			return { valid: false, error: `Invalid field type "${value}". Valid: ${[...VALID_FIELD_TYPES].join(', ')}` };
		}
		return { valid: true, value };
	},
};

// ─── Throwing Helpers ──────────────────────────────────

/**
 * Validate and throw ValidationError on failure.
 * Useful in route handlers for concise validation.
 *
 * @example
 *   const slug = assertValid(validators.slug(body.slug, 'slug'))
 *   const id = assertValid(validators.uuid(params.id))
 */
export function assertValid<T>(result: ValidationResult<T>): T {
	if (!result.valid) {
		throw new ValidationError(result.error);
	}
	return result.value;
}

/**
 * Validate multiple fields at once.
 * Throws on the FIRST failure.
 *
 * @example
 *   const { slug, name } = assertValidAll(
 *     ['slug', validators.slug(body.slug)],
 *     ['name', validators.identifier(body.name, 'name')],
 *   )
 */
export function assertValidAll<T extends Record<string, unknown>>(...validations: [string, ValidationResult<unknown>][]): T {
	const result: Record<string, unknown> = {};
	for (const [key, validation] of validations) {
		if (!validation.valid) {
			throw new ValidationError(`${key}: ${validation.error}`);
		}
		result[key] = validation.value;
	}
	return result as T;
}
