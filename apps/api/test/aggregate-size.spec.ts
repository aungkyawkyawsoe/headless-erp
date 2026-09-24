import { describe, expect, it } from 'vitest';
import { MAX_AGGREGATE_GROUPS, assertGroupCeiling } from '@/lib/api/aggregate-size';
import { ValidationError } from '@mmbix/utils';

/**
 * Aggregate-size policy — the bucket ceiling for grouped reads that are NOT
 * page-limited. A `groupBy=id` on a large table must fail LOUDLY rather than
 * stream an unbounded response (or silently truncate the chart).
 */
describe('aggregate-size policy', () => {
	it('allows a result exactly at the ceiling', () => {
		expect(() => assertGroupCeiling(MAX_AGGREGATE_GROUPS)).not.toThrow();
		expect(() => assertGroupCeiling(0)).not.toThrow();
		expect(() => assertGroupCeiling(2, 2)).not.toThrow();
	});

	it('fails loudly one bucket past the ceiling (the probe row)', () => {
		// The engine probes `LIMIT ceiling + 1`, so `ceiling + 1` observed rows is
		// precisely the overflow signal.
		expect(() => assertGroupCeiling(MAX_AGGREGATE_GROUPS + 1)).toThrow(ValidationError);
		expect(() => assertGroupCeiling(2, 1)).toThrow(/exceeds 1 groups/);
	});

	it('names the ceiling AND the remedy so the caller can act', () => {
		try {
			assertGroupCeiling(3, 2);
			throw new Error('expected assertGroupCeiling to throw');
		} catch (err) {
			expect(err).toBeInstanceOf(ValidationError);
			expect((err as Error).message).toContain('2 groups');
			expect((err as Error).message).toContain('narrow the query');
		}
	});

	it('exposes a positive ceiling', () => {
		expect(Number.isInteger(MAX_AGGREGATE_GROUPS)).toBe(true);
		expect(MAX_AGGREGATE_GROUPS).toBeGreaterThan(0);
	});
});
