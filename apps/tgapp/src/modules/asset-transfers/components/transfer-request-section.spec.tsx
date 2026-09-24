// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TransferRequestSection } from './transfer-request-section';
import { fileAssetTransfer } from '../data/api';
import type { TyreCardModel } from '@/modules/tyres/data/types';

// The filer's ONE writer, the plate master it resolves the SOURCE from, and the two
// search-first sibling pickers (they have their own specs). The STORE picker is REAL
// here — it is the surface under test.
vi.mock('../data/api', () => ({
	fileAssetTransfer: vi.fn(async () => ({ id: 'r1', display_number: 'ATR-00001' })),
}));
vi.mock('@/shared/lookups/hooks', () => ({
	useVehicleMasters: () => ({
		// The unit's own plate must resolve: the request records its source, and the
		// submit refuses to file without it.
		data: [
			{ id: 'v1', plate_no: '1TLR-8919' },
			{ id: 'v2', plate_no: '6S-2734' },
		],
		isPending: false,
		isError: false,
	}),
}));
vi.mock('@/shared/components/vehicle-picker-sheet', () => ({ VehiclePickerSheet: () => null }));
vi.mock('@/shared/components/personnel-picker-sheet', () => ({ PersonnelPickerSheet: () => null }));
vi.mock('@/shared/platform/haptics', () => ({ hapticSelection: vi.fn(), hapticImpact: vi.fn() }));

// jsdom ships neither, and the design-system Sheet this form opens touches both.
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

/** A truck-held wheel unit — the shape whose destinations are truck | store. */
function unit(over: Partial<TyreCardModel> = {}): TyreCardModel {
	return {
		id: 's1',
		kind: 'tyre',
		modelName: '11R 22.5',
		imageUrl: null,
		serialNo: 'TY_12',
		status: 'issued',
		itemNameEn: 'Tyre',
		itemNameMm: null,
		plateNo: '1TLR-8919',
		slot: 'A2-1',
		employeeId: null,
		employeeName: null,
		locationLabel: null,
		treadMm: 4.5,
		psi: null,
		condition: null,
		referenceTreadMm: 15,
		...over,
	};
}

const noop = () => {};

/** Reveal the store field: "Back to store" is one of the two governed destinations. */
function pickStoreKind() {
	fireEvent.click(screen.getByRole('button', { name: /Back to store/ }));
}

/**
 * The custody filer's DESTINATION fields.
 *
 * A truck-held unit may go to another truck or back to the store, and BOTH name their
 * target the same way — a labelled trigger that opens a picker sheet. These pin that
 * "Back to store" is a real choice of five, not a chip row dumping every store inline,
 * that the picker is deliberately lighter than the truck one (one label per row), and
 * the payload a return files.
 */
describe('TransferRequestSection — the return names a store the way a transfer names a truck', () => {
	it('offers a store through the SAME chooser anatomy as a truck, not an inline chip list', () => {
		render(<TransferRequestSection tyre={unit()} onDone={noop} />);

		// Parity, checked against the sibling field first: the truck destination is a
		// labelled trigger.
		fireEvent.click(screen.getByRole('button', { name: /Another truck/ }));
		expect(screen.getByLabelText('Destination truck').textContent).toContain('Choose a truck…');

		pickStoreKind();

		const trigger = screen.getByLabelText('Destination store');
		expect(trigger.textContent).toContain('Choose a store…');
		// …and the stores are NOT all rendered inline (the chip row it replaced).
		expect(screen.queryByRole('button', { name: 'Mandalay store' })).toBeNull();
	});

	it('lists each store once with ONE label per row, and one tap commits it', () => {
		render(<TransferRequestSection tyre={unit()} onDone={noop} />);
		pickStoreKind();

		// Nothing named yet ⇒ the one action says what is still missing, and is inert.
		const submit = screen.getByRole('button', { name: /Choose the store to return it to/ }) as HTMLButtonElement;
		expect(submit.disabled).toBe(true);

		fireEvent.click(screen.getByLabelText('Destination store'));

		// The row carries the store's own name and NOTHING else — the truck picker's rows
		// have a plate + a search field because its directory is unbounded; five stores
		// need neither.
		const row = screen.getByRole('button', { name: 'Mandalay store' });
		expect(row.textContent).toBe('Mandalay store');
		expect(screen.queryByLabelText('Search stores')).toBeNull();

		fireEvent.click(row);

		// One tap commits and closes: the trigger now states where it goes…
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(screen.getByLabelText('Destination store').textContent).toContain('Mandalay store');
		// …the consequence names that store (the English label, not the raw value)…
		expect(screen.getByText(/goes into Mandalay store as in-stock/)).toBeTruthy();
		// …and the action is now the return it will file.
		expect((screen.getByRole('button', { name: /Send return request/ }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('files a return as to_location — with NO destination truck or person', async () => {
		render(<TransferRequestSection tyre={unit()} onDone={noop} />);
		pickStoreKind();
		fireEvent.click(screen.getByLabelText('Destination store'));
		fireEvent.click(screen.getByRole('button', { name: 'Main store' }));
		fireEvent.click(screen.getByRole('button', { name: /Send return request/ }));

		await waitFor(() => expect(fileAssetTransfer).toHaveBeenCalledTimes(1));
		expect(fileAssetTransfer).toHaveBeenCalledWith(
			expect.objectContaining({
				// The source is recorded so the execute is pinned to this position…
				serial: 's1',
				fromVehicle: 'v1',
				fromSlot: 'A2-1',
				// …and exactly ONE destination holdership is set: the store.
				toLocation: 'main_store',
				toVehicle: null,
				toEmployee: null,
				toSlot: null,
			}),
		);
		expect(await screen.findByText('ATR-00001 filed')).toBeTruthy();
	});

	it('clears a named store when the operator switches destination kind', () => {
		render(<TransferRequestSection tyre={unit()} onDone={noop} />);
		pickStoreKind();
		fireEvent.click(screen.getByLabelText('Destination store'));
		fireEvent.click(screen.getByRole('button', { name: 'Safety store' }));
		expect(screen.getByLabelText('Destination store').textContent).toContain('Safety store');

		fireEvent.click(screen.getByRole('button', { name: /Another truck/ }));
		pickStoreKind();

		// A stale store must never ride along on a later return (the same rule the truck
		// and person fields already followed).
		expect(screen.getByLabelText('Destination store').textContent).toContain('Choose a store…');
	});
});
