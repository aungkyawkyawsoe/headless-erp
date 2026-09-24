// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import TyreVehiclePage from './tyre-vehicle-page';
import { WheelViewToggle, type WheelView } from '../components/tyre-wheel-plan';

// The shell is a chrome-only wrapper (app bar + body) — the spec needs nothing of it.
vi.mock('@/shared/components/module-shell', () => ({
	ModuleShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/shared/components/skeletons', () => ({ ListSkeleton: () => <div data-testid="skeleton" /> }));
vi.mock('@/shared/components/empty-state', () => ({ EmptyState: ({ title }: { title: string }) => <div>{title}</div> }));
vi.mock('../data/use-board-changed', () => ({ useBoardChanged: () => () => {} }));
// The truck's register: ONE seated tyre + ONE tray spare (`t9`) — the spare is what a
// `Wear` hand-off names, so the page can resolve `?serial=t9`.
vi.mock('../data/api', () => ({
	fetchHolderAssets: vi.fn(async () => [
		{
			id: 'w1',
			kind: 'tyre',
			modelName: 'R268',
			serialNo: 'BR-9902',
			status: 'issued',
			itemNameEn: 'Tyre',
			itemNameMm: null,
			plateNo: '5S-6467',
			slot: 'steer-l',
			employeeId: null,
			employeeName: null,
			locationLabel: null,
			treadMm: 8,
			psi: null,
			condition: null,
			referenceTreadMm: 15,
		},
		{
			id: 't9',
			kind: 'tyre',
			modelName: 'X Multi D',
			serialNo: 'MX-4410',
			status: 'issued',
			itemNameEn: 'Tyre',
			itemNameMm: null,
			plateNo: '5S-6467',
			slot: null,
			employeeId: null,
			employeeName: null,
			locationLabel: null,
			treadMm: 10,
			psi: null,
			condition: null,
			referenceTreadMm: 14,
		},
	]),
}));
// ONE plate with a declared wheel budget — enough for `buildFleetBoard` to draw it.
vi.mock('@/shared/lookups/hooks', () => ({
	useVehicleMasters: () => ({
		data: [{ id: 'v1', plate_no: '5S-6467', brand: 'NISSAN', unit_type: 'truck', wheel: 4, wheel_slots: null }],
		isPending: false,
		isError: false,
		refetch: vi.fn(),
	}),
}));
// The rig/list BODY is a sibling surface with its own spec — here it reports which
// body + scope the page asked for (and can drive a scope change), while the rig/list
// SWITCH stays REAL (the `WheelViewToggle` the plan's bottom bar renders), since that
// is the control under test.
vi.mock('../components/tyre-wheel-plan', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../components/tyre-wheel-plan')>();
	return {
		...actual,
		TyreWheelPlan: ({
			view,
			onViewChange,
			segment,
			onSegmentChange,
			onPlaceOnWheel,
		}: {
			view: WheelView;
			onViewChange: (view: WheelView) => void;
			segment: string;
			onSegmentChange: (segment: 'onboard' | 'requests') => void;
			/** The list's `Wear` verb — the page turns it into the `?serial=` mode. */
			onPlaceOnWheel: (unit: { id: string }) => void;
		}) => (
			<div data-testid="plan">
				{`${view}/${segment}`}
				<WheelViewToggle view={view} onChange={onViewChange} />
				<button type="button" onClick={() => onSegmentChange('requests')}>
					go requests
				</button>
				<button type="button" onClick={() => onPlaceOnWheel({ id: 't9' })}>
					wear t9
				</button>
			</div>
		),
	};
});
// The seat-picker mode is its own surface with its own spec — here it only reports
// that the page mounted it (and lets the harness drive cancel/placed).
vi.mock('../components/wear-on-wheel-panel', () => ({
	WearOnWheelPanel: ({ tyre, onCancel, onPlaced }: { tyre: { id: string }; onCancel: () => void; onPlaced: (ids: string[]) => void }) => (
		<div data-testid="wear-panel">
			{tyre.id}
			<button type="button" onClick={onCancel}>
				cancel wear
			</button>
			<button type="button" onClick={() => onPlaced([tyre.id])}>
				placed
			</button>
		</div>
	),
}));

// jsdom ships neither, and the modules this file pulls in touch both at import time.
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
	// nuqs' react-router adapter reads the BROWSER location, so each test starts clean.
	window.history.replaceState(null, '', '/');
});

/**
 * Mount the screen at `search`. The BROWSER location is set to the same URL: nuqs'
 * react-router adapter reads `window.location`, and in a real browser the router and
 * the address bar ARE the same URL — so the harness mirrors that, and the assertions
 * read the real address bar (which is exactly what the user sees).
 */
function renderPage(search = '') {
	const path = `/app/tyres/vehicle/v1${search}`;
	window.history.replaceState(null, '', path);
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[path]}>
				<NuqsAdapter>
					<Routes>
						<Route path="/app/tyres/vehicle/:id" element={<TyreVehiclePage />} />
					</Routes>
				</NuqsAdapter>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

