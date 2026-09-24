/**
 * MMT time core — THE cross-package definition of Myanmar time.
 *
 * These tests pin the exact instants, because both the API (attendance windows,
 * task digests, stock expiry horizons) and the mini app (every date/clock/work-day
 * label) bucket by these helpers. A silent change here moves "today" for both
 * sides at once — which is the point of having one source, and the reason the
 * arithmetic is asserted rather than assumed.
 */
import { describe, it, expect } from 'vitest';

import { DAY_MS, MMT_OFFSET_MS, addDays, dayOf, mmtDayStartIso, mmtWindowStartIso, toMmtDate, todayMmtDate } from '../time';

/** 2026-01-10T20:00Z is 2026-01-11 02:30 MMT — the next MMT day. */
const NOW = Date.parse('2026-01-10T20:00:00Z');

describe('MMT constants', () => {
	it('is UTC+6:30 and a 24h day', () => {
		expect(MMT_OFFSET_MS).toBe(6.5 * 60 * 60 * 1000);
		expect(DAY_MS).toBe(86_400_000);
	});
});

describe('toMmtDate / todayMmtDate', () => {
	it('shifts a UTC instant onto the MMT calendar day', () => {
		// 20:00Z is already the NEXT day in MMT (02:30).
		expect(toMmtDate('2026-01-10T20:00:00Z')).toBe('2026-01-11');
		// 10:00Z is 16:30 MMT — the same day.
		expect(toMmtDate('2026-01-10T10:00:00Z')).toBe('2026-01-10');
		// Just before MMT midnight.
		expect(toMmtDate('2026-01-10T17:29:00Z')).toBe('2026-01-10');
		expect(toMmtDate('2026-01-10T17:30:00Z')).toBe('2026-01-11');
	});

	it('accepts epoch ms and Date, and todayMmtDate is deterministic on `now`', () => {
		expect(toMmtDate(NOW)).toBe('2026-01-11');
		expect(toMmtDate(new Date(NOW))).toBe('2026-01-11');
		expect(todayMmtDate(NOW)).toBe('2026-01-11');
	});
});

describe('mmtWindowStartIso / mmtDayStartIso', () => {
	it('opens the window at MMT midnight of (today - days)', () => {
		// MMT today is 2026-01-11 → its midnight is 2026-01-10T17:30Z.
		expect(mmtDayStartIso(NOW)).toBe('2026-01-10T17:30:00.000Z');
		expect(mmtWindowStartIso(7, NOW)).toBe('2026-01-03T17:30:00.000Z');
	});

	it('day-start really is 00:00 on the MMT clock', () => {
		const at = new Date(Date.parse(mmtDayStartIso(NOW)) + MMT_OFFSET_MS);
		expect(at.toISOString().slice(11, 16)).toBe('00:00');
		expect(toMmtDate(mmtDayStartIso(NOW))).toBe(todayMmtDate(NOW));
	});

	it('a zero-day window still opens at today’s MMT midnight', () => {
		expect(mmtWindowStartIso(0, NOW)).toBe(mmtDayStartIso(NOW));
	});
});

describe('addDays', () => {
	it('does UTC calendar arithmetic across month/year boundaries', () => {
		expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
		expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
		expect(addDays('2026-01-10', 2)).toBe('2026-01-12');
		expect(addDays('2026-01-10', 0)).toBe('2026-01-10');
	});
});

describe('dayOf', () => {
	it('buckets EITHER storage form onto the same day', () => {
		// The whole point: a DATE column and a full ISO timestamp must answer the
		// same day, or a guard comparing the two silently asks a different question.
		expect(dayOf('2026-01-11')).toBe('2026-01-11');
		expect(dayOf('2026-01-11T20:00:00.000Z')).toBe('2026-01-11');
		expect(dayOf('2026-01-11T20:00:00Z')).toBe('2026-01-11');
		// A stored timestamp and its own DATE form agree — the invariant the
		// early-leave and requisition guards rely on.
		expect(dayOf('2026-01-11T23:59:59.999Z')).toBe(dayOf('2026-01-11'));
	});

	it('returns the empty string for a non-string, never a real day', () => {
		// An absent value must not equal a day, so the comparison never matches.
		for (const v of [null, undefined, 0, 42, {}, [], new Date('2026-01-11T00:00:00Z')]) {
			expect(dayOf(v)).toBe('');
		}
	});
});
