// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { WearOnWheelPanel } from './wear-on-wheel-panel';
import { fitTyreToSeat } from '../data/api';
import type { VehicleBoardState } from '../data/board';
import type { TyreCardModel } from '../data/types';

// The ONE writer the panel calls + the signed-session actor it resolves first.
vi.mock('../data/api', () => ({ fitTyreToSeat: vi.fn(async () => ({ serialId: 't1' })) }));
vi.mock('../data/actor', () => ({ requireActorId: vi.fn(async () => 'actor-1') }));
vi.mock('@/shared/platform/haptics', () => ({ hapticSelection: vi.fn(), hapticImpact: vi.fn() }));

// jsdom ships neither, and the modules this file pulls in touch both at import time.
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

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function unit(over: Partial<TyreCardModel> & { id: string }): TyreCardModel {
	return {
		kind: 'tyre',
		modelName: 'X Multi D',
		serialNo: 'MX-4410',
		status: 'issued',
		itemNameEn: null,
		itemNameMm: null,
		plateNo: '5S-6467',
		slot: null,
		employeeId: null,
		employeeName: null,
		locationLabel: null,
		treadMm: 10,
		psi: null,
		condition: null,
		referenceTreadMm: 14,
		...over,
	};
}

/** A two-seat truck with ONE wheel filled — the other seat is therefore vacant.
 *  The layout derives the DISPLAY codes from the seat order: `A2-1` / `A2-2`. */
function board(mounted: TyreCardModel | null = unit({ id: 'w1', slot: 'steer-l', serialNo: 'BR-9902', treadMm: 2.1 })): VehicleBoardState {
	return {
		id: 'v1',
		plateNo: '5S-6467',
		brandLabel: 'NISSAN',
		unitLabel: 'tractor_unit',
		wheelCount: 2,
		seats: [
			{ id: 'steer-l', label: 'FL1' },
			{ id: 'steer-r', label: 'FR1' },
		],
		mount: new Map(mounted ? [['steer-l', mounted]] : []),
	};
}

function renderPanel(over: Partial<Parameters<typeof WearOnWheelPanel>[0]> = {}) {
	const onPlaced = vi.fn();
	const onCancel = vi.fn();
	render(
		<WearOnWheelPanel
			vehicle={board()}
			tyre={unit({ id: 't1' })}
			onPlaced={onPlaced}
			onCancel={onCancel}
			{...over}
		/>,
	);
	return { onPlaced, onCancel };
}

/**
 * WEAR ON A WHEEL POSITION.
 *
 * The action menu's `Wear` verb used to open a dialog listing vacant seats as chips,
 * which asked the operator to translate `A2-2` into a picture of the truck. This
 * panel is the truck's OWN rig reopened as the seat picker: the `+` gap you can see
 * is the target (and an occupied wheel never is), one tap performs the one fit, and
 * a stale/failed attempt stays on the drawing with its reason.
 */
describe('WearOnWheelPanel', () => {
	it('draws the truck rig with a + on the FREE seat only, and states the spare it carries', () => {
		renderPanel();

		// What is being placed — the unit the operator tapped, never re-asked.
		expect(screen.getByText('MX-4410')).toBeTruthy();
		expect(screen.getByText(/Tap a \+ wheel on 5S-6467/)).toBeTruthy();

		// The VACANT seat is the tap target, with the rig's `+` affordance…
		const free = screen.getByRole('button', { name: 'A2-2 — free wheel seat, move the tyre here' });
		expect(free.querySelector('svg')).toBeTruthy();
		// …and the wheel that already carries a tyre is NOT (Poka-Yoke).
		expect(screen.queryByRole('button', { name: /A2-1/ })).toBeNull();
		expect(screen.getByRole('img', { name: /A2-1 — BR-9902/ })).toBeTruthy();
	});

	it('fits the spare onto the seat that was tapped — one writer call, then the page is told', async () => {
		const { onPlaced } = renderPanel();

		fireEvent.click(screen.getByRole('button', { name: 'A2-2 — free wheel seat, move the tyre here' }));

		await waitFor(() => expect(fitTyreToSeat).toHaveBeenCalledTimes(1));
		expect(fitTyreToSeat).toHaveBeenCalledWith(
			't1',
			expect.objectContaining({ toVehicle: 'v1', toSlot: 'steer-r', actorId: 'actor-1' }),
		);
		// The change rides back so the page invalidates the register + that serial.
		expect(onPlaced).toHaveBeenCalledWith(['t1']);
	});

	it('offers no target and says why when every wheel is taken', () => {
		renderPanel({
			vehicle: {
				...board(),
				mount: new Map([
					['steer-l', unit({ id: 'w1', slot: 'steer-l' })],
					['steer-r', unit({ id: 'w2', slot: 'steer-r' })],
				]),
			},
		});

		expect(screen.getByText('No vacant wheel on this truck — take one off first.')).toBeTruthy();
		expect(screen.getByText(/Every wheel on this truck carries a tyre/)).toBeTruthy();
		// Nothing is tappable, so nothing can be written.
		expect(screen.queryByRole('button', { name: /free wheel seat/ })).toBeNull();
		expect(fitTyreToSeat).not.toHaveBeenCalled();
	});

	it('leaves the mode through the banner ✕ without writing anything', () => {
		const { onCancel } = renderPanel();

		fireEvent.click(screen.getByRole('button', { name: 'Cancel wearing' }));

		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(fitTyreToSeat).not.toHaveBeenCalled();
	});

	it('surfaces a refused fit on the drawing and keeps the seats usable', async () => {
		(fitTyreToSeat as unknown as { mockRejectedValueOnce: (err: Error) => void }).mockRejectedValueOnce(
			new Error('That seat is already taken'),
		);
		const { onPlaced } = renderPanel();

		fireEvent.click(screen.getByRole('button', { name: 'A2-2 — free wheel seat, move the tyre here' }));

		const error = await screen.findByText('That seat is already taken');
		expect(error.className).toContain('text-status-danger');
		expect(onPlaced).not.toHaveBeenCalled();
		// Still a target: the operator retries another wheel, not a dead screen.
		expect(screen.getByRole('button', { name: 'A2-2 — free wheel seat, move the tyre here' })).toBeTruthy();
	});
});
