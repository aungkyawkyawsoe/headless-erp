// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { InboundPaymentSheet } from './inbound-payment-sheet';
import type { InboundCardModel } from '../data/types';
import type { InboundPaymentModel } from '../data/payments';

/**
 * The payment sheet's contract — what a storekeeper sees and what filing sends.
 *
 *  - the ledger row is DAY-STAMPED (a payment record outlives the word "Today");
 *  - the form asks for the amount and the day and NOTHING else — no method chips,
 *    no reference field: the two facts the operator actually knows;
 *  - filing sends exactly those two fields (the engine fills the required
 *    `method` from the collection's declared default).
 */

const fetchInboundPayments = vi.fn();
const createInboundPayment = vi.fn();
const deleteInboundPayment = vi.fn();

vi.mock('../data/api', () => ({
	fetchInboundPayments: (id: string) => fetchInboundPayments(id),
	createInboundPayment: (input: unknown) => createInboundPayment(input),
	deleteInboundPayment: (inboundId: string, paymentId: string) => deleteInboundPayment(inboundId, paymentId),
}));

// Pin the store's calendar day so the "Today, …" prefix and the seeded date are
// deterministic (the sheet stamps every ledger row against it).
vi.mock('@/shared/time/myanmar', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/shared/time/myanmar')>()),
	todayMmtDate: () => '2026-09-20',
}));
vi.mock('@/shared/platform/haptics', () => ({ hapticImpact: () => {}, hapticSelection: () => {} }));

beforeAll(() => {
	// jsdom has no matchMedia; the design-system sheet probes it on mount.
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
		paidAmount: 0,
		paymentStatus: 'unpaid',
		fullyPaidOn: null,
		...overrides,
	};
}

const paymentOf = (overrides: Partial<InboundPaymentModel> = {}): InboundPaymentModel => ({
	id: 'pay-1',
	paidOn: '2026-09-12',
	amount: 500_000,
	note: null,
	recordedByName: 'Aung Kyaw',
	...overrides,
});

function renderSheet(doc: InboundCardModel) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<InboundPaymentSheet doc={doc} open onOpenChange={() => {}} />
		</QueryClientProvider>,
	);
}