/** The page needs the plate master + the holder read to resolve before the app bar's
 *  switch renders (until then it paints a skeleton). Either label is the switch. */
async function ready() {
	await screen.findByRole('button', { name: /Switch to the (on-board list|wheel rig)/ });
}

describe('TyreVehiclePage — the rig/list body is URL view state', () => {
	it('opens on the rig with a CLEAN url — the defaults never land in the query string', async () => {
		renderPage();
		await ready();

		expect(screen.getByTestId('plan').textContent).toContain('rig/onboard');
		expect(window.location.search).toBe('');
	});

	it('switches the body by writing ?tab= — REPLACING the entry, never pushing one', async () => {
		renderPage();
		await ready();

		const entriesBefore = window.history.length;

		fireEvent.click(screen.getByRole('button', { name: 'Switch to the on-board list' }));

		// The layout AND the address bar now agree: a reload or a pasted link opens the list.
		expect(screen.getByTestId('plan').textContent).toContain('list/onboard');
		await waitFor(() => expect(window.location.search).toBe('?tab=list'));
		// …and the screen still owns exactly ONE back-press (a `?param` write REPLACES).
		expect(window.history.length).toBe(entriesBefore);
	});

	it('restores the body from a deep link, and drops the param when folded back', async () => {
		renderPage('?tab=list');
		await ready();

		expect(screen.getByTestId('plan').textContent).toContain('list/onboard');
		expect(screen.getByRole('button', { name: 'Switch to the wheel rig' }).getAttribute('aria-pressed')).toBe('true');

		fireEvent.click(screen.getByRole('button', { name: 'Switch to the wheel rig' }));

		// Back to the default ⇒ the param is DROPPED (clearOnDefault), not left behind.
		expect(screen.getByTestId('plan').textContent).toContain('rig/onboard');
		await waitFor(() => expect(window.location.search).toBe(''));
	});

	it('carries the registry panel as ?scope= — the truck register vs its store requests', async () => {
		renderPage('?tab=list');
		await ready();

		fireEvent.click(screen.getByRole('button', { name: 'go requests' }));

		expect(screen.getByTestId('plan').textContent).toContain('list/requests');
		// Replaced, never pushed — and it rides in the same container as the body.
		await waitFor(() => expect(window.location.search).toContain('scope=requests'));
		expect(window.location.search).toContain('tab=list');
	});
});

describe('TyreVehiclePage — wearing a spare onto a wheel is a URL mode, not a dialog', () => {
	it('opens the seat picker for the handed-over spare and forces the rig', async () => {
		renderPage('?tab=list');
		await ready();

		fireEvent.click(screen.getByRole('button', { name: 'wear t9' }));

		// The truck's own rig is redrawn as the picker (the list only NAMES the unit)…
		await waitFor(() => expect(screen.getByTestId('wear-panel').textContent).toContain('t9'));
		expect(screen.queryByTestId('plan')).toBeNull();
		// …and the mode is VIEW state: the unit rides in the URL, and the rig — the
		// DEFAULT body (`tab=rig` is omitted from a clean URL) — is forced by dropping
		// the `tab=list` that was there, so a reload lands on the drawing.
		await waitFor(() => expect(window.location.search).toContain('serial=t9'));
		expect(window.location.search).not.toContain('tab=list');
	});

	it('returns to the ordinary board when the mode is cancelled or a seat is filled', async () => {
		renderPage('?tab=rig&serial=t9');
		// The panel REPLACES the plan body, so the bar's rig/list switch is absent until
		// the mode ends — wait on the panel itself, not on `ready()`.
		await waitFor(() => expect(screen.getByTestId('wear-panel').textContent).toContain('t9'));

		fireEvent.click(screen.getByRole('button', { name: 'cancel wear' }));
		await waitFor(() => expect(screen.queryByTestId('wear-panel')).toBeNull());
		expect(screen.getByTestId('plan')).toBeTruthy();
		await waitFor(() => expect(window.location.search).not.toContain('serial='));

		// …and the same on a successful fit.
		fireEvent.click(screen.getByRole('button', { name: 'wear t9' }));
		await waitFor(() => expect(screen.getByTestId('wear-panel')).toBeTruthy());
		fireEvent.click(screen.getByRole('button', { name: 'placed' }));
		await waitFor(() => expect(screen.queryByTestId('wear-panel')).toBeNull());
		expect(screen.getByTestId('plan')).toBeTruthy();
	});

	it('ignores a stale serial id — a unit that is no longer a tray spare of this truck', async () => {
		// `w1` is SEATED, so it is not a tray spare: the picker must not appear for it.
		renderPage('?tab=rig&serial=w1');
		await ready();

		expect(screen.queryByTestId('wear-panel')).toBeNull();
		expect(screen.getByTestId('plan')).toBeTruthy();
	});
});
