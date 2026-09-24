// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import OutboundDetailPage from './outbound-detail-page';
import type { OutboundCardModel, OutboundFormSeed } from '../data/types';

/**
 * The document page IS the form — the one layout rule this page owns.
 *
 *  - a DRAFT opens the prefilled create form and SAVES back to the SAME row
 *    (`PUT /api/entities/mro_outbounds/:id`), so a mis-typed issue is corrected
 *    instead of cancelled and re-created;
 *  - a CONFIRMED issue renders the same layout READ-ONLY — no live field and no
 *    save button, because the engine (`writes.freeze_when doc_status …`) would
 *    refuse that write anyway — while the ONE cancel stays reachable in the ⋮;
 *  - a CANCELLED issue is final: read-only, and no action at all.
 */

const mocks = vi.hoisted(() => ({
	updateOutboundDoc: vi.fn(async (_id: string, _draft: Record<string, unknown>) => ({ id: 'out-1' })),
	createOutboundDoc: vi.fn(async () => ({ id: 'out-2' })),
}));

const state = vi.hoisted(() => ({
	editor: null as { card: OutboundCardModel; seed: OutboundFormSeed } | null,
	models: [] as Array<{ id: string; name_en: string; name_mm: string | null; tracking: string; item_name: { tracking: string } }>,
	onHandRows: [] as Array<Record<string, unknown>>,
}));

const MODEL = { id: 'model-1', name_en: 'Bolt M10', name_mm: null, tracking: 'standard', item_name: { tracking: 'standard' } };
const TYRE = { id: 'model-tyre', name_en: 'Tyre 11R', name_mm: null, tracking: 'serial', item_name: { tracking: 'serial' } };

