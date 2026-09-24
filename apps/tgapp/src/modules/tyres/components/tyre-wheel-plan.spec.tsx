// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TyreWheelPlan, WheelSeatPicker, WheelViewToggle, type WheelView } from './tyre-wheel-plan';
import { axleRowsOf } from '../data/layout';
import type { VehicleBoardState } from '../data/board';
import type { TyreCardModel } from '../data/types';

// The list is a sibling surface with its own spec — the rig must not need it here.
vi.mock('./truck-inventory-list', () => ({ TruckInventoryList: () => <div data-testid="list" /> }));

// jsdom ships neither; the design-system modules this file pulls in touch both at
// import time. Both are inert here — the tests assert rendering + callbacks.
beforeAll(() => {
	if (!globalThis.ResizeObserver) {
		globalThis.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;
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

/** A register unit — a seated tyre or a tray spare. */
function unit(over: Partial<TyreCardModel> & { id: string }): TyreCardModel {
	return {
		kind: 'tyre',
		modelName: 'R268',
		serialNo: 'BR-9902',
		status: 'issued',
		itemNameEn: null,
		itemNameMm: null,
		plateNo: '5S-6467',
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

/** A two-seat truck with ONE wheel filled — the other seat is therefore vacant. */
function boardWithOneWorn(): { vehicle: VehicleBoardState; worn: TyreCardModel; tray: TyreCardModel } {
	const worn = unit({ id: 'w1', slot: 'steer-l', treadMm: 2.1 });
	const vehicle: VehicleBoardState = {
		id: 'v1',
		plateNo: '5S-6467',
		brandLabel: 'NISSAN',
		unitLabel: 'tractor_unit',
		wheelCount: 2,
		seats: [
			{ id: 'steer-l', label: 'FL1' },
			{ id: 'steer-r', label: 'FR1' },
		],
		mount: new Map([['steer-l', worn]]),
	};
	return { vehicle, worn, tray: unit({ id: 't1', serialNo: 'MX-4410', modelName: 'X Multi D', treadMm: 10 }) };
}

/** Renders the route's pathname, so a navigation away from the rig is observable. */
function ActionProbe() {
	const { pathname } = useLocation();
	return <div data-testid="action-page">{pathname}</div>;
}

function renderRig() {
	const { vehicle, worn, tray } = boardWithOneWorn();
	return render(
		<MemoryRouter initialEntries={['/app/tyres/vehicle/v1']}>
			<Routes>
				<Route
					path="/app/tyres/vehicle/:id"
					element={
						<TyreWheelPlan
							vehicle={vehicle}
							view="rig"
							onViewChange={() => {}}
							segment="onboard"
							onSegmentChange={() => {}}
							mounted={[worn]}
							tray={[tray]}
							onPlaceOnWheel={() => {}}
						/>
					}
				/>
				<Route path="/app/tyres/vehicle/:id/action/:kind/:tyreId" element={<ActionProbe />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('WheelViewToggle', () => {
	it('offers the on-board list while the rig is drawn, and reports the rig as selected', () => {
		render(<WheelViewToggle view="rig" onChange={() => {}} />);

		const button = screen.getByRole('button', { name: 'Switch to the on-board list' });
		// `aria-pressed` tracks the LIST, not the view: false = the rig is showing.
		expect(button.getAttribute('aria-pressed')).toBe('false');
	});

	it('flips the view to the list when pressed', () => {
		const onChange = vi.fn();
		render(<WheelViewToggle view="rig" onChange={onChange} />);

		fireEvent.click(screen.getByRole('button', { name: 'Switch to the on-board list' }));

		expect(onChange).toHaveBeenCalledWith<[WheelView]>('list');
	});

	it('offers the rig back while the list is drawn', () => {
		const onChange = vi.fn();
		render(<WheelViewToggle view="list" onChange={onChange} />);

		const button = screen.getByRole('button', { name: 'Switch to the wheel rig' });
		expect(button.getAttribute('aria-pressed')).toBe('true');

		fireEvent.click(button);
		expect(onChange).toHaveBeenCalledWith<[WheelView]>('rig');
	});
});

describe('TyreWheelPlan — the rig is a read-only drawing', () => {
	it('draws a vacant seat as an inert, non-interactive gap', () => {
		renderRig();

		// The gap is INFORMATION (an image), not a control: no button exists for it.
		const gap = screen.getByRole('img', { name: /A2-2 — vacant wheel seat, no tyre fitted/ });
		fireEvent.click(gap);

		expect(screen.queryByRole('button', { name: /A2-2/ })).toBeNull();
	});

	it('draws a FILLED wheel as a plain reading — tapping it opens NOTHING', () => {
		renderRig();

		// The mounted tyre is INFORMATION (an image) named by position, serial and reading.
		const tile = screen.getByRole('img', { name: 'A2-1 — BR-9902 — 2.1 mm tread, mounted' });
		fireEvent.click(tile);

		// The rig is a drawing: a wheel tap can only ever be misleading, so it unlocks no
		// action surface and stays put (no navigation away from the board).
		expect(screen.queryByTestId('action-page')).toBeNull();
		expect(screen.getByRole('img', { name: 'A2-1 — BR-9902 — 2.1 mm tread, mounted' })).toBeTruthy();
	});

	it('opens the take-off page from a filled wheel’s corner ✕', () => {
		renderRig();

		fireEvent.click(screen.getByRole('button', { name: /A2-1 — BR-9902 — take it off the wheel/ }));

		expect(screen.getByTestId('action-page').textContent).toBe('/app/tyres/vehicle/v1/action/unseat/w1');
	});
});

describe('WheelSeatPicker — the same rig, as a seat picker', () => {
	/** The two-seat truck's axle rows — one seat filled, one free. */
	const seatRows = () => axleRowsOf(boardWithOneWorn().vehicle);

	it('makes a FREE seat a tap target, and leaves a FILLED one the rig’s read-only tile', () => {
		const onSelect = vi.fn();
		render(<WheelSeatPicker rows={seatRows()} freeSeatIds={new Set(['steer-r'])} selectedSeatId={null} onSelect={onSelect} />);

		// The free gap is a control…
		fireEvent.click(screen.getByRole('button', { name: 'A2-2 — free wheel seat, move the tyre here' }));
		expect(onSelect).toHaveBeenCalledWith('steer-r');

		// …while the wheel already holding a tyre stays a drawing: no picker button,
		// and no corner ✕ either (a picker has nothing to take off).
		expect(screen.getByRole('img', { name: 'A2-1 — BR-9902 — 2.1 mm tread, mounted' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /A2-1/ })).toBeNull();
	});

	it('marks the chosen seat, and calls out the seat the unit sits on as “This tyre”', () => {
		render(
			<WheelSeatPicker
				rows={seatRows()}
				freeSeatIds={new Set(['steer-r'])}
				selectedSeatId="steer-r"
				currentSeatId="steer-l"
				onSelect={() => {}}
			/>,
		);

		expect(screen.getByRole('button', { name: 'A2-2 — free wheel seat, move the tyre here' }).getAttribute('aria-pressed')).toBe('true');
		expect(screen.getByText('Chosen')).toBeTruthy();

		// The unit's own seat is named, never drawn as a stranger's tyre.
		const own = screen.getByRole('img', { name: 'A2-1 — the seat this tyre is on now' });
		expect(own.textContent).toContain('This tyre');
	});

	it('carries the front-of-truck cue so the drawing is never ambiguous', () => {
		render(<WheelSeatPicker rows={seatRows()} freeSeatIds={new Set()} selectedSeatId={null} onSelect={() => {}} />);

		expect(screen.getByText('Front — steering axle')).toBeTruthy();
	});
});
