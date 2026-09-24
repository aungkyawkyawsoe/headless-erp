import { describe, expect, it } from 'vitest';

import { MIN_CHECKOUT_WAIT_MS, checkOutWaitRemainingMs, formatWaitRemaining } from './time';

describe('check-out minimum wait', () => {
	const start = Date.UTC(2026, 0, 15, 0, 0, 0);
	const iso = new Date(start).toISOString();

	it('measures the remaining wait from the check-in', () => {
		expect(checkOutWaitRemainingMs(iso, start)).toBe(MIN_CHECKOUT_WAIT_MS);
		expect(checkOutWaitRemainingMs(iso, start + 5 * 60_000)).toBe(10 * 60_000);
		expect(checkOutWaitRemainingMs(iso, start + MIN_CHECKOUT_WAIT_MS)).toBe(0);
		expect(checkOutWaitRemainingMs(iso, start + 60 * 60_000)).toBe(0);
	});

	it('returns 0 without a check-in or with an unparsable one', () => {
		expect(checkOutWaitRemainingMs(null, start)).toBe(0);
		expect(checkOutWaitRemainingMs(undefined, start)).toBe(0);
		expect(checkOutWaitRemainingMs('not-a-date', start)).toBe(0);
	});
});

describe('formatWaitRemaining', () => {
	it('formats seconds, minutes and hours + minutes', () => {
		expect(formatWaitRemaining(45_000)).toBe('45s');
		expect(formatWaitRemaining(15 * 60_000)).toBe('15m');
		expect(formatWaitRemaining(90 * 60_000)).toBe('1h 30m');
		expect(formatWaitRemaining(120 * 60_000)).toBe('2h');
	});
});
