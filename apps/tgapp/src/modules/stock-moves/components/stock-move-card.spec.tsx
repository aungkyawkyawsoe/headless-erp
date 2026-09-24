// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TransferCard } from './stock-move-card';
import type { TransferCardModel } from '../data/types';

/**
 * The transfer row's cancel/reverse affordance.
 *
 * The card once said a confirm "can’t be undone" and offered a posted move NOTHING —
 * a dead end that was TRUE before the API grew a reversal. It is false now: a POSTED
 * move offers the SAME `Cancel & reverse` the other stock documents do, a draft
 * offers both, and a `cancelled` move offers no action at all (frozen and final).
 *
 * The cancellation itself is NOT a second labelled button on the row: it is the ⋮
 * menu's entry, one deliberate gesture away from the confirm the operator may have
 * just pressed (poka-yoke — a reversal is destructive and final), and it is absent
 * entirely on a `cancelled` document. These tests pin that the copy and the actions
 * stay honest about the server.
 */

const confirmMock = vi.fn();
vi.mock('../data/use-transfer-confirm', () => ({
	useTransferConfirm: () => ({ busy: false, error: null, confirm: confirmMock }),
}));

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

function docOf(overrides: Partial<TransferCardModel> = {}): TransferCardModel {
	return {
		id: 'trf-1',
		displayNumber: 'TRF-00007',
		docStatus: 'draft',
		fromLabel: 'Main Store',
		toLabel: 'Admin Store',
		transferDate: '2026-09-20',
		note: null,
		reported: { id: 'emp-1', name: 'Reporting Operator', avatar: null },
		approved: { id: null, name: null, avatar: null },
		totalQty: 24,
		lineCount: 3,
		...overrides,
	};
}

function renderCard(doc: TransferCardModel) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<TransferCard doc={doc} />
		</QueryClientProvider>,
	);
}

/** Open the row's ⋮ — every lifecycle action except the draft's Confirm is behind it. */
function openMenu() {
	fireEvent.click(screen.getByRole('button', { name: /actions for TRF-00007/i }));
}

describe('TransferCard — the cancel/reverse affordance', () => {
	it('offers the draft a direct Confirm and the cancel behind the ⋮', () => {
		renderCard(docOf());
		expect(screen.getByRole('button', { name: /^Confirm$/ })).toBeTruthy();
		// Nothing irreversible sits next to the confirm — the cancel is a menu entry.
		expect(screen.queryByRole('button', { name: /^Cancel transfer$/ })).toBeNull();
		openMenu();
		expect(screen.getByRole('menuitem', { name: 'Cancel transfer' })).toBeTruthy();
	});

	it('offers Cancel & reverse on a POSTED move — behind the ⋮, never a bare cancel', () => {
		renderCard(docOf({ docStatus: 'confirmed', approved: { id: 'emp-2', name: 'Approver', avatar: null } }));
		// A posted move has no row-level action at all: its confirm is spent, and its
		// reversal is the ⋮'s business.
		expect(screen.queryByRole('button', { name: /^Confirm$/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull();
		openMenu();
		expect(screen.getByRole('menuitem', { name: 'Cancel & reverse' })).toBeTruthy();
	});

	it('offers no menu at all on a cancelled move — it is final', () => {
		renderCard(docOf({ docStatus: 'cancelled' }));
		expect(screen.queryByRole('button', { name: /^Confirm$/ })).toBeNull();
		// Poka-yoke: the ⋮ is ABSENT, not empty.
		expect(screen.queryByRole('button', { name: /actions for TRF-00007/i })).toBeNull();
		expect(screen.queryByText('Cancel transfer')).toBeNull();
		expect(screen.queryByText('Cancel & reverse')).toBeNull();
	});

	it('tells the operator a posted move CAN be reversed — never the old dead end', () => {
		renderCard(docOf());
		fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));
		expect(screen.getByText(/can still be reversed/)).toBeTruthy();
		expect(screen.queryByText(/undone/i), 'the old “can’t be undone” promise is gone').toBeNull();
	});

	it('states the stock story on the cancel sheet, from the shared derivation', () => {
		renderCard(docOf({ docStatus: 'confirmed' }));
		openMenu();
		fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel & reverse' }));
		expect(screen.getByText('Cancel this transfer and put the stock back?')).toBeTruthy();
		expect(screen.getByText(/source store gets its lots back/)).toBeTruthy();
	});
});
