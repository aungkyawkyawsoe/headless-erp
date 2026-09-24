import { describe, expect, it } from 'vitest';

import { inboundFormSeedOf, inboundLineSeedOf, inboundLineSeedsOf, isInboundEditable } from './edit';
import type { MroInboundLineRow, MroInboundRow } from './types';

/**
 * The EDIT seed — the wire → form-fields mapping the document page depends on.
 *
 * Two rules are pinned here because both are silent when they break: the
 * counterparty must be read from the column the KIND owns (not “whichever is
 * set”, which would seed a vendor into an employee picker), and the mode must
 * follow the DOCUMENT's status — a form that offered edits on a posted receipt
 * would only fail later, at the server.
 */

function rowOf(overrides: Partial<MroInboundRow> = {}): MroInboundRow {
	return {
		id: 'inb-1',
		display_number: 'INB-00031',
		doc_status: 'draft',
		type: 'purchase',
		purchase_date: '2026-09-20',
		location: 'main_store',
		note: '  Two drums  ',
		paid_at_receipt: false,
		supplier: { id: 'sup-1', name: 'Yangon Supplier Co.' },
		...overrides,
	};
}

function lineOf(overrides: Partial<MroInboundLineRow> = {}): MroInboundLineRow {
	return {
		id: 'ln-1',
		parent_id: 'inb-1',
		item_model: { id: 'model-1', name_en: 'Bolt M10', name_mm: 'ဘော့လ်', item_name: { tracking: 'batch' } },
		qty: 3,
		unit_price: 1200,
		batch_no: ' L-9 ',
		expiry_date: '2027-01-31',
		serials: null,
		...overrides,
	};
}

describe('isInboundEditable', () => {
	it('lets only a DRAFT be written — the engine freezes a confirmed row and a cancelled one is terminal', () => {
		expect(isInboundEditable('draft')).toBe(true);
		expect(isInboundEditable('confirmed')).toBe(false);
		expect(isInboundEditable('cancelled')).toBe(false);
	});
});

describe('inboundFormSeedOf', () => {
	it('seeds a purchase from the VENDOR column, and never the employee one', () => {
		// Both columns populated (a row that predates the one-or-the-other rule):
		// the kind still decides which counterparty the form opens with.
		const seed = inboundFormSeedOf(rowOf({ handed_by: { id: 'emp-9', name_en: 'Aung Aung' } }), []);
		expect(seed.type).toBe('purchase');
		expect(seed.partyId).toBe('sup-1');
		expect(seed.partyName).toBe('Yangon Supplier Co.');
	});

	it('seeds a return from the EMPLOYEE column', () => {
		const seed = inboundFormSeedOf(rowOf({ type: 'return', supplier: null, handed_by: { id: 'emp-9', name_en: 'Aung Aung' } }), []);
		expect(seed.type).toBe('return');
		expect(seed.partyId).toBe('emp-9');
		expect(seed.partyName).toBe('Aung Aung');
	});

	it('reads the draft-time facts: the paid-at-receipt flag, the trimmed note, the date', () => {
		const seed = inboundFormSeedOf(rowOf({ paid_at_receipt: true }), []);
		expect(seed.paidAtReceipt).toBe(true);
		expect(seed.note).toBe('Two drums');
		expect(seed.purchaseDate).toBe('2026-09-20');
		expect(seed.docStatus).toBe('draft');
	});

	it('treats an empty doc_status as draft (the engine does) and an unknown store as the default one', () => {
		// The row type spells the three known statuses; the ENGINE still treats `''`
		// as draft (a row written before the column existed), which is exactly what
		// this pins — so the raw wire value is cast on purpose.
		const seed = inboundFormSeedOf(rowOf({ doc_status: '' as unknown as MroInboundRow['doc_status'], location: 'nowhere' }), []);
		expect(seed.docStatus).toBe('draft');
		expect(seed.location).toBe('main_store');
	});

	it('carries the stored lines in their stored order', () => {
		const seed = inboundFormSeedOf(rowOf(), [lineOf(), lineOf({ id: 'ln-2', item_model: 'model-2' })]);
		expect(seed.lines.map((line) => line.modelId)).toEqual(['model-1', 'model-2']);
	});
});

describe('inboundLineSeedOf', () => {
	it('takes the SKU name and the tracking policy off the expanded relation', () => {
		const seed = inboundLineSeedOf(lineOf());
		expect(seed).not.toBeNull();
		expect(seed?.modelId).toBe('model-1');
		expect(seed?.modelName).toBe('Bolt M10');
		// The policy lives on the item NAME, not the SKU — it must arrive nested.
		expect(seed?.tracking).toBe('batch');
		expect(seed?.batchNo).toBe('L-9');
		expect(seed?.expiryDate).toBe('2027-01-31');
		expect(seed?.unitPrice).toBe(1200);
	});

	it('accepts a BARE relation id — the label then falls back to the directory', () => {
		const seed = inboundLineSeedOf(lineOf({ item_model: 'model-2' }));
		expect(seed?.modelId).toBe('model-2');
		expect(seed?.modelName).toBeNull();
		expect(seed?.tracking).toBe('standard');
	});

	it('reads the serials column as decoded units OR as its JSON text', () => {
		expect(inboundLineSeedOf(lineOf({ serials: ['TY-1', ' TY-2 '] }))?.serials).toEqual(['TY-1', 'TY-2']);
		expect(inboundLineSeedOf(lineOf({ serials: '["TY-1","TY-2"]' }))?.serials).toEqual(['TY-1', 'TY-2']);
		// Unreadable/absent is EMPTY, never a crash and never a phantom unit.
		expect(inboundLineSeedOf(lineOf({ serials: 'not json' }))?.serials).toEqual([]);
		expect(inboundLineSeedOf(lineOf({ serials: null }))?.serials).toEqual([]);
	});

	it('refuses a line with no item model — the editor could neither paint nor re-submit it', () => {
		expect(inboundLineSeedOf(lineOf({ item_model: null }))).toBeNull();
		expect(inboundLineSeedsOf([lineOf({ item_model: null }), lineOf()])).toHaveLength(1);
	});
});