vi.mock('../data/api', () => ({
	fetchOutboundDocEditor: async () => state.editor,
	updateOutboundDoc: mocks.updateOutboundDoc,
	createOutboundDoc: mocks.createOutboundDoc,
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
vi.mock('@/shared/hooks/use-on-hand-report', () => ({
	useOnHandReport: () => ({ data: state.onHandRows, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/shared/lookups/hooks', () => ({
	useVehicleMasters: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/shared/lookups/api', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/shared/lookups/api')>()),
	searchEmployees: vi.fn(async () => []),
}));
vi.mock('@/shared/api/search', () => ({
	searchGlobal: vi.fn(async () => []),
	globalSearchKey: (collection: string, term: string) => ['search', collection, term],
}));
vi.mock('@/shared/hooks/use-debounced-value', () => ({ useDebouncedValue: (value: string) => value }));

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
	state.models = [MODEL, TYRE];
	state.onHandRows = [
		{
			id: 'inv-model-1',
			model: 'model-1',
			model_name: 'Bolt M10',
			tracking: 'standard',
			qty_on_hand: 50,
			reorder_level: null,
			derived_qty: 50,
			expired_qty: 0,
			drift: false,
			below_reorder: false,
		},
	];
});

function cardOf(overrides: Partial<OutboundCardModel> = {}): OutboundCardModel {
	return {
		id: 'out-1',
		displayNumber: 'OUT-00031',
		docStatus: 'draft',
		type: 'goods_issue',
		location: 'main_store',
		locationLabel: 'Main Store',
		effectiveDate: '2026-09-20',
		requestRef: null,
		issuedBy: { id: null, name: null, avatar: null },
		note: null,
		totalQty: 3,
		lineCount: 1,
		totalAmount: 3_600,
		destination: null,
		...overrides,
	};
}

function seedOf(overrides: Partial<OutboundFormSeed> = {}): OutboundFormSeed {
	return {
		id: 'out-1',
		type: 'goods_issue',
		effectiveDate: '2026-09-20',
		location: 'main_store',
		note: '',
		requestId: null,
		destinationKind: null,
		destinationId: null,
		destinationLabel: null,
		lines: [{ modelId: 'model-1', modelName: 'Bolt M10', tracking: 'standard', qty: 3, unitPrice: null, serials: [] }],
		docStatus: 'draft',
		...overrides,
	};
}

/** Mount the page at its real URL. nuqs' router adapter reads the address bar, so
 *  the harness mirrors the router's entry into it (as the browser would). */
function renderPage(search = '?type=goods_issue') {
	const path = `/app/outbounds/out-1${search}`;
	window.history.replaceState(null, '', path);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[path]}>
				<NuqsAdapter>
					<Routes>
						<Route path="/app/outbounds/:id" element={<OutboundDetailPage />} />
						{/* The post-save destination — the page pops back to the list. */}
						<Route path="/app/outbounds" element={<div />} />
					</Routes>
				</NuqsAdapter>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe('OutboundDetailPage — a draft opens its own form', () => {
	it('prefills the fields from the document and SAVES back to the same row', async () => {
		state.editor = { card: cardOf(), seed: seedOf({ requestId: 'req-1' }) };
		renderPage();

		// Prefilled — the qty and the SKU both come off the document, and the status
		// pill names what this is.
		const qty = (await screen.findByLabelText('Quantity')) as HTMLInputElement;
		expect(qty.value).toBe('3');
		expect(screen.getByText('Bolt M10')).toBeTruthy();
		expect(screen.getByText('Draft')).toBeTruthy();

		// A draft is WRITABLE: the field is live and the submit bar is there.
		expect(qty.disabled).toBe(false);
		fireEvent.change(qty, { target: { value: '5' } });
		fireEvent.click(screen.getByRole('button', { name: /Save Draft/ }));

		await waitFor(() => expect(mocks.updateOutboundDoc).toHaveBeenCalledTimes(1));
		const [id, draft] = mocks.updateOutboundDoc.mock.calls[0];
		expect(id).toBe('out-1');
		// An EDIT states the holder pair and the clearable text outright, and re-states
		// the source-request link, so an edit can neither drop the link nor invent one —
		// and can empty the column it no longer uses.
		expect(draft).toMatchObject({
			type: 'goods_issue',
			effective_date: '2026-09-20',
			location: 'main_store',
			request: 'req-1',
			to_vehicle: null,
			to_employee: null,
			note: null,
		});
		expect(draft.lines).toEqual([expect.objectContaining({ item_model: 'model-1', qty: 5 })]);
	});

	it('seeds a serial issue with the holder it was filed for — the truck reads chosen before the plate directory lands', async () => {
		// The vehicle directory is deliberately EMPTY: the plate on screen can only come
		// from the stored document's own label, which is exactly the fallback under test.
		state.editor = {
			card: cardOf({ destination: 'TRK-X' }),
			seed: seedOf({
				destinationKind: 'fleet',
				destinationId: 'veh-1',
				destinationLabel: 'TRK-X',
				lines: [{ modelId: 'model-tyre', modelName: 'Tyre 11R', tracking: 'serial', qty: 2, unitPrice: null, serials: ['TY-1', 'TY-2'] }],
			}),
		};
		renderPage();

		// The row's quantity IS its picks, and the holder it goes to is stated.
		expect(await screen.findByText('2 serials selected')).toBeTruthy();
		expect(screen.getByLabelText('Select a truck').textContent).toContain('TRK-X');

		fireEvent.click(screen.getByRole('button', { name: /Save Draft/ }));
		await waitFor(() => expect(mocks.updateOutboundDoc).toHaveBeenCalledTimes(1));
		const draft = mocks.updateOutboundDoc.mock.calls[0][1];
		expect(draft.to_vehicle).toBe('veh-1');
		expect(draft.to_employee).toBeNull();
		expect(draft.lines).toEqual([{ item_model: 'model-tyre', qty: 2, serials: ['TY-1', 'TY-2'] }]);
	});
});

describe('OutboundDetailPage — a confirmed issue is the same layout, read-only', () => {
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
		expect((screen.getByRole('button', { name: /Select store/ }) as HTMLButtonElement).disabled).toBe(true);
		expect(screen.queryByRole('button', { name: /Add item/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /Remove line/ })).toBeNull();

		// Nothing pretends it can be saved, and the draft's confirm action is gone too.
		expect(screen.queryByRole('button', { name: /Save Draft/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /^Confirm$/ })).toBeNull();

		// …but cancelling is NOT gone, and it is NOT a bare button either: a posted
		// issue's cancel REVERSES the posting, so it is one deliberate gesture away, in
		// the document's own ⋮.
		expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: /actions for OUT-00031/i }));
		expect(screen.getByRole('menuitem', { name: 'Cancel & reverse' })).toBeTruthy();
	});
});

describe('OutboundDetailPage — a cancelled issue is final', () => {
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
		expect(screen.queryByRole('button', { name: /actions for OUT-00031/i })).toBeNull();
		// A void issue is final, and the pill says so: no sentence under it, because the
		// footer and the notice used to be the same fact in two voices and the pill is now
		// the ONE statement.
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
