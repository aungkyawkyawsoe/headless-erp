// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { InboundDocCard } from './inbound-doc-card';
import type { InboundCardModel } from '../data/types';

/**
 * The opening-balance / return row (the dense `ErpRow`, not the money-first purchase
 * face) and its cancel affordance.
 *
 * A stock document's lifecycle exit is NOT a second labelled button beside the row's
 * primary control: the draft's Confirm keeps that slot, and the ONE cancel — which
 * REVERSES a posted receipt rather than merely flipping it — lives behind the row's
 * top-right ⋮. A `cancelled` document (frozen and final) renders no ⋮ at all, not a
 * menu with nothing behind it.
 */

const confirmMock = vi.fn();
vi.mock('../data/use-inbound-confirm', () => ({
	useInboundConfirm: () => ({ busy: false, error: null, confirm: confirmMock }),
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
		id: 'inb-9',
		displayNumber: 'INB-00042',
		docStatus: 'draft',
		type: 'legacy',
		purchaseDate: '2026-09-20',
		location: 'main_store',
		locationLabel: 'Main Store',
		supplierName: null,
		handedByName: 'Aung Aung',
		note: null,
		totalQty: 12,
		lineCount: 2,
		totalAmount: null,
		paidAmount: null,
		paymentStatus: null,
		fullyPaidOn: null,
		...overrides,
	};
}

function renderCard(doc: InboundCardModel) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<InboundDocCard doc={doc} />
		</QueryClientProvider>,
	);
}

/** Open the row's ⋮ — where the lifecycle exit lives. */
function openMenu() {
	fireEvent.click(screen.getByRole('button', { name: /actions for INB-00042/i }));
}

describe('InboundDocCard (opening balance / return) — the cancel affordance', () => {
	it('keeps the draft Confirm on the row and the cancel behind the ⋮', () => {
		renderCard(docOf());
		expect(screen.getByRole('button', { name: /^Confirm$/ })).toBeTruthy();
		// Nothing irreversible sits beside the confirm.
		expect(screen.queryByRole('button', { name: /^Cancel/ })).toBeNull();
		openMenu();
		// The label IS `cancelCopyOf('inbounds', 'draft').label` — the same string the
		// sheet's confirm button wears, so the entry and the write it performs agree.
		expect(screen.getByRole('menuitem', { name: 'Cancel receipt' })).toBeTruthy();
	});

	it('offers a POSTED receipt Cancel & reverse behind the ⋮ — never a bare cancel', () => {
		renderCard(docOf({ docStatus: 'confirmed' }));
		// A posted receipt has no row-level action: its confirm is spent.
		expect(screen.queryByRole('button', { name: /^Confirm$/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull();
		openMenu();
		expect(screen.getByRole('menuitem', { name: 'Cancel & reverse' })).toBeTruthy();
	});

	it('offers no menu at all on a cancelled receipt — it is final', () => {
		renderCard(docOf({ docStatus: 'cancelled' }));
		expect(screen.queryByRole('button', { name: /actions for INB-00042/i })).toBeNull();
		expect(screen.queryByText('Cancel receipt')).toBeNull();
		expect(screen.queryByText('Cancel & reverse')).toBeNull();
	});
});
