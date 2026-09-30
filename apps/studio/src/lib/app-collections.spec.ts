import { describe, expect, it } from 'vitest';

import { APP_COLLECTIONS, appRequiredCollections } from './app-collections';

describe('appRequiredCollections', () => {
	it('translates each mapped app to the collections it declares, and an unmapped app to none', () => {
		for (const [id, slugs] of Object.entries(APP_COLLECTIONS)) {
			expect(appRequiredCollections([id]), `${id} → its declared slugs`).toEqual(slugs);
		}
		// The factory ships an empty map; an id no app claims must contribute
		// nothing rather than a guess ("no requirement", never "denied").
		expect(appRequiredCollections(['no-such-app'])).toEqual([]);
	});

	it('collapses collections shared by several apps to one entry, in first-seen order', () => {
		// The union/dedupe contract belongs to the FUNCTION, not to whichever
		// apps a repo ships, so stage two apps that share a collection.
		APP_COLLECTIONS.spec_a = ['spec_shared', 'spec_only_a'];
		APP_COLLECTIONS.spec_b = ['spec_shared', 'spec_only_b'];
		try {
			expect(appRequiredCollections(['spec_a', 'spec_b', 'spec_a'])).toEqual(['spec_shared', 'spec_only_a', 'spec_only_b']);
		} finally {
			delete APP_COLLECTIONS.spec_a;
			delete APP_COLLECTIONS.spec_b;
		}
	});

	it('ignores apps with no collection requirement', () => {
		expect(appRequiredCollections(['settings', 'profile'])).toEqual([]);
	});

	it('treats the unrestricted "every app" board (null/empty) as no requirement', () => {
		expect(appRequiredCollections(null)).toEqual([]);
		expect(appRequiredCollections(undefined)).toEqual([]);
		expect(appRequiredCollections([])).toEqual([]);
	});

	it('keeps every mapped app pointing at a non-empty collection list', () => {
		for (const [id, slugs] of Object.entries(APP_COLLECTIONS)) {
			expect(slugs.length, `${id} must list at least one collection`).toBeGreaterThan(0);
		}
	});
});
