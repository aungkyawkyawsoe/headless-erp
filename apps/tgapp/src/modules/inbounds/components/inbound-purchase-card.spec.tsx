// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { InboundPurchaseCard } from './inbound-purchase-card';
import type { InboundCardModel } from '../data/types';

/**
 * The purchase card's money face — the contract the redesign exists for:
 *  - the Total/Paid/Left figures and the progress bar come STRAIGHT from the
 *    engine-derived mirror on the document (never recomputed client-side);
 *  - a settled receipt says WHICH DAY it settled;
 *  - the money strip and the ⋮ menu are the only interactive children of a row
 *    whose body opens the document — a tap on the money must not open the doc;
 *  - every lifecycle action lives behind the ⋮ (the row keeps only the draft's
 *    explicit Confirm), and a cancelled receipt offers no menu at all.
 */

const confirmMock = vi.fn();
vi.mock('../data/use-inbound-confirm', () => ({
	useInboundConfirm: () => ({ busy: null, error: null, confirm: confirmMock, cancel: confirmMock }),
}));

const spies = vi.hoisted(() => ({ sheetOpen: vi.fn() }));

// The payment sheet is a sibling surface with its own spec — here it reports only
// whether the money face opened it (the WIRING is what this spec watches).
vi.mock('./inbound-payment-sheet', () => ({
	InboundPaymentSheet: ({ open }: { open: boolean }) => {
		spies.sheetOpen(open);
		return null;
	},
}));

beforeAll(() => {
	// jsdom has no matchMedia; the design-system sheet/dropdown probes it on mount.
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
});

function docOf(overrides: Partial<InboundCardModel> = {}): InboundCardModel {
	return {
		id: 'inb-1',
		displayNumber: 'INB-00031',
		docStatus: 'confirmed',
		type: 'purchase',
		purchaseDate: '2026-09-20',
		location: 'main_store',
		locationLabel: 'Main Store',
		supplierName: 'Yangon Supplier Co.',
		handedByName: null,
		note: null,
		totalQty: 3,
		lineCount: 3,
		totalAmount: 1_500_000,
		paidAmount: 1_000_000,
		paymentStatus: 'partial',
		fullyPaidOn: null,
		...overrides,
	};
}

function renderCard(doc: InboundCardModel, onOpen = vi.fn()) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<InboundPurchaseCard doc={doc} onOpen={onOpen} />
		</QueryClientProvider>,
	);
	return onOpen;
}

describe('InboundPurchaseCard — money state', () => {
	it('shows the engine mirror as Paid / Left without repeating the total', () => {
		renderCard(docOf());
		// The total is spent ONCE — the headline "Total cost". The strip below it
		// carries only what the header does not say (Paid / Left).
		expect(screen.getAllByText('1,500,000 Ks').length).toBe(1);
		expect(screen.getByText('1,000,000 Ks')).toBeTruthy(); // Paid
		expect(screen.getByText('500,000 Ks')).toBeTruthy(); // Left
		expect(screen.getByText('Partially paid · 500,000 Ks left')).toBeTruthy();
	});

	it('fills the progress bar to the paid share and keeps it under 100% until settled', () => {
		renderCard(docOf());
		const fill = document.querySelector('.bg-status-warning') as HTMLElement;
		expect(fill.style.width).toBe('67%'); // 1,000,000 / 1,500,000
	});

	it('names the day a settled receipt was cleared', () => {
		renderCard(docOf({ paidAmount: 1_500_000, paymentStatus: 'paid', fullyPaidOn: '2026-09-12' }));
		expect(screen.getByText(/Fully paid on/)).toBeTruthy();
		expect(screen.getByText(/Sep 12, 2026/)).toBeTruthy();
		expect((document.querySelector('.bg-status-success') as HTMLElement).style.width).toBe('100%');
		expect(screen.getByText('0 Ks')).toBeTruthy(); // Left — nothing outstanding
	});

	it('reads Unpaid with an empty bar when nothing has been paid', () => {
		renderCard(docOf({ paidAmount: 0, paymentStatus: 'unpaid' }));
		expect(screen.getByText('Unpaid — nothing paid yet')).toBeTruthy();
		expect((document.querySelector('.bg-muted-foreground\\/30') as HTMLElement).style.width).toBe('0%');
	});

	it('offers no money strip before the receipt has a value (a draft is not owed yet)', () => {
		renderCard(docOf({ docStatus: 'draft', totalAmount: null, paidAmount: null, paymentStatus: 'unpaid' }));
		expect(screen.queryByText('Total cost')).toBeTruthy(); // the row still leads with the figure slot
		expect(screen.queryByText('Partially paid · 500,000 Ks left')).toBeNull();
		expect(screen.getByRole('button', { name: /confirm receipt/i })).toBeTruthy();
	});

	it('opens the document from the row body but never from the money strip', () => {
		const onOpen = renderCard(docOf());
		// The money strip is its own control — a tap there must not open the doc.
		const strip = screen.getByRole('button', { name: /^Payments for INB-00031/ });
		fireEvent.click(strip);
		expect(onOpen).not.toHaveBeenCalled();
	});
});

