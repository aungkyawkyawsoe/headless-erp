import { describe, expect, it } from 'vitest';

import { formatDate } from './format';

/**
 * The picker/field date formats. The rule the `ORDERED_PATTERNS` table exists for: an
 * app that asks for `d MMM y` gets the DAY FIRST, whatever its locale would order the
 * parts in (`en-US` says “Jul 15, 2026” for the same fields) — that is the whole point
 * of the pattern, and handing it to `Intl` alone could not express it.
 */
describe('formatDate', () => {
	const JULY_15 = new Date(2026, 6, 15);

	it('orders `d MMM y` day-first, in the caller’s locale wording', () => {
		expect(formatDate(JULY_15, 'd MMM y', 'en-US')).toBe('15 Jul 2026');
		expect(formatDate(JULY_15, 'd MMM y', 'en-GB')).toBe('15 Jul 2026');
	});

	it('keeps the long localized form for `PPP`, unaffected by the ordered table', () => {
		expect(formatDate(JULY_15, 'PPP', 'en-US')).toBe('July 15, 2026');
	});

	it('still falls back to a medium date for an unknown pattern', () => {
		expect(formatDate(JULY_15, 'whatever', 'en-US')).toBe('Jul 15, 2026');
	});
});
