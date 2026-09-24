import { describe, expect, it } from 'vitest';

import { isOutboundEditable, outboundFormSeedOf, outboundLineSeedOf, outboundLineSeedsOf } from './edit';
import type { MroOutboundLineRow, MroOutboundRow } from './types';

/**
 * The EDIT seed — the wire → form-fields mapping the document page depends on.
 *
 * Three rules are pinned here because all three are silent when they break: the
 * HOLDER must be read off the column the document actually set (a seed that named
 * the wrong side would let an edit clear the holder it meant to keep), the mode
 * must follow the DOCUMENT's status (a form that offered edits on a posted issue
 * would only fail later, at the server), and a line without an item must be
 * REFUSED rather than blanked (a blank row would save the document with stock
 * quietly dropped from it).
 */

function rowOf(overrides: Partial<MroOutboundRow> = {}): MroOutboundRow {
	return {
		id: 'out-1',
		display_number: 'OUT-00031',
		doc_status: 'draft',
		type: 'goods_issue',
		effective_date: '2026-09-20',
		location: 'main_store',
		note: '  Two tyres  ',
		request: null,
		to_vehicle: null,
		to_employee: null,
		...overrides,
	};
}

function lineOf(overrides: Partial<MroOutboundLineRow> = {}): MroOutboundLineRow {
	return {
		id: 'ln-1',
		parent_id: 'out-1',
		item_model: { id: 'model-1', name_en: 'Tyre 11R', name_mm: 'တာယာ', item_name: { tracking: 'serial' } },
		qty: 2,
		serials: ['TY-1', 'TY-2'],
		...overrides,
	};
}

describe('isOutboundEditable', () => {
	it('lets only a DRAFT be written — the engine freezes a confirmed row and a cancelled one is terminal', () => {
		expect(isOutboundEditable('draft')).toBe(true);
		expect(isOutboundEditable('confirmed')).toBe(false);
		expect(isOutboundEditable('cancelled')).toBe(false);
	});
});

describe('outboundFormSeedOf', () => {
	it('seeds the holder from the VEHICLE column, and never the employee one', () => {
		// Both columns populated (a row that predates the one-holder rule): the
		// document's own shape still decides which picker the form opens with.
		const seed = outboundFormSeedOf(
			rowOf({ to_vehicle: { id: 'veh-1', plate_no: 'TRK-X' }, to_employee: { id: 'emp-9', name_en: 'Aung Aung' } }),
			[],
		);
		expect(seed.destinationKind).toBe('fleet');
		expect(seed.destinationId).toBe('veh-1');
		expect(seed.destinationLabel).toBe('TRK-X');
	});

	it('seeds a PERSON-held issue from the employee column', () => {
		const seed = outboundFormSeedOf(rowOf({ to_employee: { id: 'emp-9', name_en: 'Aung Aung' } }), []);
		expect(seed.destinationKind).toBe('employee');
		expect(seed.destinationId).toBe('emp-9');
		expect(seed.destinationLabel).toBe('Aung Aung');
	});

	it('names NO holder on a document that set neither — a write-off moves to nobody', () => {
		const seed = outboundFormSeedOf(rowOf({ type: 'write_offs' }), []);
		expect(seed.destinationKind).toBeNull();
		expect(seed.destinationId).toBeNull();
		expect(seed.destinationLabel).toBeNull();
	});

	it('keeps the source-request LINK, so an edit can neither drop it nor invent one', () => {
		// The engine may hand back the expanded row or a bare id — both answer `id`.
		expect(outboundFormSeedOf(rowOf({ request: { id: 'req-1', display_number: 'REQ-00007' } }), []).requestId).toBe('req-1');
		expect(outboundFormSeedOf(rowOf({ request: 'req-2' }), []).requestId).toBe('req-2');
	});

	it('reads the draft-time facts: the trimmed note, the date, the kind', () => {
		const seed = outboundFormSeedOf(rowOf(), []);
		expect(seed.note).toBe('Two tyres');
		expect(seed.effectiveDate).toBe('2026-09-20');
		expect(seed.type).toBe('goods_issue');
		expect(seed.docStatus).toBe('draft');
	});

	it('treats an empty doc_status as draft (the engine does) and an unknown store as the default one', () => {
		// The row type spells the three known statuses; the ENGINE still treats `''`
		// as draft (a row written before the column existed), which is exactly what
		// this pins — so the raw wire value is cast on purpose.
		const seed = outboundFormSeedOf(rowOf({ doc_status: '' as unknown as MroOutboundRow['doc_status'], location: 'nowhere' }), []);
		expect(seed.docStatus).toBe('draft');
		expect(seed.location).toBe('main_store');
	});

	it('carries the stored lines in their stored order', () => {
		const seed = outboundFormSeedOf(rowOf(), [lineOf(), lineOf({ id: 'ln-2', item_model: 'model-2' })]);
		expect(seed.lines.map((line) => line.modelId)).toEqual(['model-1', 'model-2']);
	});
});

describe('outboundLineSeedOf', () => {
	it('takes the SKU name and the tracking policy off the expanded relation', () => {
		const seed = outboundLineSeedOf(lineOf());
		expect(seed).not.toBeNull();
		expect(seed?.modelId).toBe('model-1');
		expect(seed?.modelName).toBe('Tyre 11R');
		// The policy lives on the item NAME, not the SKU — it must arrive nested.
		expect(seed?.tracking).toBe('serial');
		expect(seed?.qty).toBe(2);
		expect(seed?.serials).toEqual(['TY-1', 'TY-2']);
	});

	it('accepts a BARE relation id — the label then falls back to the directory', () => {
		const seed = outboundLineSeedOf(lineOf({ item_model: 'model-2' }));
		expect(seed?.modelId).toBe('model-2');
		expect(seed?.modelName).toBeNull();
		expect(seed?.tracking).toBe('standard');
	});

	it('reads the serials column as decoded units OR as its JSON text', () => {
		expect(outboundLineSeedOf(lineOf({ serials: ['TY-1', ' TY-2 '] }))?.serials).toEqual(['TY-1', 'TY-2']);
		expect(outboundLineSeedOf(lineOf({ serials: '["TY-1","TY-2"]' }))?.serials).toEqual(['TY-1', 'TY-2']);
		// Unreadable/absent is EMPTY, never a crash and never a phantom unit.
		expect(outboundLineSeedOf(lineOf({ serials: 'not json' }))?.serials).toEqual([]);
		expect(outboundLineSeedOf(lineOf({ serials: null }))?.serials).toEqual([]);
	});

	it('refuses a line with no item model — the editor could neither paint nor re-submit it', () => {
		expect(outboundLineSeedOf(lineOf({ item_model: null }))).toBeNull();
		expect(outboundLineSeedsOf([lineOf({ item_model: null }), lineOf()])).toHaveLength(1);
	});
});