describe('InboundPurchaseCard — the ⋮ actions', () => {
	it('offers Record payment on a confirmed, priced receipt', () => {
		renderCard(docOf());
		fireEvent.click(screen.getByRole('button', { name: /actions for INB-00031/i }));
		expect(screen.getByText('Record payment')).toBeTruthy();
		// Nothing was a draft, so no bare draft cancel is offered.
		expect(screen.queryByText('Cancel receipt')).toBeNull();
	});

	it('actually RUNS the entry it was given — the menu is not decoration', () => {
		renderCard(docOf());
		fireEvent.click(screen.getByRole('button', { name: /actions for INB-00031/i }));
		// A base-ui `Menu.Item` takes `onClick`; an entry wired to the DOM's text-selection
		// `onSelect` would render, highlight, and do nothing at all.
		fireEvent.click(screen.getByText('Record payment'));
		expect(spies.sheetOpen).toHaveBeenCalledWith(true);
	});

	it('offers confirm + cancel on a draft', () => {
		renderCard(docOf({ docStatus: 'draft', paidAmount: 0, paymentStatus: 'unpaid' }));
		fireEvent.click(screen.getByRole('button', { name: /actions for INB-00031/i }));
		// "Confirm receipt" is the draft's fast path AND the menu entry — both are fine,
		// the point is that the ⋮ menu carries the full action set.
		expect(screen.getAllByText('Confirm receipt').length).toBeGreaterThanOrEqual(2);
		// The menu's cancel label IS the shared derivation's (`cancelCopyOf`), i.e. the
		// same string the sheet's confirm button will wear.
		expect(screen.getByText('Cancel receipt')).toBeTruthy();
	});

	it('stops offering Record payment once the receipt is fully paid', () => {
		renderCard(docOf({ paidAmount: 1_500_000, paymentStatus: 'paid', fullyPaidOn: '2026-09-12' }));
		fireEvent.click(screen.getByRole('button', { name: /actions for INB-00031/i }));

		// Nothing is owed, so nothing asks for money — no menu entry leading to a
		// form-less sheet.
		expect(screen.queryByText('Record payment')).toBeNull();
		// The money face STAYS: a settled receipt is still worth reading, and its
		// ledger still opens (to review the entries, or remove a wrong one).
		expect(screen.getByRole('button', { name: /^Payments for INB-00031/ })).toBeTruthy();
		expect(screen.getByText('Fully paid on Sep 12, 2026')).toBeTruthy();
	});

	it('offers Cancel & reverse on a POSTED receipt — the one verb that undoes the posting', () => {
		renderCard(docOf());
		// The cancellation is NOT a button beside the row's own controls: a posted
		// receipt's cancel REVERSES it, so it lives one deliberate gesture away, in
		// the ⋮ only the row's own menu opens.
		expect(screen.queryByRole('button', { name: /Cancel & reverse/ })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: /actions for INB-00031/i }));
		expect(screen.getByText('Cancel & reverse')).toBeTruthy();
	});

	it('offers no menu at all on a cancelled receipt — it is final', () => {
		renderCard(docOf({ docStatus: 'cancelled', paidAmount: 0, paymentStatus: 'unpaid' }));
		// A void document takes no money and cannot be cancelled again (the server is
		// frozen and the route is an idempotent no-op). Poka-yoke: the ⋮ is ABSENT, not
		// empty — a menu with nothing behind it is not rendered at all.
		expect(screen.queryByRole('button', { name: /actions for INB-00031/i })).toBeNull();
		expect(screen.queryByText('Record payment')).toBeNull();
		expect(screen.queryByText('Cancel & reverse')).toBeNull();
	});
});
