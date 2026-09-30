/**
 * The duplicate half of the field "⋯" menu. The name rule is the contract the
 * backend sees (a duplicate must never collide with a column that exists — the
 * engine would 409 on the repeat PUT), and the label mark is the only way to
 * tell a copy apart, because a column cannot be renamed after creation.
 */
import { describe, expect, it } from 'vitest';
import { canDuplicateField, copyFieldName, duplicatedFields } from './field-ops';
import type { FieldDefinition } from './api';

const fields: FieldDefinition[] = [
	{ name: 'name_en', type: 'text', label: 'Name (EN)', required: true },
	{ name: 'name_en_copy', type: 'text', label: 'Name (EN)' },
];

describe('copyFieldName', () => {
	it('appends _copy, then counts up while the name is taken', () => {
		expect(copyFieldName([{ name: 'a', type: 'text' }], 'a')).toBe('a_copy');
		expect(copyFieldName(fields, 'name_en')).toBe('name_en_copy_2');
		expect(copyFieldName([...fields, { name: 'name_en_copy_2', type: 'text' }], 'name_en')).toBe('name_en_copy_3');
	});
});

describe('duplicatedFields', () => {
	it('appends a full copy — properties verbatim, unique name, "(copy)" label', () => {
		const next = duplicatedFields([{ name: 'qty', type: 'number', label: 'Qty', required: true, unique: true, min: 0 }], 'qty');
		expect(next).not.toBeNull();
		expect(next!.map((f) => f.name)).toEqual(['qty', 'qty_copy']);
		expect(next![1]).toEqual({ name: 'qty_copy', type: 'number', label: 'Qty (copy)', required: true, unique: true, min: 0 });
	});

	it('leaves the source list untouched and keeps its order', () => {
		const source: FieldDefinition[] = [
			{ name: 'a', type: 'text' },
			{ name: 'b', type: 'text' },
		];
		const next = duplicatedFields(source, 'a');
		expect(source).toHaveLength(2);
		expect(next!.map((f) => f.name)).toEqual(['a', 'b', 'a_copy']);
	});

	it('marks no label when the field has none — the name carries the copy', () => {
		const next = duplicatedFields([{ name: 'a', type: 'text' }], 'a');
		expect(next![1].label).toBeUndefined();
	});

	it('returns null when the source no longer exists', () => {
		expect(duplicatedFields(fields, 'gone')).toBeNull();
	});

	it('refuses the two types a duplicate cannot be honest for — m2m (engine 400) and table (shared child rows)', () => {
		expect(canDuplicateField({ name: 'tags', type: 'm2m', related_collection: 'hrm_employees' })).toBe(false);
		expect(canDuplicateField({ name: 'lines', type: 'table', related_collection: 'mro_inbound_lines' })).toBe(false);
		expect(duplicatedFields([{ name: 'tags', type: 'm2m', related_collection: 'hrm_employees' }], 'tags')).toBeNull();
		expect(duplicatedFields([{ name: 'lines', type: 'table', related_collection: 'mro_inbound_lines' }], 'lines')).toBeNull();
	});

	it('allows the types a duplicate is honest for — incl. a read-only o2m and a stored formula', () => {
		expect(canDuplicateField({ name: 'orders', type: 'o2m', related_collection: 'hrm_tasks' })).toBe(true);
		expect(canDuplicateField({ name: 'total', type: 'formula', store: true })).toBe(true);
		expect(canDuplicateField({ name: 'note', type: 'text' })).toBe(true);
	});
});
