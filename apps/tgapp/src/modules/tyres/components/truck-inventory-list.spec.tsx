// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TruckInventoryList, type RegistryTab } from './truck-inventory-list';
import type { VehicleBoardState } from '../data/board';
import { onBoardActions } from '../data/board-actions';
import type { TyreCardModel } from '../data/types';

// The list WRITES nothing: a wear is performed on the truck's own rig (the page's
// `?serial=` seat-picker mode), so the spec asserts the hand-off, not an API call.
// The Requests tab reads the SHARED store-requests module — stubbed so the spec
// proves the panel is wired (card + plate-bound order), not the requisition API.
vi.mock('@/modules/store-requests/data/api', () => ({
	fetchVehicleRequisitionPage: vi.fn(async () => ({
		rows: [
			{
				id: 'r1',
				displayNumber: 'REQ-00001',
				status: 'confirmed',
				requisitionStatus: 'requested',
				requestedBy: { id: 'e1', name: 'Aung', avatar: null },
				approvedBy: { id: null, name: null, avatar: null },
				vehicleId: 'v1',
				vehiclePlate: '24W-HAUL-990',
				issuedQty: null,
				requestedQty: 12,
				locationLabel: 'Main Store',
				requestDateLabel: '5 Sep 2026',
				lineCount: 2,
				totalQty: 12,
				summaryLabel: '2 items · Total 12',
				note: null,
				closeReason: null,
				ageLabel: '1 week ago',
			},
		],
		nextCursor: null,
		hasMore: false,
	})),
}));

