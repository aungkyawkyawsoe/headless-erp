import { defineConfig, devices } from '@playwright/test';

/**
 * Studio E2E (Playwright).
 *
 * Boots the Studio dev server and drives the real DOM in a browser. The smoke
 * spec asserts the login shell renders — a full-flow suite (login → schema edit
 * → save) needs a seeded API and is the next step.
 *
 * First run needs a browser: `npx playwright install chromium`.
 */
export default defineConfig({
	testDir: './e2e',
	timeout: 30_000,
	fullyParallel: true,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: 'http://localhost:5174',
		trace: 'on-first-retry',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'pnpm dev',
		url: 'http://localhost:5174',
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
	},
});
