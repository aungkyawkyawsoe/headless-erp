// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { OutboundDocCard } from './outbound-doc-card';
import type { OutboundCardModel } from '../data/types';

/**
 * The goods-issue row's ANATOMY — the two rules the outbound list is read by:
 *
 *  1. the top-right corner is the LIFECYCLE, not the money: a scan of this list is
 *     deciding what state a document is in and what can still be done about it, so
 *     the status pill and the document's ⋮ own that corner (the ⋮ being the LAST
 *     thing in it). The total is not deleted — it is ranked, one tap away in the
 *     disclosure facts, instead of being read twice in two registers.
 *  2. the ⋮ is the row's ONLY destructive affordance, and it is absent on a
 *     `cancelled` document (frozen and final) rather than rendered empty.
 */

const confirmMock = vi.fn();
vi.mock('../data/use-outbound-confirm', () => ({
	useOutboundConfirm: () => ({ busy: false, error: null, confirm: confirmMock }),
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

function docOf(overrides: Partial<OutboundCardModel> = {}): OutboundCardModel {
	return {
		id: 'out-1',
		displayNumber: 'OUT-00018',
		docStatus: 'confirmed',
		type: 'goods_issue',
		location: 'main_store',
		locationLabel: 'Main Store',
		effectiveDate: '2026-09-05',
		requestRef: null,
		issuedBy: { id: 'emp-1', name: 'Issuer', avatar: null },
		note: null,
		totalQty: 3,
		lineCount: 3,
		totalAmount: 6400,
		destination: 'TRK-X',
		...overrides,
	};
}

function renderCard(doc: OutboundCardModel) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<OutboundDocCard doc={doc} />
		</QueryClientProvider>,
	);
}

describe('OutboundDocCard — the row anatomy', () => {
	it('leads the top-right with the lifecycle (status + ⋮) and NOT with the money', () => {
		renderCard(docOf());

		// The amount is nowhere on the collapsed face…
		expect(screen.queryByText('6,400 Ks')).toBeNull();
		// …while the lifecycle is: the status pill, then the ⋮ as the LAST control in
		// the top-right corner.
		expect(screen.getByText('Confirmed')).toBeTruthy();
		const chevron = screen.getByRole('button', { name: 'Show details' });
		expect(chevron.nextElementSibling).toBe(screen.getByRole('button', { name: /actions for OUT-00018/i }));
	});

	it('keeps the total one tap away — ranked behind the disclosure, never deleted', () => {
		renderCard(docOf());
		expect(screen.queryByText('6,400 Ks')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
		expect(screen.getByText('6,400 Ks')).toBeTruthy();
	});

	it('keeps the draft’s direct Confirm and puts the cancel behind the ⋮', () => {
		renderCard(docOf({ docStatus: 'draft' }));
		expect(screen.getByRole('button', { name: /^Confirm$/ })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: /actions for OUT-00018/i }));
		expect(screen.getByRole('menuitem', { name: 'Cancel issue' })).toBeTruthy();
	});

	it('offers a POSTED issue Cancel & reverse behind the ⋮ — never a bare cancel', () => {
		renderCard(docOf());
		expect(screen.queryByRole('button', { name: /^Confirm$/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: /actions for OUT-00018/i }));
		expect(screen.getByRole('menuitem', { name: 'Cancel & reverse' })).toBeTruthy();
	});

	it('offers no menu at all on a cancelled issue — it is final', () => {
		renderCard(docOf({ docStatus: 'cancelled' }));
		expect(screen.queryByRole('button', { name: /actions for OUT-00018/i })).toBeNull();
		expect(screen.queryByText('Cancel issue')).toBeNull();
		expect(screen.queryByText('Cancel & reverse')).toBeNull();
	});
});
