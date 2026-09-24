import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The generic entity create the filer calls — captured to pin the WIRE payload. */
const { create } = vi.hoisted(() => ({
	create: vi.fn(async (_payload: Record<string, unknown>) => ({ id: 'r1', display_number: 'ATR-00009' })),
}));

vi.mock('@/shared/api/sdk', () => ({ sdk: { items: () => ({ create }) } }));
vi.mock('@/shared/mro', () => ({ mroApi: {} }));

import { fileAssetTransfer } from './api';

/**
 * The filed row IS the contract with the engine: `write_off` is what makes a
 * destination-less request a write-off, and the compiled kind guard refuses one
 * that also carries a destination — so the wire payload is pinned here, not just
 * the form's intent.
 */
describe('fileAssetTransfer — the wire payload the engine kind guard reads', () => {
	beforeEach(() => create.mockClear());

	it('files a WRITE-OFF with the flag set and EVERY destination null', async () => {
		await fileAssetTransfer({
			serial: 't1',
			fromVehicle: 'v1',
			fromSlot: 'FL1',
			writeOff: true,
			note: 'sidewall cut',
		});

		expect(create.mock.calls[0][0]).toEqual({
			serial: 't1',
			from_vehicle: 'v1',
			from_slot: 'FL1',
			from_employee: null,
			to_vehicle: null,
			to_slot: null,
			to_employee: null,
			to_location: null,
			write_off: true,
			note: 'sidewall cut',
		});
	});

	it('files a transfer with the flag explicitly false — never a missing column', async () => {
		await fileAssetTransfer({ serial: 't1', fromVehicle: 'v1', toVehicle: 'v2' });

		expect(create.mock.calls[0][0]).toMatchObject({ to_vehicle: 'v2', write_off: false });
	});
});
