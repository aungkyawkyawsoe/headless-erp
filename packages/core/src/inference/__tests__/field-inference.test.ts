import { describe, expect, it } from 'vitest';
import { VALID_FIELD_TYPES } from '@mmbix/utils';
import { inferFieldType, inferFields, inferRelations, snakeName } from '../field-inference';
import type { DesignHint } from '@mmbix/types';

describe('snakeName', () => {
	it('normalizes a human label to a safe identifier', () => {
		expect(snakeName('Phone Number (Mobile)')).toBe('phone_number_mobile');
		expect(snakeName('Amount')).toBe('amount');
		expect(snakeName('   ')).toBe('');
	});
	it('never starts an identifier with a digit', () => {
		expect(snakeName('2024 Revenue')).toBe('f_2024_revenue');
	});
});

describe('inferFieldType', () => {
	it('maps label words to SSOT field types', () => {
		expect(inferFieldType({ label: 'Amount' })?.type).toBe('currency');
		expect(inferFieldType({ label: 'Quantity' })?.type).toBe('integer');
		expect(inferFieldType({ label: 'Email' })?.type).toBe('email');
		expect(inferFieldType({ label: 'Due Date' })?.type).toBe('date');
		expect(inferFieldType({ label: 'Is Active' })?.type).toBe('boolean');
		expect(inferFieldType({ label: 'Status' })?.type).toBe('select');
		expect(inferFieldType({ label: 'Description' })?.type).toBe('longtext');
	});

	it('lets a declared sample format outrank a label rule', () => {
		const f = inferFieldType({ label: 'Reference', sampleFormat: 'currency' });
		expect(f?.type).toBe('currency');
		expect(f?.inference.source).toBe('declared');
		expect(f?.inference.confidence).toBe(2);
	});

	it('falls back to text (confidence 0) when no rule matches', () => {
		const f = inferFieldType({ label: 'Foobar' });
		expect(f?.type).toBe('text');
		expect(f?.inference.confidence).toBe(0);
	});

	it('ALWAYS returns a member of the field-type SSOT', () => {
		for (const label of ['Amount', 'Quantity', 'Email', 'Due Date', 'Is Active', 'Status', 'Whatever', 'Notes', 'Colour']) {
			expect(VALID_FIELD_TYPES.has(inferFieldType({ label })!.type)).toBe(true);
		}
	});

	it('returns null for a label with no usable identifier', () => {
		expect(inferFieldType({ label: '!!!' })).toBeNull();
	});

	it('is deterministic — same hint ⇒ same proposal', () => {
		const hint: DesignHint = { label: 'Amount' };
		expect(inferFieldType(hint)).toEqual(inferFieldType(hint));
	});
});

describe('inferFields', () => {
	it('de-duplicates names with a warning', () => {
		const { fields, warnings } = inferFields([{ label: 'Amount' }, { label: 'amount' }]);
		expect(fields).toHaveLength(1);
		expect(warnings[0].code).toBe('duplicate_field');
	});

	it('drops an unnameable hint with a warning', () => {
		const { fields, warnings } = inferFields([{ label: '@#$' }]);
		expect(fields).toHaveLength(0);
		expect(warnings[0].code).toBe('unnameable_hint');
	});
});

describe('inferRelations', () => {
	it('proposes declared relations deterministically', () => {
		const rels = inferRelations([{ from: 'order', to: 'order_item', cardinality: 'many' }]);
		expect(rels).toEqual([{ from: 'order', to: 'order_item', cardinality: 'many', confidence: 2, reason: 'declared relation' }]);
	});
});
