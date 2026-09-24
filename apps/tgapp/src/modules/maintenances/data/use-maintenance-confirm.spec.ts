import { describe, expect, it } from 'vitest';

import { friendlyConfirmError } from './use-maintenance-confirm';

describe('friendlyConfirmError', () => {
	it('turns the status-transition jargon into "already final" copy', () => {
		expect(friendlyConfirmError(new Error('Cannot transition from "draft" to "confirmed"'))).toContain('already be final');
		expect(friendlyConfirmError(new Error('Invalid doc_status: "confirmed"'))).toContain('already be final');
	});

	it('turns the freeze jargon into "already confirmed and locked" copy', () => {
		expect(
			friendlyConfirmError(
				new Error('"veh_maintenance_logs" rows in state "confirmed" are frozen — reverse or amend them through their domain service'),
			),
		).toContain('already confirmed and locked');
	});

	it('keeps any other actionable message verbatim, trims blank ones', () => {
		expect(friendlyConfirmError(new TypeError('network down'))).toBe('network down');
		expect(friendlyConfirmError(new Error('   '))).toBe('Could not confirm — try again.');
		expect(friendlyConfirmError(null)).toBe('Could not confirm — try again.');
	});
});
