// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ItemForm, { type ItemFormInitial } from './item-form';

/**
 * The Balance affordance on the item form's Photo caption.
 *
 * It exists because the catalog card opens this form rather than the SKU's stock
 * — so the form is where an operator standing in front of an item model asks
 * "how much is there?". Balance opens the STOCK page (`/app/stocks/item/:id`
 * resolves it in ONE place, `stockItemPath`): the item's image and totals, then
 * every line by the item's OWN tracking method — per-store balances, FEFO lots
 * or serial units — line by line.
 *
 * Two things are pinned: the destination (with the row's own id, and the header
 * seed the page paints from before its read lands), and the fact that a CREATE
 * form offers no Balance at all — there is no stored stock behind a SKU that
 * does not exist yet.
 */

// The item-group directory — irrelevant here, and its real query would go to the network.
vi.mock('@/shared/hooks/use-mro-masters', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/shared/hooks/use-mro-masters')>()),
	useMroItemNames: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
// No Telegram bridge in jsdom — the in-page submit affordances are what render.
vi.mock('@/shared/platform/use-main-button', () => ({ useTelegramMainButton: () => false }));

afterEach(cleanup);

/** The stored row the edit page hands the form. */
const INITIAL: ItemFormInitial = {
	name_en: 'Air Filter AF-1001',
	nameMm: 'လေစစ်ဇကာ AF-1001',
	tracking: 'standard',
	expiryAlertDays: null,
	image: '/api/media/af.jpg',
	itemName: { id: 'g1', name: 'Air Filter' },
};

/** Stands in for the stock page — prints the id it was reached with and the
 *  header seed it was handed, so one assertion covers both. */
function StockPageStub() {
	const { modelId } = useParams<{ modelId: string }>();
	const location = useLocation();
	const seed = location.state as { name?: string; image?: string | null } | null;
	return (
		<>
			<p>stock page for {modelId}</p>
			<p>seeded {seed?.name ?? 'nothing'}</p>
		</>
	);
}

function renderForm(props: { mode: 'create' | 'edit'; modelId?: string } = { mode: 'edit', modelId: 'm1' }) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={['/app/items/m1/edit']}>
				<Routes>
					<Route
						path="/app/items/:id/edit"
						element={
							<ItemForm
								mode={props.mode}
								modelId={props.modelId}
								initial={props.mode === 'edit' ? INITIAL : undefined}
								save={vi.fn()}
								submitLabel="Save"
								savingLabel="Saving…"
								errorMessage="Could not save. Please try again."
							/>
						}
					/>
					<Route path="/app/stocks/item/:modelId" element={<StockPageStub />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe('item form — Balance beside the Photo caption', () => {
	it('links to the SKU’s own stock page, seeded with the row it stands for', () => {
		renderForm();

		const balance = screen.getByRole('link', { name: 'Balance' });
		// The row's OWN id — not the item group, not a name.
		expect(balance.getAttribute('href')).toBe('/app/stocks/item/m1');
	});

	it('opens the stock page — the full lines by tracking method, not a sheet', async () => {
		renderForm();

		fireEvent.click(screen.getByRole('link', { name: 'Balance' }));

		expect(await screen.findByText('stock page for m1')).toBeTruthy();
		// The header seed rides along so the page paints before its own read lands.
		expect(screen.getByText('seeded Air Filter AF-1001')).toBeTruthy();
		// …and the form is gone: this is a real page, not an overlay.
		expect(screen.queryByRole('textbox', { name: 'Item Name' })).toBeNull();
	});

	it('offers no Balance on a create form — there is no stored stock yet', () => {
		renderForm({ mode: 'create' });
		expect(screen.queryByRole('link', { name: 'Balance' })).toBeNull();
	});

	it('offers no Balance when the row has no id to look up', () => {
		renderForm({ mode: 'edit' });
		expect(screen.queryByRole('link', { name: 'Balance' })).toBeNull();
	});
});
