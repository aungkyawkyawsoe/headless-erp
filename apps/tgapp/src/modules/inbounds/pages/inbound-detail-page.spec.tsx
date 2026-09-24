// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import InboundDetailPage from './inbound-detail-page';
import type { InboundCardModel, InboundFormSeed } from '../data/types';

/**
 * The document page IS the form — the one layout rule this page owns.
 *
 *  - a DRAFT opens the prefilled create form and SAVES back to the SAME row
 *    (`PUT /api/entities/mro_inbounds/:id`), so a mis-typed draft is corrected
 *    instead of cancelled and re-created;
 *  - a CONFIRMED receipt renders the same layout READ-ONLY — no live field and no
 *    save button, because the engine (`writes.freeze_when doc_status:confirmed`)
 *    would refuse that write anyway — while the MONEY face stays: the ledger is
 *    not a form field, and its sheet is the only place a payment is recorded.
 */

const mocks = vi.hoisted(() => ({
	updateInboundDoc: vi.fn(async (_id: string, _draft: Record<string, unknown>) => ({ id: 'inb-1' })),
}));

const state = vi.hoisted(() => ({
	editor: null as { card: InboundCardModel; seed: InboundFormSeed } | null,
}));

/** The ONE SKU the directory offers — the seeded line's own id, so the row resolves. */
const MODEL = { id: 'model-1', name_en: 'Bolt M10', name_mm: null, tracking: 'standard', item_name: { tracking: 'standard' } };

vi.mock('../data/api', () => ({
	fetchInboundDocEditor: async () => state.editor,
	updateInboundDoc: mocks.updateInboundDoc,
}));
// The shell is chrome-only (app bar + body) — the spec needs nothing of it.
vi.mock('@/shared/components/module-shell', () => ({
	ModuleShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
// The payment sheet is its own surface with its own spec; here it only has to not
// reach the network (the money STRIP's wiring is what this spec watches).
vi.mock('../components/inbound-payment-sheet', () => ({ InboundPaymentSheet: () => null }));
vi.mock('@/shared/platform/use-main-button', () => ({ useTelegramMainButton: () => false }));
vi.mock('@/shared/hooks/use-mro-item-models', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/shared/hooks/use-mro-item-models')>()),
	useMroItemModels: () => ({ data: [MODEL], isPending: false, isError: false, refetch: vi.fn() }),
	filterMroItemModels: () => [MODEL],
}));
vi.mock('@/shared/hooks/use-mro-masters', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/shared/hooks/use-mro-masters')>()),
	fetchMroSuppliers: async () => [{ id: 'sup-1', name: 'Yangon Supplier Co.' }],
}));
vi.mock('@/shared/lookups/api', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/shared/lookups/api')>()),
	searchEmployees: async () => [],
}));

