import { describe, expect, it } from 'vitest';

import { APP_COLLECTIONS, appRequiredCollections } from './app-collections';

describe('appRequiredCollections', () => {
	it('maps a known app to the collections it reads', () => {
		expect(appRequiredCollections(['projects'])).toEqual(['hrm_projects', 'hrm_tasks']);
	});

	it('collapses collections shared by several apps to one entry', () => {
		// attendance → hrm_attendances, projects → hrm_projects + hrm_tasks.
		const slugs = appRequiredCollections(['attendance', 'projects', 'attendance']);
		expect(slugs).toEqual(['hrm_attendances', 'hrm_projects', 'hrm_tasks']);
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
