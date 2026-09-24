import { describe, expect, it } from 'vitest';
import { humanizeEnumValue, selectDisplayLabel, selectOptionLabel } from '@mmbix/ui-views';
import { cellValue, renderTemplate, m2oLabel, renderCell } from './cell-render';
import { RELATION_PAGE_LIMIT } from './list-projection';
import type { FieldDefinition } from './api';

describe('cellValue', () => {
	it('renders null/undefined as em-dash', () => {
		expect(cellValue(null)).toBe('—');
		expect(cellValue(undefined)).toBe('—');
	});
	it('stringifies objects and scalars', () => {
		expect(cellValue('abc')).toBe('abc');
		expect(cellValue(42)).toBe('42');
		expect(cellValue({ a: 1 })).toBe('{"a":1}');
	});
});

describe('renderTemplate', () => {
	it('substitutes {{field}} placeholders', () => {
		expect(renderTemplate('Hi {{name}}!', { name: 'Aung' })).toBe('Hi Aung!');
	});
	it('resolves dotted paths', () => {
		expect(renderTemplate('{{a.b.c}}', { a: { b: { c: 'deep' } } })).toBe('deep');
	});
	it('leaves missing values empty and handles no template', () => {
		expect(renderTemplate('x{{missing}}y', {})).toBe('xy');
		expect(renderTemplate(undefined, {})).toBe('');
	});
});

describe('m2oLabel', () => {
	it('picks the first non-empty display field in priority order', () => {
		expect(m2oLabel({ name_mm: 'အောင်', name_en: 'Aung' })).toBe('အောင်');
		expect(m2oLabel({ name_en: 'Aung' })).toBe('Aung');
	});
	it('returns null for non-objects and empty rows', () => {
		expect(m2oLabel('x')).toBeNull();
		expect(m2oLabel([1, 2])).toBeNull();
		expect(m2oLabel({})).toBeNull();
	});
});

describe('select display labels (shared @mmbix/ui-views helpers)', () => {
	it('shows the matching option label when it is distinct', () => {
		expect(selectOptionLabel('draft', [{ value: 'draft', label: 'Draft' }])).toBe('Draft');
		expect(selectDisplayLabel('draft', [{ value: 'draft', label: 'Draft' }])).toBe('Draft');
	});
	it('falls back to a humanized label when option label equals the value', () => {
		// Live Gender field: options store label === value (`male`) — the UI must
		// still display `Male`, without hardcoding any particular option.
		expect(selectOptionLabel('male', [{ value: 'male', label: 'male' }])).toBeNull();
		expect(selectDisplayLabel('male', [{ value: 'male', label: 'male' }])).toBe('Male');
		expect(selectDisplayLabel('female', ['male', 'female'])).toBe('Female');
	});
	it('keeps already-readable values and free text untouched', () => {
		expect(selectDisplayLabel('Draft', [{ value: 'Draft', label: 'Draft' }])).toBe('Draft');
		expect(selectDisplayLabel('INV-0001')).toBe('INV-0001');
		expect(selectDisplayLabel('Aung Kyaw')).toBe('Aung Kyaw');
		expect(selectDisplayLabel('')).toBe('');
	});
});

describe('humanizeEnumValue', () => {
	it('word-capitalizes snake_case enum tokens', () => {
		expect(humanizeEnumValue('late_in')).toBe('Late In');
		expect(humanizeEnumValue('grace_early_out')).toBe('Grace Early Out');
	});
	it('capitalizes a single lowercase word token (male → Male)', () => {
		expect(humanizeEnumValue('male')).toBe('Male');
		expect(humanizeEnumValue('present')).toBe('Present');
		expect(humanizeEnumValue('v2x')).toBe('V2x');
	});
	it('leaves non-token strings untouched', () => {
		expect(humanizeEnumValue('Aung Kyaw')).toBeNull();
		expect(humanizeEnumValue('Male')).toBeNull();
		expect(humanizeEnumValue('INV-0001')).toBeNull();
		expect(humanizeEnumValue('')).toBeNull();
		expect(humanizeEnumValue(null)).toBeNull();
		// Long all-lowercase runs are hashes/base64, not enum tokens.
		expect(humanizeEnumValue('abcdef0123456789abcdef0123456789abcdef01')).toBeNull();
	});
});

