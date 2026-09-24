import { describe, expect, it } from 'vitest';

import { dateLabel, formatCount, money, paidOnLabel } from './display';

/**
 * The display rules the inbounds screens hang on — money and payment DAY stamps.
 *
 * Pure and TZ-proof: every date helper anchors on UTC midnight of a `YYYY-MM-DD`
 * string, so a store in Yangon (+06:30) never renders the day before. The payment
 * ledger is a record of WHEN money moved, so a date that shifts is a wrong record.
 */

describe('money / formatCount', () => {
	it('formats a whole and a fractional amount with thousands separators', () => {
		expect(money(1_500_000)).toBe('1,500,000 Ks');
		expect(money(1200.5)).toBe('1,200.5 Ks');
		expect(formatCount(0)).toBe('0');
	});

	it('renders an absent or non-numeric amount as a dash, never "NaN"', () => {
		expect(money(null)).toBe('—');
		expect(money(undefined)).toBe('—');
		expect(money(Number.NaN)).toBe('—');
	});
});

describe('dateLabel', () => {
	it('formats a calendar day in English without shifting timezone', () => {
		expect(dateLabel('2026-09-20')).toBe('Sep 20, 2026');
		expect(dateLabel('2026-01-01')).toBe('Jan 1, 2026');
	});

	it('is a dash when unset or unparseable', () => {
		expect(dateLabel(null)).toBe('—');
		expect(dateLabel('not-a-date')).toBe('—');
	});
});

describe('paidOnLabel — the ledger row date stamp', () => {
	it('prefixes today / yesterday but ALWAYS keeps the date', () => {
		expect(paidOnLabel('2026-09-20', '2026-09-20')).toBe('Today, Sep 20, 2026');
		expect(paidOnLabel('2026-09-19', '2026-09-20')).toBe('Yesterday, Sep 19, 2026');
	});

	it('uses the weekday for anything older (and for a future day)', () => {
		expect(paidOnLabel('2026-09-12', '2026-09-20')).toBe('Sat, Sep 12, 2026');
		expect(paidOnLabel('2026-09-25', '2026-09-20')).toBe('Fri, Sep 25, 2026');
	});

	it('spans month boundaries by whole days, not by string compare', () => {
		expect(paidOnLabel('2026-08-31', '2026-09-01')).toBe('Yesterday, Aug 31, 2026');
	});

	it('is a dash when the payment has no usable date', () => {
		expect(paidOnLabel(null, '2026-09-20')).toBe('—');
		expect(paidOnLabel('nope', '2026-09-20')).toBe('—');
	});
});
