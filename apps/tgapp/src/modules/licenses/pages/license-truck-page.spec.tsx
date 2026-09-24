// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import LicenseTruckPage from './license-truck-page';

/**
 * The truck page's + must NAVIGATE to the dedicated renewal page
 * (`/app/licenses/:id/renew`) — not open an in-page form. The form page is the
 * one that is full-screen (no bottom toolbar) and owns the native MainButton
 * save; keeping the truck page free of it is what lets the bar own its bottom
 * edge and the form own the whole screen.
 */

vi.mock('../data/api', () => ({
	fetchTruckIdentity: async () => ({ plate: '2Q-8386', brand: null, image: null }),
	fetchTruckLicensePage: async () => ({ rows: [], nextCursor: null, hasMore: false }),
	permitSummaryOf: (card: unknown) => card,
}));
// The truck page owns no form any more — its history feed + bar search are all it
// needs, so both hooks are stubbed to their settled empty state.
vi.mock('@/shared/hooks/use-cursor-list', () => ({
	useCursorList: () => ({
		data: { pages: [] },
		rows: [],
		isPending: false,
		isError: false,
		refetch: vi.fn(),
		hasNextPage: false,
		isFetchingNextPage: false,
		fetchNextPage: vi.fn(),
	}),
}));
vi.mock('@/shared/hooks/use-bar-search', () => ({
	useBarSearch: () => ({ open: false, query: '', button: null, panel: null, results: [], searching: false, error: null, clear: vi.fn() }),
}));
vi.mock('@/shared/components/module-shell', () => ({
	ModuleShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

beforeAll(() => {
	window.matchMedia ??= ((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false,
	})) as unknown as typeof window.matchMedia;
	if (!globalThis.ResizeObserver) {
		globalThis.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;
	}
});

function renderPage() {
	const path = '/app/licenses/veh-1';
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter
				initialEntries={[
					{ pathname: path, state: { row: { vehicleId: 'veh-1', plate: '2Q-8386', brand: null, current: null } } },
				]}
			>
				<NuqsAdapter>
					<Routes>
						<Route path="/app/licenses/:id" element={<LicenseTruckPage />} />
						<Route path="/app/licenses/:id/renew" element={<div>RENEW PAGE</div>} />
					</Routes>
				</NuqsAdapter>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe('LicenseTruckPage — the + opens the dedicated renewal page', () => {
	it('navigates to /app/licenses/:id/renew instead of an in-page form', () => {
		renderPage();
		fireEvent.click(screen.getByRole('button', { name: 'Renew license' }));
		expect(screen.getByText('RENEW PAGE')).toBeTruthy();
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
