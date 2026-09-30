/**
 * The user directory's views — the ONE list the panel, the toolbar toggle and
 * the empty state derive from (pure; the URL wiring is pinned in the DOM specs,
 * `components/idp/ViewsPanel.spec.tsx` and `components/admin/users-tab.spec.tsx`).
 */
import { describe, expect, it } from 'vitest';
import { resolveUserView, USER_VIEWS } from './user-view';

describe('USER_VIEWS', () => {
	it("is Directus's list, in Directus's order — Active first (the landing), All last", () => {
		// The order is load-bearing: `resolveUserView` defaults to the FIRST entry,
		// and Directus lands on `/admin/users` = Active Users.
		expect(USER_VIEWS.map((v) => v.id)).toEqual(['active', 'suspended', 'invited', 'all']);
		expect(USER_VIEWS.map((v) => v.label)).toEqual(['Active Users', 'Suspended Users', 'Invited Users', 'All Users']);
	});

	it('gives every view an icon — the panel rows are icon-labelled, like Directus', () => {
		for (const v of USER_VIEWS) expect(v.icon).toBeTruthy();
	});

	it('offers exactly the stored states, plus `all` — never `unknown`', () => {
		// `unknown` is what a row WITHOUT a stored status reads as; it is not a
		// state anyone chooses, so it is not a view (those rows live in All).
		const ids = USER_VIEWS.map((v) => v.id);
		expect(ids.filter((id) => id !== 'all')).toEqual(['active', 'suspended', 'invited']);
		expect(ids).not.toContain('unknown');
	});
});

describe('resolveUserView', () => {
	it('returns a declared view unchanged', () => {
		for (const v of USER_VIEWS) expect(resolveUserView(v.id)).toBe(v.id);
	});

	it('reads an absent, empty or out-of-vocabulary value as the default', () => {
		// A pasted `?view=banana` (or none at all) must never leave the table in a
		// "no view" state — the default is Active, the Directus landing.
		expect(resolveUserView(null)).toBe('active');
		expect(resolveUserView(undefined)).toBe('active');
		expect(resolveUserView('')).toBe('active');
		expect(resolveUserView('banana')).toBe('active');
	});
});
