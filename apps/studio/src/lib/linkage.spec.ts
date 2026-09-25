import { describe, expect, it } from 'vitest';
import { evaluateCondition, fieldRuntimeState } from './linkage';

const d = (data: Record<string, unknown>, cond: Parameters<typeof evaluateCondition>[0]) => evaluateCondition(cond, data);

describe('evaluateCondition — absent condition', () => {
	it('is true for undefined / null (no rule means no constraint)', () => {
		expect(evaluateCondition(undefined, { x: 1 })).toBe(true);
		expect(evaluateCondition(null, { x: 1 })).toBe(true);
	});

	it('is true for a malformed condition (missing field / unknown op) rather than hiding the field', () => {
		expect(evaluateCondition({ field: '', op: 'eq', value: 1 }, {})).toBe(true);
		expect(evaluateCondition({ field: 'x', op: 'nope' as never }, { x: 1 })).toBe(true);
	});
});

describe('evaluateCondition — equality', () => {
	it('eq matches loosely as strings for scalars', () => {
		expect(d({ x: 'a' }, { field: 'x', op: 'eq', value: 'a' })).toBe(true);
		expect(d({ x: 30 }, { field: 'x', op: 'eq', value: '30' })).toBe(true);
		expect(d({ x: true }, { field: 'x', op: 'eq', value: true })).toBe(true);
		expect(d({ x: 'a' }, { field: 'x', op: 'eq', value: 'b' })).toBe(false);
	});

	it('eq treats an untouched (undefined/null) field as empty', () => {
		expect(d({}, { field: 'x', op: 'eq', value: '' })).toBe(true);
		expect(d({ x: null }, { field: 'x', op: 'eq', value: '' })).toBe(true);
		expect(d({ x: 'a' }, { field: 'x', op: 'eq', value: '' })).toBe(false);
	});

	it('eq on two distinct objects does not false-match', () => {
		expect(d({ x: { a: 1 } }, { field: 'x', op: 'eq', value: { a: 2 } })).toBe(false);
		expect(d({ x: { a: 1 } }, { field: 'x', op: 'eq', value: { a: 1 } })).toBe(true);
	});

	it('neq is the negation of eq', () => {
		expect(d({ x: 'a' }, { field: 'x', op: 'neq', value: 'b' })).toBe(true);
		expect(d({ x: 'a' }, { field: 'x', op: 'neq', value: 'a' })).toBe(false);
	});
});

describe('evaluateCondition — membership', () => {
	it('in matches when the field value is one of the array members (loosely)', () => {
		expect(d({ x: 'a' }, { field: 'x', op: 'in', value: ['a', 'b'] })).toBe(true);
		expect(d({ x: 2 }, { field: 'x', op: 'in', value: ['1', '2'] })).toBe(true);
		expect(d({ x: 'c' }, { field: 'x', op: 'in', value: ['a', 'b'] })).toBe(false);
	});

	it('in is false when the value is not an array (empty set)', () => {
		expect(d({ x: 'a' }, { field: 'x', op: 'in', value: 'a' })).toBe(false);
		expect(d({ x: 'a' }, { field: 'x', op: 'in', value: undefined })).toBe(false);
	});

	it('nin is the complement of in (and holds for a non-array value)', () => {
		expect(d({ x: 'c' }, { field: 'x', op: 'nin', value: ['a', 'b'] })).toBe(true);
		expect(d({ x: 'a' }, { field: 'x', op: 'nin', value: ['a', 'b'] })).toBe(false);
		expect(d({ x: 'a' }, { field: 'x', op: 'nin', value: 'not-an-array' })).toBe(true);
	});
});

