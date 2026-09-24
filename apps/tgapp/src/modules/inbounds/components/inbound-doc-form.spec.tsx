// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { InboundDocForm } from './inbound-doc-form';
import type { InboundFormSeed } from '../data/types';

/**
 * The inbound form's supplier picker — the ADD path.
 *
 * The reported bug: the sheet showed an “Add …” row, but pressing it did
 * nothing (it was disabled until you typed, and even then it silently created a
 * name-only master instead of showing the supplier layout). These tests pin the
 * contract: the row is ALWAYS pressable, it opens the SAME layout the masters
 * hub adds a supplier with, the name typed in the search box carries over, and
 * nothing is written until the operator submits that layout.
 */
const mocks = vi.hoisted(() => ({
	createMroSupplier: vi.fn(async () => ({ id: 'sup-new', name: 'Global Tyre' })),
	upsertMasterDirectory: vi.fn(),
	createInboundDoc: vi.fn(async (_payload: Record<string, unknown>) => ({ id: 'doc-1' })),
	updateInboundDoc: vi.fn(async (_id: string, _draft: Record<string, unknown>) => ({ id: 'doc-1' })),
	searchEmployees: vi.fn(async () => [{ id: 'emp-1', name: 'Aung Aung', name_mm: null, eid: 'E-1', photo: null }]),
}));

/** The one SKU the picker offers — a plain `standard` model (no batch/serial extras). */
const MODEL = {
	id: 'model-1',
	name_en: 'Bolt M10',
	name_mm: 'ဘော့လ်',
	tracking: 'standard',
	item_name: { tracking: 'standard' },
};

/** The serial-tracked SKU — the policy that routes a row through the serial sheet. */
const SERIAL_MODEL = {
	id: 'model-serial',
	name_en: 'Tyre 11R',
	name_mm: null,
	tracking: 'serial',
	item_name: { tracking: 'serial' },
};

/** A SKU whose parent item NAME differs from its own size code — the pair a line has
 *  to state (`Tyre · 11R 22.5`), which its bare `name_en` would hide. */
const GROUPED_MODEL = {
	id: 'model-grouped',
	name_en: '11R 22.5',
	name_mm: null,
	tracking: 'standard',
	group_name_en: 'Tyre',
	item_name: { tracking: 'standard', name_en: 'Tyre' },
};

vi.mock('../data/api', () => ({ createInboundDoc: mocks.createInboundDoc, updateInboundDoc: mocks.updateInboundDoc }));
vi.mock('@/shared/hooks/use-mro-item-models', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/shared/hooks/use-mro-item-models')>()),
	useMroItemModels: () => ({ data: [MODEL, SERIAL_MODEL, GROUPED_MODEL], isPending: false, isError: false, refetch: vi.fn() }),
	filterMroItemModels: () => [MODEL, SERIAL_MODEL, GROUPED_MODEL],
}));
// The personnel picker searches `hrm_employees` server-side — one hit is enough
// to prove WHICH relation the return/opening kinds write.
vi.mock('@/shared/lookups/api', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/shared/lookups/api')>()),
	searchEmployees: mocks.searchEmployees,
}));
// The real module keeps the shared query key intact; only its network calls are
// stubbed (an empty supplier directory is the interesting case: it is exactly
// where an operator has to add one).
vi.mock('@/shared/hooks/use-mro-masters', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/shared/hooks/use-mro-masters')>()),
	fetchMroSuppliers: async () => [],
	createMroSupplier: mocks.createMroSupplier,
	upsertMasterDirectory: mocks.upsertMasterDirectory,
}));
// No Telegram bridge in jsdom — the in-page submit affordances are what render.
vi.mock('@/shared/platform/use-main-button', () => ({ useTelegramMainButton: () => false }));

// jsdom ships neither, and the design-system Sheet's portal path touches both.
beforeAll(() => {
	if (!globalThis.ResizeObserver) {
		globalThis.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;
	}
	// The design-system ScrollArea's viewport polls `getAnimations()` in a
	// timeout — jsdom has no Web Animations API, and the throw lands AFTER the
	// test as an unhandled error (which fails the run).
	if (!Element.prototype.getAnimations) {
		Element.prototype.getAnimations = () => [];
	}
	if (!window.matchMedia) {
		window.matchMedia = ((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		})) as unknown as typeof window.matchMedia;
	}
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function renderForm() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<InboundDocForm onDone={() => {}} />
		</QueryClientProvider>,
	);
}

