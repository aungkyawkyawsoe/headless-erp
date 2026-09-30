import { test, expect } from '@playwright/test';

/**
 * The post-login surface — signed in, `/` IS the portal.
 *
 * The app launcher grid (`AppsPage`) was deleted: a session used to land on a
 * Design-System `ModuleGrid` of module tiles and had to click through it to
 * reach anything. `/` now redirects to the portal, whose rail + panel are the
 * navigation. The sidebar's own launcher (the DS module switcher: a picker
 * button that portal-ed a full-screen `ModuleGrid` over everything) is off too,
 * because it bound the SAME ⌘K the command palette uses.
 *
 * This spec drives the REAL browser (the unit spec `App.spec.tsx` pins the route
 * table with stubbed pages) and covers what only a live DOM can show: the chrome
 * actually lays out, ⌘K opens the palette and not a launcher grid, and the
 * account menu OPENS with the moved sign-out — that menu used to throw on open
 * (`LocaleMenuItem` without a `LocaleProvider`) and blank the whole tree, which
 * no unit test sees. The menu lives in the panel footer, so it is driven on a
 * section that HAS a panel: the landing page dropped its own (it listed the
 * rail's domains back at it), which makes ⌘K the sign-out there.
 *
 * Deliberately API-free like the smoke spec: the rail and the panels render from
 * the nav registry, so the chrome assertions hold with no backend (the pages
 * behind them show their own error states). The session is seeded, not logged
 * in — login itself needs a seeded API.
 */
