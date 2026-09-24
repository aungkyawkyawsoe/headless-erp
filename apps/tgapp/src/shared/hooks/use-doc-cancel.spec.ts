import { describe, expect, it } from 'vitest';

import { cancelCopyOf } from './use-doc-cancel';

/**
 * The cancel copy is DERIVED, not written per screen — so this pins the contract
 * every cancel affordance renders (the list card AND the document page of all four
 * families read this one function):
 *
 *   draft     → nothing was moved, and the only cost is re-typing it;
 *   posted    → the stock goes BACK, and the document is final (a replacement is a
 *               new document, never this one reopened).
 *
 * A screen that promised "nothing to reverse" over a POSTED document would tell the
 * operator the opposite of what the server is about to do, which is exactly the class
 * of lie this derivation exists to make impossible.
 */
describe('cancelCopyOf', () => {
	it('promises a draft a pure flip, and names the re-typing cost', () => {
		const copy = cancelCopyOf('inbounds', 'draft');
		expect(copy.title).toBe('Cancel this receipt?');
		expect(copy.description).toMatch(/never moved stock/i);
		expect(copy.description).toMatch(/final/i);
		expect(copy.label).toBe('Cancel receipt');
	});

	it('states the stock reversal for a POSTED document of each family', () => {
		const inbound = cancelCopyOf('inbounds', 'confirmed');
		expect(inbound.title).toMatch(/put the stock back/i);
		expect(inbound.description).toMatch(/REVERSES/);
		expect(inbound.description, 'the receipt money story').toMatch(/payment/i);
		expect(inbound.label).toBe('Cancel & reverse');

		const outbound = cancelCopyOf('outbounds', 'confirmed');
		expect(outbound.title).toBe('Cancel this issue and put the stock back?');
		expect(outbound.description, 'the units return + the request is recomputed').toMatch(/return to the store/i);
		expect(outbound.description).toMatch(/request/i);

		const adjustment = cancelCopyOf('adjustments', 'confirmed');
		expect(adjustment.title).toBe('Cancel this adjustment and put the stock back?');
		expect(adjustment.description).toMatch(/added stock is taken back/i);

		const transfer = cancelCopyOf('transfers', 'confirmed');
		expect(transfer.title).toBe('Cancel this transfer and put the stock back?');
		expect(transfer.description, 'the source gets its lots back + the destination gives up what arrived').toMatch(
			/source store gets its lots back/i,
		);
		expect(transfer.description).toMatch(/destination store gives up/i);
	});

	it('never claims a reversal can be undone — a cancelled stock document is final', () => {
		for (const kind of ['inbounds', 'outbounds', 'transfers', 'adjustments'] as const) {
			expect(cancelCopyOf(kind, 'confirmed').description).toMatch(/cannot be restored/i);
		}
	});

	it('uses the family’s own noun so the sheet never says "receipt" over an issue', () => {
		expect(cancelCopyOf('outbounds', 'draft').title).toBe('Cancel this issue?');
		expect(cancelCopyOf('adjustments', 'draft').title).toBe('Cancel this adjustment?');
		expect(cancelCopyOf('transfers', 'draft').title).toBe('Cancel this transfer?');
		expect(cancelCopyOf('transfers', 'draft').label).toBe('Cancel transfer');
	});
});