// jsdom ships none of these, and the modules this file pulls in touch them. The
// observers stay inert — the tests assert rendering + callbacks.
beforeAll(() => {
	if (!globalThis.ResizeObserver) {
		globalThis.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;
	}
	if (!globalThis.IntersectionObserver) {
		globalThis.IntersectionObserver = class {
			root = null;
			rootMargin = '';
			thresholds = [];
			observe() {}
			unobserve() {}
			disconnect() {}
			takeRecords() {
				return [];
			}
		} as unknown as typeof IntersectionObserver;
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

afterEach(cleanup);

/** A register unit — a tyre (worn when it has a slot) or an `assets`-flagged item. */
function unit(over: Partial<TyreCardModel> & { id: string }): TyreCardModel {
	return {
		kind: 'tyre',
		modelName: 'R268',
		imageUrl: null,
		serialNo: 'BR-9902',
		status: 'issued',
		itemNameEn: null,
		itemNameMm: null,
		plateNo: '24W-HAUL-990',
		slot: null,
		employeeId: null,
		employeeName: null,
		locationLabel: null,
		treadMm: null,
		psi: null,
		condition: null,
		referenceTreadMm: null,
		...over,
	};
}

/** A three-seat truck with ONE wheel filled — two seats are therefore vacant. */
function boardWithOneWorn(): { vehicle: VehicleBoardState; worn: TyreCardModel; tray: TyreCardModel } {
	const worn = unit({ id: 'w1', slot: 'steer-l', treadMm: 2.1 });
	const vehicle: VehicleBoardState = {
		id: 'v1',
		plateNo: '24W-HAUL-990',
		brandLabel: 'HINO',
		unitLabel: 'box',
		wheelCount: 3,
		seats: [
			{ id: 'steer-l', label: 'FL1' },
			{ id: 'steer-r', label: 'FR1' },
			{ id: 'drv1-lo', label: 'RL1-O' },
		],
		mount: new Map([['steer-l', worn]]),
	};
	const tray = unit({ id: 't1', serialNo: 'MX-4410', modelName: 'X Multi D', treadMm: 10 });
	return { vehicle, worn, tray };
}

/** Renders the route's pathname, so a verb that leaves for its own page is
 *  observable without mounting that page. */
function ActionProbe() {
	const { pathname } = useLocation();
	return <div data-testid="action-page">{pathname}</div>;
}

const noop = () => {};

function renderList(over: Partial<Parameters<typeof TruckInventoryList>[0]> = {}) {
	const { vehicle, worn, tray } = boardWithOneWorn();
	const props = {
		vehicle,
		mounted: [worn],
		tray: [tray],
		assets: [],
		onOpenHistory: noop,
		onChanged: noop,
		onPlaceOnWheel: noop,
		onRequestFromStore: noop,
		...over,
	};

	/** The PAGE owns the registry's scope as URL view state (`?scope=`); the harness
	 *  stands in for it with local state so a tab switch behaves like the app. */
	function Harness() {
		const [segment, setSegment] = useState<RegistryTab>(over.segment ?? 'onboard');
		return <TruckInventoryList {...props} segment={segment} onSegmentChange={setSegment} />;
	}

	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={['/app/tyres/vehicle/v1']}>
				<Routes>
					<Route path="/app/tyres/vehicle/:id" element={<Harness />} />
					<Route path="/app/tyres/vehicle/:id/action/:kind/:tyreId" element={<ActionProbe />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

/** ONE row — its `<li>`, located by the row's ONE tap target (the action-menu
 *  button). The row's own copy is asserted through `textContent`, because a row's
 *  lines are composed of several text nodes (a value + its unit, a serial + its
 *  label, …). */
function rowOf(serialNo: string): HTMLElement {
	return screen.getByRole('button', { name: `${serialNo} — open its actions` }).closest('li') as HTMLElement;
}

/** The GLYPH chip of a row with no product photo — the element whose colour encodes
 *  the unit's tread band. A photographed row has no chip at all: its face IS the
 *  picture (assert on the row's `<img>` instead). */
function iconWellOf(serialNo: string): HTMLElement {
	return rowOf(serialNo).querySelector('span.flex.size-9') as HTMLElement;
}

/** Tap ONE row (by its serial) to open its action-menu sheet. */
function openActions(serialNo: string) {
	fireEvent.click(screen.getByRole('button', { name: `${serialNo} — open its actions` }));
	return screen.getByRole('dialog');
}

describe('TruckInventoryList', () => {
	it('shows tyres AND equipment in ONE list, told apart by their sections and badges', () => {
		renderList({ assets: [unit({ id: 'a1', kind: 'asset', itemNameEn: 'Jack', serialNo: 'JK-1' })] });

		// TWO panels — the truck's whole register, then what it asked the store for.
		expect(screen.getByRole('tab', { name: 'On board' })).toBeTruthy();
		expect(screen.getByRole('tab', { name: 'Requests' })).toBeTruthy();
		expect(screen.queryByRole('tab', { name: /^Tyre$/ })).toBeNull();
		expect(screen.queryByRole('tab', { name: /^Equipment$/ })).toBeNull();

		// All THREE sections in the one panel, each with its count — a tyre and a jack are
		// two kinds of the same answer ("what is on this truck"), so neither is hidden
		// behind a tab that has to be switched to.
		expect(screen.getByText(/On wheels · worn/)).toBeTruthy();
		expect(screen.getByText(/Off wheels · un-worn/)).toBeTruthy();
		expect(screen.getByText(/Equipment \(1\)/)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'JK-1 — open its actions' })).toBeTruthy();

		// The badges carry a row's kind WITHOUT reading up to the nearest heading — which
		// is exactly what a mixed list needs them for.
		expect(screen.getByText('UN-WORN')).toBeTruthy();
		expect(screen.getByText('TOOL')).toBeTruthy();
	});

	it('binds the tabs to their panel (APG tab pattern)', () => {
		renderList();

		const panel = screen.getByRole('tabpanel');
		const active = screen.getByRole('tab', { name: 'On board' });
		expect(active.getAttribute('aria-selected')).toBe('true');
		expect(active.getAttribute('aria-controls')).toBe(panel.id);
		expect(panel.getAttribute('aria-labelledby')).toBe(active.id);
	});

	it('marks an un-worn unit as off a wheel: a muted surface and a grey well', () => {
		renderList();

		const wornRow = screen.getByRole('button', { name: 'BR-9902 — open its actions' }).closest('li') as HTMLElement;
		const trayRow = screen.getByRole('button', { name: 'MX-4410 — open its actions' }).closest('li') as HTMLElement;
		expect(wornRow.className).toContain('bg-card');
		expect(trayRow.className).toContain('bg-muted/30');
		expect(screen.getByText('UN-WORN')).toBeTruthy();
	});

	it('names each row by its ITEM and its MODEL — never a bare size code', () => {
		renderList({
			mounted: [unit({ id: 'w1', slot: 'steer-l', serialNo: 'BR-9902', itemNameEn: 'Tyre', modelName: '11R 22.5' })],
		});

		// The two facts a unit is identified by, in ONE title — the same pair the item
		// picker showed when this SKU was chosen, so a search result and the card agree.
		expect(screen.getByText('Tyre · 11R 22.5')).toBeTruthy();
		expect(screen.queryByText('11R 22.5')).toBeNull();
	});

	it('fronts a row with its MODEL’s photo as a FULL-BLEED tile, and keeps the glyph when the SKU has none', () => {
		renderList({
			mounted: [unit({ id: 'w1', slot: 'steer-l', serialNo: 'BR-9902', imageUrl: '/api/media/tyre.jpg' })],
			tray: [unit({ id: 't1', serialNo: 'MX-4410', imageUrl: null })],
		});

		const row = rowOf('BR-9902');
		const photo = row.querySelector('img') as HTMLImageElement;
		expect(photo.getAttribute('src')).toBe('/api/media/tyre.jpg');
		// Decorative on purpose: the row's own label names the unit, right beside it.
		expect(photo.getAttribute('alt')).toBe('');

		// The tile OWNS the card's left/top/bottom edges: it is a direct child of the
		// row's tap target (no box wrapping it) and stretches to the card's height, with
		// `object-cover` filling that space instead of letterboxing it — so there is no
		// padding above, below or to its left.
		expect(photo.parentElement?.tagName).toBe('BUTTON');
		expect(photo.classList.contains('self-stretch')).toBe(true);
		expect(photo.classList.contains('object-cover')).toBe(true);
		// …the row keeps ONLY its right inset; the vertical breathing room moved into the
		// text column (asserted below), never around the picture.
		const target = photo.closest('button') as HTMLButtonElement;
		expect(target.classList.contains('p-2.5')).toBe(false);
		expect(target.classList.contains('py-2.5')).toBe(false);
		expect(target.classList.contains('pl-2.5')).toBe(false);
		expect(target.classList.contains('pr-2.5')).toBe(true);
		expect((photo.nextElementSibling as HTMLElement).classList.contains('py-2.5')).toBe(true);
		// The card clips the tile, so the picture's corners ARE the card's radius.
		expect(row.classList.contains('overflow-hidden')).toBe(true);

		// A SKU with no picture yet keeps its INSET glyph chip — never a blank tile.
		expect(rowOf('MX-4410').querySelector('img')).toBeNull();
		expect(iconWellOf('MX-4410').classList.contains('size-9')).toBe(true);
		expect(iconWellOf('MX-4410').querySelector('svg')).toBeTruthy();
	});

	it('falls back to the glyph chip when a model photo cannot load', () => {
		// A media asset can be gone (GC'd / never synced here); a broken image must not
		// leave an empty tile, and the row keeps its tread-band chip either way.
		renderList({ tray: [unit({ id: 't1', serialNo: 'MX-4410', imageUrl: '/api/media/gone.jpg' })] });

		const row = rowOf('MX-4410');
		fireEvent.error(row.querySelector('img') as HTMLImageElement);

		expect(row.querySelector('img')).toBeNull();
		expect(row.querySelector('svg')).toBeTruthy();
		// The chip comes back with the row's own tone (this tray spare is grey, never
		// the danger band a measured tyre would carry).
		expect(iconWellOf('MX-4410').classList.contains('text-muted-foreground')).toBe(true);
	});

	it('reads a TYRE by condition and thickness — a colour dot BEFORE the name, the depth at the top-right', () => {
		renderList({
			mounted: [unit({ id: 'w1', slot: 'steer-l', serialNo: 'BR-9902', treadMm: 2.1, itemNameEn: 'Tyre', modelName: '11R 22.5' })],
		});

		const row = rowOf('BR-9902');
		const title = screen.getByText('Tyre · 11R 22.5');

		// The dot LEADS the name, and its colour is the band (2.1 mm ⇒ Replace) — with
		// the band's own name for a screen reader, so colour is never the only carrier.
		const dot = row.querySelector('[role="img"]') as HTMLElement;
		expect(dot.classList.contains('bg-status-danger')).toBe(true);
		expect(dot.getAttribute('aria-label')).toBe('Tread Replace');
		expect(title.previousElementSibling).toBe(dot);

		// The measured THICKNESS rides the title line, pushed to the card's right edge —
		// ONE figure in ONE place (the serial line no longer repeats it).
		const depth = screen.getByText('2.1 mm');
		expect(depth.parentElement).toBe(title.parentElement);
		expect(depth.classList.contains('ml-auto')).toBe(true);
		expect(depth.classList.contains('text-status-danger')).toBe(true);
		expect(row.textContent?.match(/2\.1 mm/g)).toHaveLength(1);
		expect(row.textContent).toContain('S/N BR-9902');
	});

	it('bands the dot by the measured depth — a healthy tyre leads with green', () => {
		// The base board's tray spare measures 10 mm (≥ 5 ⇒ Good); the SAME map the
		// wheel map's tiles and its legend read, so card and board cannot disagree.
		renderList();

		const dot = rowOf('MX-4410').querySelector('[role="img"]') as HTMLElement;
		expect(dot.classList.contains('bg-status-success')).toBe(true);
		expect(dot.getAttribute('aria-label')).toBe('Tread Good');
		expect(screen.getByText('10 mm')).toBeTruthy();
	});

	it('shows a GREY "not measured" dot for an unmeasured tyre — never silence, and never on equipment', () => {
		// Measurement-only (`readings.ts`): a unit with no `checked` reading has no band
		// to paint, so the dot states the GAP instead of vanishing — while equipment's
		// `condition` is not a tread band at all, so its row stays text.
		renderList({
			mounted: [unit({ id: 'w1', slot: 'steer-l', serialNo: 'BR-9902', treadMm: null })],
			assets: [unit({ id: 'a1', kind: 'asset', itemNameEn: 'Jack', serialNo: 'JK-1', condition: 'good' })],
		});

		const dot = rowOf('BR-9902').querySelector('[role="img"]') as HTMLElement;
		expect(dot.className).toContain('bg-muted-foreground');
		expect(dot.getAttribute('aria-label')).toBe('Tread not measured');
		// No measurement ⇒ no figure to state (the reading is what the number IS).
		expect(rowOf('BR-9902').textContent).not.toMatch(/\d+ mm/);

		expect(rowOf('JK-1').querySelector('[role="img"]')).toBeNull();
		expect(rowOf('JK-1').textContent).toContain('Good');
	});

	it('opens a row’s action MENU in a bottom sheet — the whole worn verb set, no inline strip', () => {
		renderList();

		const sheet = openActions('BR-9902');

		// The verbs are the rule's own, and NOTHING expanded under the row itself.
		for (const verb of [/history/i, /inspect/i, /move/i, /swap/i, /take off/i, /write-off/i, /transfer/i]) {
			expect(within(sheet).getByRole('button', { name: verb }), String(verb)).toBeTruthy();
		}
		// A store return is the TRANSFER filer with the store as its destination — ONE
		// menu entry, never a second route to the same `mro_asset_requests` row.
		expect(within(sheet).queryByRole('button', { name: /return to store/i })).toBeNull();
		expect(document.querySelector('[role="toolbar"]')).toBeNull();

		// Each row carries the English verb AND its Burmese gloss — the operator's copy,
		// read from the ONE rule so a copy edit can never leave this expectation stale.
		const historyRow = within(sheet).getByRole('button', { name: /full history/i });
		const historyHint = onBoardActions('worn', { vacantSeats: 1, peers: 1, transferable: true }).find((a) => a.kind === 'history')!.hint;
		expect(historyRow.textContent).toContain(historyHint);
	});

	it('names the unit and where it sits in the sheet header, so a verb is never chosen blind', () => {
		renderList();

		const sheet = openActions('BR-9902');

		// Serial + lifecycle, then the plate, the wheel position and the measured depth.
		expect(within(sheet).getByText('BR-9902')).toBeTruthy();
		expect(within(sheet).getByText('Issued')).toBeTruthy();
		expect(within(sheet).getByText('24W-HAUL-990')).toBeTruthy();
		expect(within(sheet).getByText('A2-1')).toBeTruthy();
		expect(within(sheet).getByText(/2.1 mm/)).toBeTruthy();
	});

	it('closes the sheet and opens the lifecycle page from the History verb', () => {
		const onOpenHistory = vi.fn();
		renderList({ onOpenHistory });

		const sheet = openActions('BR-9902');
		fireEvent.click(within(sheet).getByRole('button', { name: /history/i }));

		expect(onOpenHistory.mock.calls[0][0]).toMatchObject({ id: 'w1' });
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('offers Wear, a write-off REQUEST and the governed transfer on an off-wheel spare — and no separate return row', () => {
		renderList();

		const sheet = openActions('MX-4410');
		for (const verb of [/wear/i, /write-off/i, /transfer/i]) {
			expect((within(sheet).getByRole('button', { name: verb }) as HTMLButtonElement).disabled).toBe(false);
		}
		// Back to store is one of that filer's destinations, not a verb of its own.
		expect(within(sheet).queryByRole('button', { name: /return to store/i })).toBeNull();
	});

	it('walks the sheet’s transfer verb to its OWN full-screen page — no stacked pane', () => {
		renderList({ assets: [unit({ id: 'a1', kind: 'asset', itemNameEn: 'Jack', serialNo: 'JK-1' })] });

		const sheet = openActions('JK-1');
		fireEvent.click(within(sheet).getByRole('button', { name: /request a transfer/i }));

		// The sheet is gone and the filer's own route is showing — the app bar's back
		// (not a back control inside the sheet) is what returns to the board.
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(screen.getByTestId('action-page').textContent).toBe('/app/tyres/vehicle/v1/action/transfer/a1');
	});

	it('renders Wear inert WITH its reason when no wheel is vacant (Poka-Yoke)', () => {
		const { vehicle, worn, tray } = boardWithOneWorn();
		// Fill the other two seats so nothing is vacant.
		const extra = [unit({ id: 'w2', slot: 'steer-r' }), unit({ id: 'w3', slot: 'drv1-lo' })];
		vehicle.mount = new Map([
			['steer-l', worn],
			['steer-r', extra[0]],
			['drv1-lo', extra[1]],
		]);
		renderList({ vehicle, tray: [tray] });

		const sheet = openActions('MX-4410');
		const wear = within(sheet).getByRole('button', { name: /wear/i }) as HTMLButtonElement;
		expect(wear.disabled).toBe(true);
		expect(within(sheet).getByText(/no vacant wheel on this truck/i)).toBeTruthy();
	});

	it('hands a tray spare to the WEAR seat-picker — no dialog, and no write from here', () => {
		const onPlaceOnWheel = vi.fn();
		renderList({ onPlaceOnWheel });

		const sheet = openActions('MX-4410');
		fireEvent.click(within(sheet).getByRole('button', { name: /wear/i }));

		// The row's exact unit goes to the page, which reopens THIS truck's rig as a
		// seat picker: a wheel is chosen by tapping the drawing, never in a dialog.
		expect(onPlaceOnWheel).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', serialNo: 'MX-4410' }));
		// One surface at a time: the verb menu is gone and nothing stacked on it.
		expect(screen.queryByRole('button', { name: /write-off/i })).toBeNull();
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('colours a worn tyre by its tread band but keeps an UN-WORN tyre grey', () => {
		renderList();

		// 2.1 mm ⇒ the danger band, so the worn row's well carries the danger tone.
		expect(iconWellOf('BR-9902').className).toContain('text-status-danger');
		// An un-worn tyre is grey whatever it measures — colour is reserved for a
		// live safety state on a wheel.
		expect(iconWellOf('MX-4410').className).toContain('text-muted-foreground');
		expect(iconWellOf('MX-4410').className).not.toContain('text-status-');
	});

	it('shows ONE empty CARD — never a "(0)" heading — when the truck holds nothing at all', () => {
		renderList({ mounted: [], tray: [], assets: [] });

		expect(screen.getByText('Nothing on board')).toBeTruthy();
		// The card OWNS the tab panel, so it stretches to it — never a compact box
		// floating in a half-empty pane with the store button stranded below.
		expect(screen.getByText('Nothing on board').parentElement?.className).toContain('min-h-full');
		// The sections collapse entirely rather than printing a zero count.
		const panel = screen.getByRole('tabpanel');
		expect(within(panel).queryByText(/On wheels · worn/)).toBeNull();
		expect(within(panel).queryByText(/Off wheels · un-worn/)).toBeNull();
		expect(within(panel).queryByText(/Equipment/)).toBeNull();
		expect(within(panel).queryByText(/\(0\)/)).toBeNull();
	});

	it('keeps the tyres on screen when only the tool box is empty — no empty card mid-list', () => {
		// The empty card is for a truck with NOTHING, not for one missing a section: a
		// unified panel must not replace real rows with "nothing here".
		renderList({ assets: [] });

		expect(screen.getByRole('button', { name: 'BR-9902 — open its actions' })).toBeTruthy();
		expect(screen.queryByText('Nothing on board')).toBeNull();
		expect(screen.queryByText(/Equipment/)).toBeNull();
	});

	it('offers a one-tap clear when the search matches nothing', () => {
		renderList({ mounted: [], tray: [], assets: [] });

		fireEvent.change(screen.getByLabelText('Filter the on-board registry'), { target: { value: 'zzz' } });
		expect(screen.getByText('No unit matches')).toBeTruthy();
		// A search miss fills the same pane the no-data card does.
		expect(screen.getByText('No unit matches').parentElement?.className).toContain('min-h-full');

		fireEvent.click(screen.getByRole('button', { name: /clear filter/i }));
		expect(screen.getByText('Nothing on board')).toBeTruthy();
	});

	it('orders from the store bound to the plate — the merged panel has no catalog to scope to', () => {
		const onRequestFromStore = vi.fn();
		renderList({ assets: [unit({ id: 'a1', kind: 'asset', itemNameEn: 'Jack', serialNo: 'JK-1' })], onRequestFromStore });

		// ONE store action for the whole register — the footer never offers a way to
		// write a fit.
		expect(screen.getAllByRole('button', { name: /request /i })).toHaveLength(1);
		fireEvent.click(screen.getByRole('button', { name: /request from store/i }));
		// NO argument: the form opens on the whole directory and the operator picks the
		// kind there, rather than inheriting a scope from a tab they were not on.
		expect(onRequestFromStore).toHaveBeenLastCalledWith();
	});

	it('shows the truck’s REQUESTS on the second tab — the shared request card, + bound to the plate alone', async () => {
		const onRequestFromStore = vi.fn();
		renderList({ onRequestFromStore });

		fireEvent.click(screen.getByRole('tab', { name: 'Requests' }));

		// The SAME card the /app/store-requests register renders (number + status).
		expect(await screen.findByText('REQ-00001')).toBeTruthy();
		expect(screen.getByText('Requested')).toBeTruthy();
		// The registry filter has nothing to narrow here, so it is not offered.
		expect(screen.queryByLabelText('Filter the on-board registry')).toBeNull();

		// The + opens a request bound to the plate but to NO catalog scope.
		fireEvent.click(screen.getByRole('button', { name: /new request/i }));
		expect(onRequestFromStore).toHaveBeenLastCalledWith();
	});
});
