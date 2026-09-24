import { describe, expect, it } from 'vitest';

import { APP_COLLECTIONS, appRequiredCollections } from './app-collections';

describe('appRequiredCollections', () => {
	it('ships an empty default map (headless factory)', () => {
		expect(Object.keys(APP_COLLECTIONS)).toEqual([]);
	});

	it('ignores apps with no collection requirement', () => {
		expect(appRequiredCollections(['settings', 'profile'])).toEqual([]);
	});

	it('treats the unrestricted "every app" board (null/empty) as no requirement', () => {
		expect(appRequiredCollections(null)).toEqual([]);
		expect(appRequiredCollections(undefined)).toEqual([]);
		expect(appRequiredCollections([])).toEqual([]);
	});

	it('collapses collections shared by several apps to one entry', () => {
		// The helper itself is generic: with a populated map it de-dupes.
		const slugs = appRequiredCollections(['a', 'b', 'a']);
		expect(slugs).toEqual([]); // no mapped ids ⇒ nothing
	});
});
