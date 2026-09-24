import { describe, expect, it } from 'vitest';

import { URL_PARAM, enumParam, pageParam, searchParam, stringListParam, stringParam } from './url-state';

/** The tgapp URL view-state contract — pins the shared vocabulary so a new
 *  screen cannot drift into `?store=`/`?view=`/camelCase spellings again. */
describe('url-state contract', () => {
	it('keeps every key lowercase snake_case and unique', () => {
		const keys = Object.values(URL_PARAM);
		for (const key of keys) expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('carries the canonical spelling for each concept', () => {
		expect(URL_PARAM).toMatchObject({
			search: 'q',
			page: 'page',
			tab: 'tab',
			status: 'status',
			type: 'type',
			location: 'location',
			requestRef: 'request_ref',
		});
	});

	it('omits default values from the URL', () => {
		expect(searchParam.defaultValue).toBe('');
		expect(pageParam.defaultValue).toBe(0);
		expect(stringListParam.defaultValue).toEqual([]);
		// A free-string context id has NO default — nuqs yields `null` when absent.
		expect('defaultValue' in stringParam).toBe(false);
	});

	it('enumParam accepts known values and falls back on anything else', () => {
		const param = enumParam(['all', 'reorder', 'out'] as const, 'reorder');
		expect(param.parse('out')).toBe('out');
		expect(param.defaultValue).toBe('reorder');
		// An unknown / empty value resolves to the fallback (via parse or default).
		expect(param.parse('nope') ?? param.defaultValue).toBe('reorder');
		expect(param.parse('') ?? param.defaultValue).toBe('reorder');
	});
});