describe('renderCell', () => {
	const m2oField: FieldDefinition = { name: 'owner', type: 'm2o' };
	it('renders an m2o object via template or label', () => {
		expect(renderCell(m2oField, { name: 'Aung' })).toBe('Aung');
		expect(renderCell({ ...m2oField, display_template: '{{name}} ({{id}})' }, { name: 'Aung', id: 7 })).toBe('Aung (7)');
	});
	it('renders relation arrays as a related-row count, not JSON', () => {
		expect(renderCell({ name: 'shifts', type: 'm2m' }, [{ id: 'a' }, { id: 'b' }])).toBe('2');
		expect(renderCell({ name: 'subordinates', type: 'o2m' }, [])).toBe('—');
		expect(renderCell({ name: 'lines', type: 'table' }, null)).toBe('—');
		// A scalar m2m (unexpanded id list) is still counted.
		expect(renderCell({ name: 'tags', type: 'm2m' }, ['x'])).toBe('1');
	});
	it('marks a full relation page as "at least" (the engine caps the array)', () => {
		const full = Array.from({ length: RELATION_PAGE_LIMIT }, (_, i) => ({ id: String(i) }));
		expect(renderCell({ name: 'shifts', type: 'm2m' }, full)).toBe(`${RELATION_PAGE_LIMIT}+`);
		expect(renderCell({ name: 'shifts', type: 'm2m' }, full.slice(0, -1))).toBe(String(RELATION_PAGE_LIMIT - 1));
	});
	it('falls back to cellValue for non-m2o', () => {
		expect(renderCell({ name: 'n', type: 'text' }, 5)).toBe('5');
	});
	it('renders datetime/timestamp cells in Myanmar time (UTC+6:30), not raw UTC', () => {
		expect(renderCell({ name: 'at', type: 'datetime' }, '2026-09-23T04:30:00.000Z')).toBe('2026-09-23 11:00');
		expect(renderCell({ name: 'at', type: 'timestamp' }, '2026-09-23 04:30:00')).toBe('2026-09-23 11:00');
		expect(renderCell({ name: 'at', type: 'datetime' }, null)).toBe('—');
	});
	it('renders select values via the matching option label', () => {
		const selectField: FieldDefinition = {
			name: 'status',
			type: 'select',
			options: [
				{ value: 'draft', label: 'Draft' },
				{ value: 'submitted', label: 'Submitted' },
			],
		};
		expect(renderCell(selectField, 'draft')).toBe('Draft');
		expect(renderCell(selectField, 'submitted')).toBe('Submitted');
	});
	it('prettifies lowercase select options that have no distinct label', () => {
		expect(renderCell({ name: 's', type: 'select', options: ['pending', 'done'] }, 'done')).toBe('Done');
		expect(
			renderCell(
				{
					name: 's',
					type: 'select',
					options: [
						{ value: 'male', label: 'male' },
						{ value: 'female', label: 'female' },
					],
				},
				'male',
			),
		).toBe('Male');
	});
	it('humanizes enum-style select/formula tokens without an explicit label', () => {
		expect(renderCell({ name: 's', type: 'select' }, 'late_in')).toBe('Late In');
		expect(renderCell({ name: 's', type: 'select', options: ['late_in'] }, 'late_in')).toBe('Late In');
		expect(renderCell({ name: 's', type: 'select' }, 'male')).toBe('Male');
		expect(renderCell({ name: 'status', type: 'formula', result_type: 'string' }, 'grace_early_out')).toBe('Grace Early Out');
		expect(renderCell({ name: 'status', type: 'formula' }, 'on_time')).toBe('On Time');
		expect(renderCell({ name: 'status', type: 'formula' }, 'present')).toBe('Present');
	});
	it('leaves free text and non-enum values untouched', () => {
		// Plain text fields are never humanized.
		expect(renderCell({ name: 'n', type: 'text' }, 'hello_world')).toBe('hello_world');
		// Formula output that is not an enum token stays as computed.
		expect(renderCell({ name: 'code', type: 'formula' }, 'INV-0001')).toBe('INV-0001');
		expect(renderCell({ name: 'code', type: 'formula' }, 'Aung Kyaw')).toBe('Aung Kyaw');
	});
	it('humanizes unmatched enum-like values but keeps real free text raw', () => {
		expect(renderCell({ name: 's', type: 'select', options: [{ value: 'a', label: 'A' }] }, 'legacy')).toBe('Legacy');
		expect(renderCell({ name: 's', type: 'select', options: [{ value: 'a', label: 'A' }] }, 'x')).toBe('X');
		expect(renderCell({ name: 's', type: 'select', options: [{ value: 'a', label: 'A' }] }, 'INV-0001')).toBe('INV-0001');
		expect(renderCell({ name: 's', type: 'select', options: [{ value: 'a', label: 'A' }] }, null)).toBe('—');
	});
});
