import { describe, expect, it } from 'vitest';

import { rejectOdoReading, type OdoReadingDraft } from './reading-guard';

/**
 * The Daily ODO record form's admission rule: a reading may not be dated before
 * the vehicle's last reading, nor its km sit below that reading's. These pin the
 * rule so the form can never append an entry the newest-date board would hide.
 */

const LAST = { lastOdo: 23_500, lastDate: '2026-09-12' } as const;

const draft = (over: Partial<OdoReadingDraft>): OdoReadingDraft => ({ date: '2026-09-15', odo: '23500', ...LAST, ...over });

describe('rejectOdoReading — append-only readings', () => {
	it('accepts a later date at or above the last km', () => {
		expect(rejectOdoReading(draft({ date: '2026-09-15', odo: '24000' }))).toBeNull();
	});

	it('accepts the SAME date with a higher km (a later reading that day)', () => {
		expect(rejectOdoReading(draft({ date: '2026-09-12', odo: '23600' }))).toBeNull();
	});

	it('rejects a back date — the reported bug', () => {
		expect(rejectOdoReading(draft({ date: '2026-09-02', odo: '24000' }))).toBe('before-last-date');
	});

	it('rejects km below the last reading even on a later date', () => {
		expect(rejectOdoReading(draft({ date: '2026-09-15', odo: '23000' }))).toBe('below-last-odo');
	});

	it('reports the back date BEFORE the km issue when both are wrong', () => {
		expect(rejectOdoReading(draft({ date: '2026-09-02', odo: '1000' }))).toBe('before-last-date');
	});

	it('requires a date and a km', () => {
		expect(rejectOdoReading(draft({ date: '' }))).toBe('missing-date');
		expect(rejectOdoReading(draft({ odo: '' }))).toBe('missing-odo');
	});

	it('rejects a negative or non-numeric km', () => {
		expect(rejectOdoReading(draft({ odo: '-5' }))).toBe('invalid-odo');
		expect(rejectOdoReading(draft({ odo: 'abc' }))).toBe('invalid-odo');
	});

	it('has no floor when the vehicle has no reading yet', () => {
		expect(rejectOdoReading({ date: '2026-09-15', odo: '1', lastOdo: null, lastDate: null })).toBeNull();
	});
});

describe('rejectOdoReading — the correction floor is the PREVIOUS reading', () => {
	// The newest reading (23,500) is corrected with the reading BEFORE it
	// (22,800 · 10 Sep) as the floor: the corrected number may sit BELOW its own
	// old value (the point of a correction) but never below the one before it.
	const prev = { lastOdo: 22_800, lastDate: '2026-09-10' } as const;

	it('allows a corrected value below its own old number', () => {
		expect(rejectOdoReading({ date: '2026-09-12', odo: '23000', ...prev })).toBeNull();
	});

	it('rejects a corrected value below the previous reading', () => {
		expect(rejectOdoReading({ date: '2026-09-12', odo: '22700', ...prev })).toBe('below-last-odo');
	});
});