beforeAll(() => {
	// jsdom has no matchMedia; the design-system sheet/dropdown/datepicker probes it.
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

function cardOf(overrides: Partial<InboundCardModel> = {}): InboundCardModel {
	return {
		id: 'inb-1',
		displayNumber: 'INB-00031',
		docStatus: 'draft',
		type: 'purchase',
		purchaseDate: '2026-09-20',
		location: 'main_store',
		locationLabel: 'Main Store',
		supplierName: 'Yangon Supplier Co.',
		handedByName: null,
		note: null,
		totalQty: 3,
		lineCount: 1,
		totalAmount: 3_600,
		paidAmount: 0,
		paymentStatus: 'unpaid',
		fullyPaidOn: null,
		...overrides,
	};
}

function seedOf(overrides: Partial<InboundFormSeed> = {}): InboundFormSeed {
	return {
		id: 'inb-1',
		type: 'purchase',
		purchaseDate: '2026-09-20',
		partyId: 'sup-1',
		partyName: 'Yangon Supplier Co.',
		location: 'main_store',
		note: '',
		paidAtReceipt: false,
		lines: [
			{
				modelId: 'model-1',
				modelName: 'Bolt M10',
				tracking: 'standard',
				qty: 3,
				unitPrice: 1200,
				batchNo: '',
				expiryDate: '',
				serials: [],
			},
		],
		docStatus: 'draft',
		...overrides,
	};
}

/** Mount the page at its real URL. nuqs' router adapter reads the address bar, so
 *  the harness mirrors the router's entry into it (as the browser would). */
function renderPage(search = '?type=purchase') {
	const path = `/app/inbounds/inb-1${search}`;
	window.history.replaceState(null, '', path);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[path]}>
				<NuqsAdapter>
					<Routes>
						<Route path="/app/inbounds/:id" element={<InboundDetailPage />} />
						{/* The post-save destination — the page pops back to the list. */}
						<Route path="/app/inbounds" element={<div />} />
					</Routes>
				</NuqsAdapter>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe('InboundDetailPage — a draft opens its own form', () => {
	it('prefills the fields from the document and SAVES back to the same row', async () => {
		state.editor = { card: cardOf(), seed: seedOf() };
		renderPage();

		// Prefilled — the qty, the price, the SKU and the vendor all come off the doc.
		const qty = (await screen.findByLabelText('Quantity')) as HTMLInputElement;
		expect(qty.value).toBe('3');
		expect((screen.getByLabelText('Unit price') as HTMLInputElement).value).toBe('1200');
		expect(screen.getByText('Bolt M10')).toBeTruthy();
		expect(screen.getByText('Yangon Supplier Co.')).toBeTruthy();

		// A draft is WRITABLE: the field is live and the submit bar is there.
		expect(qty.disabled).toBe(false);
		fireEvent.change(qty, { target: { value: '5' } });
		fireEvent.click(screen.getByRole('button', { name: /Save Draft/ }));

		await waitFor(() => expect(mocks.updateInboundDoc).toHaveBeenCalledTimes(1));
		const [id, draft] = mocks.updateInboundDoc.mock.calls[0];
		expect(id).toBe('inb-1');
		// An EDIT states the counterparty pair and the clearable fields outright, so
		// switching the kind can empty the column it no longer uses and a note can be
		// cleared — a create simply omits what it was never given.
		expect(draft).toMatchObject({
			type: 'purchase',
			supplier: 'sup-1',
			handed_by: null,
			location: 'main_store',
			note: null,
			paid_at_receipt: false,
		});
		expect(draft.lines).toEqual([expect.objectContaining({ item_model: 'model-1', qty: 5, unit_price: 1200 })]);
	});
});

describe('InboundDetailPage — a confirmed receipt is the same layout, read-only', () => {
	it('disables every field, drops the save button, and keeps the money reachable', async () => {
		state.editor = {
			card: cardOf({ docStatus: 'confirmed', paidAmount: 1_000, paymentStatus: 'partial' }),
			seed: seedOf({ docStatus: 'confirmed' }),
		};
		renderPage();

		// The pill IS the whole statement — the receipt's KIND joined to its state. A
		// settled receipt's form has no kind selector left (a row of dead tabs would offer
		// a write the engine refuses), so the badge carries the kind.
		const pill = (await screen.findByText('Confirmed')).parentElement as HTMLElement;
		expect(pill.textContent).toBe('Purchase·Confirmed');

		// …and nothing explains the locked form a second time: no reason paragraph, and no
		// three dead kind tabs either.
		expect(screen.queryByText(/already posted/)).toBeNull();
		expect(screen.queryByText(/Nothing here can be changed/)).toBeNull();
		expect(screen.queryByRole('button', { name: 'Purchase' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Opening' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Return' })).toBeNull();

		// Not one live field: the quantity, the price, the note and the store picker.
		expect((screen.getByLabelText('Quantity') as HTMLInputElement).disabled).toBe(true);
		expect((screen.getByLabelText('Unit price') as HTMLInputElement).disabled).toBe(true);
		expect((screen.getByLabelText('Note') as HTMLTextAreaElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: /Select store/ }) as HTMLButtonElement).disabled).toBe(true);

		// Nothing pretends it can be saved, and the draft's confirm action is gone too.
		expect(screen.queryByRole('button', { name: /Save Draft/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /^Confirm$/ })).toBeNull();

		// …but cancelling is NOT gone, and it is NOT a bare button either: a posted
		// receipt's cancel REVERSES the posting, so it is one deliberate gesture away,
		// in the document's own ⋮.
		expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: /actions for INB-00031/i }));
		expect(screen.getByRole('menuitem', { name: 'Cancel & reverse' })).toBeTruthy();

		// The MONEY face stays — the receipt's figures are derived from the ledger, and
		// their sheet is where a payment is still recorded or removed.
		expect(screen.getByText('2,600 Ks')).toBeTruthy(); // Left = total − paid
		expect(screen.getByRole('button', { name: /^Payments for INB-00031/ })).toBeTruthy();
		// …and NOTHING asks about the money in the form: the draft's "Paid in full"
		// declaration is gone (its sentence speaks of what CONFIRMING will file), so the
		// strip above is the ONE statement of the receipt's money.
		expect(screen.queryByRole('checkbox', { name: /Paid in full/ })).toBeNull();
		expect(screen.queryByText(/records one payment of/)).toBeNull();
	});

	it('shows no money face on a kind that owes nobody', async () => {
		state.editor = {
			card: cardOf({
				docStatus: 'confirmed',
				type: 'return',
				supplierName: null,
				handedByName: 'Aung Aung',
				totalAmount: null,
				paidAmount: null,
				paymentStatus: null,
			}),
			seed: seedOf({ docStatus: 'confirmed', type: 'return', partyId: 'emp-9', partyName: 'Aung Aung' }),
		};
		renderPage('?type=return');

		// The KIND is the document's own — a return receipt reads `Return · Confirmed`.
		const pill = (await screen.findByText('Confirmed')).parentElement as HTMLElement;
		expect(pill.textContent).toBe('Return·Confirmed');
		expect(screen.getByText('Aung Aung')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Payments for/ })).toBeNull();
	});
});

