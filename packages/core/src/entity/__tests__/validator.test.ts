/**
 * FieldValidator Unit Tests
 */
import { describe, it, expect } from 'vitest';
import { FieldValidator } from '../validator';
import type { ValidationRule } from '../validator';

describe('FieldValidator', () => {
	// --- required ---
	it('should pass when required field has value', () => {
		const errors = FieldValidator.validateField('name', 'hello', [{ type: 'required' }]);
		expect(errors).toHaveLength(0);
	});

	it('should fail when required field is undefined', () => {
		const errors = FieldValidator.validateField('name', undefined, [{ type: 'required' }]);
		expect(errors).toHaveLength(1);
		expect(errors[0].field).toBe('name');
	});

	it('should fail when required field is empty string', () => {
		const errors = FieldValidator.validateField('name', '', [{ type: 'required' }]);
		expect(errors).toHaveLength(1);
	});

	// --- min ---
	it('should pass min when value >= min', () => {
		expect(FieldValidator.validateField('age', 18, [{ type: 'min', value: 18 }])).toHaveLength(0);
		expect(FieldValidator.validateField('age', 20, [{ type: 'min', value: 18 }])).toHaveLength(0);
	});

	it('should fail min when value < min', () => {
		const errors = FieldValidator.validateField('age', 15, [{ type: 'min', value: 18 }]);
		expect(errors).toHaveLength(1);
	});

	// --- max ---
	it('should pass max when value <= max', () => {
		expect(FieldValidator.validateField('score', 100, [{ type: 'max', value: 100 }])).toHaveLength(0);
	});

	it('should fail max when value > max', () => {
		expect(FieldValidator.validateField('score', 150, [{ type: 'max', value: 100 }])).toHaveLength(1);
	});

	// --- min_length / max_length ---
	it('should validate string length', () => {
		expect(FieldValidator.validateField('code', 'ABC', [{ type: 'min_length', value: 3 }])).toHaveLength(0);
		expect(FieldValidator.validateField('code', 'AB', [{ type: 'min_length', value: 3 }])).toHaveLength(1);
		expect(FieldValidator.validateField('code', 'ABCDE', [{ type: 'max_length', value: 5 }])).toHaveLength(0);
		expect(FieldValidator.validateField('code', 'ABCDEF', [{ type: 'max_length', value: 5 }])).toHaveLength(1);
	});

	// --- regex ---
	it('should validate regex patterns', () => {
		const rules: ValidationRule[] = [{ type: 'regex', pattern: '^[A-Z]{2}-\\d{4}$' }];
		expect(FieldValidator.validateField('sku', 'AB-1234', rules)).toHaveLength(0);
		expect(FieldValidator.validateField('sku', 'abc', rules)).toHaveLength(1);
	});

	// --- email ---
	it('should validate email format', () => {
		const rules: ValidationRule[] = [{ type: 'email' }];
		expect(FieldValidator.validateField('email', 'test@example.com', rules)).toHaveLength(0);
		expect(FieldValidator.validateField('email', 'not-an-email', rules)).toHaveLength(1);
	});

	// --- url ---
	it('should validate URL format', () => {
		const rules: ValidationRule[] = [{ type: 'url' }];
		expect(FieldValidator.validateField('website', 'https://example.com', rules)).toHaveLength(0);
		expect(FieldValidator.validateField('website', 'not-a-url', rules)).toHaveLength(1);
	});

	// --- in ---
	it('should validate value is in list', () => {
		const rules: ValidationRule[] = [{ type: 'in', values: ['draft', 'published', 'archived'] }];
		expect(FieldValidator.validateField('status', 'draft', rules)).toHaveLength(0);
		expect(FieldValidator.validateField('status', 'deleted', rules)).toHaveLength(1);
	});

	// --- expression ---
	it('should validate custom expression', () => {
		const rules: ValidationRule[] = [{ type: 'expression', formula: 'value > 0 && value < 100', message: 'Must be between 0 and 100' }];
		expect(FieldValidator.validateField('percent', 50, rules)).toHaveLength(0);
		const errors = FieldValidator.validateField('percent', 150, rules);
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toBe('Must be between 0 and 100');
	});

	it('should allow expression to reference other fields via data', () => {
		const rules: ValidationRule[] = [{ type: 'expression', formula: 'value === data.confirm_password', message: 'Passwords must match' }];
		expect(FieldValidator.validateField('password', 'secret', rules, { confirm_password: 'secret' })).toHaveLength(0);
		expect(FieldValidator.validateField('password', 'wrong', rules, { confirm_password: 'secret' })).toHaveLength(1);
	});

	// --- required_if ---
	it('should validate required_if condition', () => {
		const rules: ValidationRule[] = [{ type: 'required_if', field: 'status', value: 'rejected' }];
		// Not required when status != rejected
		expect(FieldValidator.validateField('reason', '', rules, { status: 'draft' })).toHaveLength(0);
		// Required when status = rejected
		expect(FieldValidator.validateField('reason', '', rules, { status: 'rejected' })).toHaveLength(1);
		expect(FieldValidator.validateField('reason', 'Not good', rules, { status: 'rejected' })).toHaveLength(0);
	});

	// --- custom message ---
	it('should use custom error messages', () => {
		const errors = FieldValidator.validateField('email', '', [{ type: 'required', message: 'Email is mandatory!' }]);
		expect(errors[0].message).toBe('Email is mandatory!');
	});

	// --- unique (DB-enforced; the standalone validator reports that) ---
	it('reports that unique is DB-enforced when used standalone', () => {
		const errors = FieldValidator.validateField('username', 'exists', [{ type: 'unique' }]);
		expect(errors).toHaveLength(1);
		expect(errors[0].rule).toBe('unique');
		expect(errors[0].message).toContain('unique'); // points at the DB check, not a silent no-op
	});

	// --- validateAll ---
	it('should validate all fields in an object', () => {
		const errors = FieldValidator.validateAll(
			[
				{ name: 'email', validation: [{ type: 'required' }, { type: 'email' }] },
				{ name: 'age', validation: [{ type: 'min', value: 18 }] },
			],
			{ email: '', age: 15 },
		);
		expect(errors.length).toBeGreaterThanOrEqual(2);
	});

	it('should skip fields without validation rules', () => {
		const errors = FieldValidator.validateAll([{ name: 'title', validation: undefined }], { title: 'test' });
		expect(errors).toHaveLength(0);
	});

	// --- formatErrors ---
	it('should format multiple errors', () => {
		const errors = [
			{ field: 'email', message: 'Email is required' },
			{ field: 'age', message: 'Age must be at least 18' },
		];
		expect(FieldValidator.formatErrors(errors)).toBe('"email": Email is required; "age": Age must be at least 18');
	});

	// --- isValid ---
	it('should return true for empty errors', () => {
		expect(FieldValidator.isValid([])).toBe(true);
	});

	it('should return false when errors exist', () => {
		expect(FieldValidator.isValid([{ field: 'x', message: 'bad' }])).toBe(false);
	});

	// --- multiple rules on one field ---
	it('should run all rules and collect all errors', () => {
		const errors = FieldValidator.validateField('password', 'ab', [
			{ type: 'min_length', value: 8, message: 'Too short' },
			{ type: 'regex', pattern: '[A-Z]', message: 'Need uppercase' },
		]);
		expect(errors).toHaveLength(2);
	});
});
