/**
 * Pins the punch write-through's query-key contract.
 *
 * The bug this guards against: `attendanceSummary` keys carry a trailing
 * `withLeaves` flag, and invalidating a CONCRETE key built with only `days`
 * (the default arg fills in `false`) prefix-matches ONLY the task-feed variant.
 * The fallback history variant (`withLeaves: true`, shown whenever the session
 * cannot open Projects) then stayed stale after a punch until a manual reload —
 * the exact symptom this suite exists to prevent recurring.
 *
 * `matchQuery` is TanStack Query's OWN prefix matcher, so these assertions are
 * not a re-implementation that could drift from the library's behaviour.
 */
import { describe, expect, it } from 'vitest';
import { matchQuery } from '@tanstack/react-query';

import { SUMMARY_DAYS, qk } from './query-keys';

/** Minimal Query-shaped object `matchQuery` accepts (it reads `queryKey`). */
function queryLike(queryKey: readonly unknown[]) {
	return { queryKey, queryHash: JSON.stringify(queryKey), state: {} } as never;
}

function matches(filterKey: readonly unknown[], liveKey: readonly unknown[]): boolean {
	return matchQuery({ queryKey: filterKey as unknown[] }, queryLike(liveKey));
}

describe('attendance summary key invalidation', () => {
	it('attendanceSummaryAll() is a prefix of EVERY summary variant', () => {
		const prefix = qk.attendanceSummaryAll();
		for (const withLeaves of [false, true]) {
			expect(matches(prefix, qk.attendanceSummary(SUMMARY_DAYS, withLeaves))).toBe(true);
		}
	});

	it('the days-only key only matches its own variant — the regression this fixes', () => {
		const daysOnly = qk.attendanceSummary(SUMMARY_DAYS);
		// Sanity: it does refresh the task-feed (withLeaves:false) read...
		expect(matches(daysOnly, qk.attendanceSummary(SUMMARY_DAYS, false))).toBe(true);
		// ...but NOT the fallback history (withLeaves:true) read.
		expect(matches(daysOnly, qk.attendanceSummary(SUMMARY_DAYS, true))).toBe(false);
	});

	it('a punch write-through must invalidate with the prefix, never the days-only key', () => {
		const liveKeyShownWithoutProjects = qk.attendanceSummary(SUMMARY_DAYS, true);
		expect(matches(qk.attendanceSummaryAll(), liveKeyShownWithoutProjects)).toBe(true);
	});
});
