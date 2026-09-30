import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

/**
 * ONE table everywhere — the shared `DataTable` chrome, verified in a real DOM.
 *
 * The Collections workbench set the shape (a toolbar with the search box, the
 * Create action, column layout, pagination). Every OTHER registry surface used to
 * hand-roll its own `<Table>` markup, so the chrome drifted from surface to
 * surface: two search inputs, two empty states, two ideas of a bulk action. They
 * all render through the design system's `DataTable` now, and this spec pins that
 * where jsdom cannot look — a laid-out DOM.
 *
 * The session is SEEDED rather than logged in (login itself needs a seeded API),
 * and the assertions are about CHROME, so a local API that happens to hold no
 * rows still satisfies them.
 */
async function seedSession(context: BrowserContext) {
	await context.addInitScript(() => {
		localStorage.setItem('studio_token', 'dev-token');
		localStorage.setItem('studio_user', JSON.stringify({ email: 'dev@mmbics.com', full_name: 'Administrator' }));
	});
}

/**
 * Assert a surface renders THE shared table: its container, the toolbar's search
 * box (labelled by the surface, owned by the table) and a real header row. A
 * hand-rolled `<table>` has none of those slots, so this is the shape itself, not
 * a coincidence of markup.
 */
async function sharedTable(page: Page, searchLabel: string): Promise<Locator> {
	const table = page.locator('[data-slot="datatable"]').first();
	await expect(table).toBeVisible();
	await expect(table.locator('input[type="search"]')).toHaveAttribute('aria-label', searchLabel);
	await expect(table.locator('[data-slot="datatable-header-cell"]').first()).toBeVisible();
	return table;
}

/**
 * Assert NOTHING sits above the table: below the shell's pinned header there is
 * only breathing room, never a band of chrome. jsdom cannot see this — it is the
 * chrome question ("is there still a title row or a card above the table?")
 * answered by geometry. Measured live at 32px: the header's 4px gap + the content
 * column's own 16px padding + the page's 12px. A re-added title row, count line
 * or preamble card adds its own height (≥30px) on top, so the ceiling sits well
 * below one — the two copy assertions above catch a re-added LINE, this catches
 * a re-added BLOCK of any content.
 */
async function tableStartsAtTheTop(page: Page, toolbar: Locator) {
	const header = (await page.locator('[data-slot="app-shell-header"]').boundingBox())!;
	const y = (await toolbar.boundingBox())!.y;
	expect(y - (header.y + header.height)).toBeLessThan(45);
}

test('the Users surface renders the shared table, toolbar and all', async ({ page, context }) => {
	await seedSession(context);
	await page.goto('/#/idp/users');

	const table = await sharedTable(page, 'Search users');
	// The toolbar is the WHOLE top of this surface: the search box and the Create
	// action both live in it now.
	const toolbar = table.locator('[data-slot="datatable-toolbar"]');
	await expect(toolbar.getByRole('button', { name: 'New user' })).toBeVisible();
	await expect(toolbar.locator('input[type="search"]')).toBeVisible();

	// The lifecycle views are NOT here — they are the section's PANEL now (tier
	// 2, the Directus sidebar; pinned in `portal-home.spec.ts`). A copy in the
	// toolbar would be the same `?view=` filter drawn twice.
	await expect(toolbar.locator('[data-slot="toggle-group"]')).toHaveCount(0);

	// …and nothing sits above it: the title row and the preamble paragraph that used
	// to repeat the count and explain the screen are gone (the count rides the
	// table's own pagination).
	await expect(page.getByText('Every account that can sign in')).toHaveCount(0);
	await tableStartsAtTheTop(page, toolbar);
});

test("the user editor is the whole surface — the role form's own chrome", async ({ page, context }) => {
	await seedSession(context);
	await page.goto('/#/idp/users');

	// A real row opens the editor (the registry comes from the API, like the
	// role-gated Create action above).
	const row = page.locator('[data-slot="datatable-row"]').first();
	await expect(row).toBeVisible();
	await row.getByRole('button', { name: /^edit /i }).click();

	// The form carries its own Directus-style header — the title + the circular
	// ✓/✕ — so the shell's crumb row is dropped while it is open, the exact rule
	// the Roles & Access pages set.
	await expect(page.locator('[data-slot="app-shell-header"]')).toHaveCount(0);
	const editor = page.getByRole('region', { name: /edit user/i });
	await expect(editor).toBeVisible();
	await expect(editor.getByRole('button', { name: 'Save' })).toBeVisible();
	await expect(editor.getByRole('button', { name: 'Close' })).toBeVisible();

	// The ✕ is the way out, and the shell header comes back with the list.
	await editor.getByRole('button', { name: 'Close' }).click();
	await expect(page.locator('[data-slot="app-shell-header"]')).toBeVisible();
	await expect(page.locator('[data-slot="datatable-row"]').first()).toBeVisible();
});

