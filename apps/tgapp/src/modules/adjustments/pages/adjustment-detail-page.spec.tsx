// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import AdjustmentDetailPage from './adjustment-detail-page';
import type { AdjustmentCardModel, AdjustmentFormSeed } from '../data/types';

/**
 * The document page IS the form — the one layout rule this page owns.
 *
 *  - a DRAFT opens the prefilled create form and SAVES back to the SAME row
 *    (`PUT /api/entities/mro_adjustments/:id`), so a mis-typed correction is fixed
 *    instead of cancelled and re-created — and the save never re-states the reporter
 *    (`actor_fields`, and the two-person rule is built on it);
 *  - a CONFIRMED (applied) correction renders the same layout READ-ONLY — no live
 *    field and no save button, because the engine
 *    (`writes.freeze_when doc_status …`) would refuse that write anyway — while the
 *    ONE cancel stays reachable in the ⋮, where it REVERSES the posting;
 *  - a CANCELLED one is final: read-only, and no action at all.
 *
 * Two LOCAL rules get their own case because both are silent when broken: a batch
 * ADD cannot be saved without its lot (the operator sees the same refusal the
 * confirm would give, before it happens), and a REMOVE never offers the lot at all.
 */

const mocks = vi.hoisted(() => ({
	updateAdjustmentDoc: vi.fn(async (_id: string, _draft: Record<string, unknown>) => ({ id: 'ajt-1' })),
	createAdjustmentDoc: vi.fn(async () => ({ id: 'ajt-2' })),
}));

const state = vi.hoisted(() => ({
	editor: null as { card: AdjustmentCardModel; seed: AdjustmentFormSeed } | null,
	models: [] as Array<{ id: string; name_en: string; name_mm: string | null; tracking: string; item_name: { tracking: string } }>,
}));

const MODEL_BATCH = { id: 'model-1', name_en: 'Tyre 11R', name_mm: null, tracking: 'batch', item_name: { tracking: 'batch' } };