/**
 * The form's HEADER shaping — one row, two facts, and no running total.
 *
 * WHO the goods come from (the counterparty this receipt is about) and WHERE they
 * land (the store that receives them) are read together, so the two pickers share
 * ONE row. The Items heading states the label + the add action only — the running
 * `Total quantity` pill was removed, so its absence is pinned here.
 */
describe('inbound form — the header row', () => {
	it('puts the counterparty and the store in ONE row, and states no running total', () => {
		renderForm();

		// A 2-column grid whose cells are EXACTLY the two fields: the sheets behind the
		// pickers are portal-only, so a closed one cannot claim a cell.
		const row = screen.getByRole('button', { name: /Select store/ }).closest('.grid');
		expect(row).toBeTruthy();
		expect(row?.className).toContain('grid-cols-2');
		expect(row?.children).toHaveLength(2);
		expect(row?.children[0]?.textContent).toContain('Supplier');
		// No hint line under either field: each label says what its own field is.
		expect(screen.queryByText(/these goods were bought from/)).toBeNull();
		// The date field states the app's SHORT day-first format (`20 Sep 2026`), never
		// the locale's long “September 20, 2026” — a half-width cell has no room for it.
		expect(screen.getByText(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/)).toBeTruthy();

		expect(screen.queryByText('Total quantity')).toBeNull();
	});
});

describe('inbound supplier picker — add a supplier', () => {
	it('opens the supplier ADD layout from an empty search — the row is never dead', async () => {
		renderForm();

		fireEvent.click(screen.getByRole('button', { name: 'Supplier' }));
		const addRow = screen.getByRole('button', { name: /Add new supplier/ }) as HTMLButtonElement;
		expect(addRow.disabled).toBe(false);

		fireEvent.click(addRow);

		// The masters hub's own layout, inside the sheet.
		expect(await screen.findByLabelText(/Supplier name/)).toBeTruthy();
		expect(screen.getByLabelText(/Mobile/)).toBeTruthy();
		expect(screen.getByLabelText(/Address/)).toBeTruthy();
		// Nothing is written just by opening it, and its submit is in-page (the
		// sheet covers the native MainButton).
		expect(mocks.createMroSupplier).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: 'Add supplier' })).toBeTruthy();
	});

	it('carries the typed search term into the layout and folds the created row', async () => {
		renderForm();

		fireEvent.click(screen.getByRole('button', { name: 'Supplier' }));
		fireEvent.change(screen.getByPlaceholderText('Search supplier name'), { target: { value: 'Global Tyre' } });
		fireEvent.click(screen.getByRole('button', { name: /Add .Global Tyre/ }));

		const nameField = (await screen.findByLabelText(/Supplier name/)) as HTMLInputElement;
		expect(nameField.value).toBe('Global Tyre');

		// A prefilled CREATE is still submittable: the carried name is a prefill,
		// not the edit baseline (passing it as `initial` would disable Add).
		const submit = screen.getByRole('button', { name: 'Add supplier' }) as HTMLButtonElement;
		expect(submit.disabled).toBe(false);
		fireEvent.click(submit);

		await waitFor(() =>
			expect(mocks.createMroSupplier).toHaveBeenCalledWith({ name: 'Global Tyre', mobile: undefined, address: undefined }),
		);
		// Write-through: the new master joins the shared directory (no refetch).
		expect(mocks.upsertMasterDirectory).toHaveBeenCalledTimes(1);
	});

	it('returns to the search pane instead of closing when backing out of the layout', async () => {
		renderForm();

		fireEvent.click(screen.getByRole('button', { name: 'Supplier' }));
		fireEvent.click(screen.getByRole('button', { name: /Add new supplier/ }));
		expect(await screen.findByLabelText(/Supplier name/)).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: /Back to search/ }));

		expect(screen.getByPlaceholderText('Search supplier name')).toBeTruthy();
		expect(screen.queryByLabelText(/Supplier name/)).toBeNull();
		expect(mocks.createMroSupplier).not.toHaveBeenCalled();
	});
});

/**
 * The KIND decides the counterparty: a purchase is bought FROM a vendor, a
 * return comes back from a person, an opening balance is handed over by one.
 * The form and the engine's `required_if` rules must agree on that split.
 */
