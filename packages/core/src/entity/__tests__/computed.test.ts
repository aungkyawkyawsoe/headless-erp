/**
 * Computed fields — pure helper unit tests.
 *
 * extractLookupRefs / buildLookupScope / topoSortStoredFormulas /
 * coerceComputedValue / formulaResultType — the machinery shared by the read
 * pipeline (virtual formulas) and the write pipeline (stored formulas).
 */
import { describe, it, expect } from 'vitest';
import type { FieldDefinition } from '@mmbix/types';
import { FORMULA_RESULT_TYPES as TYPES_SSOT } from '@mmbix/types';
import {
	extractLookupRefs,
	buildLookupScope,
	topoSortStoredFormulas,
	coerceComputedValue,
	formulaResultType,
	applyFormulaPrecision,
	roundTo,
	validateFormulaReferences,
	extractFieldRefs,
	resolveFormulaDependencies,
	DEFAULT_FORMULA_RESULT_TYPE,
	FORMULA_RESULT_TYPES,
} from '../computed';
import { evaluateExpression } from '../expression';

const field = (name: string, type: string, overrides: Partial<FieldDefinition> = {}): FieldDefinition =>
	({
		name,
		type,
		...overrides,
	}) as FieldDefinition;

describe('extractLookupRefs', () => {
	const sf: FieldDefinition[] = [
		field('items', 'o2m', { related_collection: 'invoice_items', foreign_key: 'parent_id' }),
		field('tags', 'm2m', { related_collection: 'tags' }),
		field('lines', 'table', { related_collection: 'invoice_lines' }),
		field('customer', 'm2o', { related_collection: 'customers' }),
		field('qty', 'integer'),
		field('rate', 'number'),
	];

	it('finds o2m/m2m/table/m2o relation references in an expression', () => {
		const refs = extractLookupRefs('SUM(items.amount) + COUNT(lines)', sf);
		expect([...refs.keys()].sort()).toEqual(['items', 'lines']);
	});

	it('finds m2o single-row references', () => {
		const refs = extractLookupRefs('customer.name', sf);
		expect(refs.get('customer')?.type).toBe('m2o');
	});

	it('ignores plain (non-relation) identifiers', () => {
		const refs = extractLookupRefs('qty * rate - discount', sf);
		expect(refs.size).toBe(0);
	});

	it('returns an empty map for empty/missing formulas', () => {
		expect(extractLookupRefs('', sf).size).toBe(0);
		expect(extractLookupRefs(undefined as unknown as string, sf).size).toBe(0);
	});
});

