import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { foldPunchIntoSummary, type AttendanceSummary } from './api';

/**
 * The punch write-through contract: the server's own punch response folds into
 * EVERY cached attendance summary so the Check In / Check Out cards paint the
 * time the instant the punch resolves — no refetch round trip needed to see it
 * (the background refetch stays the source of truth, this is latency relief).
 */
function makeEntry(withLeaves: boolean, prev?: { id: string; type: 'check-in' | 'check-out'; timestamp: string }): AttendanceSummary {
	const attendance = prev ? [{ id: prev.id, type: prev.type, timestamp: prev.timestamp }] : [];
	return {
		attendance,
		leaves: withLeaves ? [{ id: 'l', status: 'approved', from_date: '', to_date: '' } as never] : [],
	};
}

describe('foldPunchIntoSummary', () => {
	it('folds the check-in punch into BOTH summary variants (shallow + withLeaves)', () => {
		const qc = new QueryClient();
		qc.setQueryData<AttendanceSummary>(['hr', 'attendance', 'summary', 4, false], makeEntry(false));
		qc.setQueryData<AttendanceSummary>(
			['hr', 'attendance', 'summary', 4, true],
			makeEntry(true, { id: 'd1', type: 'check-out', timestamp: 'yesterday' }),
		);

		foldPunchIntoSummary(qc, { id: 'd2', type: 'check-in', timestamp: '2026-09-14T02:30:00.000Z', shift_id: 's1' });

		expect(qc.getQueryData<AttendanceSummary>(['hr', 'attendance', 'summary', 4, false])?.attendance).toEqual([
			{ id: 'd2', type: 'check-in', timestamp: '2026-09-14T02:30:00.000Z', shift_id: 's1' },
		]);
		const deep = qc.getQueryData<AttendanceSummary>(['hr', 'attendance', 'summary', 4, true]);
		// The deep variant keeps its leaves and the OLD punch — the fold appends,
		// it never rewrites entries the server hasn't touched.
		expect(deep?.leaves).toHaveLength(1);
		expect(deep?.attendance.map((r) => r.id)).toEqual(['d2', 'd1']);
	});

	it('replaces an old copy of the same punch (check-out stamps over the draft)', () => {
		const qc = new QueryClient();
		qc.setQueryData<AttendanceSummary>(['hr', 'attendance', 'summary', 4, false], {
			attendance: [
				{ id: 'd1', type: 'check-in', timestamp: 'in' },
				{ id: 'd1', type: 'check-out', timestamp: 'stale-draft' },
			],
			leaves: [],
		});

		foldPunchIntoSummary(qc, { id: 'd1', type: 'check-out', timestamp: 'checked-out-time' });

		const rows = qc.getQueryData<AttendanceSummary>(['hr', 'attendance', 'summary', 4, false])?.attendance ?? [];
		expect(rows).toEqual([
			{ id: 'd1', type: 'check-out', timestamp: 'checked-out-time', shift_id: null },
			{ id: 'd1', type: 'check-in', timestamp: 'in' },
		]);
	});

	it('is a no-op when there is no cached summary (empty cache stays empty, unpainted)', () => {
		const qc = new QueryClient();
		expect(() => foldPunchIntoSummary(qc, { id: 'd', type: 'check-in', timestamp: 't' })).not.toThrow();
		expect(qc.getQueryData(['hr', 'attendance', 'summary', 4, false])).toBeUndefined();
	});

	it('is a no-op without a server-timestamped punch (the server owns the time)', () => {
		const qc = new QueryClient();
		qc.setQueryData<AttendanceSummary>(['hr', 'attendance', 'summary', 4, false], makeEntry(false));
		foldPunchIntoSummary(qc, { id: 'd', type: 'check-in', timestamp: null });
		expect(qc.getQueryData<AttendanceSummary>(['hr', 'attendance', 'summary', 4, false])?.attendance).toEqual([]);
	});
});
