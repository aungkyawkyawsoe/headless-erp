import { describe, expect, it } from 'vitest';

import { formatClock12h, formatClockTime, formatShiftRange12h, formatShiftTime12h } from './myanmar';
import { formatPunchTime } from '@/modules/attendance/utils/time';

/**
 * The 12-hour clock is ONE rule (`formatClock12h`) that every clock label in the
 * app renders through. These tests pin the rule itself AND the invariant that the
 * per-surface formatters agree with it — so the header clock, the shift rows, the
 * punch cards and the request/OT time spans can never drift apart again (they
 * were four independent implementations before).
 */
describe('formatClock12h — the ONE 12-hour clock rule', () => {
	it('renders midnight and noon as 12 AM / 12 PM', () => {
		expect(formatClock12h(0, 0)).toBe('12:00 AM');
		expect(formatClock12h(12, 0)).toBe('12:00 PM');
	});

	it('zero-pads the hour and the minute', () => {
		expect(formatClock12h(9, 5)).toBe('09:05 AM');
		expect(formatClock12h(17, 30)).toBe('05:30 PM');
		expect(formatClock12h(23, 59)).toBe('11:59 PM');
	});

	it('appends zero-padded seconds only when asked', () => {
		expect(formatClock12h(19, 51, 8)).toBe('07:51:08 PM');
		expect(formatClock12h(19, 51)).toBe('07:51 PM');
	});

	it('wraps hours past a full day', () => {
		expect(formatClock12h(25, 0)).toBe('01:00 AM');
	});
});

describe('every per-surface clock label agrees with the shared rule', () => {
	it('formatShiftTime12h renders the shared label', () => {
		expect(formatShiftTime12h('09:05')).toBe(formatClock12h(9, 5));
		expect(formatShiftTime12h('17:30')).toBe(formatClock12h(17, 30));
	});

	it('formatPunchTime renders the SAME label for the same MMT time', () => {
		// 02:30Z is 09:00 MMT (UTC+6:30) — the punch clock and the shift clock must
		// read identically for the same wall-clock time.
		expect(formatPunchTime('2026-01-01T02:30:00Z')).toBe('09:00 AM');
		expect(formatPunchTime('2026-01-01T02:30:00Z')).toBe(formatShiftTime12h('09:00'));
		expect(formatPunchTime('2026-01-01T00:00:00Z')).toBe('06:30 AM');
	});

	it('formatClockTime (the header clock) renders the shared label', () => {
		const date = new Date(2026, 0, 1, 19, 51, 8);
		expect(formatClockTime(date)).toBe('07:51:08 PM');
	});

	it('formatShiftRange12h derives its end from the same rule', () => {
		expect(formatShiftRange12h('10:00', 6)).toBe('10:00 AM - 04:00 PM');
	});

	it('keeps the absent/invalid sentinels', () => {
		expect(formatShiftTime12h(null)).toBe('--:--');
		expect(formatShiftTime12h('')).toBe('--:--');
		expect(formatPunchTime(null)).toBe('--:--');
		expect(formatPunchTime('not-a-date')).toBe('--:--');
		expect(formatShiftRange12h(undefined, 8)).toBe('—');
	});
});
