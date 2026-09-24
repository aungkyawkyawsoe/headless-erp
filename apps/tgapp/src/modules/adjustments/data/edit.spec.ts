import { describe, expect, it } from 'vitest';

import { adjustmentFormSeedOf, adjustmentLineSeedOf, adjustmentLineSeedsOf, isAdjustmentEditable } from './edit';
import type { MroAdjustmentLineRow, MroAdjustmentRow } from './types';

/**
 * The EDIT seed — the wire → form-fields mapping the document page depends on.
 *
 * Four rules are pinned here because every one of them is SILENT when it breaks:
 * the mode must follow the DOCUMENT's status (a form that offered edits on an
 * applied correction would only fail later, at the server), a line without an item
 * must be REFUSED rather than blanked (a blank row would save the document with
 * stock quietly dropped from it), the LOT identity must survive only where the
 * engine honours it (a `remove` takes FEFO — re-seeding a batch number it never
 * used would hand a false provenance claim back to the operator), and the stored
 * per-unit cost must ride through (the child table is REPLACED on save, so a
 * column the form does not collect would vanish from the row).
 */

function rowOf(overrides: Partial<MroAdjustmentRow> = {}): MroAdjustmentRow {
	return {
		id: 'ajt-1',
		display_number: 'AJT-00021',
		doc_status: 'draft',
		location: 'mandalay_store',
		adjustment_date: '2026-09-20',
		description: '  Two tyres counted short  ',
		reported_by: { id: 'emp-1', name_en: 'Aung Aung' },
		approved_by: null,
		...overrides,
	};
}

function lineOf(overrides: Partial<MroAdjustmentLineRow> = {}): MroAdjustmentLineRow {
	return {
		id: 'ln-1',
		parent_id: 'ajt-1',
		item_model: { id: 'model-1', name_en: 'Tyre 11R', name_mm: 'တာယာ', item_name: { tracking: 'batch' } },
		direction: 'add',
		qty: 2,
		batch_no: 'B-77',
		expiry_date: '2027-01-31',
		unit_cost: 9000,
		serials: null,
		...overrides,
	};
}

describe('isAdjustmentEditable', () => {
	it('lets only a DRAFT be written — an applied correction is frozen and a cancelled one is terminal', () => {
		expect(isAdjustmentEditable('draft')).toBe(true);
		expect(isAdjustmentEditable('confirmed')).toBe(false);
		expect(isAdjustmentEditable('cancelled')).toBe(false);
	});
});

describe('adjustmentFormSeedOf', () => {
	it('reads the document off its own columns: store, date, description, status', () => {
		const seed = adjustmentFormSeedOf(rowOf(), []);
		expect(seed.id).toBe('ajt-1');
		expect(seed.location).toBe('mandalay_store');
		expect(seed.adjustmentDate).toBe('2026-09-20');
		expect(seed.description).toBe('Two tyres counted short');
		expect(seed.docStatus).toBe('draft');
	});

	it('falls back to the default store for an unknown one — never opens on a store that does not exist', () => {
		expect(adjustmentFormSeedOf(rowOf({ location: 'nowhere' }), []).location).toBe('main_store');
		expect(adjustmentFormSeedOf(rowOf({ location: null }), []).location).toBe('main_store');
	});

	it('treats an empty doc_status as draft (the engine does)', () => {
		// The row type spells the three known statuses; the ENGINE still treats `''`
		// as draft (a row written before the column existed), which is exactly what
		// this pins — so the raw wire value is cast on purpose.
		const seed = adjustmentFormSeedOf(rowOf({ doc_status: '' as unknown as MroAdjustmentRow['doc_status'] }), []);
		expect(seed.docStatus).toBe('draft');
	});

	it('never carries the reporter — an edit cannot reassign who filed the report', () => {
		// `mro_adjustments` declares `actor_fields: ['reported_by']` and the two-person
		// rule (`approved_by != reported_by`) is built on it, so the seed has no field
		// for it at all; this pins that no future field quietly re-adds one.
		const seed = adjustmentFormSeedOf(rowOf(), []);
		expect('reported_by' in seed).toBe(false);
		expect('reportedBy' in seed).toBe(false);
	});

	it('carries the stored lines in their stored order', () => {
		const seed = adjustmentFormSeedOf(rowOf(), [lineOf(), lineOf({ id: 'ln-2', item_model: 'model-2' })]);
		expect(seed.lines.map((line) => line.modelId)).toEqual(['model-1', 'model-2']);
	});
});

