import { describe, expect, it } from 'vitest';

import { isNewestRecord } from './newest';

/**
 * The shared "only the newest record is editable" rule — the head of a
 * newest-first history feed is the current record. Pins the wiring so an edit
 * action can never appear on (or a screen accept) a historical row.
 */
describe('isNewestRecord', () => {
	const rows = [{ id: 'b' }, { id: 'a' }];

	it('accepts the head of the feed', () => {
		expect(isNewestRecord(rows, 'b')).toBe(true);
	});

	it('rejects a historical row', () => {
		expect(isNewestRecord(rows, 'a')).toBe(false);
	});

	it('rejects a blank/absent id and an empty feed', () => {
		expect(isNewestRecord(rows, null)).toBe(false);
		expect(isNewestRecord(rows, '')).toBe(false);
		expect(isNewestRecord([], 'b')).toBe(false);
	});
});
