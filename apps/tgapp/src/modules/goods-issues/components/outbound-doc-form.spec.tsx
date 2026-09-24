// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { OutboundDocForm } from './outbound-doc-form';

/**
 * The outbound form's own behaviour under test: the item picker's STOCK filter, a
 * serial row's PICKS being its quantity, and the goods-issue DESTINATION.
 *
 * The stock-filter problem: `/app/outbounds/+` offered the WHOLE SKU directory, so an
 * operator could pick an item the store does not hold and only discover it when
 * the confirm 409'd. The picker is now narrowed to what the CHOSEN store can
 * actually supply — and which number that is depends on the document's kind:
 *
 *   · an ISSUE draws usable stock → an expired-only or empty SKU is not offered;
 *   · a WRITE-OFF / DISPOSAL is exactly how expired stock leaves the store → it
 *     IS offered, because filtering by the issuable number would hide the items
 *     those tabs exist for.
 *
 * The destination problem: a goods issue handed its serial units to a truck's
 * inventory or a person's custody, but the document named NO holder — so the units
 * left the store belonging to nobody and appeared on no truck board and no employee
 * register. The field is now asked for exactly where it means something, and only
 * where it means something (see the describe below).
 *
 * The search match is not under test: `filterMroItemModels` is stubbed to pass
 * every model through, so ONLY the stock filter decides what renders.
 */

const mocks = vi.hoisted(() => ({
	createOutboundDoc: vi.fn(async () => ({ id: 'doc-1' })),
	models: [] as Array<{ id: string; name_en: string; name_mm: string | null; tracking: string; item_name: { tracking: string } }>,
	onHandRows: [] as Array<Record<string, unknown>>,
	/** The units `GET /mro/stock/items/:modelId?location=` answers with. */
	itemStock: vi.fn(async () => ({ serials: [] as Array<{ id: string; serial_no: string; expired: boolean; days_left: number | null }> })),
	/** The plate directory the destination picker lists. */
	vehicles: [] as Array<{ id: string; plate_no: string | null }>,
	/** The personnel directory the employee picker answers with. */
	employees: [] as Array<{ id: string; name: string; photo: string | null; eid: string | null }>,
}));