describe('inbound counterparty field — vendor vs employee', () => {
	/** The doc's counterparty field — its accessible name is the FormField label. */
	const partyField = (label: string) => screen.getByRole('button', { name: label });

	it('shows the supplier picker for a purchase and the employee picker for return / opening', () => {
		renderForm();

		expect(partyField('Supplier')).toBeTruthy();
		expect(screen.queryByText('Returned by')).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: 'Return' }));
		expect(partyField('Returned by')).toBeTruthy();
		// The vendor picker is GONE — a return has no supplier to choose.
		expect(screen.queryByRole('button', { name: 'Supplier' })).toBeNull();
		expect(screen.getByText('Select employee')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Opening' }));
		expect(partyField('Handed over by')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Supplier' })).toBeNull();
	});

	it('files a RETURN with handed_by (an employee) and no supplier at all', async () => {
		renderForm();

		fireEvent.click(screen.getByRole('button', { name: 'Return' }));

		// One complete line: the model from the item sheet + a quantity.
		fireEvent.click(screen.getByRole('button', { name: 'Select item' }));
		fireEvent.change(screen.getByPlaceholderText('Search item name'), { target: { value: 'Bolt' } });
		fireEvent.click(await screen.findByRole('button', { name: /Bolt M10/ }));
		fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '5' } });

		// …and the person the goods came back from.
		fireEvent.click(partyField('Returned by'));
		fireEvent.change(screen.getByLabelText('Search personnel'), { target: { value: 'Aung' } });
		fireEvent.click(await screen.findByRole('button', { name: /Aung Aung/ }));

		fireEvent.click(screen.getByRole('button', { name: /Save Draft/ }));

		await waitFor(() => expect(mocks.createInboundDoc).toHaveBeenCalledTimes(1));
		const payload = mocks.createInboundDoc.mock.calls[0][0] as Record<string, unknown>;
		expect(payload.type).toBe('return');
		expect(payload.handed_by).toBe('emp-1');
		// The vendor column is never written for a return.
		expect(payload).not.toHaveProperty('supplier');
		expect(payload.lines).toEqual([expect.objectContaining({ item_model: MODEL.id, qty: 5 })]);
	});
});

/**
 * "Paid in full" — a purchase declared as ALREADY SETTLED while it is still a
 * draft: the confirm then files the one ledger payment that settles it (amount =
 * the line total, day = the receipt date), so the card arrives with nothing left
 * to pay. Three edges belong to the form and mirror the server exactly — the flag
 * is offered for a PURCHASE only, only once a total exists, and only while the
 * receipt is still a DRAFT (a settled receipt states its money on the ledger face,
 * never through a dead checkbox and a pre-confirm sentence) — so the option can
 * never be picked into a state the confirm would refuse.
 */