test('the Access Policies matrix is that same table', async ({ page, context }) => {
	await seedSession(context);
	await page.goto('/#/idp/access/policies');

	// The page opens on its TABLE — the policy registry, one row per role (the
	// engine's policy for it). Nothing else is up before a pick.
	const registry = page.locator('[data-slot="datatable"]').first();
	await expect(registry).toBeVisible();
	await expect(registry.locator('[data-slot="datatable-header-cell"]').first()).toBeVisible();

	// Clicking a row opens that policy's form, and the matrix IS the shared table.
	// Target a REAL row (`data-slot="datatable-row"`): while the read is in
	// flight the table renders skeleton `<tr>`s that carry no row handler, so
	// clicking "the first tr" would be a no-op race.
	await registry.locator('[data-slot="datatable-row"]').first().click();

	// The edit form replaces the shell's crumb row — no breadcrumbs, no
	// fullscreen toggle; the form carries its own Directus-style header.
	await expect(page.locator('[data-slot="app-shell-header"]')).toHaveCount(0);

	const table = await sharedTable(page, 'Filter collections');
	// The editor IS this table: the view switch and the bulk ops share its toolbar
	// row with the search box.
	const toolbar = table.locator('[data-slot="datatable-toolbar"]');
	const collections = toolbar.getByRole('button', { name: 'Collections' });
	await expect(collections).toBeVisible();
	// The switch is ICON-ONLY — the name rides aria-label + title, not a label.
	await expect(collections).toHaveText('');
	await expect(collections).toHaveAttribute('title', 'Per-collection flags');
	await expect(toolbar.getByRole('button', { name: 'Read all' })).toBeVisible();
	// …and the toolbar states no counts: the rows on screen are the count.
	await expect(page.getByText(/\d+ collections/)).toHaveCount(0);
	// ONE Save for the whole matrix — it rides the FORM header (a circular
	// check), never the toolbar.
	await expect(toolbar.getByRole('button', { name: 'Save' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();

	// Whichever view is up renders through the same component.
	const apps = toolbar.getByRole('button', { name: 'Apps' });
	await expect(apps).toBeVisible();
	await expect(apps).toHaveText('');
	await apps.click();
	await expect(table.locator('input[type="search"]')).toHaveAttribute('aria-label', 'Filter apps');
	// The SAME header Save is up in the board view — one action for both halves.
	await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
});

test('Studio Admin renders its tabs through the same table', async ({ page, context }) => {
	await seedSession(context);
	await page.goto('/#/studio');

	// The admin tabs are the sidebar's nav items (the shell owns the navigation).
	const sidebar = page.locator('[data-slot="sidebar"]');

	// Add-ons: the catalog table with the shared search box.
	await sidebar.getByRole('link', { name: 'Add-ons' }).click();
	await sharedTable(page, 'Search add-ons');

	// Operations: the declared jobs — the table a silently-stopped job hides in.
	await sidebar.getByRole('link', { name: 'Operations' }).click();
	await sharedTable(page, 'Search jobs');
});

/**
 * ONE field grid across the Directus-chrome editors — the users editor set the
 * 2-column shape and the role profile wears the same one, so the two forms read
 * as ONE design language. jsdom cannot see layout, so the contract is pinned
 * with geometry: two equal columns side by side, and the SAME columns (the same
 * x) in both editors — "the same grid" is literal.
 */
test('the user editor and the role profile share one two-column field grid', async ({ page, context }) => {
	await seedSession(context);

	// The user editor, opened from a real row's Edit action (never the skeleton
	// `<tr>`s — they carry no handler, a click race found live).
	await page.goto('/#/idp/users');
	const userRow = page.locator('[data-slot="datatable-row"]').first();
	await expect(userRow).toBeVisible();
	await userRow.getByRole('button', { name: /^edit /i }).click();
	const editor = page.getByRole('region', { name: /edit user/i });
	await expect(editor).toBeVisible();

	const email = (await editor.getByLabel('Email').boundingBox())!;
	const fullName = (await editor.getByLabel('Full name').boundingBox())!;
	// Same row, side by side, equal columns.
	expect(Math.abs(email.y - fullName.y)).toBeLessThan(6);
	expect(fullName.x).toBeGreaterThanOrEqual(email.x + email.width);
	expect(Math.abs(email.width - fullName.width)).toBeLessThan(2);

	// The role profile, opened from a role row.
	await page.goto('/#/idp/access/roles');
	const roleRow = page.locator('[data-slot="datatable-row"]').first();
	await expect(roleRow).toBeVisible();
	await roleRow.click();

	const roleName = (await page.getByPlaceholder('e.g. Storekeeper').boundingBox())!;
	const description = (await page.getByPlaceholder('A description of this role...').boundingBox())!;
	expect(Math.abs(roleName.y - description.y)).toBeLessThan(6);
	expect(description.x).toBeGreaterThanOrEqual(roleName.x + roleName.width);
	expect(Math.abs(roleName.width - description.width)).toBeLessThan(2);

	// …and they are the SAME columns: both editors pad the same container, so the
	// role profile's left column starts where the user editor's does.
	expect(Math.abs(roleName.x - email.x)).toBeLessThan(2);
	expect(Math.abs(description.x - fullName.x)).toBeLessThan(2);
});
