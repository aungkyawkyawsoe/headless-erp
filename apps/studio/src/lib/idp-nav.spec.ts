/**
 * The IDP nav registry — pure helpers.
 *
 * These pin the contract the rail and the panels rely on: every route in the
 * portal resolves to exactly ONE section (so the rail always has one active
 * item), the root never swallows an app-detail page, and no two sections claim
 * the same route.
 */
import { describe, expect, it } from 'vitest';
import { IDP_SECTIONS, activeSectionForPath, visibleSections } from './idp-nav';

describe('registry integrity', () => {
	it('has unique ids and unique route ownership', () => {
		const ids = IDP_SECTIONS.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);

		const matches = IDP_SECTIONS.flatMap((s) => s.match);
		expect(new Set(matches).size).toBe(matches.length);
	});

	it('makes every section reachable — its `path` is one of its own routes', () => {
		for (const s of IDP_SECTIONS) expect(s.match).toContain(s.path);
	});

	it('keeps the rail bounded (Miller: 7±2 domains)', () => {
		expect(IDP_SECTIONS.length).toBeLessThanOrEqual(9);
	});

	it('gives Overview no panel — the rail is already the directory', () => {
		const overview = IDP_SECTIONS.find((s) => s.id === 'overview');

		// The panel here used to list the portal's own domains — the RAIL's list one
		// tier down (the rail labels every icon in a tooltip). A copy of tier 1 is not
		// information, so the landing page keeps the canvas (its scorecard) instead.
		expect(overview?.panel.kind).toBe('none');
		expect(overview?.match).toEqual(['/idp']);
	});

	it('gives Users and Roles & Access one rail item each — no shared two-row panel', () => {
		const users = IDP_SECTIONS.find((s) => s.id === 'users');
		const access = IDP_SECTIONS.find((s) => s.id === 'access');

		expect(users?.label).toBe('Users');
		expect(access?.label).toBe('Roles & Access');
		// Users owns exactly its own route; Roles & Access owns its section root AND
		// the two pages beneath it (the root redirects to the first page).
		expect(users?.match).toEqual(['/idp/users']);
		expect(access?.match).toEqual(['/idp/access', '/idp/access/roles', '/idp/access/policies']);
		// The access panel is the section's two PAGES — not the roles themselves.
		// The registry moved onto the User Roles page (the table IS the page, the
		// Directus shape), so a panel enumerating roles would render the same rows
		// twice; the panel names destinations, the page lists entities.
		expect(access?.panel).toMatchObject({
			kind: 'links',
			items: [{ label: 'User Roles' }, { label: 'Access Policies' }],
		});
		// Users DOES have a panel — the directory's saved VIEWS (Directus's
		// sidebar: Active / Suspended / Invited / All — `USER_VIEWS`,
		// `lib/user-view.ts`), because the section has something to enumerate
		// after all: not pages, but the views themselves. The rows are view state
		// (`?view=` — replace), which is why this kind carries no items payload.
		expect(users?.panel.kind).toBe('views');
	});
});

describe('activeSectionForPath', () => {
	it('resolves the portal root to Overview', () => {
		expect(activeSectionForPath('/idp').id).toBe('overview');
		expect(activeSectionForPath('/idp/').id).toBe('overview');
	});

	it('resolves every declared route to its own section', () => {
		expect(activeSectionForPath('/idp/catalog').id).toBe('catalog');
		expect(activeSectionForPath('/idp/create').id).toBe('catalog');
		expect(activeSectionForPath('/idp/collections').id).toBe('collections');
		expect(activeSectionForPath('/idp/access').id).toBe('access');
		expect(activeSectionForPath('/idp/access/roles').id).toBe('access');
		expect(activeSectionForPath('/idp/access/policies').id).toBe('access');
		expect(activeSectionForPath('/idp/users').id).toBe('users');
		expect(activeSectionForPath('/idp/policies').id).toBe('governance');
		expect(activeSectionForPath('/idp/api-docs').id).toBe('api-docs');
	});

	it('has no Release or Insights section — their one page each went, so the domain did too', () => {
		// Release held Environments (Deployments went first); Insights held Usage
		// (Audit went first). When the operator dropped the LAST page of each, a
		// section with no page behind it could only render a rail item that lands
		// nowhere — so the sections went with them, and the rail is 7 domains.
		expect(IDP_SECTIONS.map((s) => s.id)).not.toContain('release');
		expect(IDP_SECTIONS.map((s) => s.id)).not.toContain('insights');
	});

	it('keeps a deeper path in its section (longest match wins)', () => {
		expect(activeSectionForPath('/idp/collections/orders').id).toBe('collections');
	});

	it('falls back to Catalog for an app-detail page — the root does not swallow `/idp/:slug`', () => {
		expect(activeSectionForPath('/idp/my-app').id).toBe('catalog');
		expect(activeSectionForPath('/idp/hr/extra').id).toBe('catalog');
	});

	it('drops a bookmark to a removed page into the same app-detail lane', () => {
		// All four removed Studio pages are gone the same way. They are not
		// special-cased into a redirect — they match no section and no route, so the
		// app-detail catch-all (`/idp/:slug`) takes them and reports no such app,
		// with the rail honestly showing Catalog. One rule for every unknown slug.
		for (const slug of ['deployments', 'audit', 'environments', 'usage']) {
			expect(activeSectionForPath(`/idp/${slug}`).id).toBe('catalog');
		}
	});

	it('tolerates a hash/query suffix and a trailing slash', () => {
		expect(activeSectionForPath('/idp/access?role=abc').id).toBe('access');
		expect(activeSectionForPath('/idp/collections/orders/').id).toBe('collections');
	});

	it('is total — anything outside the portal, or nothing at all, is Overview', () => {
		expect(activeSectionForPath('/apps/orders').id).toBe('overview');
		expect(activeSectionForPath('/').id).toBe('overview');
		expect(activeSectionForPath(undefined).id).toBe('overview');
		expect(activeSectionForPath(null).id).toBe('overview');
		expect(activeSectionForPath('').id).toBe('overview');
	});
});

describe('visibleSections', () => {
	it('shows every section to an admin', () => {
		expect(visibleSections(true)).toEqual(IDP_SECTIONS);
	});

	it('never shows an admin-only section to a non-admin', () => {
		const visible = visibleSections(false);
		expect(visible.every((s) => !s.adminOnly)).toBe(true);
		expect(visible.map((s) => s.id)).toContain('overview');
	});
});
