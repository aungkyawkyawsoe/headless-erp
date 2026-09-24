import { describe, expect, it } from 'vitest';

import { eventPartyOf, unitTitleOf } from './labels';

/**
 * The register card's title — the item NAME over its MODEL.
 *
 * A unit is identified by two facts at once: what it IS (the item name: “Tyre”)
 * and which one it is (the SKU: “11R 22.5”). Each alone fails a store floor — a
 * bare size code is not a thing anyone ordered, and a lone item name is the same
 * word on every row of the kind. These pin the pair, its dedupe (the catalog has
 * models that already SAY the item name), and the fallbacks for a half-known SKU.
 */
const unit = (over: Partial<Parameters<typeof unitTitleOf>[0]> = {}): Parameters<typeof unitTitleOf>[0] => ({
	kind: 'tyre',
	modelName: '11R 22.5',
	itemNameEn: 'Tyre',
	itemNameMm: 'တာယာ',
	...over,
});

describe('unitTitleOf', () => {
	it('puts the item name over the model', () => {
		expect(unitTitleOf(unit())).toBe('Tyre · 11R 22.5');
	});

	it('never repeats an item name the model already says', () => {
		// The real catalog case: a SKU named “Tyre 11R22.5 (Serial)” under “Tyre”.
		expect(unitTitleOf(unit({ modelName: 'Tyre 11R22.5 (Serial)' }))).toBe('Tyre 11R22.5 (Serial)');
	});

	it('shows the bare model when the SKU has no item name', () => {
		expect(unitTitleOf(unit({ itemNameEn: null, itemNameMm: null }))).toBe('11R 22.5');
	});

	it('falls back to the item name when the SKU is unnamed', () => {
		expect(unitTitleOf(unit({ modelName: null }))).toBe('Tyre');
		// …through the Burmese pair too, so a Burmese-only master still names the row.
		expect(unitTitleOf(unit({ modelName: null, itemNameEn: null }))).toBe('တာယာ');
	});

	it('names the unit by its KIND when the masters say nothing', () => {
		// Never the em dash a picker label ends in — a tyre card must still say it is
		// a tyre (an unnamed row is a data gap, not a blank card).
		expect(unitTitleOf(unit({ modelName: null, itemNameEn: null, itemNameMm: null }))).toBe('Tyre');
		expect(unitTitleOf(unit({ kind: 'asset', modelName: null, itemNameEn: null, itemNameMm: null }))).toBe('Equipment');
	});

	it('ignores whitespace-only names rather than printing a separator around nothing', () => {
		expect(unitTitleOf(unit({ modelName: '   ', itemNameEn: 'Jack' }))).toBe('Jack');
		expect(unitTitleOf(unit({ modelName: '2-ton', itemNameEn: '  ' }))).toBe('2-ton');
	});
});

/** ONE lifecycle row's inputs — the shape `eventLineOf` feeds the rule. */
const row = (over: Partial<Parameters<typeof eventPartyOf>[0]> = {}): Parameters<typeof eventPartyOf>[0] => ({
	kind: 'fitted',
	reporter: 'U Hla Tun',
	approvedBy: null,
	handedTo: null,
	...over,
});

/**
 * The RIGHT half of a lifecycle row — the other PERSON on it, or nobody.
 *
 * The rule must never over-claim: a row whose movement carried no document (a kiosk
 * fit, an inspection, a receipt) says NOTHING rather than asserting an approval rule
 * the record cannot prove — and the earlier "No approval needed" filler did exactly
 * that on most rows, burying the ones that DO carry a name.
 */
describe('eventPartyOf', () => {
	it('names the approver of the governing document', () => {
		expect(eventPartyOf(row({ kind: 'issued', approvedBy: 'Daw Mya' }))).toEqual({
			label: 'Approved by',
			name: 'Daw Mya',
		});
	});

	it('names the person it was handed to, with the verb that happened', () => {
		expect(eventPartyOf(row({ kind: 'issued', handedTo: 'Ma Ei Mon' }))).toEqual({
			label: 'Issued to',
			name: 'Ma Ei Mon',
		});
		expect(eventPartyOf(row({ kind: 'reissued', handedTo: 'U Soe Naing' }))).toEqual({
			label: 'Transferred to',
			name: 'U Soe Naing',
		});
	});

	it('prefers the APPROVAL over the hand-off — one other party per row', () => {
		expect(eventPartyOf(row({ kind: 'issued', approvedBy: 'Daw Mya', handedTo: 'Ma Ei Mon' }))).toEqual({
			label: 'Approved by',
			name: 'Daw Mya',
		});
	});

	it('says NOTHING on a movement nobody had to approve', () => {
		// The six `ref_kind`s the engine writes for a direct custody move or a kiosk
		// chore stamp the unit's OWN serial into `ref_doc`, so no document — and no
		// approver — stands behind them. The row's right half stays EMPTY: a statement
		// that nothing had to approve it would just restate the row's own kind.
		for (const kind of ['purchased', 'returned', 'fitted', 'unseated', 'rotated', 'checked'] as const) {
			expect(eventPartyOf(row({ kind }))).toBeNull();
		}
	});

	it('stays SILENT on a document-backed movement with no recorded approver', () => {
		// An OUT-/INB-/TRF- row whose approver is absent (a direct store issue, a legacy
		// row) says nothing rather than claiming an approval that never happened.
		for (const kind of ['issued', 'returned', 'store_transferred', 'adjusted', 'refitted'] as const) {
			expect(eventPartyOf(row({ kind }))).toBeNull();
		}
	});

	it('never prints the same person twice — a party equal to the reporter is skipped', () => {
		// The demo's own case: the store keeper filed, issued AND would-be-approved the
		// one movement. Printing them on both sides of the row adds nothing, and there is
		// no filler left to say so.
		expect(eventPartyOf(row({ kind: 'store_transferred', approvedBy: 'U Hla Tun' }))).toBeNull();
		expect(eventPartyOf(row({ kind: 'issued', handedTo: 'U Hla Tun' }))).toBeNull();
	});

	it('renders no right-hand side when the row has no reporter either', () => {
		// A checkout-less kiosk write names nobody at all; the row is then only its
		// title + detail, and the slot stays empty rather than blaming an absence.
		expect(eventPartyOf(row({ reporter: null }))).toBeNull();
	});
});
