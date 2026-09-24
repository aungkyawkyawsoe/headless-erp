/**
 * LinkageEngine Unit Tests
 */
import { describe, it, expect } from 'vitest';
import { LinkageEngine } from '../linkage-engine';
import type { LinkageFieldDef } from '../linkage-engine';

describe('LinkageEngine', () => {
	// --- set_value ---
	it('should set target field value on condition match', () => {
		const fields: LinkageFieldDef[] = [
			{
				name: 'status',
				linkages: [
					{ target: 'approved_at', action: 'set_value', value: 'auto-filled', condition: { field: 'status', op: 'eq', value: 'approved' } },
				],
			},
		];

		const { data } = LinkageEngine.evaluate(fields, { status: 'approved' });
		expect(data.approved_at).toBe('auto-filled');
	});

	it('should not set value when condition is not met', () => {
		const fields: LinkageFieldDef[] = [
			{
				name: 'status',
				linkages: [
					{ target: 'approved_at', action: 'set_value', value: 'now', condition: { field: 'status', op: 'eq', value: 'approved' } },
				],
			},
		];

		const { data } = LinkageEngine.evaluate(fields, { status: 'draft' });
		expect(data.approved_at).toBeUndefined();
	});

	// --- clear ---
	it('should clear target field', () => {
		const fields: LinkageFieldDef[] = [
			{
				name: 'status',
				linkages: [{ target: 'reason', action: 'clear', condition: { field: 'status', op: 'neq', value: 'rejected' } }],
			},
		];

		const { data } = LinkageEngine.evaluate(fields, { status: 'approved', reason: 'was bad' });
		expect(data.reason).toBeUndefined(); // cleared
	});

	// --- calculate ---
	it('should calculate and set target field', () => {
		const fields: LinkageFieldDef[] = [
			{
				name: 'qty',
				linkages: [{ target: 'total', action: 'calculate', expression: 'qty * rate' }],
			},
			{
				name: 'rate',
				linkages: [{ target: 'total', action: 'calculate', expression: 'qty * rate' }],
			},
		];

		const { data } = LinkageEngine.evaluate(fields, { qty: 5, rate: 100 });
		expect(data.total).toBe(500);
	});

	// --- visible_when ---
	it('should return visibility hint', () => {
		const fields: LinkageFieldDef[] = [{ name: 'reason', visible_when: { field: 'status', op: 'eq', value: 'rejected' } }];

		const { hints } = LinkageEngine.evaluate(fields, { status: 'rejected' });
		expect(hints).toContainEqual({ field: 'reason', visible: true });
	});

	it('should hide field when condition not met', () => {
		const fields: LinkageFieldDef[] = [{ name: 'reason', visible_when: { field: 'status', op: 'eq', value: 'rejected' } }];

		const { hints } = LinkageEngine.evaluate(fields, { status: 'draft' });
		expect(hints).toContainEqual({ field: 'reason', visible: false });
	});

	// --- readonly_when ---
	it('should return readonly hint', () => {
		const fields: LinkageFieldDef[] = [{ name: 'total', readonly_when: { field: 'status', op: 'neq', value: 'draft' } }];

		const { hints } = LinkageEngine.evaluate(fields, { status: 'approved', total: 500 });
		expect(hints).toContainEqual({ field: 'total', readonly: true });
	});

	// --- required_when ---
	it('should return required hint', () => {
		const fields: LinkageFieldDef[] = [{ name: 'rejection_reason', required_when: { field: 'status', op: 'eq', value: 'rejected' } }];

		const { hints } = LinkageEngine.evaluate(fields, { status: 'rejected' });
		expect(hints).toContainEqual({ field: 'rejection_reason', required: true });
	});

	// --- Multiple conditions ---
	it('should support gt/lt operators', () => {
		const fields: LinkageFieldDef[] = [{ name: 'amount', visible_when: { field: 'amount', op: 'gt', value: 0 } }];

		const { hints } = LinkageEngine.evaluate(fields, { amount: 100 });
		expect(hints).toContainEqual({ field: 'amount', visible: true });
	});

	it('should support contains operator', () => {
		const fields: LinkageFieldDef[] = [{ name: 'alert', visible_when: { field: 'title', op: 'contains', value: 'urgent' } }];

		const { hints } = LinkageEngine.evaluate(fields, { title: 'urgent: fix bug' });
		expect(hints).toContainEqual({ field: 'alert', visible: true });
	});

	it('should support is_empty / is_not_empty', () => {
		const fields: LinkageFieldDef[] = [{ name: 'description', required_when: { field: 'title', op: 'is_not_empty', value: null } }];

		const { hints } = LinkageEngine.evaluate(fields, { title: 'Hello' });
		expect(hints).toContainEqual({ field: 'description', required: true });
	});

	it('should support in operator', () => {
		const fields: LinkageFieldDef[] = [{ name: 'amount_field', visible_when: { field: 'type', op: 'in', value: ['invoice', 'receipt'] } }];

		const { hints } = LinkageEngine.evaluate(fields, { type: 'invoice' });
		expect(hints).toContainEqual({ field: 'amount_field', visible: true });
	});

	// --- No linkage ---
	it('should return empty hints when no rules defined', () => {
		const fields: LinkageFieldDef[] = [{ name: 'title' }];
		const { data, hints } = LinkageEngine.evaluate(fields, { title: 'Test' });
		expect(data).toEqual({ title: 'Test' });
		expect(hints).toEqual([]);
	});

	// --- Multiple linkages on one field ---
	it('should execute multiple linkages on one field', () => {
		const fields: LinkageFieldDef[] = [
			{
				name: 'status',
				linkages: [
					{ target: 'approved_by', action: 'set_value', value: 'system', condition: { field: 'status', op: 'eq', value: 'approved' } },
					{ target: 'approved_date', action: 'set_value', value: 'today', condition: { field: 'status', op: 'eq', value: 'approved' } },
				],
			},
		];

		const { data } = LinkageEngine.evaluate(fields, { status: 'approved' });
		expect(data.approved_by).toBe('system');
		expect(data.approved_date).toBe('today');
	});

	// --- DB-coerced comparison (audit fix: stored booleans are 1/0) ---
	it('matches eq:true against both in-memory true and stored 1', () => {
		const fields: LinkageFieldDef[] = [{ name: 'is_active', type: 'boolean', visible_when: { field: 'is_active', op: 'eq', value: true } }];

		// In-memory payload (pre-storage): raw boolean
		expect(LinkageEngine.evaluate(fields, { is_active: true }).hints).toContainEqual({ field: 'is_active', visible: true });
		// DB-loaded row: coerced 1
		expect(LinkageEngine.evaluate(fields, { is_active: 1 }).hints).toContainEqual({ field: 'is_active', visible: true });
		// Non-matching
		expect(LinkageEngine.evaluate(fields, { is_active: 0 }).hints).toContainEqual({ field: 'is_active', visible: false });
	});

	it('matches in: [true] against a stored 1', () => {
		const fields: LinkageFieldDef[] = [{ name: 'flag', type: 'boolean', visible_when: { field: 'flag', op: 'in', value: [true] } }];
		expect(LinkageEngine.evaluate(fields, { flag: 1 }).hints).toContainEqual({ field: 'flag', visible: true });
		expect(LinkageEngine.evaluate(fields, { flag: 0 }).hints).toContainEqual({ field: 'flag', visible: false });
	});

	it('matches nin: [false] against a stored 1', () => {
		const fields: LinkageFieldDef[] = [{ name: 'flag', type: 'boolean', visible_when: { field: 'flag', op: 'nin', value: [false] } }];
		expect(LinkageEngine.evaluate(fields, { flag: 1 }).hints).toContainEqual({ field: 'flag', visible: true });
	});

	// --- calculate with NOW() ---
	it('should support NOW() in calculate expressions', () => {
		const fields: LinkageFieldDef[] = [
			{
				name: 'status',
				linkages: [
					{ target: 'processed_at', action: 'calculate', expression: 'NOW()', condition: { field: 'status', op: 'eq', value: 'done' } },
				],
			},
		];

		const { data } = LinkageEngine.evaluate(fields, { status: 'done' });
		expect(data.processed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});
});
