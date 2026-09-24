import { describe, expect, it } from 'vitest';

import { englishDateLabel, remainingLabel } from './remaining-days-pill';

/**
 * The shared copy behind the insurance/license pills — the two modules used to
 * carry byte-identical private copies. Pinned so the wording can only change in
 * one place.
 */
describe('remainingLabel', () => {
	it('handles no date / overdue / due today / singular / plural', () => {
		expect(remainingLabel(null)).toBe('No date');
		expect(remainingLabel(-3)).toBe('Overdue');
		expect(remainingLabel(0)).toBe('Due today');
		expect(remainingLabel(1)).toBe('1 day');
		expect(remainingLabel(214)).toBe('214 days');
	});
});

describe('englishDateLabel', () => {
	it('formats YYYY-MM-DD in English, UTC-safely, and handles null', () => {
		expect(englishDateLabel('2026-09-30')).toBe('Sep 30, 2026');
		expect(englishDateLabel('2026-01-01')).toBe('Jan 1, 2026');
		expect(englishDateLabel(null)).toBe('—');
	});
});