// Every export the page / form / approve hook pulls off this module must exist here.
vi.mock('../data/api', () => ({
	fetchAdjustmentDocEditor: async () => state.editor,
	updateAdjustmentDoc: mocks.updateAdjustmentDoc,
	createAdjustmentDoc: mocks.createAdjustmentDoc,
	confirmAdjustment: vi.fn(async () => ({})),
	fetchAdjustmentPage: vi.fn(async () => ({ rows: [], nextCursor: null, hasMore: false })),
	fetchAdjustmentSearch: vi.fn(async () => []),
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
	state.models = [];
});

function cardOf(overrides: Partial<AdjustmentCardModel> = {}): AdjustmentCardModel {
	return {
		id: 'ajt-1',
		displayNumber: 'AJT-00021',
		docStatus: 'draft',
		location: 'mandalay_store',
		locationLabel: 'Mandalay store',
		adjustmentDate: '2026-09-20',
		description: 'Two tyres counted short',
		reported: { id: 'emp-1', name: 'Aung Aung', avatar: null },
		approved: { id: null, name: null, avatar: null },
		totalQty: 2,
		lineCount: 1,
		...overrides,
	};
}

function seedOf(overrides: Partial<AdjustmentFormSeed> = {}): AdjustmentFormSeed {
	return {
		id: 'ajt-1',
		adjustmentDate: '2026-09-20',
		location: 'mandalay_store',
		description: 'Two tyres counted short',
		lines: [
			{
				modelId: 'model-1',
				modelName: 'Tyre 11R',
				tracking: 'batch',
				direction: 'add',
				qty: 2,
				batchNo: 'B-77',
				expiryDate: '2027-01-31',
				unitCost: 9000,
				serials: [],
			},
		],
		docStatus: 'draft',
		...overrides,
	};
}

/** Mount the page at its real URL. nuqs' router adapter reads the address bar, so
 *  the harness mirrors the router's entry into it (as the browser would). */
function renderPage(search = '?status=all') {
	const path = `/app/adjustments/ajt-1${search}`;
	window.history.replaceState(null, '', path);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[path]}>
				<NuqsAdapter>
					<Routes>
						<Route path="/app/adjustments/:id" element={<AdjustmentDetailPage />} />
						{/* The post-save destination — the page pops back to the list. */}
						<Route path="/app/adjustments" element={<div />} />
					</Routes>
				</NuqsAdapter>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe('AdjustmentDetailPage — a draft opens its own form', () => {
	it('prefills the fields from the document and SAVES back to the same row', async () => {
		// The cached directory is deliberately EMPTY: everything painted below can only
		// come from the stored document's own seed, which is exactly what is under test.
		state.editor = { card: cardOf(), seed: seedOf() };
		renderPage();

		// Prefilled — the qty, the SKU, the store and the lot all come off the document,
		// and the status pill names what this is.
		const qty = (await screen.findByLabelText('Quantity')) as HTMLInputElement;
		expect(qty.value).toBe('2');
		expect(screen.getByText('Tyre 11R')).toBeTruthy();
		expect(screen.getByText('Draft')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Store' }).textContent).toContain('Mandalay store');
		expect((screen.getByLabelText('Batch No') as HTMLInputElement).value).toBe('B-77');

		// A draft is WRITABLE: the field is live, the line's actions are there and so is
		// the submit bar.
		expect(qty.disabled).toBe(false);
		expect(screen.getByRole('button', { name: /Add another/ })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Remove line' })).toBeTruthy();

		// Clear the reason, then save.
		fireEvent.change(screen.getByLabelText('Description'), { target: { value: '' } });
		fireEvent.click(screen.getByRole('button', { name: /Save Draft/ }));

		await waitFor(() => expect(mocks.updateAdjustmentDoc).toHaveBeenCalledTimes(1));
		const [id, draft] = mocks.updateAdjustmentDoc.mock.calls[0];
		expect(id).toBe('ajt-1');
		// An EDIT states the clearable reason outright (emptied ⇒ `null`), and never the
		// reporter: `mro_adjustments` declares `actor_fields: ['reported_by']`, so sending
		// it could reassign who filed the report.
		expect(draft).toMatchObject({
			location: 'mandalay_store',
			adjustment_date: '2026-09-20',
			description: null,
		});
		expect(draft).not.toHaveProperty('reported_by');
		// The lot identity AND the per-unit cost are carried through: the `lines` child
		// table is REPLACED by this payload, so a column the form does not collect would
		// silently vanish from the row on every save.
		expect(draft.lines).toEqual([
			expect.objectContaining({
				item_model: 'model-1',
				direction: 'add',
				qty: 2,
				batch_no: 'B-77',
				expiry_date: '2027-01-31',
				unit_cost: 9000,
			}),
		]);
	});

	it('refuses a batch ADD with no lot — and switching the row to REMOVE both clears it and unlocks the save', async () => {
		// The confirm 400s an `add` with a blank `batch_no`; the form can see that coming,
		// so the save is shut until the lot is typed — where the operator can still fix it.
		state.models = [MODEL_BATCH];
		state.editor = {
			card: cardOf(),
			seed: seedOf({
				lines: [
					{
						modelId: 'model-1',
						modelName: 'Tyre 11R',
						tracking: 'batch',
						direction: 'add',
						qty: 2,
						batchNo: '',
						expiryDate: '',
						unitCost: null,
						serials: [],
					},
				],
			}),
		};
		renderPage();

		expect(((await screen.findByLabelText('Quantity')) as HTMLInputElement).disabled).toBe(false);
		expect((screen.getByRole('button', { name: /Save Draft/ }) as HTMLButtonElement).disabled).toBe(true);

		// A REMOVE draws FEFO — it has no lot of its own to name, so the field GOES and the
		// row becomes saveable.
		fireEvent.click(screen.getByRole('button', { name: 'remove' }));
		expect(screen.queryByLabelText('Batch No')).toBeNull();
		expect((screen.getByRole('button', { name: /Save Draft/ }) as HTMLButtonElement).disabled).toBe(false);

		fireEvent.click(screen.getByRole('button', { name: /Save Draft/ }));
		await waitFor(() => expect(mocks.updateAdjustmentDoc).toHaveBeenCalledTimes(1));
		const draft = mocks.updateAdjustmentDoc.mock.calls[0][1];
		// The cleared lot must NOT reappear on the payload — the engine ignores `batch_no`
		// on a removal, so sending one would store a lot the stock ledger never took.
		expect(draft.lines).toEqual([expect.objectContaining({ item_model: 'model-1', direction: 'remove', qty: 2 })]);
		expect(draft.lines).not.toEqual([expect.objectContaining({ batch_no: 'B-77' })]);
	});
});

describe('AdjustmentDetailPage — an applied correction is the same layout, read-only', () => {
	it('disables every field, drops the save button, and keeps the cancel one deliberate gesture away', async () => {
		state.editor = { card: cardOf({ docStatus: 'confirmed' }), seed: seedOf({ docStatus: 'confirmed' }) };
		renderPage();

		// The pill IS the statement: the status name resolves exactly ONCE on the page, and
		// nothing under it explains the read-only form a second time.
		expect(await screen.findByText('Confirmed')).toBeTruthy();
		expect(screen.getAllByText('Confirmed')).toHaveLength(1);
		expect(screen.queryByText(/already applied/)).toBeNull();

		// Not one live field — and not one ACTION either: adding or removing a line is a
		// write, so those controls are gone rather than dead.
		expect((screen.getByLabelText('Quantity') as HTMLInputElement).disabled).toBe(true);
		expect((screen.getByLabelText('Description') as HTMLTextAreaElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: 'Store' }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByLabelText('Batch No') as HTMLInputElement).disabled).toBe(true);
		expect(screen.queryByRole('button', { name: /Add another/ })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Remove line' })).toBeNull();

		// Nothing pretends it can be saved, and the draft's approve action is gone too.
		expect(screen.queryByRole('button', { name: /Save Draft/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /^Approve$/ })).toBeNull();

		// …but cancelling is NOT gone, and it is NOT a bare button either: an applied
		// correction's cancel REVERSES the posting, so it is one deliberate gesture away,
		// in the document's own ⋮.
		expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: /actions for AJT-00021/i }));
		expect(screen.getByRole('menuitem', { name: 'Cancel & reverse' })).toBeTruthy();
	});
});

