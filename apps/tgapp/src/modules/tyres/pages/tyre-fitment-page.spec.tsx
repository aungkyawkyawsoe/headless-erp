// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import TyreFitmentPage from './tyre-fitment-page';
import { fetchMountedTyres } from '../data/api';
import type { TyreCardModel } from '../data/types';

// The shell is chrome only (app bar + body) — the spec's subject is the board and
// its bottom action bar, which `ListPage` mounts INSIDE it.
vi.mock('@/shared/components/module-shell', () => ({
	ModuleShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// The two reads the board joins, mutable per test (`vi.hoisted` so the factories
// below can close over it).
const state = vi.hoisted(() => ({
	vehicles: [
		{ id: 'v-bare', plate_no: 'BARE-1', brand: 'HINO', unit_type: 'box', wheel: 4, wheel_slots: null },
		{ id: 'v-part', plate_no: 'PART-1', brand: 'HINO', unit_type: 'box', wheel: 4, wheel_slots: null },
		{ id: 'v-full', plate_no: 'FULL-1', brand: 'HINO', unit_type: 'box', wheel: 4, wheel_slots: null },
	],
	mounted: [] as TyreCardModel[],
}));

vi.mock('@/shared/lookups/hooks', () => ({
	useVehicleMasters: () => ({ data: state.vehicles, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('../data/api', () => ({ fetchMountedTyres: vi.fn(async () => state.mounted) }));

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

/** A register unit — the board only reads `plateNo` + `slot` to seat it. */
function unit(over: Partial<TyreCardModel> & { id: string }): TyreCardModel {
	return {
		kind: 'tyre',
		modelName: 'R268',
		serialNo: null,
		status: 'issued',
		itemNameEn: null,
		itemNameMm: null,
		plateNo: null,
		slot: null,
		employeeId: null,
		employeeName: null,
		locationLabel: null,
		treadMm: null,
		psi: null,
		condition: null,
		referenceTreadMm: null,
		...over,
	};
}

// The board's seats come from each plate's declared 4-wheel plan: steer-l,
// steer-r, drv1-l, drv1-r. PART-1 wears ONE tyre (partial), FULL-1 wears all four
// (full), BARE-1 wears none (bare) — one truck per filter value.
beforeEach(() => {
	state.mounted = [
		unit({ id: 'm1', plateNo: 'PART-1', slot: 'steer-l', serialNo: 'BR-1' }),
		unit({ id: 'm2', plateNo: 'FULL-1', slot: 'steer-l', serialNo: 'BR-2' }),
		unit({ id: 'm3', plateNo: 'FULL-1', slot: 'steer-r', serialNo: 'BR-3' }),
		unit({ id: 'm4', plateNo: 'FULL-1', slot: 'drv1-l', serialNo: 'BR-4' }),
		unit({ id: 'm5', plateNo: 'FULL-1', slot: 'drv1-r', serialNo: 'BR-5' }),
	];
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	// nuqs' react-router adapter reads the BROWSER location — each test starts clean.
	window.history.replaceState(null, '', '/');
});

/** Mount the board at `search`, mirroring the URL into the address bar (nuqs reads
 *  it from there, so the assertions below read exactly what the user would share). */
function renderPage(search = '') {
	const path = `/app/tyres/fitment${search}`;
	window.history.replaceState(null, '', path);
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[path]}>
				<NuqsAdapter>
					<Routes>
						<Route path="/app/tyres/fitment" element={<TyreFitmentPage />} />
					</Routes>
				</NuqsAdapter>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

/** One truck row, located by its own accessible name (`<plate> — view fitment (…)`). */
const rowFor = (plate: string) => screen.findByRole('button', { name: new RegExp(`^${plate} — view fitment`) });
const hasRow = (plate: string) => screen.queryByRole('button', { name: new RegExp(`^${plate} — view fitment`) }) !== null;

describe('TyreFitmentPage — the bottom action bar is the shared list toolbar', () => {
	it('mounts filter, search and refresh around the active-filter label', async () => {
		renderPage();
		await rowFor('PART-1');

		expect(screen.getByRole('button', { name: 'Filter' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
		expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false);
		// No filter yet ⇒ the pill reads "All", the same label every list bar shows.
		expect(screen.getByText('All')).toBeTruthy();
	});

	it('refreshes the board from the bar’s ↻ — a forced re-read, not a cache serve', async () => {
		renderPage();
		await rowFor('PART-1');

		const before = (fetchMountedTyres as Mock).mock.calls.length;
		fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

		await waitFor(() => expect((fetchMountedTyres as Mock).mock.calls.length).toBe(before + 1));
	});
});

describe('TyreFitmentPage — the fitment filter is URL view state', () => {
	it('narrows the board from ?status=, naming the filter in the pill', async () => {
		renderPage('?status=bare');
		await rowFor('BARE-1');

		expect(hasRow('PART-1')).toBe(false);
		expect(hasRow('FULL-1')).toBe(false);
		expect(screen.getByText('Bare (no tyres)')).toBeTruthy();
	});

	it('writes the choice from the filter sheet — one replace, never a push', async () => {
		renderPage();
		await rowFor('PART-1');

		const entriesBefore = window.history.length;
		fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
		const sheet = await screen.findByRole('dialog');
		fireEvent.click(within(sheet).getByRole('button', { name: 'Partly fitted' }));

		expect(hasRow('PART-1')).toBe(true);
		expect(hasRow('BARE-1')).toBe(false);
		await waitFor(() => expect(window.location.search).toBe('?status=partial'));
		expect(window.history.length).toBe(entriesBefore);
	});

	it('shows the filter’s own empty state — with a one-tap clear — never "no records"', async () => {
		// Only a partial truck is shod here, so "fully fitted" has nothing to show.
		state.mounted = [unit({ id: 'm1', plateNo: 'PART-1', slot: 'steer-l', serialNo: 'BR-1' })];
		renderPage('?status=full');

		const clear = await screen.findByRole('button', { name: 'Clear Filter' });
		expect(screen.getByText('No trucks match this filter')).toBeTruthy();
		expect(screen.queryByText('No vehicle fitment to show')).toBeNull();

		fireEvent.click(clear);

		// The clear resets the filter AND drops the param (clearOnDefault).
		await waitFor(() => expect(hasRow('PART-1')).toBe(true));
		await waitFor(() => expect(window.location.search).toBe(''));
	});
});

describe('TyreFitmentPage — the toolbar search narrows the loaded board locally', () => {
	it('finds the truck wearing a serial — the board is vehicle-first', async () => {
		renderPage('?q=BR-5');

		// The debounced local narrow settles, then the results replace the board.
		await rowFor('FULL-1');
		expect(hasRow('PART-1')).toBe(false);
		expect(hasRow('BARE-1')).toBe(false);
	});

	it('narrows by plate', async () => {
		renderPage('?q=PART');

		await rowFor('PART-1');
		expect(hasRow('FULL-1')).toBe(false);
	});

	it('a narrow that finds nothing is the search’s own empty state, not the module’s', async () => {
		renderPage('?q=zzz');

		expect(await screen.findByText(/No results match/)).toBeTruthy();
		expect(screen.queryByText('No vehicle fitment to show')).toBeNull();
	});
});
