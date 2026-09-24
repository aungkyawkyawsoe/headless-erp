// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import StockMoveDetailPage from './stock-move-detail-page';
import type { TransferCardModel, TransferFormSeed } from '../data/types';

/**
 * The document page IS the form — the one layout rule this page owns.
 *
 *  - a DRAFT opens the prefilled create form and SAVES back to the SAME row
 *    (`PUT /api/entities/mro_transfers/:id`), so a mis-typed move is corrected
 *    instead of cancelled and re-created — and the save never re-states the
 *    reporter (`actor_fields`, and the reporter of a report must not change);
 *  - a CONFIRMED move renders the same layout READ-ONLY — no live field and no save
 *    button, because the engine (`writes.freeze_when doc_status …`) would refuse
 *    that write anyway — while the ONE cancel stays reachable in the ⋮;
 *  - a CANCELLED move is final: read-only, and no action at all.
 */

const mocks = vi.hoisted(() => ({
	updateTransferDoc: vi.fn(async (_id: string, _draft: Record<string, unknown>) => ({ id: 'trf-1' })),
	createTransferDoc: vi.fn(async () => ({ id: 'trf-2' })),
}));

const state = vi.hoisted(() => ({
	editor: null as { card: TransferCardModel; seed: TransferFormSeed } | null,
	models: [] as Array<{ id: string; name_en: string; name_mm: string | null; tracking: string; item_name: { tracking: string } }>,
}));

const MODEL = { id: 'model-1', name_en: 'Bolt M10', name_mm: null, tracking: 'standard', item_name: { tracking: 'standard' } };

// Every export the page / form / confirm hook pulls off this module must exist here.
vi.mock('../data/api', () => ({
	fetchTransferDocEditor: async () => state.editor,
	updateTransferDoc: mocks.updateTransferDoc,
	createTransferDoc: mocks.createTransferDoc,
	confirmTransferDoc: vi.fn(async () => ({})),
}));
// The shell is chrome-only (app bar + body) — the spec needs nothing of it.
vi.mock('@/shared/components/module-shell', () => ({
	ModuleShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/shared/platform/use-main-button', () => ({ useTelegramMainButton: () => false }));
vi.mock('@/shared/hooks/use-mro-item-models', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/shared/hooks/use-mro-item-models')>()),
	useMroItemModels: () => ({ data: state.models, isPending: false, isError: false, refetch: vi.fn() }),
	filterMroItemModels: (models: unknown[]) => models,
}));
vi.mock('@/modules/attendance/data/api', () => ({ fetchCurrentEmployee: vi.fn(async () => null) }));

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
	if (!Element.prototype.getAnimations) Element.prototype.getAnimations = () => [];
});

beforeEach(() => {
	state.models = [MODEL];
});

function cardOf(overrides: Partial<TransferCardModel> = {}): TransferCardModel {
	return {
		id: 'trf-1',
		displayNumber: 'TRF-00007',
		docStatus: 'draft',
		fromLabel: 'Main store',
		toLabel: 'Mandalay store',
		transferDate: '2026-09-20',
		note: null,
		reported: { id: 'emp-1', name: 'Aung Aung', avatar: null },
		approved: { id: null, name: null, avatar: null },
		totalQty: 3,
		lineCount: 1,
		...overrides,
	};
}

function seedOf(overrides: Partial<TransferFormSeed> = {}): TransferFormSeed {
	return {
		id: 'trf-1',
		transferDate: '2026-09-20',
		fromLocation: 'main_store',
		toLocation: 'mandalay_store',
		note: '',
		lines: [{ modelId: 'model-1', modelName: 'Bolt M10', tracking: 'standard', qty: 3, batchNo: '', serials: [] }],
		docStatus: 'draft',
		...overrides,
	};
}

/** Mount the page at its real URL. nuqs' router adapter reads the address bar, so
 *  the harness mirrors the router's entry into it (as the browser would). */
