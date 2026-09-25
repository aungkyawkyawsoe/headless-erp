/**
 * Field-type catalogs — the ONE searchable-type list every search surface
 * derives from (collection `?search=`, export `search`, global FTS5/LIKE search).
 */
import { describe, expect, it } from 'vitest';
import { FIELD_TYPE_NAMES, SEARCHABLE_FIELD_TYPES, VALID_FIELD_TYPES } from '../field-types';

describe('SEARCHABLE_FIELD_TYPES — single source', () => {
	it('is the exact union the search surfaces share', () => {
		const expected = [
			'text',
			'longtext',
			'text_editor',
			'markdown',
			'code',
			'slug',
			'phone',
			'email',
			'url',
			'icon',
			'barcode',
			'csv',
			'tags',
			'uuid',
			'color',
			'select',
			'time',
		];
		expect([...SEARCHABLE_FIELD_TYPES].sort()).toEqual([...expected].sort());
	});

	it('every member is a real field type (no dead label)', () => {
		for (const t of SEARCHABLE_FIELD_TYPES) {
			expect(VALID_FIELD_TYPES.has(t), t).toBe(true);
			expect(FIELD_TYPE_NAMES).toContain(t);
		}
	});

	it('excludes relations and non-text types', () => {
		const excluded = [
			'm2o',
			'o2m',
			'm2m',
			'm2a',
			'table',
			'formula',
			'integer',
			'number',
			'bigint',
			'currency',
			'percent',
			'rating',
			'boolean',
			'timestamp',
			'date',
			'datetime',
			'json',
			'file',
			'image',
			'password',
			'location',
			'signature',
			'progress',
			'duration',
		];
		for (const t of excluded) expect(SEARCHABLE_FIELD_TYPES.has(t), t).toBe(false);
	});
});
