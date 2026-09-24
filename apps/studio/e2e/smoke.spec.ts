import { test, expect } from '@playwright/test';

/**
 * Smoke — the Studio shell loads and shows the sign-in surface.
 *
 * Deliberately API-free: it proves the SPA boots, routes, and paints before any
 * backend is involved, so a broken build/config fails fast in CI.
 */
test('login screen renders', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: /sign in to your workspace/i })).toBeVisible();
	await expect(page.getByPlaceholder('admin@my.co')).toBeVisible();
	await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
});