describe('evaluateCondition — numeric comparisons', () => {
	it('gt / gte / lt / lte compare via Number()', () => {
		expect(d({ n: 5 }, { field: 'n', op: 'gt', value: 4 })).toBe(true);
		expect(d({ n: 5 }, { field: 'n', op: 'gt', value: 5 })).toBe(false);
		expect(d({ n: 5 }, { field: 'n', op: 'gte', value: 5 })).toBe(true);
		expect(d({ n: 5 }, { field: 'n', op: 'lt', value: 6 })).toBe(true);
		expect(d({ n: 5 }, { field: 'n', op: 'lte', value: 5 })).toBe(true);
		expect(d({ n: '5' }, { field: 'n', op: 'gte', value: '4' })).toBe(true);
	});

	it('fails closed (false) when the field is not numeric', () => {
		expect(d({ n: 'abc' }, { field: 'n', op: 'gt', value: 0 })).toBe(false);
		expect(d({}, { field: 'n', op: 'lt', value: 0 })).toBe(false);
	});
});

describe('evaluateCondition — string ops', () => {
	it('contains is a substring test on the string form', () => {
		expect(d({ s: 'hello world' }, { field: 's', op: 'contains', value: 'world' })).toBe(true);
		expect(d({ s: 'hello' }, { field: 's', op: 'contains', value: 'zzz' })).toBe(false);
	});

	it('starts_with is a prefix test', () => {
		expect(d({ s: 'INV-1001' }, { field: 's', op: 'starts_with', value: 'INV' })).toBe(true);
		expect(d({ s: 'INV-1001' }, { field: 's', op: 'starts_with', value: 'PO' })).toBe(false);
	});
});

describe('evaluateCondition — emptiness', () => {
	it('is_empty covers null / undefined / empty string', () => {
		expect(d({}, { field: 'x', op: 'is_empty' })).toBe(true);
		expect(d({ x: null }, { field: 'x', op: 'is_empty' })).toBe(true);
		expect(d({ x: '' }, { field: 'x', op: 'is_empty' })).toBe(true);
		expect(d({ x: 0 }, { field: 'x', op: 'is_empty' })).toBe(false);
		expect(d({ x: 'a' }, { field: 'x', op: 'is_empty' })).toBe(false);
	});

	it('is_not_empty is the negation', () => {
		expect(d({ x: 'a' }, { field: 'x', op: 'is_not_empty' })).toBe(true);
		expect(d({ x: '' }, { field: 'x', op: 'is_not_empty' })).toBe(false);
		expect(d({}, { field: 'x', op: 'is_not_empty' })).toBe(false);
	});
});

describe('fieldRuntimeState', () => {
	it('is fully permissive when no flags or conditions are set (the common case)', () => {
		expect(fieldRuntimeState({}, { x: 1 })).toEqual({ visible: true, readOnly: false, required: false });
	});

	it('composes visible_when / readonly_when / required_when against the data', () => {
		const field = {
			visible_when: { field: 'kind', op: 'eq' as const, value: 'person' },
			readonly_when: { field: 'locked', op: 'eq' as const, value: true },
			required_when: { field: 'kind', op: 'eq' as const, value: 'person' },
		};
		expect(fieldRuntimeState(field, { kind: 'person', locked: false })).toEqual({ visible: true, readOnly: false, required: true });
		expect(fieldRuntimeState(field, { kind: 'person', locked: true })).toEqual({ visible: true, readOnly: true, required: true });
		expect(fieldRuntimeState(field, { kind: 'company', locked: true })).toEqual({ visible: false, readOnly: true, required: false });
	});

	it('ORs the conditions with the static flags (a condition only adds a constraint)', () => {
		expect(fieldRuntimeState({ read_only: true, required: true }, {})).toEqual({ visible: true, readOnly: true, required: true });
		// A read_only field with a readonly_when that does NOT hold is still read-only.
		expect(fieldRuntimeState({ read_only: true, readonly_when: { field: 'x', op: 'eq', value: 'never' } }, { x: 'no' }).readOnly).toBe(
			true,
		);
		// A statically optional field can be forced required by its rule.
		expect(fieldRuntimeState({ required: false, required_when: { field: 'x', op: 'is_not_empty' } }, { x: 'v' }).required).toBe(true);
	});
});
