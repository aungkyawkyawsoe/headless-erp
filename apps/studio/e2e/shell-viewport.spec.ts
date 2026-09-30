import { test, expect } from '@playwright/test';

/**
 * The shell fills the app frame — nothing grows past the viewport.
 *
 * `App.tsx` pins the authed frame to the viewport (`100svh` — the same unit the
 * design-system chrome sizes its rail/sidebar with), and `studio.css` makes the
 * shell FILL that frame while the content column owns the scroll. Without those
 * rules a long page stretches the shell to its own content height: on `/studio`
 * the 25-row component table made `[data-slot="sidebar-wrapper"]` ~1400px tall
 * in a 900px viewport, and the `[data-slot="sidebar"]` element inside it
 * stretched with it, while every rail/sidebar/header/status-bar element stayed
 * viewport-pinned inside that taller row.
 *
 * jsdom cannot see layout, so both halves are pinned here, in the real browser:
 * the shell is exactly one viewport tall, and the inset is the scroll container
 * (the page scrolls UNDER the pinned header/status bar instead of scrolling the
 * whole app frame). API-free like the other specs: `/studio`'s component table
 * comes from the committed `studio.db` catalog via the dev server's
 * `/__studio/meta`, so it is tall with no backend.
 */
test('a long page keeps the shell one viewport tall, and the content column scrolls', async ({ page, context }) => {
	const viewport = page.viewportSize();
	if (!viewport) throw new Error('the project must pin a viewport');

	await context.addInitScript(() => {
		localStorage.setItem('studio_token', 'dev-token');
		localStorage.setItem('studio_user', JSON.stringify({ email: 'dev@mmbics.com', full_name: 'Administrator' }));
	});

	await page.goto('/#/studio');
	const wrapper = page.locator('[data-slot="sidebar-wrapper"]');
	const sidebar = page.locator('[data-slot="sidebar"]');
	const inset = page.locator('[data-slot="sidebar-inset"]');
	const statusBar = page.locator('[data-slot="status-bar"]');
	await expect(inset).toBeVisible();

	// The page must be LONGER than the viewport, or "fills the frame" holds
	// trivially and this spec would pin nothing.
	await expect.poll(() => inset.evaluate((el) => el.scrollHeight)).toBeGreaterThan(viewport.height);

	// The invariant: shell and sidebar are exactly one viewport tall — never the
	// content height.
	expect(Math.round((await wrapper.boundingBox())!.height)).toBe(viewport.height);
	expect(Math.round((await sidebar.boundingBox())!.height)).toBe(viewport.height);

	// The scroll belongs to the content column, so the chrome stays pinned while
	// the page moves under it.
	expect(await inset.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
	await inset.evaluate((el) => {
		el.scrollTop = el.scrollHeight;
	});
	await expect.poll(() => inset.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	expect(Math.round((await inset.boundingBox())!.height)).toBe(viewport.height);
	expect(Math.round((await page.locator('header').first().boundingBox())!.y)).toBe(0);
	const bar = (await statusBar.boundingBox())!;
	expect(Math.round(bar.y + bar.height)).toBe(viewport.height);
});

/**
 * The same invariant on the portal, where the rail is the extra tier: the rail,
 * the panel container, the wrapper and the inset all sit at the very top of the
 * viewport and end exactly at its bottom edge — the two-tier geometry the
 * activity-bar design relies on.
 *
 * Driven on a PANEL-BEARING section (Catalog): the landing page (`/#/idp`) has no
 * panel at all — its column listed the rail's own domains back at it and was
 * removed — so it has no container to measure. The panel-less geometry is pinned
 * in `portal-home.spec.ts`.
 */
test('the portal keeps its rail, panel and wrapper exactly one viewport tall', async ({ page, context }) => {
	const viewport = page.viewportSize();
	if (!viewport) throw new Error('the project must pin a viewport');

	await context.addInitScript(() => {
		localStorage.setItem('studio_token', 'dev-token');
		localStorage.setItem('studio_user', JSON.stringify({ email: 'dev@mmbics.com', full_name: 'Administrator' }));
	});

	await page.goto('/#/idp/catalog');
	const rail = page.locator('nav[data-slot="nav-rail"]');
	await expect(rail).toBeVisible();

	for (const selector of [
		'[data-slot="sidebar-wrapper"]',
		'nav[data-slot="nav-rail"]',
		'[data-slot="sidebar-container"]',
		'[data-slot="sidebar-inset"]',
	]) {
		const box = (await page.locator(selector).boundingBox())!;
		expect(Math.round(box.y), selector).toBe(0);
		expect(Math.round(box.height), selector).toBe(viewport.height);
	}
});

/**
 * The API reference is the ONE section that owns the whole canvas: the shell
 * renders for it WITHOUT the header row (no breadcrumbs, no fullscreen toggle)
 * and without the empty status bar, so its content column starts at the very top
 * of the viewport and ends at its bottom edge. `/#/idp` right here is the
 * control — it keeps BOTH, so this cannot pass by the chrome quietly vanishing
 * from every surface. API-free like the rest: the assertions are about the
 * shell, not about Scalar's payload (without a backend the page shows its own
 * error state inside the same column).
 */
test('the API reference section renders without the shell header and status bar', async ({ page, context }) => {
	const viewport = page.viewportSize();
	if (!viewport) throw new Error('the project must pin a viewport');

	await context.addInitScript(() => {
		localStorage.setItem('studio_token', 'dev-token');
		localStorage.setItem('studio_user', JSON.stringify({ email: 'dev@mmbics.com', full_name: 'Administrator' }));
	});

	await page.goto('/#/idp');
	await expect(page.locator('[data-slot="app-shell-header"]')).toBeVisible();
	await expect(page.locator('[data-slot="status-bar"]')).toBeVisible();

	await page.goto('/#/idp/api-docs');
	const inset = page.locator('[data-slot="sidebar-inset"]');
	await expect(inset).toBeVisible();
	await expect(page.locator('[data-slot="app-shell-header"]')).toHaveCount(0);
	await expect(page.locator('[data-slot="status-bar"]')).toHaveCount(0);
	await expect(page.locator('[data-slot="breadcrumb"]')).toHaveCount(0);
	// The rail is what is left to navigate with, so it must still be there.
	await expect(page.locator('nav[data-slot="nav-rail"]')).toBeVisible();

	// The canvas is really free, not merely empty: the content column is the
	// inset's first child — nothing sits above it — and it spans AT LEAST the
	// viewport (a short page fills the column, a long one overflows it into the
	// inset's scroll). A surviving header or status bar would leave it 76px short.
	const column = (await inset.locator('> div').first().boundingBox())!;
	expect(Math.round(column.y)).toBe(0);
	expect(column.height).toBeGreaterThanOrEqual(viewport.height);
	const insetBox = (await inset.boundingBox())!;
	expect(Math.round(insetBox.height)).toBe(viewport.height);
	expect(await inset.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
});
