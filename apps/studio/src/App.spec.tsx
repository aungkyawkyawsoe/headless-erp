// @vitest-environment jsdom
/**
 * App routing — signed in, `/` IS the portal.
 *
 * The app launcher grid (`pages/AppsPage.tsx`) was deleted: `/` used to render a
 * Design-System `ModuleGrid` of module tiles, and a session had to click through
 * it to reach anything. The contract now is the redirect in `App.tsx`
 * (`<Navigate to="/idp" replace />`), pinned here because it is the ONE thing
 * every signed-in session goes through — a regression would silently bring the
 * grid back, or land a deep link on a blank route.
 *
 * The destination pages are STUBBED: this asserts the route TABLE (which surface
 * a path renders), not the portal's own reads — those have their own specs.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./lib/api', async (importOriginal) => ({
	...(await importOriginal<typeof import('./lib/api')>()),
	// The three calls the authed tree makes on boot: the theme read, the ⌘K
	// palette's module/me reads, and the 401-handler registration.
	setUnauthorizedHandler: vi.fn(),
	getEffectiveTokens: async () => null,
	getTranslations: async () => ({}),
	listModules: async () => [],
	getMe: async () => null,
}));
vi.mock('./pages/IdpHomePage', () => ({ default: () => <div data-testid="idp-home" /> }));

import App from './App';

const TOKEN_KEY = 'studio_token';
const USER_KEY = 'studio_user';

function renderSignedIn() {
	// An unparseable token counts as fresh (`lib/session.ts` is fail-open) — the
	// server is the authority, and this spec is about routing, not auth.
	localStorage.setItem(TOKEN_KEY, 'dev-token');
	localStorage.setItem(USER_KEY, JSON.stringify({ email: 'admin@mmbics.com', full_name: 'Administrator' }));
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<App />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	window.location.hash = '';
	localStorage.clear();
});

afterEach(() => cleanup());

describe('App — the post-login surface', () => {
	it('lands a signed-in load of `/` on the portal, not a launcher grid', async () => {
		renderSignedIn();

		await screen.findByTestId('idp-home');
		// `#/idp` is the address the session actually sits on (replace, so the
		// redirect is not a history entry of its own — see lib/view-state.ts).
		expect(window.location.hash).toBe('#/idp');
	});

	it('sends an unknown path to the portal too (the catch-all)', async () => {
		window.location.hash = '#/definitely-not-a-route';
		renderSignedIn();

		await waitFor(() => expect(window.location.hash).toBe('#/idp'));
		expect(await screen.findByTestId('idp-home')).toBeTruthy();
	});
});