describe('adjustmentLineSeedOf', () => {
	it('takes the SKU name and the tracking policy off the expanded relation', () => {
		const seed = adjustmentLineSeedOf(lineOf());
		expect(seed).not.toBeNull();
		expect(seed?.modelId).toBe('model-1');
		expect(seed?.modelName).toBe('Tyre 11R');
		// The policy lives on the item NAME, not the SKU — it must arrive nested.
		expect(seed?.tracking).toBe('batch');
		expect(seed?.direction).toBe('add');
		expect(seed?.qty).toBe(2);
	});

	it('keeps the lot identity on an ADD — that IS the lot the line created', () => {
		const seed = adjustmentLineSeedOf(lineOf());
		expect(seed?.batchNo).toBe('B-77');
		expect(seed?.expiryDate).toBe('2027-01-31');
	});

	it('DROPS the lot identity on a REMOVE — the engine took FEFO and stored the lots it really used', () => {
		// A stored `remove` carrying a batch number is a claim the stock ledger never
		// honoured (`allocateLots(..., 'write_offs')` has no batch filter), so the seed
		// must not hand it back to the operator — the line's real provenance is its
		// `mro_adjustment_lots` trace, not a number typed beside it.
		const seed = adjustmentLineSeedOf(lineOf({ direction: 'remove' }));
		expect(seed?.direction).toBe('remove');
		expect(seed?.batchNo).toBe('');
		expect(seed?.expiryDate).toBe('');
	});

	it('defaults an unknown/absent direction to `add` — the same default the column carries', () => {
		expect(adjustmentLineSeedOf(lineOf({ direction: null }))?.direction).toBe('add');
		expect(adjustmentLineSeedOf(lineOf({ direction: 'sideways' }))?.direction).toBe('add');
		expect(adjustmentLineSeedOf(lineOf({ direction: 'remove' }))?.direction).toBe('remove');
	});

	it('carries the stored per-unit COST — the child table is replaced on save, so it must be re-stated', () => {
		expect(adjustmentLineSeedOf(lineOf())?.unitCost).toBe(9000);
		expect(adjustmentLineSeedOf(lineOf({ unit_cost: null }))?.unitCost).toBeNull();
	});

	it('accepts a BARE relation id — the label then falls back to the directory', () => {
		const seed = adjustmentLineSeedOf(lineOf({ item_model: 'model-2' }));
		expect(seed?.modelId).toBe('model-2');
		expect(seed?.modelName).toBeNull();
		expect(seed?.tracking).toBe('standard');
	});

	it('reads the serials column as decoded units OR as its JSON text', () => {
		expect(adjustmentLineSeedOf(lineOf({ serials: ['TY-1', ' TY-2 '] }))?.serials).toEqual(['TY-1', 'TY-2']);
		expect(adjustmentLineSeedOf(lineOf({ serials: '["TY-1","TY-2"]' }))?.serials).toEqual(['TY-1', 'TY-2']);
		// Unreadable/absent is EMPTY, never a crash and never a phantom unit.
		expect(adjustmentLineSeedOf(lineOf({ serials: 'not json' }))?.serials).toEqual([]);
		expect(adjustmentLineSeedOf(lineOf({ serials: null }))?.serials).toEqual([]);
	});

	it('refuses a line with no item model — the editor could neither paint nor re-submit it', () => {
		expect(adjustmentLineSeedOf(lineOf({ item_model: null }))).toBeNull();
		expect(adjustmentLineSeedsOf([lineOf({ item_model: null }), lineOf()])).toHaveLength(1);
	});
});
