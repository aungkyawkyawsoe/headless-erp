/**
 * starterPivotDef — the shared "first-pass" pivot builder (Studio canvas +
 * runtime admin both fall back to it). Guards the classic trap: the API's
 * field list leads with engine-managed system/audit columns (deleted_at,
 * updated_at, doc_status, …), so the starter must pick a real USER date /
 * select / numeric field, never a system one.
 */

import { describe, expect, it } from 'vitest';
import { starterPivotDef } from '@mmbix/types';

describe('starterPivotDef', () => {
	const rawFields = [
		{ name: 'id', type: 'uuid' },
		{ name: 'doc_status', type: 'select' },
		{ name: 'display_number', type: 'text' },
		{ name: '_owner', type: 'uuid' },
		{ name: 'deleted_at', type: 'timestamp' },
		{ name: 'deleted_by', type: 'uuid' },
		{ name: 'updated_by', type: 'uuid' },
		{ name: 'created_at', type: 'timestamp' },
		{ name: 'updated_at', type: 'timestamp' },
		{ name: 'employee', type: 'm2o' },
		{ name: 'claim_date', type: 'datetime' },
		{ name: 'amount', type: 'currency' },
		{ name: 'expense_type', type: 'select' },
	];

	it('skips system/audit fields — picks the first USER date, select and numeric', () => {
		const def = starterPivotDef('expense_claim', rawFields);
		// deleted_at / created_at lead the raw list — the user's claim_date wins.
		expect(def.rowDimensions).toEqual(['month(claim_date)']);
		// doc_status (system select) is skipped — the user's expense_type wins.
		expect(def.columnDimensions).toEqual(['expense_type']);
		expect(def.measures[0]).toMatchObject({ op: 'sum', field: 'amount' });
	});

	it('falls back to month(created_at) × count when a collection has no user date/numeric fields', () => {
		const def = starterPivotDef('audit_log', [
			{ name: 'id', type: 'uuid' },
			{ name: 'created_at', type: 'timestamp' },
			{ name: 'updated_at', type: 'timestamp' },
			{ name: 'deleted_at', type: 'timestamp' },
			{ name: 'payload', type: 'longtext' },
		]);
		expect(def.rowDimensions).toEqual(['month(created_at)']);
		expect(def.columnDimensions).toBeUndefined();
		expect(def.measures[0]).toMatchObject({ op: 'count', field: '*' });
	});
});
