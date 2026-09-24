// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { qk } from '../data/query-keys';
import FluidCreatePage from './fluid-create-page';

const VEHICLE = 'v1';

vi.mock('../data/api', () => ({
	fetchFluidFleetIdentity: vi.fn(async () => ({ plateNo: '5S-6467', brandLabel: 'NISSAN', lastOdo: 120000, image: null })),
	fetchFluidHistoryPage: vi.fn(async () => ({ rows: [], nextCursor: null, hasMore: false })),
	createFluidFill: vi.fn(async () => ({ id: 'x' })),
	updateFluidFill: vi.fn(async () => ({ id: 'x' })),
}));

// jsdom ships neither, and the design-system DatePicker touches both.
beforeAll(() => {
	if (!globalThis.ResizeObserver) {
		globalThis.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;
	}
	if (!Element.prototype.getAnimations) {
		Element.prototype.getAnimations = () => [];
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

afterEach(cleanup);

function renderPage(queryClient: QueryClient) {
	const path = `/app/fluid/+?vehicle=${VEHICLE}&type=engine_oil`;
	window.history.replaceState(null, '', path);
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[path]}>
				<NuqsAdapter>
					<Routes>
						<Route path="/app/fluid/+" element={<FluidCreatePage />} />
					</Routes>
				</NuqsAdapter>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

/**
 * The record page reads the active kind's newest fill to seed the "Next due"
 * hint. That read MUST NOT share the vehicle page's `qk.history` key: the
 * vehicle page reads the SAME key with `useInfiniteQuery` (data =
 * `{ pages, pageParams }`), so a plain `useQuery` on it read `data.rows` off the
 * infinite shape — `undefined[0]` — and the screen failed to load the moment it
 * was opened from a vehicle whose feed was already cached (the real "+" flow).
 */
describe('FluidCreatePage — the newest-fill read never shares the vehicle feed key', () => {
	it('renders even when the vehicle page already cached its infinite history feed', async () => {
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		// The EXACT shape `useCursorList`/`useInfiniteQuery` stores under qk.history.
		queryClient.setQueryData(qk.history(VEHICLE, 'engine_oil'), {
			pages: [{ rows: [{ id: 'f1', odo: 120000, nextDueOdo: 135000, qtyLiters: 18, createdLabel: '22 Sep', docStatus: 'draft' }], nextCursor: null, hasMore: false }],
			pageParams: [undefined],
		});

		renderPage(queryClient);

		// The form renders — the poisoned history entry was never read as `{ rows }`.
		expect(await screen.findByText('Effective Date')).toBeTruthy();
		expect(screen.getByText('Save engine oil fill')).toBeTruthy();
	});
});