vi.mock('../data/api', () => ({ createOutboundDoc: mocks.createOutboundDoc }));
// Only the in-stock unit read is replaced — every other `mroApi` member (and the
// shared quantity helpers) must stay the real thing, since the form renders from them.
vi.mock('@/shared/mro', async (importOriginal) => {
	const original = await importOriginal<typeof import('@/shared/mro')>();
	return { ...original, mroApi: { ...original.mroApi, itemStock: mocks.itemStock } };
});
vi.mock('@/shared/hooks/use-mro-item-models', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/shared/hooks/use-mro-item-models')>()),
	useMroItemModels: () => ({ data: mocks.models, isPending: false, isError: false, refetch: vi.fn() }),
	filterMroItemModels: (models: unknown[]) => models,
}));
vi.mock('@/shared/hooks/use-on-hand-report', () => ({
	useOnHandReport: () => ({ data: mocks.onHandRows, isPending: false, isError: false, refetch: vi.fn() }),
}));
// No Telegram bridge in jsdom — the in-page submit affordances are what render.
vi.mock('@/shared/platform/use-main-button', () => ({ useTelegramMainButton: () => false }));
// The two destination pickers are the REAL shared sheets — only their directories
// are stubbed, so the form's own props/contract with them is what gets exercised.
vi.mock('@/shared/lookups/hooks', () => ({
	useVehicleMasters: () => ({ data: mocks.vehicles, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/shared/lookups/api', async (importOriginal) => {
	const original = await importOriginal<typeof import('@/shared/lookups/api')>();
	return { ...original, searchEmployees: vi.fn(async () => mocks.employees) };
});
vi.mock('@/shared/api/search', () => ({
	searchGlobal: vi.fn(async () => []),
	globalSearchKey: (collection: string, term: string) => ['search', collection, term],
}));
// The type-ahead SETTLE window (600ms) is not what these tests are about — the term
// applies on the next render so a picker is ready without a timer dance.
vi.mock('@/shared/hooks/use-debounced-value', () => ({ useDebouncedValue: (value: string) => value }));

// jsdom ships neither, and the design-system Sheet/ScrollArea's portal path touches both.
beforeAll(() => {
	if (!globalThis.ResizeObserver) {
		globalThis.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;
	}
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
	// Reset (not clear): each serial test sets its own in-stock units, and a test
	// that sets none must read as an empty store rather than the previous answer.
	mocks.itemStock.mockReset();
	mocks.models = [];
	mocks.onHandRows = [];
	mocks.vehicles = [];
	mocks.employees = [];
});

function model(id: string, name: string) {
	return { id, name_en: name, name_mm: null, tracking: 'standard', item_name: { tracking: 'standard' } };
}

/** A serial-tracked SKU — its row is completed by PICKS, not by a qty input. */
function serialModel(id: string, name: string) {
	return { id, name_en: name, name_mm: null, tracking: 'serial', item_name: { tracking: 'serial' } };
}

/** One unit of `GET /mro/stock/items/:modelId` (in stock, unused, not expired). */
function unit(serialNo: string) {
	return { id: `s-${serialNo}`, serial_no: serialNo, expired: false, days_left: null };
}

/** One `/stock/onhand` row — `derived_qty` is the physical total, `expired_qty` the
 *  slice of it that is present but not issuable. */
function stockRow(modelId: string, location: string, derived: number, expired = 0) {
	return {
		id: `inv-${modelId}`,
		model: modelId,
		model_name: modelId,
		location,
		tracking: 'standard',
		qty_on_hand: derived,
		reorder_level: null,
		derived_qty: derived,
		expired_qty: expired,
		drift: false,
		below_reorder: false,
	};
}

function renderForm(
	type: 'goods_issue' | 'write_offs' | 'defects_missing' = 'goods_issue',
	initialLines?: Array<{ modelId: string; qty: string }>,
) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<OutboundDocForm type={type} onDone={() => {}} initialLines={initialLines} />
		</QueryClientProvider>,
	);
}

/** The in-page save action (the native MainButton is off in jsdom). */
function saveButton(): HTMLButtonElement {
	return screen.getByRole('button', { name: 'Save Draft' }) as HTMLButtonElement;
}

/** Dismiss the open bottom sheet the way a user does — its own Close control. A
 *  sheet `aria-hidden`s the page behind it, so nothing out there is queryable until
 *  it is closed (the real reason a disabled Save cannot be reasoned about until then). */
function closeSheet() {
	fireEvent.click(screen.getByRole('button', { name: 'Close' }));
}

/** The payload the form actually posted — the ONE thing the destination rule exists
 *  to get right, so it is asserted on the wire and not on the rendered state. */
function postedPayload(): Record<string, unknown> {
	expect(mocks.createOutboundDoc).toHaveBeenCalledTimes(1);
	return (mocks.createOutboundDoc.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
}

/** Open the line's item picker and type a long enough term (the picker is gated on `SEARCH_MIN_CHARS`). */
function searchItems(term = 'bolt') {
	fireEvent.click(screen.getByRole('button', { name: 'Select item' }));
	fireEvent.change(screen.getByPlaceholderText('Search items…'), { target: { value: term } });
}

/** The serial-row trigger — located by its `aria-label`, which is unique (the picker
 *  sheet's title shares the visible words, and a role query would additionally be
 *  refused while a sheet has the page behind it hidden from the accessibility tree). */
function serialTrigger(): HTMLElement {
	return screen.getByLabelText('Select serials');
}

/** The trigger's text — the row's stated quantity, e.g. `2 serials selected`. */
function serialTriggerLabel(): string {
	return serialTrigger().textContent ?? '';
}

/**
 * The form's HEADER shaping — one row, two facts, and no running total.
 *
 * The 1st/2nd header fields are the pair an issue is read for (WHEN the units
 * leave beside WHERE from), so they share a row; and the Items heading states the
 * label + the add action ONLY — the running `Total quantity` pill was removed, so
 * this is the one place its absence is pinned.
 */
describe('outbound form — the header row', () => {
	it('puts the date and the store in ONE row, and states no running total', () => {
		renderForm('goods_issue');

		// The row is a 2-column grid, and its cells are EXACTLY the two fields: the
		// sheets behind the pickers are portal-only, so a closed one cannot claim a cell.
		const row = screen.getByRole('button', { name: /Select store/ }).closest('.grid');
		expect(row).toBeTruthy();
		expect(row?.className).toContain('grid-cols-2');
		expect(row?.children).toHaveLength(2);
		expect(row?.children[0]?.textContent).toContain('Select date');
		// …and the date states the app's SHORT day-first format (`20 Sep 2026`), never the
		// locale's long form — this cell is half the row.
		expect(screen.getByText(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/)).toBeTruthy();

		expect(screen.queryByText('Total quantity')).toBeNull();
	});
});

describe('outbound item picker — stock filter', () => {
	it('offers only what the chosen store can ISSUE: not another store, not empty, not expired-only', () => {
		mocks.models = [
			model('m-in', 'Bolt In Stock'),
			model('m-out', 'Bolt Empty'),
			model('m-else', 'Bolt Other Store'),
			model('m-exp', 'Bolt Expired Only'),
		];
		mocks.onHandRows = [
			stockRow('m-in', 'main_store', 8),
			stockRow('m-out', 'main_store', 0),
			stockRow('m-else', 'vehicle_store', 5),
			stockRow('m-exp', 'main_store', 4, 4),
		];
		renderForm('goods_issue');
		searchItems();

		expect(screen.getByText('Bolt In Stock')).toBeTruthy();
		expect(screen.queryByText('Bolt Empty')).toBeNull();
		expect(screen.queryByText('Bolt Other Store'), 'stock at another store is not issueable here').toBeNull();
		expect(screen.queryByText('Bolt Expired Only'), 'expired units can never be issued').toBeNull();
	});

	it('offers an expired-only SKU to a WRITE-OFF — that is how expired stock leaves the store', () => {
		mocks.models = [model('m-in', 'Bolt In Stock'), model('m-exp', 'Bolt Expired Only')];
		mocks.onHandRows = [stockRow('m-in', 'main_store', 8), stockRow('m-exp', 'main_store', 4, 4)];
		renderForm('write_offs');
		searchItems();

		expect(screen.getByText('Bolt In Stock')).toBeTruthy();
		expect(screen.getByText('Bolt Expired Only')).toBeTruthy();
	});

	it('says the STORE has none rather than that the catalogue has none', () => {
		// The catalogue matches, but nothing it matched is held here — a different
		// answer from "no items found", and the one that tells the operator to change
		// the store instead of the search term.
		mocks.models = [model('m-else', 'Bolt Other Store')];
		mocks.onHandRows = [stockRow('m-else', 'vehicle_store', 5)];
		renderForm('goods_issue');
		searchItems();

		expect(screen.getByText('Nothing in stock at Main store')).toBeTruthy();
	});
});

describe('outbound serial rows — the picks ARE the quantity', () => {
	it('takes as many units as the store holds — the first pick no longer locks the second', async () => {
		// The reported bug: picking one unit wrote `qty = 1` and that qty then capped the
		// list, so a second unit could never be selected.
		mocks.models = [serialModel('m-tyre', 'Tyre 11R')];
		mocks.onHandRows = [stockRow('m-tyre', 'main_store', 3)];
		mocks.itemStock.mockResolvedValue({ serials: [unit('TY-1'), unit('TY-2'), unit('TY-3')] });
		renderForm('goods_issue');
		searchItems('tyre');
		fireEvent.click(screen.getByText('Tyre 11R'));

		// No qty input on a serial row — the quantity has ONE source, the picks.
		expect(screen.queryByLabelText('Quantity')).toBeNull();

		fireEvent.click(serialTrigger());
		fireEvent.click(await screen.findByRole('button', { name: 'TY-1' }));
		fireEvent.click(screen.getByRole('button', { name: 'TY-2' }));
		// A third unit is still on offer: the first pick capped nothing.
		expect(screen.getByRole('button', { name: 'TY-3' })).toBeTruthy();

		expect(serialTriggerLabel()).toBe('2 serials selected');

		// Unpicking is symmetric — the row follows the list back down.
		fireEvent.click(screen.getByRole('button', { name: 'TY-1' }));
		expect(serialTriggerLabel()).toBe('1 serial selected');

		// …and the empty state is back to the call to action.
		fireEvent.click(screen.getByRole('button', { name: 'TY-2' }));
		expect(serialTriggerLabel()).toBe('Select serials');
	});

	it('states the request’s count as a target, never as a cap', async () => {
		// A goods issue handed the WHOLE request to this form: 3 units were asked for.
		// The operator may still pick more (or fewer — a partial issue is real), so the
		// count reads as guidance and the row stays submittable on one unit.
		mocks.models = [serialModel('m-tyre', 'Tyre 11R')];
		mocks.onHandRows = [stockRow('m-tyre', 'main_store', 4)];
		mocks.itemStock.mockResolvedValue({ serials: [unit('TY-1'), unit('TY-2'), unit('TY-3'), unit('TY-4')] });
		renderForm('goods_issue', [{ modelId: 'm-tyre', qty: '3' }]);

		expect(screen.getByText('The request asked for 3 — 3 still to pick.')).toBeTruthy();
		// The request's count is not this row's quantity — nothing is picked yet, so the
		// row reads `0/3` (picked / asked) rather than claiming three units.
		expect(serialTriggerLabel()).toBe('Select serials0/3');

		fireEvent.click(serialTrigger());
		fireEvent.click(await screen.findByRole('button', { name: 'TY-1' }));
		fireEvent.click(screen.getByRole('button', { name: 'TY-2' }));
		expect(screen.getByText('The request asked for 3 — 1 still to pick.')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'TY-3' }));
		expect(screen.queryByText(/still to pick/)).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: 'TY-4' }));
		expect(screen.getByText('More than the 3 this request asked for.')).toBeTruthy();
		// The row states the picks it carries beside the count asked for, so an
		// over-pick is visible on the row itself.
		expect(serialTriggerLabel()).toBe('4 serials selected4/3');
	});
});

