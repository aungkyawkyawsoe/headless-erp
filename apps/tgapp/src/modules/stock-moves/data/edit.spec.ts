import { describe, expect, it } from 'vitest';

import { isTransferEditable, transferFormSeedOf, transferLineSeedOf, transferLineSeedsOf } from './edit';
import type { MroTransferLineRow, MroTransferRow } from './types';

/**
 * The EDIT seed — the wire → form-fields mapping the document page depends on.
 *
 * Three rules are pinned here because all three are silent when they break: the two
 * STORES must be read off the document's own columns (a seed that invented a
 * destination would let an edit move stock somewhere the report never named), the
 * mode must follow the DOCUMENT's status (a form that offered edits on a posted move
 * would only fail later, at the server), and a line without an item must be REFUSED
 * rather than blanked (a blank row would save the document with stock quietly
 * dropped from it).
 */

function rowOf(overrides: Partial<MroTransferRow> = {}): MroTransferRow {
	return {
		id: 'trf-1',
		display_number: 'TRF-00007',
		doc_status: 'draft',
		from_location: 'main_store',
		to_location: 'mandalay_store',
		transfer_date: '2026-09-20',
		note: '  To the site  ',
		reported_by: { id: 'emp-1', name_en: 'Aung Aung' },
		approved_by: null,
		...overrides,
	};
}

function lineOf(overrides: Partial<MroTransferLineRow> = {}): MroTransferLineRow {
	return {
		id: 'ln-1',
		parent_id: 'trf-1',
		item_model: { id: 'model-1', name_en: 'Tyre 11R', name_mm: 'တာယာ', item_name: { tracking: 'serial' } },
		qty: 2,
		batch_no: 'B-77',
		serials: ['TY-1', 'TY-2'],
		...overrides,
	};
}

describe('isTransferEditable', () => {
	it('lets only a DRAFT be written — the engine freezes a confirmed row and a cancelled one is terminal', () => {
		expect(isTransferEditable('draft')).toBe(true);
		expect(isTransferEditable('confirmed')).toBe(false);
		expect(isTransferEditable('cancelled')).toBe(false);
	});
});

describe('transferFormSeedOf', () => {
	it('reads the route off the document — the source store, and the destination it actually named', () => {
		const seed = transferFormSeedOf(rowOf(), []);
		expect(seed.fromLocation).toBe('main_store');
		expect(seed.toLocation).toBe('mandalay_store');
	});

	it('keeps an UNKNOWN destination unchosen rather than inventing a store', () => {
		// The source falls back to the form's own default (a real doc never opens with an
		// empty source), but the destination stays null — the picker's own "nothing
		// chosen yet" state — because a store the document never named must not appear.
		const seed = transferFormSeedOf(rowOf({ from_location: 'nowhere', to_location: 'nowhere' }), []);
		expect(seed.fromLocation).toBe('main_store');
		expect(seed.toLocation).toBeNull();
	});

	it('reads the draft-time facts: the trimmed note, the date, the status', () => {
		const seed = transferFormSeedOf(rowOf(), []);
		expect(seed.note).toBe('To the site');
		expect(seed.transferDate).toBe('2026-09-20');
		expect(seed.docStatus).toBe('draft');
	});

	it('never carries the reporter — an edit cannot reassign who filed the report', () => {
		// `mro_transfers` declares `actor_fields: ['reported_by']`, so the seed has no
		// field for it at all; this pins that no future field quietly re-adds one.
		const seed = transferFormSeedOf(rowOf(), []);
		expect('reported_by' in seed).toBe(false);
		expect('reportedBy' in seed).toBe(false);
	});

	it('treats an empty doc_status as draft (the engine does)', () => {
		// The row type spells the three known statuses; the ENGINE still treats `''`
		// as draft (a row written before the column existed), which is exactly what
		// this pins — so the raw wire value is cast on purpose.
		const seed = transferFormSeedOf(rowOf({ doc_status: '' as unknown as MroTransferRow['doc_status'] }), []);
		expect(seed.docStatus).toBe('draft');
	});

	it('carries the stored lines in their stored order', () => {
		const seed = transferFormSeedOf(rowOf(), [lineOf(), lineOf({ id: 'ln-2', item_model: 'model-2' })]);
		expect(seed.lines.map((line) => line.modelId)).toEqual(['model-1', 'model-2']);
	});
});

describe('transferLineSeedOf', () => {
	it('takes the SKU name and the tracking policy off the expanded relation', () => {
		const seed = transferLineSeedOf(lineOf());
		expect(seed).not.toBeNull();
		expect(seed?.modelId).toBe('model-1');
		expect(seed?.modelName).toBe('Tyre 11R');
		// The policy lives on the item NAME, not the SKU — it must arrive nested.
		expect(seed?.tracking).toBe('serial');
		expect(seed?.qty).toBe(2);
		expect(seed?.serials).toEqual(['TY-1', 'TY-2']);
	});

	it('keeps the stored BATCH restriction — the confirm picks the lot with it', () => {
		const seed = transferLineSeedOf(lineOf({ item_model: { id: 'model-2', name_en: 'Oil', item_name: { tracking: 'batch' } } }));
		expect(seed?.tracking).toBe('batch');
		expect(seed?.batchNo).toBe('B-77');
	});

	it('accepts a BARE relation id — the label then falls back to the directory', () => {
		const seed = transferLineSeedOf(lineOf({ item_model: 'model-2' }));
		expect(seed?.modelId).toBe('model-2');
		expect(seed?.modelName).toBeNull();
		expect(seed?.tracking).toBe('standard');
	});

	it('reads the serials column as decoded units OR as its JSON text', () => {
		expect(transferLineSeedOf(lineOf({ serials: ['TY-1', ' TY-2 '] }))?.serials).toEqual(['TY-1', 'TY-2']);
		expect(transferLineSeedOf(lineOf({ serials: '["TY-1","TY-2"]' }))?.serials).toEqual(['TY-1', 'TY-2']);
		// Unreadable/absent is EMPTY, never a crash and never a phantom unit.
		expect(transferLineSeedOf(lineOf({ serials: 'not json' }))?.serials).toEqual([]);
		expect(transferLineSeedOf(lineOf({ serials: null }))?.serials).toEqual([]);
	});

	it('refuses a line with no item model — the editor could neither paint nor re-submit it', () => {
		expect(transferLineSeedOf(lineOf({ item_model: null }))).toBeNull();
		expect(transferLineSeedsOf([lineOf({ item_model: null }), lineOf()])).toHaveLength(1);
	});
});
