import { describe, expect, it } from 'vitest';
import { renderTemplate, m2oLabel, rowLabel, m2mIds } from './record-label';

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
	it('returns null for non-objects, arrays and label-less rows', () => {
		expect(m2oLabel('x')).toBeNull();
		expect(m2oLabel([1, 2])).toBeNull();
		expect(m2oLabel({})).toBeNull();
		expect(m2oLabel({ id: 'abc-123' })).toBeNull(); // a bare id is not a label
	});
});

describe('rowLabel', () => {
	it('prefers the display_template over display columns', () => {
		expect(rowLabel({ name_en: 'U Aung', eid: 'WH-1' }, '{{eid}} — {{name_en}}')).toBe('WH-1 — U Aung');
	});
	it('falls back to conventional display columns when no template resolves', () => {
		expect(rowLabel({ name_en: 'Aung' })).toBe('Aung');
	});
	it('only falls back to the raw id for genuinely label-less rows', () => {
		expect(rowLabel({ id: 'uuid-1' })).toBe('uuid-1');
		expect(rowLabel({ id: 'uuid-1', subordinate: { name_en: 'Sub' } })).toBe('uuid-1'); // nested data is not a top-level label
		expect(rowLabel({})).toBe('');
	});
});

describe('m2mIds', () => {
	it("extracts ids from expanded related rows (the '*.*' read shape)", () => {
		expect(m2mIds([{ id: 'a', name_en: 'A' }, { id: 'b' }, { id: 'c', deleted_at: null }])).toEqual(['a', 'b', 'c']);
	});
	it('passes plain id arrays through and coerces scalars to strings', () => {
		expect(m2mIds(['x', 'y'])).toEqual(['x', 'y']);
		expect(m2mIds(['a', 7])).toEqual(['a', '7']);
	});
	it('dedupes repeated ids (a duplicate would write a duplicate junction row)', () => {
		expect(m2mIds([{ id: 'a' }, 'a', { id: 'b' }])).toEqual(['a', 'b']);
	});
	it('returns [] for non-array / empty / blank values', () => {
		expect(m2mIds(undefined)).toEqual([]);
		expect(m2mIds(null)).toEqual([]);
		expect(m2mIds('tags')).toEqual([]);
		expect(m2mIds([])).toEqual([]);
		expect(m2mIds([{ id: '' }, ''])).toEqual([]);
	});
});