/** Line 1 carrying a SERIAL item with its units picked — the state in which the
 *  destination is REQUIRED (the row is complete, so the units are about to move). */
async function chooseSerialLine(serialNos: readonly string[] = ['TY-1', 'TY-2']) {
	mocks.models = [serialModel('m-tyre', 'Tyre 11R')];
	mocks.onHandRows = [stockRow('m-tyre', 'main_store', serialNos.length)];
	mocks.itemStock.mockResolvedValue({ serials: serialNos.map(unit) });
	renderForm('goods_issue');
	searchItems('tyre');
	fireEvent.click(screen.getByText('Tyre 11R'));
	fireEvent.click(serialTrigger());
	fireEvent.click(await screen.findByRole('button', { name: serialNos[0] }));
	closeSheet();
}

/** Choose a plate through the REAL shared vehicle sheet (search-first: type, tap). */
async function pickTruck(plate: string) {
	fireEvent.click(screen.getByLabelText('Select a truck'));
	fireEvent.change(screen.getByPlaceholderText('Search plate no…'), { target: { value: plate } });
	fireEvent.click(await screen.findByRole('button', { name: plate }));
}

/** Switch the destination to a PERSON and take one through the personnel sheet. */
async function pickEmployee(term: string, name: string) {
	fireEvent.click(screen.getByRole('button', { name: 'Employee' }));
	fireEvent.click(screen.getByLabelText('Select an employee'));
	fireEvent.change(screen.getByPlaceholderText('Search name or staff ID…'), { target: { value: term } });
	fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
}

