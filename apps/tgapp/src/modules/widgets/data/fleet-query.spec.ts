import { describe, expect, it } from 'vitest';

import { fleetWidgetQuery } from './api';

/**
 * The board's fleet read is a BATCH spec, and the SDK accepts a `URLSearchParams`
 * (or a params record) — never a serialized string. That distinction is not
 * cosmetic: given a string the SDK finds no enumerable string values, so it
 * forwards one junk parameter per CHARACTER and then falls back to the default
 * page size. The read still succeeds, which is what made it invisible — the board
 * silently counted the first 25 vehicles with NO field projection, so the
 * document pointers came back as bare ids and the License/Insurance cells read a
 * permanent 0 while every register showed the real state.
 */
describe('fleetWidgetQuery — the contract the batch read depends on', () => {
	it('is a URLSearchParams instance, not a serialized string', () => {
		const query = fleetWidgetQuery();
		expect(query).toBeInstanceOf(URLSearchParams);
		expect(typeof query).not.toBe('string');
	});

	it('projects the document POINTERS the alert cells count (dotted paths included)', () => {
		const fields = (fleetWidgetQuery().get('fields') ?? '').split(',');
		// License/Insurance cells read these two; without them both read 0 forever.
		expect(fields).toContain('last_license.expiry_date');
		expect(fields).toContain('last_insurance.expiry_date');
		// The care scalars the Oil cell reads.
		expect(fields).toContain('last_odo');
		expect(fields).toContain('last_engine_oil');
		expect(fields).toContain('last_gear_oil');
	});

	it('asks for a full page of vehicles, not the 25-row default', () => {
		expect(fleetWidgetQuery().get('limit')).toBe('100');
		expect(fleetWidgetQuery().get('sort')).toBe('plate_no');
	});
});