function renderPage(search = '?status=all') {
	const path = `/app/stock-moves/trf-1${search}`;
	window.history.replaceState(null, '', path);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[path]}>
				<NuqsAdapter>
					<Routes>
						<Route path="/app/stock-moves/:id" element={<StockMoveDetailPage />} />
						{/* The post-save destination — the page pops back to the list. */}
						<Route path="/app/stock-moves" element={<div />} />
					</Routes>
				</NuqsAdapter>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe('StockMoveDetailPage — a draft opens its own form', () => {
	it('prefills the fields from the document and SAVES back to the same row', async () => {
		state.editor = { card: cardOf(), seed: seedOf() };
		renderPage();

		// Prefilled — the qty, the SKU and the ROUTE all come off the document, and the
		// status pill names what this is.
		const qty = (await screen.findByLabelText('Quantity')) as HTMLInputElement;
		expect(qty.value).toBe('3');
		expect(screen.getByText('Bolt M10')).toBeTruthy();
		expect(screen.getByText('Draft')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Select From store' }).textContent).toContain('Main store');
		expect(screen.getByRole('button', { name: 'Select To store' }).textContent).toContain('Mandalay store');

		// A draft is WRITABLE: the field is live and the submit bar is there.
		expect(qty.disabled).toBe(false);
		fireEvent.change(qty, { target: { value: '5' } });
		fireEvent.click(screen.getByRole('button', { name: /Save Draft/ }));

		await waitFor(() => expect(mocks.updateTransferDoc).toHaveBeenCalledTimes(1));
		const [id, draft] = mocks.updateTransferDoc.mock.calls[0];
		expect(id).toBe('trf-1');
		// An EDIT states the clearable note outright (empty ⇒ `null`), and never the
		// reporter: `mro_transfers` declares `actor_fields: ['reported_by']`, so sending
		// it could reassign who filed the report.
		expect(draft).toMatchObject({
			from_location: 'main_store',
			to_location: 'mandalay_store',
			transfer_date: '2026-09-20',
			note: null,
		});
		expect(draft).not.toHaveProperty('reported_by');
		expect(draft.lines).toEqual([expect.objectContaining({ item_model: 'model-1', qty: 5 })]);
	});

	it('keeps a seeded BATCH restriction and a line the SKU directory no longer knows', async () => {
		// The cached directory is deliberately EMPTY: everything painted below can only
		// come from the stored document's own seed, which is exactly what is under test.
		state.models = [];
		state.editor = {
			card: cardOf(),
			seed: seedOf({
				lines: [{ modelId: 'model-batch', modelName: 'Oil 5W-30', tracking: 'batch', qty: 4, batchNo: 'B-77', serials: [] }],
			}),
		};
		renderPage();

		// The stored line's own name stands in for the directory…
		expect(await screen.findByText('Oil 5W-30')).toBeTruthy();
		// …and its batch field is on screen because the row's POLICY came off the stored
		// line, not off a directory read that has not landed.
		const batch = (await screen.findByPlaceholderText('Batch no. — blank = FEFO')) as HTMLInputElement;
		expect(batch.value).toBe('B-77');

		fireEvent.click(screen.getByRole('button', { name: /Save Draft/ }));
		await waitFor(() => expect(mocks.updateTransferDoc).toHaveBeenCalledTimes(1));
		const draft = mocks.updateTransferDoc.mock.calls[0][1];
		// A SKU missing from the directory is saved AS IT WAS — dropping the line would
		// silently delete stock from the document — and its batch restriction survives,
		// because the confirm picks the lot with it.
		expect(draft.lines).toEqual([{ item_model: 'model-batch', qty: 4, batch_no: 'B-77' }]);
	});
});

describe('StockMoveDetailPage — a confirmed move is the same layout, read-only', () => {
	it('disables every field, drops the save button, and keeps the cancel one deliberate gesture away', async () => {
		state.editor = { card: cardOf({ docStatus: 'confirmed' }), seed: seedOf({ docStatus: 'confirmed' }) };
		renderPage();

		// The pill IS the statement: the status name resolves exactly ONCE on the page, and
		// nothing under it explains the read-only form a second time.
		expect(await screen.findByText('Confirmed')).toBeTruthy();
		expect(screen.getAllByText('Confirmed')).toHaveLength(1);
		expect(screen.queryByText(/already posted/)).toBeNull();

		// Not one live field — and not one ACTION either: adding or removing a line is a
		// write, so those controls are gone rather than dead.
		expect((screen.getByLabelText('Quantity') as HTMLInputElement).disabled).toBe(true);
		expect((screen.getByLabelText('Note') as HTMLTextAreaElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: 'Select To store' }) as HTMLButtonElement).disabled).toBe(true);
		expect(screen.queryByRole('button', { name: /Add item/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /Remove line/ })).toBeNull();

		// Nothing pretends it can be saved, and the draft's confirm action is gone too.
		expect(screen.queryByRole('button', { name: /Save Draft/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /^Confirm$/ })).toBeNull();

		// …but cancelling is NOT gone, and it is NOT a bare button either: a posted move's
		// cancel REVERSES the posting, so it is one deliberate gesture away, in the
		// document's own ⋮.
		expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: /actions for TRF-00007/i }));
		expect(screen.getByRole('menuitem', { name: 'Cancel & reverse' })).toBeTruthy();
	});
});

describe('StockMoveDetailPage — a cancelled move is final', () => {
	it('renders read-only with NO action at all, and says a replacement is a new document', async () => {
		state.editor = { card: cardOf({ docStatus: 'cancelled' }), seed: seedOf({ docStatus: 'cancelled' }) };
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
		expect(screen.queryByRole('button', { name: /actions for TRF-00007/i })).toBeNull();
		// A void move is final, and the pill says so — nothing under it: the notice and the
		// footer were the same fact in two voices, and the pill is the ONE statement now.
		expect(screen.queryByText(/was cancelled, so its stock effect/)).toBeNull();
		expect(screen.queryByText(/Nothing here can be changed/)).toBeNull();
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	state.editor = null;
	window.history.replaceState(null, '', '/');
});
