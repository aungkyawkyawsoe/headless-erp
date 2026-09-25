import { describe, expect, it } from 'vitest';
import { STATUS_TONES, statusTone, toneVars } from './status';

/**
 * The status→tone map is the Single Source of Truth for every status pill; a
 * wrong tone here colours every screen wrong, so pin the cases that diverged
 * across the old per-screen maps plus the normalization + deny-by-default rule.
 */
describe('statusTone', () => {
	it('gives the SAME tone for the same status regardless of case/separator', () => {
		expect(statusTone('Rolled Back')).toBe(statusTone('rolled-back'));
		expect(statusTone('ROLLED_BACK')).toBe('danger');
		expect(statusTone('Pending Review')).toBe('warning');
	});

	it('maps the states the old maps disagreed on', () => {
		// `live` was green in one map and teal in another → ONE positive tone.
		expect(statusTone('live')).toBe('positive');
		expect(statusTone('promoted')).toBe('info');
		expect(statusTone('review')).toBe('warning');
		expect(statusTone('draft')).toBe('neutral');
		expect(statusTone('rolled_back')).toBe('danger');
		expect(statusTone('rejected')).toBe('danger');
	});

	it('covers the admin + doc + job vocabularies', () => {
		expect(statusTone('active')).toBe('positive');
		expect(statusTone('disabled')).toBe('danger');
		expect(statusTone('done')).toBe('positive');
		expect(statusTone('failed')).toBe('danger');
		expect(statusTone('cancelled')).toBe('danger');
		expect(statusTone('pass')).toBe('positive');
		expect(statusTone('fail')).toBe('danger');
		expect(statusTone('installed')).toBe('positive');
	});

	it('denies by default — an unknown/blank status is neutral, never guessed', () => {
		expect(statusTone('banana')).toBe('neutral');
		expect(statusTone('')).toBe('neutral');
		expect(statusTone(null)).toBe('neutral');
		expect(statusTone(undefined)).toBe('neutral');
	});

	it('every tone has a complete token var triple', () => {
		for (const tone of STATUS_TONES) {
			const vars = toneVars(tone);
			expect(vars.color).toBe(`var(--mmbix-tone-${tone}-fg)`);
			expect(vars.background).toBe(`var(--mmbix-tone-${tone}-bg)`);
			expect(vars.borderColor).toBe(`var(--mmbix-tone-${tone}-border)`);
		}
	});
});
