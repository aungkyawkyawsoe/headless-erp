/**
 * Utils Package Unit Tests
 *
 * Covers:
 *   - sanitizeIdentifier: SQL injection defense
 *   - table-name: prefix normalization, system/user table naming
 *   - validators: slug, identifier, roleName, email, uuid, positiveInt, limit, fieldType
 *   - assertValid / assertValidAll: throwing helpers
 */
import { describe, it, expect } from 'vitest';
import { sanitizeIdentifier, SanitizeError } from '../sanitize';
import { normalizePrefix, systemTable, collectionTable } from '../table-name';
import { validators, assertValid, assertValidAll, isReservedSqlWord, RESERVED_SQL_WORDS } from '../validation';
import { ValidationError } from '../errors/index';
import { MAX_PAGE_SIZE } from '../constants';

// ─── reserved-word prevention ───────────────────────────

describe('reserved SQL word prevention', () => {
	it('flags common SQL keywords (case-insensitive)', () => {
		for (const w of ['in', 'IN', 'In', 'order', 'group', 'values', 'index', 'select', 'from', 'where', 'check', 'rowid']) {
			expect(isReservedSqlWord(w), w).toBe(true);
		}
	});

	it('allows normal identifiers', () => {
		for (const w of ['check_in', 'start_time', 'ordering', 'group_name', 'values_json', 'index_code', 'in_time']) {
			expect(isReservedSqlWord(w), w).toBe(false);
		}
	});

	it('reservedWord validator rejects with a helpful error', () => {
		const result = validators.reservedWord('in', 'field name');
		expect(result.valid).toBe(false);
		if (!result.valid) expect(result.error).toContain('reserved SQL keyword');
		expect(validators.reservedWord('check_in', 'field name').valid).toBe(true);
	});

	it('slug validator rejects reserved words', () => {
		expect(validators.slug('order', 'slug').valid).toBe(false);
		expect(validators.slug('values', 'slug').valid).toBe(false);
		expect(validators.slug('hr_shifts', 'slug').valid).toBe(true);
	});

	it('keyword list is non-trivial and lowercase', () => {
		expect(RESERVED_SQL_WORDS.size).toBeGreaterThan(50);
		for (const w of RESERVED_SQL_WORDS) expect(w).toBe(w.toLowerCase());
	});
});

// ─── sanitizeIdentifier ─────────────────────────────────

describe('sanitizeIdentifier', () => {
	it('accepts valid identifiers', () => {
		expect(sanitizeIdentifier('users')).toBe('users');
		expect(sanitizeIdentifier('user_profiles')).toBe('user_profiles');
		expect(sanitizeIdentifier('_system_meta')).toBe('_system_meta');
		expect(sanitizeIdentifier('cms_articles')).toBe('cms_articles');
		expect(sanitizeIdentifier('A1_b2')).toBe('A1_b2');
	});

	it('rejects SQL injection payloads', () => {
		const bad = [
			'users; DROP TABLE users; --',
			"users' OR '1'='1",
			'user; DELETE FROM users',
			'1=1',
			'-1 UNION SELECT * FROM users',
			'table name with spaces',
			'table-name-with-dashes',
			'admin/../../etc/passwd',
		];
		for (const payload of bad) {
			expect(() => sanitizeIdentifier(payload)).toThrow(SanitizeError);
		}
	});

	it('rejects empty, null, and non-string values', () => {
		expect(() => sanitizeIdentifier('')).toThrow(SanitizeError);
		expect(() => sanitizeIdentifier(null as unknown as string)).toThrow(SanitizeError);
		expect(() => sanitizeIdentifier(undefined as unknown as string)).toThrow(SanitizeError);
		expect(() => sanitizeIdentifier(42 as unknown as string)).toThrow(SanitizeError);
	});

	it('includes context in error message', () => {
		try {
			sanitizeIdentifier('bad-name', 'QueryBuilder.select');
		} catch (err) {
			expect(err).toBeInstanceOf(SanitizeError);
			expect((err as Error).message).toContain('QueryBuilder.select');
		}
	});
});

// ─── table-name ─────────────────────────────────────────

describe('normalizePrefix', () => {
	it('appends trailing underscore', () => {
		expect(normalizePrefix('cms')).toBe('cms_');
	});

	it('keeps single trailing underscore', () => {
		expect(normalizePrefix('cms_')).toBe('cms_');
	});

	it('strips extra trailing underscores', () => {
		expect(normalizePrefix('cms__')).toBe('cms_');
		expect(normalizePrefix('cms___')).toBe('cms_');
	});

	it('handles empty prefix', () => {
		expect(normalizePrefix('')).toBe('_');
	});
});

describe('systemTable', () => {
	it('builds double-underscore system table names', () => {
		expect(systemTable('entity_schemas', 'cms_')).toBe('cms__entity_schemas');
		expect(systemTable('audit_log', 'app_')).toBe('app__audit_log');
	});

	it('works with un-normalized prefix', () => {
		expect(systemTable('roles', 'cms')).toBe('cms__roles');
	});
});

describe('collectionTable', () => {
	it('builds single-underscore collection table names', () => {
		expect(collectionTable('articles', 'cms_')).toBe('cms_articles');
		expect(collectionTable('products', 'cms_')).toBe('cms_products');
	});

	it('works with un-normalized prefix', () => {
		expect(collectionTable('orders', 'cms')).toBe('cms_orders');
	});
});

// ─── validators.slug ────────────────────────────────────

