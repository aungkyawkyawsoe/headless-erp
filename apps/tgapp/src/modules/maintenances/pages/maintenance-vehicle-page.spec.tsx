// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import MaintenanceVehiclePage from './maintenance-vehicle-page';

vi.mock('@/shared/components/module-shell', () => ({ ModuleShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/shared/components/skeletons', () => ({ ListSkeleton: () => <div data-testid="skeleton" /> }));
vi.mock('@/shared/components/search-results-list', () => ({
	SearchResultsList: ({ query }: { query: string }) => <div data-testid="search-results">{query}</div>,
}));
vi.mock('@/shared/components/load-more-sentinel', () => ({ LoadMoreSentinel: () => null }));
vi.mock('@/shared/components/confirm-sheet', () => ({ ConfirmSheet: () => null }));
// The hero + cards are sibling surfaces with their own specs — here they report the
// data the page fed them, so this spec watches the VIEW SWITCH, not their internals.
vi.mock('@/shared/components/record-hero', () => ({
	RecordHero: ({ identity, headline }: { identity: string; headline: string }) => (
		<div data-testid="hero">
			{identity}:{headline}
		</div>
	),
}));
vi.mock('../components/maintenance-log-card', () => ({
	MaintenanceLogCard: ({ log }: { log: { id: string; issueTypeName?: string } }) => <div data-testid="job">{log.id}</div>,
}));
vi.mock('../data/use-maintenance-confirm', () => ({
	useMaintenanceConfirm: () => ({ busy: false, error: null, confirm: vi.fn(async () => {}), reset: vi.fn() }),
}));
vi.mock('../data/api', () => ({
	fetchTruckIdentity: vi.fn(async () => ({ plate: '5S-6467', brand: 'NISSAN', lastOdo: 100, image: '/api/media/truck1' })),
	fetchTruckMaintenancePage: vi.fn(async () => ({
		rows: [
			{
				id: 'm1',
				issueTypeName: 'Oil change',
				rangeLabel: '1,020 km',
				docStatus: 'draft',
				jobCode: 'PM-1',
				technician: 'U Aye',
				note: 'filtered',
				odoKm: 100,
			},
		],
		nextCursor: null,
		hasMore: false,
	})),
}));

// jsdom ships neither, and modules this file pulls in touch both at import time.
beforeAll(() => {
	if (!globalThis.ResizeObserver) {
		globalThis.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;
	}
	if (!window.matchMedia) {
		window.matchMedia = ((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		})) as unknown as typeof window.matchMedia;
	}
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	window.history.replaceState(null, '', '/');
});

/**
 * Mount the screen at `search`. nuqs' react-router adapter reads the BROWSER
 * location, so the harness mirrors the address bar (as the user sees it).
 */
function renderPage(search = '') {
	const path = `/app/maintenances/vehicle/v1${search}`;
	window.history.replaceState(null, '', path);
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[path]}>
				<NuqsAdapter>
					<Routes>
						<Route path="/app/maintenances/vehicle/:id" element={<MaintenanceVehiclePage />} />
					</Routes>
				</NuqsAdapter>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

/** The loaded screen — the bar's view toggle renders in BOTH views but before data
 *  settles, so ALSO wait for the current view's settled content (hero in the
 *  overview, the history section in the list — the hero only leads the overview). */
async function ready() {
	await screen.findByRole('button', { name: /Show the (truck overview|service history)/ });
	if (window.location.search.includes('tab=list')) {
		await screen.findByText('Service history');
	} else {
		await screen.findByTestId('hero');
	}
}

describe('MaintenanceVehiclePage — the file body is URL view state', () => {
	it('opens on the OVERVIEW by default — the history list is NOT drawn, URL stays clean', async () => {
		renderPage();
		await ready();

		// The truck hero leads (plate headline), no "Service history" section and no
		// job cards — the history only appears when the list is asked for.
		expect(screen.getByTestId('hero').textContent).toContain('5S-6467');
		expect(screen.queryByText('Service history')).toBeNull();
		expect(screen.queryByTestId('job')).toBeNull();
		expect(window.location.search).toBe('');
	});

	it('the bottom bar list toggle writes ?tab=list — REPLACING the entry, never pushing one', async () => {
		renderPage();
		await ready();

		const entriesBefore = window.history.length;

		fireEvent.click(screen.getByRole('button', { name: 'Show the service history' }));

		// The file now draws as the history list, and the address bar agrees.
		await waitFor(() => expect(window.location.search).toBe('?tab=list'));
		expect(screen.getByText('Service history')).toBeTruthy();
		expect(screen.getByTestId('job').textContent).toBe('m1');
		// …and the screen still owns exactly ONE back-press (a `?param` write REPLACES).
		expect(window.history.length).toBe(entriesBefore);
	});

	it('restores the list from a deep link — and folds back to the clean overview URL', async () => {
		renderPage('?tab=list');
		await ready();

		expect(screen.getByText('Service history')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Show the truck overview' }).getAttribute('aria-pressed')).toBe('true');

		fireEvent.click(screen.getByRole('button', { name: 'Show the truck overview' }));

		// Back to the default ⇒ the param is DROPPED (clearOnDefault), not left behind,
		// and the truck hero returns.
		await waitFor(() => expect(window.location.search).toBe(''));
		expect(screen.queryByText('Service history')).toBeNull();
		expect(screen.getByTestId('hero').textContent).toContain('5S-6467');
	});
});
