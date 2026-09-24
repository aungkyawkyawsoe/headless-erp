/**
 * @mmbix/compute — evaluator integration tests.
 *
 * Proves the "single source of truth" contract: after registerComputeFunctions(),
 * the safe expression evaluator (packages/core) can call every function by name
 * — the exact same surface workflow guards / server-function rules / linkage
 * calculate / formula fields use.
 */
import { describe, it, expect } from 'vitest';
import { evaluateExpression, evaluateBoolean, registerFunction } from '@mmbix/core';
import { registerComputeFunctions, computeFunctionNames } from '../src/index';

describe('evaluator integration', () => {
	it('registers compute functions into the evaluator registry', () => {
		expect(registerComputeFunctions()).toBeGreaterThanOrEqual(18);
		expect(computeFunctionNames().length).toBeGreaterThanOrEqual(18);
	});

	it('workflow-guard style expressions evaluate with financial functions', () => {
		// "guard": "NPV(0.08, doc.cashflows) > 0"
		expect(
			evaluateBoolean('NPV(0.08, doc.cashflows) > 0', {
				doc: { cashflows: [-1000, 600, 600] },
			}),
		).toBe(true);
		expect(
			evaluateBoolean('NPV(0.08, doc.cashflows) > 0', {
				doc: { cashflows: [-2000, 100, 100] },
			}),
		).toBe(false);
	});

	it('PMT in a guard (loan affordability)', () => {
		// PMT is negative (money out) — the guard compares its absolute value
		// against the monthly payment budget.
		expect(evaluateBoolean('Math.abs(PMT(0.015, 12, doc.loan)) < doc.payment', { doc: { loan: 120000, payment: 12000 } })).toBe(true);
		expect(evaluateBoolean('Math.abs(PMT(0.015, 12, doc.loan)) < doc.payment', { doc: { loan: 120000, payment: 10000 } })).toBe(false);
	});

	it('statistical + datetime functions work inside expressions', () => {
		expect(evaluateExpression('MEAN(doc.scores)', { doc: { scores: [1, 2, 3, 4] } })).toBe(2.5);
		expect(evaluateExpression('DAYS_BETWEEN(doc.from, doc.to)', { doc: { from: '2026-01-01', to: '2026-02-01' } })).toBe(31);
		expect(evaluateExpression('MEDIAN(doc.v)', { doc: { v: [10, 20, 30] } })).toBe(20);
	});

	it('composes with built-ins (single registry)', () => {
		expect(evaluateBoolean('NPV(0.1, doc.cfs) > 0 && Math.abs(doc.x) < 5', { doc: { cfs: [-100, 60, 60], x: -3 } })).toBe(true);
		// Unknown functions still throw (registry is the whitelist).
		expect(() => evaluateExpression('MYSTERY(1)', {})).toThrow(/Unknown function/);
	});

	it('registerFunction replaces/extents idempotently', () => {
		registerFunction('TRIPLE', (args) => Number(args[0]) * 3);
		expect(evaluateExpression('TRIPLE(7)', {})).toBe(21);
		expect(() => registerFunction('bad name!', () => 1)).toThrow(/Invalid function name/);
	});
});