describe('InboundPaymentSheet — the ledger', () => {
	it('day-stamps every row (date + recorder) instead of a relative word', async () => {
		fetchInboundPayments.mockResolvedValue([paymentOf()]);
		renderSheet(docOf({ paidAmount: 500_000, paymentStatus: 'partial' }));

		await waitFor(() => expect(screen.getByText('Sat, Sep 12, 2026 · Aung Kyaw')).toBeTruthy());
		// The row carries the amount and the day it was paid, side by side.
		const row = screen.getByText('Sat, Sep 12, 2026 · Aung Kyaw').closest('li');
		expect(row?.textContent).toContain('500,000 Ks');
		// The outstanding figure sits in the compact block's right-hand slot.
		expect(screen.getByText('1,000,000 Ks left')).toBeTruthy();
	});

	it('reads paid-of-total against the remainder, under the ledger’s entry count', async () => {
		fetchInboundPayments.mockResolvedValue([paymentOf()]);
		renderSheet(docOf({ paidAmount: 500_000, paymentStatus: 'partial' }));

		await waitFor(() => expect(screen.getByText('1 entry')).toBeTruthy());
		// One number, two readings of it — the summary's "Paid:" figure and the ledger
		// row that makes it up.
		expect(screen.getAllByText('500,000 Ks').length).toBe(2);
	});

	it('says so when nothing has been paid (and hides the ledger list)', async () => {
		fetchInboundPayments.mockResolvedValue([]);
		renderSheet(docOf());
		await waitFor(() => expect(screen.getByText('No payment recorded yet — this receipt is fully unpaid.')).toBeTruthy());
		expect(screen.getByText('Nothing paid yet')).toBeTruthy();
	});

	it('drops the form once the receipt is fully paid — the history is the story', async () => {
		fetchInboundPayments.mockResolvedValue([paymentOf({ amount: 1_500_000 })]);
		renderSheet(docOf({ paidAmount: 1_500_000, paymentStatus: 'paid', fullyPaidOn: '2026-09-12' }));

		await waitFor(() => expect(screen.getByText('1 entry')).toBeTruthy());

		// Nothing is owed, so the sheet stops asking: no amount field, no quick-fill,
		// no submit.
		expect(screen.queryByLabelText('Amount (Ks)')).toBeNull();
		expect(screen.queryByText('Pay remaining balance')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull();
		// …while the day it settled and the ledger itself STAY: a settled receipt is
		// still opened to be reviewed, and a wrong entry removed.
		expect(screen.getByText('Fully paid on Sep 12, 2026')).toBeTruthy();
		expect(screen.getByText('Sat, Sep 12, 2026 · Aung Kyaw')).toBeTruthy();
	});
});

describe('InboundPaymentSheet — the form', () => {
	it('asks for the amount and the day only — no method picker, no reference field', async () => {
		fetchInboundPayments.mockResolvedValue([]);
		renderSheet(docOf());
		await waitFor(() => expect(fetchInboundPayments).toHaveBeenCalled());

		expect(screen.queryByText('Method')).toBeNull();
		expect(screen.queryByText(/cash/i)).toBeNull();
		expect(screen.queryByText(/bank transfer/i)).toBeNull();
		expect(screen.queryByText('Reference')).toBeNull();
		// Exactly two inputs: the amount and the (defaulted) paid-on day.
		expect(screen.getAllByRole('textbox')).toHaveLength(1);
		expect(screen.getByLabelText('Amount (Ks)')).toBeTruthy();
	});
});

describe('InboundPaymentSheet — removing a wrong entry', () => {
	it('removes through the receipt’s own service route, not the generic entity delete', async () => {
		fetchInboundPayments.mockResolvedValue([paymentOf()]);
		deleteInboundPayment.mockResolvedValue(undefined);
		renderSheet(docOf({ paidAmount: 500_000, paymentStatus: 'partial' }));

		// The trash only ASKS; the ledger write happens on confirm.
		fireEvent.click(await screen.findByRole('button', { name: /^Remove the 500,000 Ks payment of/ }));
		expect(deleteInboundPayment).not.toHaveBeenCalled();
		fireEvent.click(await screen.findByRole('button', { name: 'Remove entry' }));

		// BOTH ids: the route re-derives THAT receipt's mirror, so the payment id alone
		// is not enough — and the generic DELETE (which needs `can_delete` on the
		// ledger, a grant no operator role carries) is never used.
		await waitFor(() => expect(deleteInboundPayment).toHaveBeenCalledWith('inb-1', 'pay-1'));
	});
});

describe('InboundPaymentSheet — filing', () => {
	it('prefills the remainder and files paid_on + amount, nothing else', async () => {
		fetchInboundPayments.mockResolvedValue([]);
		createInboundPayment.mockResolvedValue(paymentOf({ amount: 1_500_000 }));
		renderSheet(docOf());

		// Opened on an unpaid receipt, so the amount is prefilled with the whole total.
		const amount = screen.getByLabelText('Amount (Ks)') as HTMLInputElement;
		expect(amount.value).toBe('1500000');

		fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));

		await waitFor(() => expect(createInboundPayment).toHaveBeenCalledTimes(1));
		const payload = createInboundPayment.mock.calls[0][0] as Record<string, unknown>;
		// The DAY is the store's today and the AMOUNT is the figure entered — and the
		// payload carries no method / reference the sheet never asked about.
		expect(payload).toEqual({ parentId: 'inb-1', paidOn: '2026-09-20', amount: 1_500_000 });
		expect(Object.keys(payload)).toEqual(['parentId', 'paidOn', 'amount']);
	});

	it('offers no submit for a zero amount', async () => {
		fetchInboundPayments.mockResolvedValue([]);
		renderSheet(docOf());
		fireEvent.change(screen.getByLabelText('Amount (Ks)'), { target: { value: '0' } });
		expect((screen.getByRole('button', { name: 'Record payment' }) as HTMLButtonElement).disabled).toBe(true);
	});
});
