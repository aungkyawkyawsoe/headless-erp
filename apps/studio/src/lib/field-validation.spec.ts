import { describe, expect, it } from 'vitest';
import type { FieldDefinition } from './api';
import { validateField } from './field-validation';

/** A schema field with only the properties the validator actually reads. */
function field(partial: Partial<FieldDefinition> & Pick<FieldDefinition, 'type'>): FieldDefinition {
	return { name: 'value', ...partial } as FieldDefinition;
}

describe('validateField — required', () => {
	it('reports a required field left empty (undefined / null / empty string / empty array)', () => {
		const f = field({ type: 'text', label: 'Name', required: true });
		expect(validateField(f, undefined)).toBe('Name is required');
		expect(validateField(f, null)).toBe('Name is required');
		expect(validateField(f, '')).toBe('Name is required');
		expect(validateField(f, [])).toBe('Name is required');
	});

	it('accepts a filled required field', () => {
		const f = field({ type: 'text', label: 'Name', required: true });
		expect(validateField(f, 'Ada')).toBeNull();
	});

	it('treats false as a real value for a required boolean (false is a choice, not "empty")', () => {
		expect(validateField(field({ type: 'boolean', required: true }), false)).toBeNull();
	});

	it('does not scold an empty OPTIONAL field (the hidden/omitted value case)', () => {
		const f = field({ type: 'email', label: 'Email' });
		expect(validateField(f, undefined)).toBeNull();
		expect(validateField(f, null)).toBeNull();
		expect(validateField(f, '')).toBeNull();
	});
});

describe('validateField — numeric shape and bounds', () => {
	it('rejects a non-numeric value', () => {
		expect(validateField(field({ type: 'number', label: 'Qty' }), 'abc')).toBe('Qty must be a number');
	});

	it('enforces min/max from the field definition', () => {
		const f = field({ type: 'integer', label: 'Age', min: 18, max: 65 });
		expect(validateField(f, 17)).toBe('Age must be at least 18');
		expect(validateField(f, 66)).toBe('Age must be at most 65');
		expect(validateField(f, 30)).toBeNull();
	});

	it('accepts a numeric string (the value a number input can briefly hold)', () => {
		expect(validateField(field({ type: 'number', label: 'Qty' }), '12')).toBeNull();
	});
});

describe('validateField — string shapes', () => {
	it('checks email', () => {
		expect(validateField(field({ type: 'email', label: 'Email' }), 'nope')).toBe('Email must be a valid email address');
		expect(validateField(field({ type: 'email', label: 'Email' }), 'a@b.co')).toBeNull();
	});

	it('checks url (http/https with a host)', () => {
		expect(validateField(field({ type: 'url', label: 'Site' }), 'ftp://x')).toBe('Site must be a valid URL');
		expect(validateField(field({ type: 'url', label: 'Site' }), 'https://example.com')).toBeNull();
	});

	it('checks a real calendar date', () => {
		expect(validateField(field({ type: 'date', label: 'Start' }), '2026-02-30')).toBe('Start must be a valid date');
		expect(validateField(field({ type: 'date', label: 'Start' }), '2026-02-28')).toBeNull();
	});

	it('checks datetime/timestamp (date part with an optional valid time)', () => {
		expect(validateField(field({ type: 'datetime', label: 'At' }), '2026-09-03T25:00:00Z')).toBe('At must be a valid date and time');
		expect(validateField(field({ type: 'datetime', label: 'At' }), '2026-09-03T17:25:00.000Z')).toBeNull();
		expect(validateField(field({ type: 'timestamp', label: 'At' }), '2026-09-03')).toBeNull();
	});

	it('checks a 24-hour clock time', () => {
		expect(validateField(field({ type: 'time', label: 'Shift' }), '9:00')).toBe('Shift must be a valid time');
		expect(validateField(field({ type: 'time', label: 'Shift' }), '09:00')).toBeNull();
	});

	it('checks JSON is parseable (an already-decoded object is valid)', () => {
		expect(validateField(field({ type: 'json', label: 'Meta' }), '{ bad')).toBe('Meta must be valid JSON');
		expect(validateField(field({ type: 'json', label: 'Meta' }), '{"a":1}')).toBeNull();
		expect(validateField(field({ type: 'json', label: 'Meta' }), { a: 1 })).toBeNull();
	});

	it('checks select membership against the field options', () => {
		const f = field({ type: 'select', label: 'Status', options: ['draft', { value: 'approved', label: 'Approved' }] });
		expect(validateField(f, 'bogus')).toBe('Status must be one of the available options');
		expect(validateField(f, 'approved')).toBeNull();
	});
});

describe('validateField — length limits from validation rules', () => {
	it('enforces min_length / max_length (server-backed rules)', () => {
		const f = field({ type: 'text', label: 'Code', validation: [{ type: 'min_length', value: 3 }] });
		expect(validateField(f, 'ab')).toBe('Code must be at least 3 characters');
		expect(validateField(f, 'abc')).toBeNull();

		const g = field({ type: 'text', label: 'Code', validation: [{ type: 'max_length', value: 4 }] });
		expect(validateField(g, 'abcde')).toBe('Code must be at most 4 characters');
	});

	it('prefers a rule-provided message when present', () => {
		const f = field({ type: 'text', label: 'Code', validation: [{ type: 'min_length', value: 3, message: 'Too short' }] });
		expect(validateField(f, 'ab')).toBe('Too short');
	});
});

describe('validateField — total and side-effect free', () => {
	it('returns a message or null instead of throwing on malformed input', () => {
		const cases = [
			() => validateField(undefined as unknown as FieldDefinition, 'x'),
			() => validateField(null as unknown as FieldDefinition, 'x'),
			() => validateField({ name: '', type: '' } as FieldDefinition, 'x'),
			// A non-numeric value on a number field is a message, not a crash.
			() => validateField(field({ type: 'number', label: 'N' }), { weird: true }),
			() => validateField(field({ type: 'text', label: 'T', validation: [null as never] }), 'ok'),
		];
		for (const run of cases) {
			expect(run).not.toThrow();
			const out = run();
			expect(out === null || typeof out === 'string').toBe(true);
		}
	});

	it('does not mutate its inputs', () => {
		const f = field({ type: 'number', label: 'N', min: 1 });
		const before = JSON.stringify(f);
		validateField(f, 0);
		expect(JSON.stringify(f)).toBe(before);
	});
});