test('signed in, `/` is the portal and the account menu carries sign-out', async ({ page, context }) => {
	await context.addInitScript(() => {
		localStorage.setItem('studio_token', 'dev-token');
		localStorage.setItem('studio_user', JSON.stringify({ email: 'dev@mmbics.com', full_name: 'Administrator' }));
	});

	await page.goto('/');
	await expect(page).toHaveURL(/#\/idp$/);

	// Tier 1 (the rail) is on screen and Overview is the active domain. Tier 2 is
	// NOT: the landing page carries no panel — the column it used to hold listed the
	// portal's own domains, a copy of the rail one tier down. The launcher grid is
	// gone for good.
	const rail = page.locator('nav[data-slot="nav-rail"]');
	await expect(rail).toBeVisible();
	await expect(rail.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
	await expect(rail.getByRole('button', { name: 'Collections' })).toBeVisible();
	await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0);
	await expect(page.locator('input[placeholder="Search apps..."]')).toHaveCount(0);
	// The launcher's trigger left with it: no picker row on top of the panel.
	await expect(page.locator('[data-slot="sidebar-header"]')).toHaveCount(0);

	// ⌘K belongs to the app's own command palette. The DS module switcher used to
	// bind the same shortcut and covered the screen with a module grid, so this
	// pins both halves: the palette is what opens, the grid stays shut.
	await page.keyboard.press('Control+k');
	const palette = page.locator('input[placeholder="Jump to…"]');
	await expect(palette).toBeVisible();
	await expect(page.locator('input[placeholder="Search apps..."]')).toHaveCount(0);
	// The palette moves focus onto its input one frame after opening, and Esc is
	// handled by the dialog itself — waiting for the focus is what makes the Esc
	// below deterministic instead of a race against that frame.
	await expect(palette).toBeFocused();
	// On THIS page the palette is also the only sign-out: the account menu lives in
	// the panel footer, and the landing page now has no panel. ⌘K is the one path
	// that can never strand a session (the same rule the API Docs section follows).
	await expect(page.getByRole('option', { name: 'Log out' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(palette).toHaveCount(0);

	// The account menu lives in the panel footer, so it is pinned where a panel
	// exists: it OPENS, it carries the one real action, and the DS defaults' dead
	// rows (Account/Billing/Notifications) and the locale picker are not offered.
	await rail.getByRole('button', { name: 'Catalog' }).click();
	await expect(page).toHaveURL(/#\/idp\/catalog$/);
	await page.getByRole('button', { name: 'Administrator' }).click();
	const logout = page.getByRole('menuitem', { name: 'Log out' });
	await expect(logout).toBeVisible();
	await expect(page.getByRole('menuitem', { name: 'Account' })).toHaveCount(0);
	await expect(page.getByRole('menuitem', { name: 'Language' })).toHaveCount(0);

	// …and it really ends the session (no stranded sign-in).
	await logout.click();
	await expect(page.getByRole('heading', { name: /sign in to your workspace/i })).toBeVisible();
});

/**
 * Users and Roles & Access are two rail items, not one — and their panels are
 * two different KINDS.
 *
 * They used to share a single "Roles & Access" icon whose tier-2 panel held both
 * rows. Each is its own domain now — one icon, one route. Users' panel is the
 * DIRECTUS SIDEBAR: the directory's four saved views (Active Users first — the
 * default a bare URL lands on — then Suspended, Invited, All), and a click is
 * VIEW STATE, rewriting `?view=` in place (replace), so the section still owns
 * one history entry and the views never appear in the back stack. Roles &
 * Access keeps the `links` panel naming its two PAGES (User Roles / Access
 * Policies): the role registry moved onto the User Roles page itself (the table
 * IS the page, the Directus shape), so a panel enumerating roles would render
 * the same rows twice. Only the rail click proves the halves agree — the
 * registry (`lib/idp-nav.spec.ts`, pure) and `IdpShell`'s panel dispatch are
 * separate files, and the shell's own DOM is the evidence they line up.
 */
test('Users lists the directory views in its panel; Roles & Access lists its two pages', async ({ page, context }) => {
	await context.addInitScript(() => {
		localStorage.setItem('studio_token', 'dev-token');
		localStorage.setItem('studio_user', JSON.stringify({ email: 'dev@mmbics.com', full_name: 'Administrator' }));
	});

	await page.goto('/#/idp');
	const rail = page.locator('nav[data-slot="nav-rail"]');
	await expect(rail.getByRole('button', { name: 'Users' })).toBeVisible();
	await expect(rail.getByRole('button', { name: 'Roles & Access' })).toBeVisible();

	await rail.getByRole('button', { name: 'Users' }).click();
	await expect(page).toHaveURL(/#\/idp\/users$/);
	await expect(rail.getByRole('button', { name: 'Users' })).toHaveAttribute('aria-current', 'page');

	// Tier 2 is the Directus sidebar — the four saved views, in Directus's order
	// and wording. The header (and its breadcrumb) stays: the way back out below
	// `md`, where the rail is hidden.
	const panel = page.locator('[data-slot="sidebar"]');
	await expect(panel).toBeVisible();
	await expect(page.locator('[data-slot="app-shell-header"]')).toBeVisible();
	const viewRows = panel.locator('nav[aria-label="Users"]').getByRole('button');
	await expect(viewRows).toHaveCount(4);
	expect(await viewRows.allTextContents()).toEqual(['Active Users', 'Suspended Users', 'Invited Users', 'All Users']);
	// The panel is rows only — no search box of its own (the registries' search
	// boxes live in their tables, inside the content column).
	await expect(panel.locator('input')).toHaveCount(0);

	// A row is a FILTER, not a destination: the click rewrites `?view=` in place
	// and the marked row follows. Active is the bare URL (the Directus landing).
	await expect(panel.getByRole('button', { name: 'Active Users' })).toHaveAttribute('aria-current', 'true');
	await panel.getByRole('button', { name: 'Suspended Users' }).click();
	await expect(page).toHaveURL(/#\/idp\/users\?view=suspended$/);
	await expect(panel.getByRole('button', { name: 'Suspended Users' })).toHaveAttribute('aria-current', 'true');
	await expect(panel.getByRole('button', { name: 'Active Users' })).not.toHaveAttribute('aria-current', 'true');
	// Back to the default and the canonical BARE url returns — the default view
	// deletes the param rather than writing it.
	await panel.getByRole('button', { name: 'Active Users' }).click();
	await expect(page).toHaveURL(/#\/idp\/users$/);

	// Roles & Access keeps its column too, holding its two pages. The section root
	// redirects (replace — no extra history entry) to the first: User Roles.
	await rail.getByRole('button', { name: 'Roles & Access' }).click();
	await expect(page).toHaveURL(/#\/idp\/access\/roles$/);
	await expect(rail.getByRole('button', { name: 'Roles & Access' })).toHaveAttribute('aria-current', 'page');
	await expect(panel).toBeVisible();
	await expect(panel.getByRole('button', { name: 'User Roles' })).toBeVisible();
	await expect(panel.getByRole('button', { name: 'Access Policies' })).toBeVisible();
	await expect(panel.locator('input')).toHaveCount(0);

	// Control: a MULTI-page domain keeps its panel too — and its panel is NOT the
	// access one, so the assertions above cannot pass by the column appearing
	// everywhere with the same contents.
	await rail.getByRole('button', { name: 'Catalog' }).click();
	await expect(page).toHaveURL(/#\/idp\/catalog$/);
	const catalogPanel = page.locator('[data-slot="sidebar"]');
	await expect(catalogPanel).toBeVisible();
	await expect(catalogPanel.getByRole('button', { name: 'Create' })).toBeVisible();
	await expect(catalogPanel.getByRole('button', { name: 'User Roles' })).toHaveCount(0);

	// Release and Insights are not merely panel-less — they are GONE from the rail.
	// Each held a single page (Environments / Usage) and both pages were dropped
	// from the Studio, so the sections went with them: a rail item with nothing
	// behind it is the one thing this bar must never offer. The registry spec pins
	// the same removal purely.
	await expect(rail.getByRole('button', { name: 'Release' })).toHaveCount(0);
	await expect(rail.getByRole('button', { name: 'Insights' })).toHaveCount(0);
});

/**
 * A removed page is gone for real — an old bookmark cannot bring it back.
 *
 * Deployments and Audit were real routes under the Release and Insights domains;
 * when those domains' last pages (Environments, Usage) were dropped from the
 * Studio, the sections went with them. Nothing special-cases any of the four
 * paths now: they match no route, so the app-detail catch-all (`/idp/:slug`)
 * renders and reports no such app, with the rail honestly showing Catalog — the
 * ONE rule every unknown slug already followed. Pinning it here keeps a future
 * "helpful" redirect from silently resurrecting a surface the operator asked to
 * delete.
 */
test('a bookmark to a removed page reports no such app', async ({ page, context }) => {
	await context.addInitScript(() => {
		localStorage.setItem('studio_token', 'dev-token');
		localStorage.setItem('studio_user', JSON.stringify({ email: 'dev@mmbics.com', full_name: 'Administrator' }));
	});

	for (const slug of ['deployments', 'audit', 'environments', 'usage']) {
		await page.goto(`/#/idp/${slug}`);
		await expect(page.getByText('App not found')).toBeVisible();
		await expect(page.getByText(`No catalog entry matches “${slug}”.`)).toBeVisible();
		// The rail never points at a section that no longer owns this path — and the
		// sections those two pages belonged to are not offered at all.
		const rail = page.locator('nav[data-slot="nav-rail"]');
		await expect(rail.getByRole('button', { name: 'Catalog' })).toHaveAttribute('aria-current', 'page');
		await expect(rail.getByRole('button', { name: 'Release' })).toHaveCount(0);
		await expect(rail.getByRole('button', { name: 'Insights' })).toHaveCount(0);
	}
});
