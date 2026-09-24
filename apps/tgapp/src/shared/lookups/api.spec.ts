import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The `hrm_employees` list the lookup issues — captured to pin the WIRE query. */
const { list } = vi.hoisted(() => ({
	list: vi.fn(async (_query?: Record<string, unknown>) => ({ data: [], meta: {} })),
}));

vi.mock('@/shared/api/sdk', () => ({ sdk: { items: () => ({ list }) } }));

import { searchEmployees } from './api';

/**
 * The driver narrowing is a SERVER-side nested relation filter — the picker must
 * not walk the 200+ person directory, nor client-filter a truncated page (a
 * driver further down the alphabetical list would silently vanish). Pinned at the
 * wire level: the filter reaches the engine, and a whole-directory search stays
 * unfiltered.
 */
describe('searchEmployees — the designation narrowing', () => {
	beforeEach(() => list.mockClear());

	it('adds a nested `designation.name` filter when narrowing to drivers', async () => {
		await searchEmployees('aung', { designationContains: 'driver' });

		expect(list.mock.calls[0][0]).toMatchObject({
			search: 'aung',
			filter: { designation: { name: { _icontains: 'driver' } } },
		});
	});

	it('omits the filter for a whole-directory search (crew / holder fields)', async () => {
		await searchEmployees('aung');

		expect(list.mock.calls[0][0]).not.toHaveProperty('filter');
	});
});