describe('InboundDetailPage — a cancelled receipt is final', () => {
	it('renders read-only with NO action at all, and says a replacement is a new document', async () => {
		state.editor = {
			card: cardOf({ docStatus: 'cancelled', paidAmount: 0, paymentStatus: 'unpaid' }),
			seed: seedOf({ docStatus: 'cancelled' }),
		};
		renderPage();

		// The form is locked for the same reason a confirmed one is (the engine refuses
		// the write), so the screen never offers one…
		expect(((await screen.findByLabelText('Quantity')) as HTMLInputElement).disabled).toBe(true);
		expect(screen.queryByRole('button', { name: /Save Draft/ })).toBeNull();
		// …AND it offers no way back: a cancelled stock document is not reopened and not
		// deleted (the collection freezes `cancelled` too), so the only path is a new doc.
		// Poka-yoke: the ⋮ is ABSENT, not a menu with nothing behind it.
		expect(screen.queryByRole('button', { name: /^Confirm$/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /actions for INB-00031/i })).toBeNull();
		// The pill carries the receipt's kind AND its state (the form drops the kind
		// selector, and nothing else explains the final document).
		const pill = (await screen.findByText('Cancelled')).parentElement as HTMLElement;
		expect(pill.textContent).toBe('Purchase·Cancelled');
		expect(screen.queryByText(/was cancelled, so its stock effect/)).toBeNull();
		// A void receipt takes no money, so not even the ledger is offered.
		expect(screen.queryByRole('button', { name: /^Payments for/ })).toBeNull();
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	state.editor = null;
	window.history.replaceState(null, '', '/');
});
