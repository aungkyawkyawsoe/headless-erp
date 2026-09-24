import { describe, expect, it } from 'vitest';

import { canConfirmFill, canEditFill, fillStatusOf } from './status';

/**
 * The fluid status vocabulary — the ONE rule every surface reads. `canEditFill`
 * is the "a confirmed fill is not editable" gate; `canConfirmFill` the review
 * ladder. Pinned together so a future status can't silently widen either.
 */
describe('fillStatusOf', () => {
	it('maps the engine doc_status ladder to the three UI statuses', () => {
		expect(fillStatusOf('approved')).toBe('confirmed');
		expect(fillStatusOf('confirmed')).toBe('confirmed');
		expect(fillStatusOf('approved_l2')).toBe('confirmed');
		expect(fillStatusOf('cancelled')).toBe('cancelled');
		expect(fillStatusOf('rejected')).toBe('cancelled');
		expect(fillStatusOf('draft')).toBe('pending');
		expect(fillStatusOf('pending_review')).toBe('pending');
		expect(fillStatusOf(null)).toBe('pending');
	});
});

describe('canEditFill', () => {
	it('allows only a not-yet-posted fill to be corrected', () => {
		expect(canEditFill('draft')).toBe(true);
		expect(canEditFill('submitted')).toBe(true);
		expect(canEditFill('pending_review')).toBe(true);
		expect(canEditFill('')).toBe(true);
	});

	it('refuses a CONFIRMED (posted) or CANCELLED fill', () => {
		expect(canEditFill('approved')).toBe(false);
		expect(canEditFill('confirmed')).toBe(false);
		expect(canEditFill('approved_l1')).toBe(false);
		expect(canEditFill('cancelled')).toBe(false);
		expect(canEditFill('rejected')).toBe(false);
	});
});

describe('canConfirmFill', () => {
	it('allows every pre-approved status and refuses posted/terminal ones', () => {
		expect(canConfirmFill('draft')).toBe(true);
		expect(canConfirmFill('submitted')).toBe(true);
		expect(canConfirmFill('pending_review')).toBe(true);
		expect(canConfirmFill('')).toBe(true);
		expect(canConfirmFill('approved')).toBe(false);
		expect(canConfirmFill('cancelled')).toBe(false);
	});
});