describe('buildLookupScope + aggregate evaluation', () => {
	it('exposes per-field value arrays and __rows', () => {
		const scope = buildLookupScope([
			{ id: 'a', amount: 10, qty: 1 },
			{ id: 'b', amount: 20, qty: 2 },
			{ id: 'c', amount: null },
		]);
		expect(scope.amount).toEqual([10, 20, null]);
		expect((scope.__rows as unknown[]).length).toBe(3);
	});

	it('SUM sums numeric values and skips nulls', () => {
		const scope = buildLookupScope([{ amount: 10 }, { amount: 20 }, { amount: null }]);
		expect(evaluateExpression('SUM(items.amount)', { items: scope })).toBe(30);
	});

	it('COUNT counts rows (COUNT(items)) and values (COUNT(items.id))', () => {
		const scope = buildLookupScope([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
		expect(evaluateExpression('COUNT(items)', { items: scope })).toBe(3);
		expect(evaluateExpression('COUNT(items.id)', { items: scope })).toBe(3);
	});

	it('MIN / MAX / AVG over child values', () => {
		const scope = buildLookupScope([{ price: 5 }, { price: 15 }, { price: 10 }]);
		expect(evaluateExpression('MIN(items.price)', { items: scope })).toBe(5);
		expect(evaluateExpression('MAX(items.price)', { items: scope })).toBe(15);
		expect(evaluateExpression('AVG(items.price)', { items: scope })).toBe(10);
	});

	it('empty children: SUM → 0, COUNT → 0, AVG → null', () => {
		const scope = buildLookupScope([]);
		expect(evaluateExpression('SUM(items.amount)', { items: scope })).toBe(0);
		expect(evaluateExpression('COUNT(items)', { items: scope })).toBe(0);
		expect(evaluateExpression('AVG(items.amount)', { items: scope })).toBeNull();
	});

	it('m2o member access resolves from a plain related row', () => {
		expect(evaluateExpression('customer.name', { customer: { name: 'Acme' } })).toBe('Acme');
	});

	it('aggregates work on plain arrays too', () => {
		expect(evaluateExpression('SUM([1, 2, 3])', {})).toBe(6);
	});
});

describe('topoSortStoredFormulas', () => {
	it('orders dependencies before dependents', () => {
		const fields = [
			field('total', 'formula', { store: true, formula: 'qty * rate' }),
			field('grand_total', 'formula', { store: true, formula: 'total * 1.1' }),
			field('vat', 'formula', { store: true, formula: 'grand_total * 0.05' }),
			field('qty', 'integer'),
			field('rate', 'number'),
		];
		const ordered = topoSortStoredFormulas(fields).map((f) => f.name);
		expect(ordered.indexOf('total')).toBeLessThan(ordered.indexOf('grand_total'));
		expect(ordered.indexOf('grand_total')).toBeLessThan(ordered.indexOf('vat'));
	});

	it('keeps schema order for independent formulas', () => {
		const fields = [field('a', 'formula', { store: true, formula: '1 + 1' }), field('b', 'formula', { store: true, formula: '2 + 2' })];
		expect(topoSortStoredFormulas(fields).map((f) => f.name)).toEqual(['a', 'b']);
	});

	it('breaks cycles deterministically instead of hanging', () => {
		const fields = [field('x', 'formula', { store: true, formula: 'y + 1' }), field('y', 'formula', { store: true, formula: 'x + 1' })];
		expect(
			topoSortStoredFormulas(fields)
				.map((f) => f.name)
				.sort(),
		).toEqual(['x', 'y']);
	});

	it('only includes stored formulas with expressions', () => {
		const fields = [
			field('virtual', 'formula', { formula: '1 + 1' }), // not stored
			field('stored', 'formula', { store: true, formula: '2 + 2' }),
			field('empty', 'formula', { store: true }), // no formula
		];
		expect(topoSortStoredFormulas(fields).map((f) => f.name)).toEqual(['stored']);
	});
});

describe('formulaResultType / coerceComputedValue', () => {
	it('defaults to number and accepts declared result types', () => {
		expect(formulaResultType(field('f', 'formula', { formula: '1' }))).toBe(DEFAULT_FORMULA_RESULT_TYPE);
		expect(formulaResultType(field('f', 'formula', { formula: '1', result_type: 'string' }))).toBe('string');
		expect(FORMULA_RESULT_TYPES).toEqual(['number', 'string', 'boolean', 'json']);
	});

	it('re-exports the ONE @mmbix/types SSOT (not a local copy)', () => {
		// Reference equality: `computed.ts` re-exports the canonical binding, so a
		// re-declared local union would make this fail instead of silently drifting.
		expect(FORMULA_RESULT_TYPES).toBe(TYPES_SSOT);
	});

	it('coerces number results (NaN → 0, null passes through)', () => {
		expect(coerceComputedValue(42, 'number')).toBe(42);
		expect(coerceComputedValue('12.5', 'number')).toBe(12.5);
		expect(coerceComputedValue('abc', 'number')).toBe(0);
		expect(coerceComputedValue(null, 'number')).toBeNull();
	});

	it('coerces boolean results to 1/0 (string false/0 → 0)', () => {
		expect(coerceComputedValue(true, 'boolean')).toBe(1);
		expect(coerceComputedValue(false, 'boolean')).toBe(0);
		expect(coerceComputedValue('false', 'boolean')).toBe(0);
		expect(coerceComputedValue(0, 'boolean')).toBe(0);
	});

	it('coerces string + json results', () => {
		expect(coerceComputedValue(7, 'string')).toBe('7');
		expect(coerceComputedValue({ a: 1 }, 'json')).toBe('{"a":1}');
	});
});

describe('precision / rounding', () => {
	it('roundTo half_up rounds half away from zero (2.345 → 2.35, -2.345 → -2.35)', () => {
		expect(roundTo(2.345, 2)).toBe(2.35);
		expect(roundTo(-2.345, 2)).toBe(-2.35);
		expect(roundTo(2.344, 2)).toBe(2.34);
		expect(roundTo(12.5, 0)).toBe(13);
	});

	it('roundTo half_even (banker) + up/down modes', () => {
		expect(roundTo(2.345, 2, 'half_even')).toBe(2.34); // .005 → even 4
		expect(roundTo(2.355, 2, 'half_even')).toBe(2.36); // .005 → even 6
		expect(roundTo(2.341, 2, 'up')).toBe(2.35);
		expect(roundTo(2.349, 2, 'down')).toBe(2.34);
	});

	it('coerceComputedValue applies precision + rounding', () => {
		expect(coerceComputedValue(2.345, 'number', { precision: 2 })).toBe(2.35);
		expect(coerceComputedValue(2.345, 'number', { precision: 2, rounding: 'down' })).toBe(2.34);
		expect(coerceComputedValue(2.5, 'number', { precision: 0 })).toBe(2); // trunc
	});

	it('applyFormulaPrecision rounds only numeric results, respects field config', () => {
		expect(applyFormulaPrecision(2.345, field('total', 'formula', { precision: 2 }))).toBe(2.35);
		expect(applyFormulaPrecision(2.345, field('total', 'formula', { precision: 2, rounding: 'half_even' }))).toBe(2.34);
		expect(applyFormulaPrecision(2.345, field('total', 'formula', {}))).toBe(2.345); // no precision → untouched
		expect(applyFormulaPrecision('abc', field('total', 'formula', { precision: 2 }))).toBe('abc');
	});
});

describe('validateFormulaReferences', () => {
	const sf: FieldDefinition[] = [
		field('qty', 'integer'),
		field('rate', 'number'),
		field('items', 'o2m', { related_collection: 'invoice_items', foreign_key: 'parent_id' }),
		field('customer', 'm2o', { related_collection: 'customers' }),
	];

	it('accepts real fields, relations, functions and literals', () => {
		expect(validateFormulaReferences('qty * rate', sf)).toBeNull();
		expect(validateFormulaReferences('SUM(items.amount) + COUNT(items)', sf)).toBeNull();
		expect(validateFormulaReferences('customer.name', sf)).toBeNull();
		expect(validateFormulaReferences('NOW()', sf)).toBeNull(); // core built-in
		expect(validateFormulaReferences('Math.abs(-qty)', sf)).toBeNull();
		expect(validateFormulaReferences('true && false', sf)).toBeNull();
	});

	it('rejects unknown fields (typos) and unknown functions', () => {
		expect(validateFormulaReferences('totl * rate', sf)).toContain('unknown field "totl"');
		expect(validateFormulaReferences('FOO(qty)', sf)).toContain('unknown function "FOO"');
	});

	it('ignores identifiers INSIDE string literals (comparison + string-returning formulas)', async () => {
		// The evaluator's compute layer (IF/… — registered at runtime by @mmbix/compute)
		// makes string-returning formulas real; mirror that registration here.
		const { registerComputeFunctions } = await import('../../../../../packages/compute/src/index');
		registerComputeFunctions();
		// `'paid'` is a VALUE, not a field — must not trip the reference scan.
		expect(
			validateFormulaReferences("due_date < NOW() && status != 'paid'", [...sf, field('status', 'select'), field('due_date', 'date')]),
		).toBeNull();
		// IF branches returning text, and timestamp/format literals (T00 / Z runs).
		expect(validateFormulaReferences("IF(qty > 0, 'on_time', 'late_in')", [...sf, field('status', 'select')])).toBeNull();
		expect(
			validateFormulaReferences("MINUTES_BETWEEN(CONCAT(LEFT(check_in, 10), 'T00:00:00Z'), check_in)", [field('check_in', 'timestamp')]),
		).toBeNull();
		// Double-quoted literals behave the same.
		expect(validateFormulaReferences('IF(qty > 0, "ok", "bad")', sf)).toBeNull();
		// An escaped quote inside a string still hides the inner word.
		expect(validateFormulaReferences("IF(qty > 0, 'it\\'s paid', 'no')", sf)).toBeNull();
	});

	it('still catches real typos next to string literals', async () => {
		const { registerComputeFunctions } = await import('../../../../../packages/compute/src/index');
		registerComputeFunctions();
		expect(validateFormulaReferences("IF(qty > 0, 'ok', 'bad') && totl > 1", sf)).toContain('unknown field "totl"');
		expect(validateFormulaReferences("qty > 0 && status == 'paid'", [...sf, field('status', 'select')])).toBeNull();
		expect(validateFormulaReferences("qty > 0 && statuss == 'paid'", [...sf, field('status', 'select')])).toContain(
			'unknown field "statuss"',
		);
	});

	it('allows extra identifiers via extraAllowed (system columns)', () => {
		expect(validateFormulaReferences('created_at', sf, new Set(['created_at']))).toBeNull();
		expect(validateFormulaReferences('created_at', sf)).toContain('unknown field');
	});
});

describe('extractFieldRefs / resolveFormulaDependencies', () => {
	const sf: FieldDefinition[] = [
		field('qty', 'integer'),
		field('rate', 'number'),
		field('items', 'o2m', { related_collection: 'invoice_items', foreign_key: 'parent_id' }),
		field('total', 'formula', { formula: 'qty * rate' }),
		field('grand_total', 'formula', { formula: 'total * 1.1' }),
	];

	it('extractFieldRefs returns physical same-row deps only', () => {
		expect(extractFieldRefs('qty * rate', sf).sort()).toEqual(['qty', 'rate']);
		expect(extractFieldRefs('SUM(items.amount)', sf)).toEqual([]); // relation member — not a same-row dep
		expect(extractFieldRefs('total * 1.1', sf)).toEqual([]); // formula dep — resolved separately
	});

	it('resolveFormulaDependencies returns transitive deps in topological order', () => {
		const deps = resolveFormulaDependencies(sf, ['grand_total']).map((f) => f.name);
		expect(deps).toEqual(['total', 'grand_total']); // total computes before grand_total
	});

	it('returns only the selected set when there are no dependencies', () => {
		expect(resolveFormulaDependencies(sf, ['total']).map((f) => f.name)).toEqual(['total']);
	});
});
