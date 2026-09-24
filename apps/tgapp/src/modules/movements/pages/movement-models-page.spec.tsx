// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import MovementModelsPage from './movement-models-page';
import type { MovementModelRow } from '../data/types';

/**
 * Movement Screen 2 (`/app/movements/models?group=…`) — the group's movement read
 * TWO ways over one scope:
 *
 *  - **Models** is the DEFAULT (the screen's own name): one row per SKU with its
 *    totals, keyset-paged;
 *  - **Transactions** is the line feed behind the second tab, paged the same way.
 *
 * The spec watches the wiring both readings share: which endpoint a tab reads,
 * that the scope travels with it, and that the NEXT page is fetched with the
 * cursor the previous page returned (the infinite-scroll contract — the sentinel
 * is stubbed to a button because jsdom has no IntersectionObserver).
 */

const state = vi.hoisted(() => ({
	models: [] as MovementModelRow[],
	/** Page 2's rows — a DIFFERENT SKU, so a streamed page never repeats a key. */
	modelsPage2: [] as MovementModelRow[],
	modelsCursor: null as string | null,
	lines: [] as Array<Record<string, unknown>>,
	fetchModels: vi.fn(),
	fetchLines: vi.fn(),
}));

vi.mock('../data/api', () => ({
	fetchMovementGroupName: async () => ({ id: 'g-1', nameEn: 'Alternator' }),
	fetchMovementGroupModels: (input: Record<string, unknown>) => {
		state.fetchModels(input);
		return Promise.resolve({ rows: input.cursor ? state.modelsPage2 : state.models, nextCursor: state.modelsCursor });
	},
	fetchMovementGroupLines: (input: Record<string, unknown>) => {
		state.fetchLines(input);
		return Promise.resolve({ rows: state.lines, nextCursor: null });
	},
}));

// The shell is chrome-only; the store filter is a sibling surface.
vi.mock('@/shared/components/module-shell', () => ({
	ModuleShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../components/store-scope-filter', () => ({ StoreScopeFilter: () => null }));
// jsdom has no IntersectionObserver — the sentinel becomes an explicit button so
// the test drives "the operator scrolled to the end" deterministically.
vi.mock('@/shared/components/load-more-sentinel', () => ({
	LoadMoreSentinel: ({ onLoadMore, hasMore }: { onLoadMore: () => void; hasMore: boolean }) =>
		hasMore ? (
			<button type="button" onClick={onLoadMore}>
				load more
			</button>
		) : null,
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
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	state.models = [];
	state.modelsCursor = null;
	state.lines = [];
	window.history.replaceState(null, '', '/');
});

const modelOf = (overrides: Partial<MovementModelRow> = {}): MovementModelRow => ({
	model: 'model-1',
	model_name: 'Bolt M10',
	total_in: 120,
	total_out: 40,
	total_trf: 0,
	line_count: 12,
	doc_count: 5,
	last_date: '2026-09-05',
	...overrides,
});

function renderPage(search: string) {
	const path = `/app/movements/models${search}`;
	window.history.replaceState(null, '', path);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[path]}>
				<NuqsAdapter>
					<Routes>
						<Route path="/app/movements/models" element={<MovementModelsPage />} />
					</Routes>
				</NuqsAdapter>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe('MovementModelsPage — the group’s models are the default reading', () => {
	it('reads the MODELS endpoint by default and renders one row per SKU', async () => {
		state.models = [modelOf()];
		renderPage('?group=g-1');

		expect(await screen.findByText('Bolt M10')).toBeTruthy();
		// The scope travels with the read: the group, and no direction/location filter.
		expect(state.fetchModels).toHaveBeenCalledWith({ group: 'g-1', direction: 'all', location: '', cursor: undefined });
		// The line feed is NOT read while the default reading is showing.
		expect(state.fetchLines).not.toHaveBeenCalled();
		// The row's figures come from the aggregate the server computed.
		expect(screen.getByText('+120')).toBeTruthy();
		expect(screen.getByText('−40')).toBeTruthy();
	});

	it('streams the next page with the cursor the previous page returned', async () => {
		state.models = [modelOf()];
		state.modelsPage2 = [modelOf({ model: 'model-2', model_name: 'Bolt M12' })];
		state.modelsCursor = '2026-09-05~model-1';
		renderPage('?group=g-1');

		// The stub sentinel stands in for the scroll-armed observer.
		fireEvent.click(await screen.findByRole('button', { name: 'load more' }));

		await waitFor(() =>
			expect(state.fetchModels).toHaveBeenLastCalledWith({
				group: 'g-1',
				direction: 'all',
				location: '',
				cursor: '2026-09-05~model-1',
			}),
		);
		// …and the page it brought back is appended under the first.
		expect(await screen.findByText('Bolt M12')).toBeTruthy();
		expect(screen.getByText('Bolt M10')).toBeTruthy();
	});

	it('carries the direction + store scope into the models read', async () => {
		state.models = [modelOf()];
		renderPage('?group=g-1&direction=in&location=main_store');

		await waitFor(() => expect(state.fetchModels).toHaveBeenCalled());
		expect(state.fetchModels).toHaveBeenCalledWith({
			group: 'g-1',
			direction: 'in',
			location: 'main_store',
			cursor: undefined,
		});
	});

	it('switches to the Transactions feed (and back) from the tab row', async () => {
		state.models = [modelOf()];
		state.lines = [
			{
				direction: 'in',
				line_id: 'line-1',
				model: 'model-1',
				kind: 'purchase',
				doc_no: 'INB-00001',
				doc_id: 'doc-1',
				date: '2026-09-05',
				location: 'main_store',
				from_location: null,
				to_location: null,
				model_name: 'Bolt M10',
				qty: 120,
				unit_price: 100,
				batch_no: null,
				serials: null,
				note: null,
				created_name: 'Ko Aung',
			},
		];
		renderPage('?group=g-1');

		fireEvent.click(await screen.findByRole('tab', { name: 'Transactions' }));

		// The second reading reads the LINE feed for the same scope…
		await waitFor(() => expect(state.fetchLines).toHaveBeenCalledWith({ group: 'g-1', direction: 'all', location: '', cursor: undefined }));
		// …and lands in the URL as view state (replace, never a new history entry).
		await waitFor(() => expect(window.location.search).toContain('tab=lines'));
		expect(await screen.findByText(/INB-00001/)).toBeTruthy();

		fireEvent.click(screen.getByRole('tab', { name: 'Models' }));
		// Back to the default: the param is dropped, not left behind.
		await waitFor(() => expect(window.location.search).not.toContain('tab='));
	});
});
