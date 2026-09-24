import { describe, expect, it } from 'vitest';

import { dueFromInterval, fillEditDraft } from './fill-edit';

/**
 * The fill edit screen's round-trip: the stored ABSOLUTE due becomes the
 * operator's interval, and the interval returns the absolute due. Pins the pair
 * so the correction form shows the same frequency the row was recorded with and
 * saves back the same number.
 */
describe('fillEditDraft ⇄ dueFromInterval', () => {
	it('turns the stored due into the interval the operator typed', () => {
		const draft = fillEditDraft({ date: '2026-09-07', odo_at_fill: 120000, next_due_odo: 135000, qty_liters: 18, note: 'oil' });
		expect(draft).toEqual({ date: '2026-09-07', odo: '120000', nextInterval: '15000', qty: '18', note: 'oil' });
	});

	it('round-trips an edited interval back to the absolute due', () => {
		const draft = fillEditDraft({ date: null, odo_at_fill: 50000, next_due_odo: 60000, qty_liters: null, note: null });
		const due = dueFromInterval(Number(draft.odo), 20000);
		expect(due).toBe(70000);
	});

	it('leaves the interval blank when the row has no odo/due', () => {
		const draft = fillEditDraft({ date: null, odo_at_fill: null, next_due_odo: null, qty_liters: null, note: null });
		expect(draft.odo).toBe('');
		expect(draft.nextInterval).toBe('');
	});
});