describe('inbound "paid in full" flag', () => {
	/** The control's accessible name comes from the label wrapping it. */
	const paidBox = () => screen.getByRole('checkbox', { name: /Paid in full/ }) as HTMLInputElement;

	/** One complete, PRICED line — its total is what a payment would settle. */
	async function addPricedLine(qty: string, unitPrice?: string) {
		fireEvent.click(screen.getByRole('button', { name: 'Select item' }));
		fireEvent.change(screen.getByPlaceholderText('Search item name'), { target: { value: 'Bolt' } });
		fireEvent.click(await screen.findByRole('button', { name: /Bolt M10/ }));
		fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: qty } });
		if (unitPrice) fireEvent.change(screen.getByLabelText('Unit price'), { target: { value: unitPrice } });
	}

	it('sends paid_at_receipt and quotes the figure + day the confirm will file', async () => {
		renderForm();
		await addPricedLine('3', '1200');

		// The hint names the money and the day — the operator marks the receipt paid
		// knowing exactly what the confirm will record.
		expect(screen.getByText(/one payment of 3,600 Ks/)).toBeTruthy();
		expect(paidBox().disabled).toBe(false);

		fireEvent.click(paidBox());
		expect(paidBox().checked).toBe(true);

		// The vendor a purchase needs (the directory is empty in this harness, so the
		// sheet's own add layout is the path), then save the draft once the sheet has
		// CLOSED — the in-page submit is deliberately tucked away behind a sheet.
		fireEvent.click(screen.getByRole('button', { name: 'Supplier' }));
		fireEvent.click(screen.getByRole('button', { name: /Add new supplier/ }));
		fireEvent.change(await screen.findByLabelText(/Supplier name/), { target: { value: 'Global Tyre' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add supplier' }));
		await waitFor(() => expect(screen.queryByLabelText(/Supplier name/)).toBeNull());

		fireEvent.click(screen.getByRole('button', { name: /Save Draft/ }));

		await waitFor(() => expect(mocks.createInboundDoc).toHaveBeenCalledTimes(1));
		const payload = mocks.createInboundDoc.mock.calls[0][0] as Record<string, unknown>;
		expect(payload.type).toBe('purchase');
		expect(payload.supplier).toBe('sup-new');
		expect(payload.paid_at_receipt).toBe(true);
		expect(payload.lines).toEqual([expect.objectContaining({ item_model: MODEL.id, qty: 3, unit_price: 1200 })]);
	});

	it('leaves the flag out entirely when it is not checked', async () => {
		renderForm();
		await addPricedLine('2', '500');

		fireEvent.click(screen.getByRole('button', { name: 'Supplier' }));
		fireEvent.click(screen.getByRole('button', { name: /Add new supplier/ }));
		fireEvent.change(await screen.findByLabelText(/Supplier name/), { target: { value: 'Global Tyre' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add supplier' }));
		await waitFor(() => expect(screen.queryByLabelText(/Supplier name/)).toBeNull());
		fireEvent.click(screen.getByRole('button', { name: /Save Draft/ }));

		await waitFor(() => expect(mocks.createInboundDoc).toHaveBeenCalledTimes(1));
		// Untouched ⇒ the field is absent, not `false`: the draft keeps the engine's
		// own default and nothing about the money is claimed.
		expect(mocks.createInboundDoc.mock.calls[0][0]).not.toHaveProperty('paid_at_receipt');
	});

	it('offers no flag until a total exists (the confirm would refuse it)', async () => {
		renderForm();
		await addPricedLine('3'); // quantity, no unit price

		expect(screen.getByText(/Add a unit price/)).toBeTruthy();
		expect(paidBox().disabled).toBe(true);
	});

	it('keeps the flag off the kinds that owe nobody', async () => {
		renderForm();

		expect(paidBox()).toBeTruthy(); // a purchase offers it
		fireEvent.click(screen.getByRole('button', { name: 'Opening' }));
		expect(screen.queryByRole('checkbox', { name: /Paid in full/ })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Return' }));
		expect(screen.queryByRole('checkbox', { name: /Paid in full/ })).toBeNull();
	});

	it('collects a serial line in the sheet — one row per unit — and sends them in order', async () => {
		renderForm();

		// A serial-tracked SKU, quantity 2.
		fireEvent.click(screen.getByRole('button', { name: 'Select item' }));
		fireEvent.change(await screen.findByPlaceholderText('Search item name'), { target: { value: 'Tyre' } });
		fireEvent.click(await screen.findByRole('button', { name: /Tyre 11R/ }));
		fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2' } });

		// The serial field is a BUTTON that states the line's units — not a text
		// input a comma list could hide a duplicate in.
		expect(screen.getByText('Add serial numbers')).toBeTruthy();
		fireEvent.click(screen.getByText('Add serial numbers'));

		// The sheet takes the units one at a time…
		fireEvent.change(await screen.findByLabelText('Serial number'), { target: { value: 'TY-1' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add' }));
		// …or as a pasted column, and a repeat is refused with a reason.
		fireEvent.change(screen.getByLabelText('Serial number'), { target: { value: 'ty-1' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add' }));
		expect(screen.getByText(/is already in this list/)).toBeTruthy();
		fireEvent.change(screen.getByLabelText('Serial number'), { target: { value: 'TY-2' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add' }));
		expect(screen.getByText('All 2 units entered.')).toBeTruthy();

		// The row behind the sheet already reads the comma list.
		expect(screen.getByText('TY-1, TY-2')).toBeTruthy();

		// Close the editor, take a vendor, save — the units go out in typed order.
		fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		fireEvent.click(screen.getByRole('button', { name: 'Supplier' }));
		fireEvent.click(screen.getByRole('button', { name: /Add new supplier/ }));
		fireEvent.change(await screen.findByLabelText(/Supplier name/), { target: { value: 'Global Tyre' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add supplier' }));
		await waitFor(() => expect(screen.queryByLabelText(/Supplier name/)).toBeNull());

		fireEvent.click(screen.getByRole('button', { name: /Save Draft/ }));

		await waitFor(() => expect(mocks.createInboundDoc).toHaveBeenCalledTimes(1));
		const payload = mocks.createInboundDoc.mock.calls[0][0] as { lines: unknown[] };
		expect(payload.lines).toEqual([expect.objectContaining({ item_model: 'model-serial', qty: 2, serials: ['TY-1', 'TY-2'] })]);
	});
});

/**
 * The SAME form, EDIT mode — `seed` turns it into an editor, and the DOCUMENT's
 * own status decides whether anything may be changed. Both halves are pinned
 * here because a mistake in either is invisible: an edit that POSTs would file a
 * second receipt instead of correcting the first, and an editable confirmed
 * receipt would only fail later, at the server (403).
 */
const SEED: InboundFormSeed = {
	id: 'doc-1',
	type: 'purchase',
	purchaseDate: '2026-09-20',
	partyId: 'sup-new',
	partyName: 'Global Tyre',
	location: 'main_store',
	note: 'Two drums',
	paidAtReceipt: false,
	lines: [
		{
			modelId: MODEL.id,
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
};

function renderSeed(seed: InboundFormSeed) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<InboundDocForm onDone={() => {}} seed={seed} />
		</QueryClientProvider>,
	);
}

describe('InboundDocForm — edit mode', () => {
	it('prefills from the seed and SAVES the same document (PUT, never a second POST)', async () => {
		renderSeed(SEED);

		// The stored line is on screen with its SKU, quantity, price and note intact.
		expect((screen.getByLabelText('Quantity') as HTMLInputElement).value).toBe('3');
		expect((screen.getByLabelText('Unit price') as HTMLInputElement).value).toBe('1200');
		expect(screen.getByText('Bolt M10')).toBeTruthy();
		expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('Two drums');
		expect(screen.getByText('Global Tyre')).toBeTruthy();

		fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '5' } });
		fireEvent.click(screen.getByRole('button', { name: /Save Draft/ }));

		await waitFor(() => expect(mocks.updateInboundDoc).toHaveBeenCalledTimes(1));
		// The DOCUMENT's id, and the whole line set (the engine replaces the
		// document's children with exactly this payload).
		expect(mocks.updateInboundDoc).toHaveBeenCalledWith(
			'doc-1',
			expect.objectContaining({
				supplier: 'sup-new',
				handed_by: null,
				note: 'Two drums',
				lines: [expect.objectContaining({ item_model: MODEL.id, qty: 5, unit_price: 1200 })],
			}),
		);
		expect(mocks.createInboundDoc).not.toHaveBeenCalled();
	});

	it('renders a confirmed receipt read-only — every field dead, nothing to submit', () => {
		renderSeed({ ...SEED, docStatus: 'confirmed' });

		for (const label of ['Quantity', 'Unit price', 'Note']) {
			expect((screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement).disabled).toBe(true);
		}
		expect((screen.getByRole('button', { name: /Select store/ }) as HTMLButtonElement).disabled).toBe(true);
		// The row actions and the KIND SELECTOR are absent, not disabled: a settled
		// receipt has no kind to choose (the engine would refuse the write), so the page's
		// status pill carries the kind it is stuck on instead.
		expect(screen.queryByRole('button', { name: 'Purchase' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Opening' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Return' })).toBeNull();
		expect(screen.queryByRole('button', { name: /Add another/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /Remove line/ })).toBeNull();
		// Nothing promises a save…
		expect(screen.queryByRole('button', { name: /Save Draft/ })).toBeNull();
		// …and the form states NO reason of its own: the DOCUMENT PAGE's status pill IS
		// that statement. Printing a second sentence here would say the same fact twice in
		// two voices — and a copy drifting from the page's is how the two disagree.
		expect(screen.queryByText(/already posted/)).toBeNull();
		// The draft's "Paid in full" declaration is gone too, even on a receipt that WAS
		// marked paid at receipt: its sentence speaks of what CONFIRMING will file, and
		// the confirm already ran — the receipt's own money face states the money.
		expect(screen.queryByRole('checkbox', { name: /Paid in full/ })).toBeNull();
		expect(screen.queryByText(/records one payment of/)).toBeNull();
	});

	it('locks a CANCELLED draft identically, and states nothing of its own either', () => {
		renderSeed({ ...SEED, docStatus: 'cancelled' });

		// Both settled states lock the form the same way (the engine refuses either write),
		// and both drop the kind selector.
		expect((screen.getByLabelText('Quantity') as HTMLInputElement).disabled).toBe(true);
		expect(screen.queryByRole('button', { name: /Save Draft/ })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Opening' })).toBeNull();
		// The two states are NOT the same fact, and telling them apart is the pill's job
		// alone — so neither sentence may be pre-empted here (see the page spec).
		expect(screen.queryByText(/was cancelled/)).toBeNull();
		expect(screen.queryByText(/already posted/)).toBeNull();
	});

	it('opens a STORED serial list in the same editor, one row per unit', () => {
		renderSeed({
			...SEED,
			lines: [
				{
					modelId: 'model-serial',
					modelName: 'Tyre 11R',
					tracking: 'serial',
					qty: 2,
					unitPrice: 90_000,
					batchNo: '',
					expiryDate: '',
					serials: ['TY-1', 'TY-2'],
				},
			],
		});

		// The field STATES the units (the comma list is the display, not an input)…
		fireEvent.click(screen.getByText('TY-1, TY-2'));

		// …and the sheet opens on the same units, counted against the quantity.
		expect(screen.getByText('2/2')).toBeTruthy();
		expect(screen.getByText('All 2 units entered.')).toBeTruthy();
	});
});

/**
 * The item LABEL a line states — the parent item NAME over the SKU (`Tyre · 11R
 * 22.5`), the SAME pair the picker row and the serial sheet's title show, so one SKU
 * reads one way on every surface. Pinned on the line card, because that is where the
 * operator reads it back.
 */
describe('inbound item labels — the item name rides the SKU', () => {
	it('labels the line with the pair the picker shows, never the bare size code', async () => {
		renderForm();

		fireEvent.click(screen.getByRole('button', { name: 'Select item' }));
		fireEvent.change(screen.getByPlaceholderText('Search item name'), { target: { value: '11R' } });
		fireEvent.click(await screen.findByRole('button', { name: /Tyre · 11R 22\.5/ }));

		// The line states the pair (its picker trigger carries the label; the trigger's
		// own accessible name is `Select item`).
		expect(screen.getByRole('button', { name: 'Select item' }).textContent).toContain('Tyre · 11R 22.5');
	});
});

/**
 * A settled receipt's units stay READABLE: the serial field opens the same sheet as a
 * viewer — one row per unit, in order, counted against the quantity — with no entry
 * box, no Add, no delete and no instruction to type. Reading is not a write, so this
 * is the ONE control that stays live on a document that froze every other field.
 */
describe('inbound serial field — a settled receipt stays readable', () => {
	it('opens the units as a read-only list, with not one way to change them', () => {
		renderSeed({
			...SEED,
			docStatus: 'confirmed',
			lines: [
				{
					modelId: 'model-serial',
					modelName: 'Tyre 11R',
					tracking: 'serial',
					qty: 3,
					unitPrice: 90_000,
					batchNo: '',
					expiryDate: '',
					serials: ['TY-12', 'TY-13', 'TY-14'],
				},
			],
		});

		// The trigger states the units and says what the tap does — a VIEW, not a write,
		// so it is live on a settled receipt (only an in-flight save holds it back).
		const trigger = screen.getByLabelText('View serials') as HTMLButtonElement;
		expect(trigger.disabled).toBe(false);
		expect(trigger.textContent).toContain('TY-12, TY-13, TY-14');
		fireEvent.click(trigger);

		// One row per unit, in order, counted against the quantity…
		expect(screen.getByText('3/3')).toBeTruthy();
		for (const unit of ['TY-12', 'TY-13', 'TY-14']) expect(screen.getByText(unit)).toBeTruthy();

		// …and NOT ONE way to change them, nor an instruction to: the entry box, the
		// Add, the per-row delete and the count hint are all absent.
		expect(screen.queryByLabelText('Serial number')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
		expect(screen.queryByLabelText('Remove TY-12')).toBeNull();
		expect(screen.queryByText(/must match quantity/)).toBeNull();
		expect(screen.queryByText(/the count must match the quantity/)).toBeNull();
	});
});
