// @vitest-environment jsdom
/**
 * CollectionsPanel — the registry list as the shell's side panel, driven through
 * a real DOM.
 *
 * Before this container existed, the list was the Collections workbench's LEFT
 * pane: it only rendered while you were already on `/idp/collections`, and the
 * workbench itself was the only way to focus a collection. It is now tier 2 of
 * the three-tier shell, so two contracts matter and are pinned here:
 *
 *   1. it renders from the SAME query/filter chain as before (hidden ones only
 *      when the reveal toggle is on), and
 *   2. choosing a row writes `?collection=` as VIEW STATE — a REPLACE, never a
 *      history entry (the Studio URL/history contract in lib/view-state.ts).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../../lib/api', () => ({ listCollections: vi.fn(), namingSeriesExample: vi.fn(() => null) }));
vi.mock('../../lib/idp', () => ({ isHiddenCollection: vi.fn(() => false) }));

import { listCollections, type CollectionSummary } from '../../lib/api';
import { resetStudioUi } from '../../lib/studio-store';
import { CollectionsPanel } from './CollectionsPanel';

const mockList = vi.mocked(listCollections) as unknown as Mock;

function collection(slug: string, name: string, hidden = false): CollectionSummary {
	return { id: `id-${slug}`, name, slug, description: '', hidden };
}

/** The panel is URL-backed — show the live search string next to it. */
function Probe() {
	const { search, pathname } = useLocation();
	return <span data-testid="url">{`${pathname}${search}`}</span>;
}

function renderPanel() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={['/idp/collections']}>
				<CollectionsPanel token="tk" />
				<Probe />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	mockList.mockReset();
	resetStudioUi();
});

afterEach(() => cleanup());

describe('CollectionsPanel', () => {
	it('lists the engine collections, keeping hidden ones out until revealed', async () => {
		mockList.mockResolvedValue([collection('customers', 'Customers'), collection('archive', 'Archive', true)]);
		renderPanel();

		await screen.findByText('Customers');
		expect(screen.queryByText('Archive')).toBeNull();
		// The header counts what is ON SCREEN, not what exists.
		expect(screen.getByText('1')).toBeTruthy();

		fireEvent.click(screen.getByLabelText('Reveal hidden collections'));
		await screen.findByText('Archive');
		expect(screen.getByText('2')).toBeTruthy();
	});

	it('writes the focused collection to ?collection= (view state, not a history entry)', async () => {
		mockList.mockResolvedValue([collection('customers', 'Customers'), collection('sales_orders', 'Sales Orders')]);
		renderPanel();

		fireEvent.click(await screen.findByText('Sales Orders'));
		await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/idp/collections?collection=sales_orders'));

		// A second pick REPLACES the same entry — the screen owns one history entry.
		fireEvent.click(screen.getByText('Customers'));
		await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/idp/collections?collection=customers'));
	});

	it('says the list is empty rather than rendering nothing', async () => {
		mockList.mockResolvedValue([]);
		renderPanel();

		await screen.findByText('No collections yet');
		expect(screen.getByText('Press the + button to create the first backend table.')).toBeTruthy();
	});
});