describe('AdjustmentDetailPage — a cancelled correction is final', () => {
	it('renders read-only with NO action at all, and says a replacement is a new document', async () => {
		state.editor = { card: cardOf({ docStatus: 'cancelled' }), seed: seedOf({ docStatus: 'cancelled' }) };
		renderPage();

		// The form is locked for the same reason an applied one is (the engine refuses
		// the write), so the screen never offers one…
		expect(((await screen.findByLabelText('Quantity')) as HTMLInputElement).disabled).toBe(true);
		expect(screen.queryByRole('button', { name: /Save Draft/ })).toBeNull();
		// …AND it offers no way back: a cancelled stock document is not reopened and not
		// deleted (the collection freezes `cancelled` too), so the only path is a new doc.
		// Poka-yoke: the ⋮ is ABSENT, not a menu with nothing behind it.
		expect(screen.queryByRole('button', { name: /^Approve$/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /actions for AJT-00021/i })).toBeNull();
		// A void correction is final, and the pill says so — no sentence under it: the
		// notice and the footer were the same fact in two voices, and the pill is the ONE
		// statement now.
		expect(screen.queryByText(/its stock effect \(if any\) was already put back/)).toBeNull();
		expect(screen.queryByText(/Nothing here can be changed/)).toBeNull();
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	state.editor = null;
	window.history.replaceState(null, '', '/');
});