describe('validators.slug', () => {
	it('normalizes slugs', () => {
		const r = validators.slug('My Cool Page');
		expect(r).toEqual({ valid: true, value: 'my_cool_page' });
	});

	it('rejects empty values', () => {
		expect(validators.slug('')).toEqual({ valid: false, error: expect.stringContaining('slug') });
		expect(validators.slug(undefined)).toEqual({ valid: false, error: expect.any(String) });
	});

	it('rejects slugs starting with non-letter', () => {
		expect(validators.slug('123abc')).toEqual({ valid: false, error: expect.any(String) });
	});
});

// ─── validators.identifier ──────────────────────────────

describe('validators.identifier', () => {
	it('accepts safe identifiers', () => {
		expect(validators.identifier('table_name')).toEqual({ valid: true, value: 'table_name' });
		expect(validators.identifier('_meta')).toEqual({ valid: true, value: '_meta' });
	});

	it('rejects unsafe identifiers', () => {
		expect(validators.identifier('table-name')).toEqual({ valid: false, error: expect.any(String) });
		expect(validators.identifier('')).toEqual({ valid: false, error: expect.any(String) });
	});
});

// ─── validators.roleName ────────────────────────────────

describe('validators.roleName', () => {
	it('accepts names with spaces', () => {
		expect(validators.roleName('Content Editor')).toEqual({ valid: true, value: 'Content Editor' });
	});

	it('rejects invalid characters', () => {
		expect(validators.roleName('Editor!@#')).toEqual({ valid: false, error: expect.any(String) });
	});
});

// ─── validators.email ───────────────────────────────────

describe('validators.email', () => {
	it('accepts valid emails and lowercases', () => {
		expect(validators.email('USER@Example.COM')).toEqual({ valid: true, value: 'user@example.com' });
	});

	it('rejects invalid emails', () => {
		expect(validators.email('not-an-email')).toEqual({ valid: false, error: expect.any(String) });
		expect(validators.email('a@b')).toEqual({ valid: false, error: expect.any(String) });
		expect(validators.email('')).toEqual({ valid: false, error: expect.any(String) });
	});
});

// ─── validators.uuid ────────────────────────────────────

describe('validators.uuid', () => {
	it('accepts valid UUID v4', () => {
		expect(validators.uuid('123e4567-e89b-42d3-a456-426614174000')).toEqual({
			valid: true,
			value: '123e4567-e89b-42d3-a456-426614174000',
		});
	});

	it('rejects invalid UUIDs', () => {
		expect(validators.uuid('not-a-uuid')).toEqual({ valid: false, error: expect.any(String) });
		expect(validators.uuid('123e4567-e89b-12d3-a456-426614174000')).toEqual({ valid: false, error: expect.any(String) });
	});
});

// ─── validators.positiveInt ─────────────────────────────

describe('validators.positiveInt', () => {
	it('accepts non-negative integers', () => {
		expect(validators.positiveInt(0)).toEqual({ valid: true, value: 0 });
		expect(validators.positiveInt(42)).toEqual({ valid: true, value: 42 });
	});

	it('rejects negatives and floats', () => {
		expect(validators.positiveInt(-5)).toEqual({ valid: false, error: expect.any(String) });
		expect(validators.positiveInt(3.14)).toEqual({ valid: false, error: expect.any(String) });
	});
});

// ─── validators.limit ───────────────────────────────────

describe('validators.limit', () => {
	it('accepts limits and caps at MAX_PAGE_SIZE', () => {
		expect(validators.limit(10)).toEqual({ valid: true, value: 10 });
		expect(validators.limit(MAX_PAGE_SIZE)).toEqual({ valid: true, value: MAX_PAGE_SIZE });
		expect(validators.limit(MAX_PAGE_SIZE + 1)).toEqual({ valid: true, value: MAX_PAGE_SIZE });
	});

	it('rejects invalid limits', () => {
		expect(validators.limit(0)).toEqual({ valid: false, error: expect.any(String) });
		expect(validators.limit('abc')).toEqual({ valid: false, error: expect.any(String) });
	});
});

// ─── validators.fieldType ───────────────────────────────

describe('validators.fieldType', () => {
	it('accepts valid field types', () => {
		expect(validators.fieldType('text')).toEqual({ valid: true, value: 'text' });
		expect(validators.fieldType('m2o')).toEqual({ valid: true, value: 'm2o' });
	});

	it('accepts the image media type', () => {
		expect(validators.fieldType('image')).toEqual({ valid: true, value: 'image' });
	});

	it('rejects unknown field types', () => {
		expect(validators.fieldType('nonsense')).toEqual({ valid: false, error: expect.stringContaining('Invalid field type') });
	});
});

// ─── assertValid / assertValidAll ───────────────────────

describe('assertValid', () => {
	it('returns value on success', () => {
		expect(assertValid(validators.slug('Hello World'))).toBe('hello_world');
	});

	it('throws ValidationError on failure', () => {
		expect(() => assertValid(validators.email('bad'))).toThrow(ValidationError);
	});
});

describe('assertValidAll', () => {
	it('returns all validated values', () => {
		const result = assertValidAll(['slug', validators.slug('My Page')], ['email', validators.email('test@example.com')]);
		expect(result).toEqual({ slug: 'my_page', email: 'test@example.com' });
	});

	it('throws on first failure with key prefix', () => {
		expect(() => assertValidAll(['slug', validators.slug('ok')], ['email', validators.email('invalid')])).toThrow(/email/);
	});
});
