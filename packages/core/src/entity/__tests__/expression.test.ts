/**
 * Safe Expression Evaluator Unit Tests
 */
import { describe, it, expect } from 'vitest';
import {
	evaluateExpression,
	evaluateBoolean,
	evaluateNumber,
	validateExpressionComplexity,
	MAX_EXPRESSION_LENGTH,
	MAX_EXPRESSION_TOKENS,
} from '../expression';

describe('evaluateExpression — arithmetic', () => {
	it('evaluates basic arithmetic', () => {
		expect(evaluateExpression('1 + 2')).toBe(3);
		expect(evaluateExpression('10 - 4')).toBe(6);
		expect(evaluateExpression('3 * 4')).toBe(12);
		expect(evaluateExpression('20 / 5')).toBe(4);
		expect(evaluateExpression('7 % 3')).toBe(1);
	});

	it('respects operator precedence', () => {
		expect(evaluateExpression('2 + 3 * 4')).toBe(14);
		expect(evaluateExpression('(2 + 3) * 4')).toBe(20);
		expect(evaluateExpression('10 - 2 - 3')).toBe(5);
		expect(evaluateExpression('100 / 10 / 2')).toBe(5);
	});

	it('supports unary minus', () => {
		expect(evaluateExpression('-5 + 10')).toBe(5);
		expect(evaluateExpression('2 * -3')).toBe(-6);
	});

	it('evaluates field references from scope', () => {
		const scope = { qty: 5, rate: 100 };
		expect(evaluateExpression('qty * rate', scope)).toBe(500);
		expect(evaluateExpression('qty + 1', scope)).toBe(6);
	});
});

describe('evaluateExpression — comparisons & logic', () => {
	it('evaluates comparisons', () => {
		expect(evaluateBoolean('5 > 3')).toBe(true);
		expect(evaluateBoolean('5 < 3')).toBe(false);
		expect(evaluateBoolean('5 >= 5')).toBe(true);
		expect(evaluateBoolean('5 <= 4')).toBe(false);
		expect(evaluateBoolean('5 == 5')).toBe(true);
		expect(evaluateBoolean('5 == "5"')).toBe(true); // loose
		expect(evaluateBoolean('5 != 6')).toBe(true);
	});

	it('evaluates date string comparisons (ISO YYYY-MM-DD)', () => {
		// Same date
		expect(evaluateBoolean('a >= b', { a: '2026-09-18', b: '2026-09-18' })).toBe(true);
		expect(evaluateBoolean('a <= b', { a: '2026-09-18', b: '2026-09-18' })).toBe(true);
		expect(evaluateBoolean('a > b', { a: '2026-09-18', b: '2026-09-18' })).toBe(false);
		expect(evaluateBoolean('a < b', { a: '2026-09-18', b: '2026-09-18' })).toBe(false);
		// a after b
		expect(evaluateBoolean('a > b', { a: '2026-09-20', b: '2026-09-18' })).toBe(true);
		expect(evaluateBoolean('a >= b', { a: '2026-09-20', b: '2026-09-18' })).toBe(true);
		expect(evaluateBoolean('a < b', { a: '2026-09-20', b: '2026-09-18' })).toBe(false);
		// a before b
		expect(evaluateBoolean('a < b', { a: '2026-09-10', b: '2026-09-18' })).toBe(true);
		expect(evaluateBoolean('a <= b', { a: '2026-09-10', b: '2026-09-18' })).toBe(true);
		expect(evaluateBoolean('a > b', { a: '2026-09-10', b: '2026-09-18' })).toBe(false);
		// Cross-year
		expect(evaluateBoolean('a > b', { a: '2027-01-01', b: '2026-12-31' })).toBe(true);
		expect(evaluateBoolean('a < b', { a: '2026-12-31', b: '2027-01-01' })).toBe(true);
	});

	it('date validation pattern — end >= start or empty', () => {
		const scope = { started_at: '2026-09-15' };
		// Empty end date passes
		expect(evaluateBoolean("value == '' || value >= data.started_at", { value: '', data: scope })).toBe(true);
		// End date after start passes
		expect(evaluateBoolean("value == '' || value >= data.started_at", { value: '2026-09-20', data: scope })).toBe(true);
		// End date same as start passes
		expect(evaluateBoolean("value == '' || value >= data.started_at", { value: '2026-09-15', data: scope })).toBe(true);
		// End date before start fails
		expect(evaluateBoolean("value == '' || value >= data.started_at", { value: '2026-09-10', data: scope })).toBe(false);
	});

	it('evaluates logical operators', () => {
		expect(evaluateBoolean('true && true')).toBe(true);
		expect(evaluateBoolean('true && false')).toBe(false);
		expect(evaluateBoolean('false || true')).toBe(true);
		expect(evaluateBoolean('!false')).toBe(true);
		expect(evaluateBoolean('value > 0 && value < 100', { value: 50 })).toBe(true);
		expect(evaluateBoolean('value > 0 && value < 100', { value: 150 })).toBe(false);
	});

	it('supports data.field access', () => {
		expect(evaluateBoolean('value === data.confirm_password', { value: 'abc', data: { confirm_password: 'abc' } })).toBe(true);
		expect(evaluateBoolean('value === data.confirm_password', { value: 'xyz', data: { confirm_password: 'abc' } })).toBe(false);
	});
});

