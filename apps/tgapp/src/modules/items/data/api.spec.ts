import { describe, expect, it } from 'vitest';

import { itemCardOf } from './api';

/** The exact row shape the mapper consumes (no production export needed). */
type ItemRowInput = Parameters<typeof itemCardOf>[0];

/**
 * The catalog card's ENGLISH label is the GROUP name followed by the model name
 * ("Air Filter AF-1001") — a bare model code must never read as an orphan row.
 * The expiry lead is an edit-time fact and is NOT part of the card.
 */
describe('itemCardOf — the catalog card row', () => {
	const row = (over: Partial<ItemRowInput> = {}): ItemRowInput =>
		({
			id: 'm1',
			name_en: 'AF-1001',
			name_mm: 'လေစစ်ဇကာ AF-1001',
			image: null,
			expiry_alert_days: 30,
			item_name: { id: 'g1', name_en: 'Air Filter', name_mm: null, tracking: 'batch' },
			...over,
		}) as ItemRowInput;

	it('concatenates the group name and the model name for the English label', () => {
		expect(itemCardOf(row()).name).toBe('Air Filter AF-1001');
	});

	it('degrades cleanly: no group label ⇒ the model name alone; neither ⇒ —', () => {
		expect(itemCardOf(row({ item_name: null })).name).toBe('AF-1001');
		expect(itemCardOf(row({ item_name: null, name_en: '' })).name).toBe('—');
	});

	it('inherits the stock policy from the group and keeps the Myanmar name', () => {
		const card = itemCardOf(row());
		expect(card.tracking).toBe('batch');
		expect(card.nameMm).toBe('လေစစ်ဇကာ AF-1001');
		// The dropped field is gone from the model (the card no longer paints it).
		expect(card).not.toHaveProperty('expiryAlertDays');
	});
});
