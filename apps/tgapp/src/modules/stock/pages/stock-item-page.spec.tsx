// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StockItemPage from './stock-item-page';

/** The shell is chrome only — but its `trailing` slot is part of the subject. */
vi.mock('@/shared/components/module-shell', () => ({
	ModuleShell: ({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) => (
		<div>
			<div data-testid="bar-trailing">{trailing}</div>
			{children}
		</div>
	),
}));

/** The session the page gates the edit errand on (mutable per test). */
const state = vi.hoisted(() => ({
	me: { is_admin: false, granted_collections: ['mro_item_model'] } as Record<string, unknown> | null,
	composition: {
		model: { id: 'm1', name_en: 'Air Filter AF-4004', name_mm: 'လေစစ်ဇကာ', image: null, group_name: 'Air Filter', tracking: 'standard' },
		totals: { on_hand: 9, expired: 0, any_below_reorder: true },
		balances: [
			{ id: 'b1', location: 'main_store', qty_on_hand: 6, derived_qty: 6, reorder_level: 5 },
			{ id: 'b2', location: 'safety_store', qty_on_hand: 3, derived_qty: 3, reorder_level: 4 },
		],
		lots: [{ id: 'l1', location: 'main_store', batch_no: 'L1', expiry_date: null, days_left: null, remaining_qty: 2, expired: false }],
		serials: [
			{
				id: 's1',
				location: 'main_store',
				serial_no: 'SN-1',
				status: 'in_stock',
				vehicle: null,
				plate_no: null,
				slot: null,
				employee: null,
				employee_name: null,
				tread_mm: null,
				psi: null,
				condition: null,
				expiry_date: null,
			},
		],
	},
}));

vi.mock('@/shared/auth', () => ({
	getCachedMe: () => state.me,
	fetchMe: vi.fn(async () => state.me),
	refreshMe: vi.fn(async () => state.me),
}));

vi.mock('@/shared/mro', async (importOriginal) => {
	const original = await importOriginal<typeof import('@/shared/mro')>();
	return { ...original, mroApi: { ...original.mroApi, itemStock: vi.fn(async () => state.composition) } };
});

beforeEach(() => {
	vi.clearAllMocks();
	state.me = { is_admin: false, granted_collections: ['mro_item_model'] };
});

afterEach(cleanup);

function renderPage() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={['/app/stocks/item/m1']}>
				<Routes>
					<Route path="/app/stocks/item/:modelId" element={<StockItemPage />} />
					<Route path="/app/items/:modelId/edit" element={<div>EDIT PROBE</div>} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe('stock item page — header facts, edit errand, no master shortcut', () => {
	it('lays the card out as [full-height photo | identity + facts], no policy chip', async () => {
		renderPage();
		const card = (await screen.findByText('Air Filter AF-4004')).closest('section');
		expect(card).toBeTruthy();
		const facts = within(card as HTMLElement);
		// Identity: the model name over its part-group.
		expect(facts.getByText('Air Filter AF-4004')).toBeTruthy();
		expect(facts.getByText('Air Filter')).toBeTruthy();
		// The on-hand DIGIT rides the identity line, level with the model name —
		// with NO visible label (its accessible name carries the meaning).
		const identityLine = facts.getByText('Air Filter AF-4004').parentElement;
		expect(identityLine?.textContent).toContain('9');
		expect(identityLine?.textContent).not.toContain('On hand');
		expect(screen.queryByText('On hand')).toBeNull();
		// The lower facts row keeps the reorder state — and carries NO tracking
		// chip: the caption above the line list already names the policy.
		expect(facts.getByText('Below reorder')).toBeTruthy();
		expect(facts.queryByText('Tracking')).toBeNull();
		expect(facts.queryByText('Standard')).toBeNull();
		// The line caption is where the policy IS stated ("Balances by store" for a
		// standard SKU) — it sits below the card, so it is queried globally.
		expect(screen.getByText('Balances by store')).toBeTruthy();
		// The photo area spans the card's FULL HEIGHT (self-stretch + fixed width).
		const tile = card?.querySelector('span.self-stretch');
		expect(tile).toBeTruthy();
		expect(tile?.className).toContain('w-28');
	});

	it('opens the master edit from the CARD itself (no app-bar pencil), routing to /app/items/:id/edit', async () => {
		renderPage();
		await screen.findByText('Air Filter AF-4004');
		// The retired affordance: nothing in the app bar.
		expect(within(screen.getByTestId('bar-trailing')).queryByRole('button')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: /Air Filter AF-4004 — edit item model/ }));
		expect(await screen.findByText('EDIT PROBE')).toBeTruthy();
	});

	it('does not offer the edit tap for a session that may not read the SKU collection', async () => {
		state.me = { is_admin: false, granted_collections: [] };
		renderPage();
		await screen.findByText('Air Filter AF-4004');
		expect(screen.queryByRole('button', { name: /edit item model/ })).toBeNull();
	});

	it('draws the card avatar as the item monogram when the SKU has no photo', async () => {
		renderPage();
		await screen.findByText('Air Filter AF-4004');
		// "Air Filter AF-4004" ⇒ the monogram tile, not a package glyph.
		expect(screen.getByText('AF')).toBeTruthy();
	});

	it('paints a serial unit as a read-out row — no tap target, no unit-history jump', async () => {
		state.composition.model.tracking = 'serial';
		renderPage();
		await screen.findByText('SN-1');
		// The row is text, not a doorway: no button, no "open unit history" affordance.
		expect(screen.queryByLabelText('SN-1 — open unit history')).toBeNull();
		expect(screen.queryAllByRole('button', { name: /open unit history/i })).toHaveLength(0);
		state.composition.model.tracking = 'standard';
	});

	it('shows NO master-page shortcut button any more', async () => {
		renderPage();
		await screen.findByText('Air Filter AF-4004');
		expect(screen.queryByText('ပစ္စည်း အချက်အလက်')).toBeNull();
	});
});