describe('evaluateExpression — functions', () => {
	it('supports Math functions', () => {
		expect(evaluateNumber('Math.max(10, 20)')).toBe(20);
		expect(evaluateNumber('Math.min(10, 20)')).toBe(10);
		expect(evaluateNumber('Math.abs(-5)')).toBe(5);
		expect(evaluateNumber('Math.round(3.7)')).toBe(4);
		expect(evaluateNumber('Math.floor(3.7)')).toBe(3);
		expect(evaluateNumber('Math.ceil(3.2)')).toBe(4);
		expect(evaluateNumber('Math.pow(2, 3)')).toBe(8);
		expect(evaluateNumber('Math.sqrt(16)')).toBe(4);
	});

	it('supports date helpers', () => {
		const now = evaluateExpression('NOW()') as string;
		expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		const today = evaluateExpression('TODAY()') as string;
		expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		const uuid = evaluateExpression('UUID()') as string;
		expect(uuid).toMatch(/^[0-9a-f-]+$/i);
	});

	it('supports type helpers', () => {
		expect(evaluateNumber('parseInt("42")')).toBe(42);
		expect(evaluateNumber('parseFloat("3.14")')).toBeCloseTo(3.14);
		expect(evaluateExpression('String(123)')).toBe('123');
		expect(evaluateBoolean('Boolean(0)')).toBe(false);
	});
});

describe('evaluateExpression — security hardening', () => {
	it('blocks Object.prototype members (prototype chain not walked)', () => {
		// `name in this.scope` used to resolve constructor/toString/hasOwnProperty
		expect(evaluateExpression('constructor')).toBeUndefined();
		expect(evaluateExpression('toString')).toBeUndefined();
		expect(evaluateExpression('hasOwnProperty')).toBeUndefined();
		expect(evaluateExpression('valueOf')).toBeUndefined();
	});

	it('blocks Math.constructor (no live Function leak)', () => {
		expect(() => evaluateExpression("Math.constructor('return 1')")).toThrow(/Unknown function/);
		expect(evaluateExpression('Math.constructor')).toBeUndefined();
	});

	it('blocks non-deterministic Math.random()', () => {
		expect(() => evaluateExpression('Math.random()')).toThrow(/Unknown function/);
	});

	it('still allows deterministic Math functions from the allowlist', () => {
		expect(evaluateNumber('Math.sign(-5)')).toBe(-1);
		expect(evaluateNumber('Math.trunc(3.9)')).toBe(3);
		expect(evaluateNumber('Math.hypot(3, 4)')).toBe(5);
		expect(evaluateNumber('Math.log10(100)')).toBe(2);
	});

	it('fails cleanly on deep unary recursion instead of blowing the stack', () => {
		const deepMinus = '-'.repeat(500) + '1';
		// Either defense layer may fire first — length/token cap or the depth cap.
		expect(() => evaluateExpression(deepMinus)).toThrow(/too deeply nested|too many tokens|too long/i);
	});

	it('fails cleanly on deep paren nesting', () => {
		const deepParens = '('.repeat(500) + '1' + ')'.repeat(500);
		expect(() => evaluateExpression(deepParens)).toThrow(/too deeply nested|too many tokens|too long/i);
	});

	it('fails cleanly on deep nested function-call arguments', () => {
		const deepCalls = 'Math.max('.repeat(500) + '1' + ')'.repeat(500);
		expect(() => evaluateExpression(deepCalls)).toThrow(/too deeply nested|too many tokens|too long/i);
	});

	it('null == undefined is true (JS loose equality)', () => {
		expect(evaluateBoolean('null == undefined')).toBe(true);
		expect(evaluateBoolean('null != undefined')).toBe(false);
		expect(evaluateBoolean('null == 0')).toBe(false);
		expect(evaluateBoolean('null == null')).toBe(true);
	});
});

describe('evaluateExpression — literals & errors', () => {
	it('supports string literals', () => {
		expect(evaluateExpression("'hello'")).toBe('hello');
		expect(evaluateExpression('"world"')).toBe('world');
		expect(evaluateExpression("name == 'john'", { name: 'john' })).toBe(true);
	});

	it('supports true/false/null', () => {
		expect(evaluateExpression('true')).toBe(true);
		expect(evaluateExpression('false')).toBe(false);
		expect(evaluateExpression('null')).toBeNull();
	});

	it('throws on syntax errors', () => {
		expect(() => evaluateExpression('2 +')).toThrow();
		expect(() => evaluateExpression('(1 + 2')).toThrow();
	});

	it('throws on unknown functions', () => {
		expect(() => evaluateExpression('evil()')).toThrow(/Unknown function/);
	});

	it('returns undefined for unknown identifiers', () => {
		expect(evaluateExpression('missing_field')).toBeUndefined();
	});

	it('does NOT execute arbitrary code — fails closed', () => {
		// new Function would allow this — our evaluator must not execute anything
		// `process.exit(1)` resolves to an unknown function call → throws, never executes
		expect(() => evaluateExpression('process.exit(1)')).toThrow(/Unknown function/);
	});
});

describe('validateExpressionComplexity — Big-O bound', () => {
	it('accepts normal rules and rejects oversized ones', () => {
		expect(validateExpressionComplexity('doc.total > 100')).toBeNull();
		const huge = 'a'.repeat(MAX_EXPRESSION_LENGTH + 1);
		expect(validateExpressionComplexity(huge)).toContain('too long');
		// Many tokens: 300 identifiers → over the 256-token cap.
		const manyTokens = Array.from({ length: MAX_EXPRESSION_TOKENS + 10 }, (_, i) => `f${i}`).join(' + ');
		expect(validateExpressionComplexity(manyTokens)).toContain('too many tokens');
	});

	it('evaluateWith throws on oversized expressions (defense in depth)', () => {
		expect(() => evaluateBoolean('a'.repeat(MAX_EXPRESSION_LENGTH + 1))).toThrow(/too long/i);
	});
});
