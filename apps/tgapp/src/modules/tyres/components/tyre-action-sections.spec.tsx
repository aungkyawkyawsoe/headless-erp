// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScrapRequestSection, UnseatSection } from './tyre-action-sections';
import { unseatTyreToTray } from '../data/api';
import { fileAssetTransfer } from '@/modules/asset-transfers/data/api';
import type { TyreCardModel } from '../data/types';

// The engine writer, the governed FILER and the signed-session actor are stubbed:
// these tests assert the CONFIRM gate in front of them, not the writes themselves.
vi.mock('../data/api', () => ({
	swapTyreSeats: vi.fn(async () => ({ serialId: 't1' })),
	unseatTyreToTray: vi.fn(async () => ({ serialId: 't1' })),
}));
vi.mock('../data/actor', () => ({ requireActorId: vi.fn(async () => 'actor-1') }));
// A write-off is FILED, not written — the request create is what the confirm guards.
vi.mock('@/modules/asset-transfers/data/api', () => ({
	fileAssetTransfer: vi.fn(async () => ({ id: 'r1', display_number: 'ATR-00009' })),
}));
// Filing RESOLVES the holding truck through the shared master cache first (the
// request records the source the execute is pinned to), so the directory read is
// stubbed to hand back the plate the fixture sits on.
vi.mock('@/shared/lookups/hooks', () => ({
	useVehicleMasters: () => ({ data: [{ id: 'v1', plate_no: '24W-HAUL-990' }], isPending: false }),
}));

/** The filers read a master through react-query, so they need a client. */
function renderInQuery(ui: React.ReactElement) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

// jsdom ships neither; the DS Sheet / date field touch both at import time.
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
beforeEach(() => vi.clearAllMocks());

const tyre: TyreCardModel = {
	kind: 'tyre',
	id: 't1',
	modelName: 'R268',
	serialNo: 'BR-9902',
	status: 'issued',
	itemNameEn: null,
	itemNameMm: null,
	plateNo: '24W-HAUL-990',
	slot: 'FL1',
	employeeId: null,
	employeeName: null,
	locationLabel: null,
	treadMm: 2.1,
	psi: null,
	condition: null,
	referenceTreadMm: null,
};

describe('irreversible tyre actions confirm first', () => {
	it('files a WRITE-OFF REQUEST on confirm — nothing is scrapped from this screen', async () => {
		renderInQuery(<ScrapRequestSection tyre={tyre} onDone={vi.fn()} />);

		// The screen says what it is: a request a superior must approve, not a writer.
		expect(screen.getByText(/superior’s approval/)).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Send write-off request' }));
		const dialog = screen.getByRole('dialog');
		expect(dialog.textContent).toContain('BR-9902');
		expect(fileAssetTransfer).not.toHaveBeenCalled();

		fireEvent.click(within(dialog).getByRole('button', { name: 'File request' }));

		await waitFor(() => expect(fileAssetTransfer).toHaveBeenCalledTimes(1));
		// The filed row IS the write-off: the flag set, the source recorded so the
		// execute is pinned to the truck the decision was made about …
		const filed = vi.mocked(fileAssetTransfer).mock.calls[0][0];
		expect(filed).toMatchObject({ serial: 't1', writeOff: true, fromVehicle: 'v1', fromSlot: 'FL1' });
		// … and NO destination: the engine's kind guard refuses a write-off that names
		// one (it would scrap a unit somebody believed they were moving).
		expect(filed.toVehicle ?? null).toBeNull();
		expect(filed.toEmployee ?? null).toBeNull();
		expect(filed.toLocation ?? null).toBeNull();
	});

	it('files nothing when the confirm sheet is dismissed', () => {
		renderInQuery(<ScrapRequestSection tyre={tyre} onDone={vi.fn()} />);

		fireEvent.click(screen.getByRole('button', { name: 'Send write-off request' }));
		fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

		expect(fileAssetTransfer).not.toHaveBeenCalled();
	});

	it('confirms taking a tyre off its wheel — it stays on the truck, not on a wheel', async () => {
		render(<UnseatSection tyre={tyre} onDone={vi.fn()} />);

		// The copy names the STATE, never a stockroom word: the unit is off the wheel.
		expect(screen.getByText(/not on a wheel/)).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Take BR-9902 off the wheel' }));
		const dialog = screen.getByRole('dialog');
		fireEvent.click(within(dialog).getByRole('button', { name: 'Take it off' }));

		await waitFor(() => expect(unseatTyreToTray).toHaveBeenCalledTimes(1));
	});
});
