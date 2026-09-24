import { describe, expect, it } from 'vitest';

import { barTone, canPayOf, expectsPaymentOf, moneyStateOf } from './money';

/**
 * The money state BOTH the receipt card and its payment sheet render.
 *
 * One derivation for two surfaces is the point: if the card says one figure is
 * left, the sheet it opens must say the same number and draw the same bar. These
 * cases pin the edges the arithmetic actually meets — an unpriced draft, a partial
 * payment, an over-payment, and float noise.
 */

describe('moneyStateOf', () => {
	it('derives left and percent from the engine mirror columns', () => {
		const state = moneyStateOf({ totalAmount: 1_500_000, paidAmount: 1_000_000, paymentStatus: 'partial' });
		expect(state).toMatchObject({ total: 1_500_000, paid: 1_000_000, left: 500_000, percent: 67, hasTotal: true, settled: false });
	});

	it('treats a missing / zero / non-numeric total as "no total"', () => {
		for (const total of [null, 0, -5, Number.NaN]) {
			const state = moneyStateOf({ totalAmount: total, paidAmount: 0, paymentStatus: null });
			expect(state.hasTotal, `total=${String(total)}`).toBe(false);
			expect(state.total).toBeNull();
			expect(state.left).toBeNull();
			expect(state.percent).toBe(0);
		}
	});

	it('clamps an over-payment: never negative left, never a bar past 100%', () => {
		const state = moneyStateOf({ totalAmount: 1_000, paidAmount: 1_200, paymentStatus: 'paid' });
		expect(state.left).toBe(0);
		expect(state.percent).toBe(100);
		expect(state.settled).toBe(true);
	});

	it('settles only on the ENGINE status, and defaults paid to 0 when unset', () => {
		expect(moneyStateOf({ totalAmount: 500, paidAmount: 500, paymentStatus: 'partial' }).settled).toBe(false);
		expect(moneyStateOf({ totalAmount: 500, paidAmount: null, paymentStatus: null }).paid).toBe(0);
	});

	it('rounds float noise out of the remainder', () => {
		expect(moneyStateOf({ totalAmount: 0.3, paidAmount: 0.1, paymentStatus: 'partial' }).left).toBe(0.2);
	});
});

describe('barTone', () => {
	it('tones the bar by the settlement status', () => {
		expect(barTone('paid')).toBe('bg-status-success');
		expect(barTone('partial')).toBe('bg-status-warning');
		expect(barTone('unpaid')).toBe('bg-muted-foreground/30');
		expect(barTone(null)).toBe('bg-muted-foreground/30');
	});
});

describe('canPayOf — the ledger’s own precondition', () => {
	const priced = { totalAmount: 1_500_000, paidAmount: 0, paymentStatus: null };

	it('offers a payment on a CONFIRMED, PRICED receipt (a settled one included)', () => {
		expect(canPayOf({ ...priced, docStatus: 'confirmed' })).toBe(true);
		expect(canPayOf({ ...priced, docStatus: 'confirmed', paidAmount: 1_500_000, paymentStatus: 'paid' })).toBe(true);
	});

	it('refuses a draft, a cancelled doc and one with no total to compare against', () => {
		// A draft has not moved stock yet, a cancelled doc never will, and an unpriced
		// receipt has no total for a payment to be measured against — the server refuses
		// all three, so no surface may offer them.
		expect(canPayOf({ ...priced, docStatus: 'draft' })).toBe(false);
		expect(canPayOf({ ...priced, docStatus: 'cancelled' })).toBe(false);
		expect(canPayOf({ ...priced, docStatus: 'confirmed', totalAmount: null })).toBe(false);
	});
});

describe('expectsPaymentOf — the app stops asking once nothing is OWED', () => {
	const priced = { totalAmount: 1_500_000, paidAmount: 0, paymentStatus: null };

	it('asks while a balance is outstanding', () => {
		expect(expectsPaymentOf({ ...priced, docStatus: 'confirmed', paidAmount: 500_000, paymentStatus: 'partial' })).toBe(true);
	});

	it('stops asking on a settled receipt — which the ledger itself would still accept', () => {
		const settled = { ...priced, docStatus: 'confirmed' as const, paidAmount: 1_500_000, paymentStatus: 'paid' as const };
		// Two DIFFERENT questions, deliberately kept apart: the engine accepts another
		// instalment (it records what left the till), the app stops offering a form whose
		// every answer is "no".
		expect(canPayOf(settled)).toBe(true);
		expect(expectsPaymentOf(settled)).toBe(false);
		// An over-payment settles the receipt too, so it stops asking as well.
		expect(expectsPaymentOf({ ...settled, paidAmount: 1_600_000 })).toBe(false);
	});

	it('never asks on a draft, a cancelled document or an unpriced receipt', () => {
		expect(expectsPaymentOf({ ...priced, docStatus: 'draft' })).toBe(false);
		expect(expectsPaymentOf({ ...priced, docStatus: 'cancelled' })).toBe(false);
		expect(expectsPaymentOf({ ...priced, docStatus: 'confirmed', totalAmount: null })).toBe(false);
	});
});