describe('outbound destination — a serial issue names the holder its units go to', () => {
	it('asks a consumable line for nothing — a plain store deduction has no holder to name', () => {
		// The field is ABSENT, not present-and-inert: the engine stamps a holder only on
		// an item-by-item unit, so demanding a destination here would ask a question
		// whose answer changes nothing.
		mocks.models = [model('m-bolt', 'Bolt')];
		mocks.onHandRows = [stockRow('m-bolt', 'main_store', 5)];
		renderForm('goods_issue');
		searchItems();
		fireEvent.click(screen.getByText('Bolt'));
		fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2' } });

		expect(screen.queryByText('Issue to')).toBeNull();
		expect(screen.queryByLabelText('Select a truck')).toBeNull();
		// …and the absent field blocks nothing: the row alone is a submittable draft.
		expect(saveButton().disabled).toBe(false);
	});

	it('blocks the save on a complete serial row and states the reason', async () => {
		// The reported failure this closes: the units left the store owned by nobody, so
		// they showed on no truck board and no employee register.
		await chooseSerialLine();

		expect(screen.getByText('Issue to')).toBeTruthy();
		expect(saveButton().disabled).toBe(true);
		expect(screen.getByText('Choose where the serial units go — a truck or an employee.')).toBeTruthy();
	});

	it('hands the units to the truck it names — the payload carries that id and no employee', async () => {
		mocks.vehicles = [{ id: 'veh-1', plate_no: 'TRK-X' }];
		await chooseSerialLine();
		await pickTruck('TRK-X');

		// The choice is read back before saving, and the save is unblocked by it.
		expect(screen.getByLabelText('Select a truck').textContent).toContain('TRK-X');
		expect(saveButton().disabled).toBe(false);

		fireEvent.click(saveButton());
		await waitFor(() => expect(mocks.createOutboundDoc).toHaveBeenCalledTimes(1));
		const payload = postedPayload();
		expect(payload.to_vehicle).toBe('veh-1');
		expect('to_employee' in payload).toBe(false);
		expect(payload.lines).toEqual([{ item_model: 'm-tyre', qty: 1, serials: ['TY-1'] }]);
	});

	it('hands the units to a person under the Employee holder — and never both at once', async () => {
		mocks.vehicles = [{ id: 'veh-1', plate_no: 'TRK-X' }];
		mocks.employees = [{ id: 'emp-1', name: 'Aung Aung', photo: null, eid: 'E-0001' }];
		await chooseSerialLine(['TY-9']);

		// Choosing a truck first, then switching to a person, must DROP the truck — the
		// engine names ONE destination, and a payload with both is refused outright.
		await pickTruck('TRK-X');
		await pickEmployee('aung', 'Aung Aung');
		// Read by ROLE, not by label text: while a sheet is mounted its dialog carries the
		// SAME words (the title) through `aria-labelledby`, so a label-text query is ambiguous.
		expect(screen.getByRole('button', { name: 'Select an employee' }).textContent).toContain('Aung Aung');

		fireEvent.click(saveButton());
		await waitFor(() => expect(mocks.createOutboundDoc).toHaveBeenCalledTimes(1));
		const payload = postedPayload();
		expect(payload.to_employee).toBe('emp-1');
		expect('to_vehicle' in payload).toBe(false);
	});

	it('never offers a destination on a write-off — those units go to nobody by design', () => {
		mocks.models = [serialModel('m-tyre', 'Tyre 11R')];
		mocks.onHandRows = [stockRow('m-tyre', 'main_store', 2)];
		renderForm('write_offs');
		searchItems('tyre');
		fireEvent.click(screen.getByText('Tyre 11R'));

		expect(screen.queryByText('Issue to')).toBeNull();
		expect(screen.queryByLabelText('Select a truck')).toBeNull();
	});
});
