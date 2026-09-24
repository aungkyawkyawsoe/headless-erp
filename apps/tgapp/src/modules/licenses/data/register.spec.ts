import { describe, expect, it } from 'vitest';

import { licenseCardOf, licenseMatchOf } from './api';
import type { FleetRow } from './types';

/**
 * The vehicle-first register's row→card mapping (`licenseCardOf`) — pure, so it
 * runs in the default node environment with no DOM. It pins the two facts the
 * register depends on: the document facts come from the expanded `last_license`
 * pointer, and a missing/stale pointer becomes the explicit "no record" card
 * (`hasRecord: false`) rather than a vanished row.
 */
function fleet(over: Partial<FleetRow> = {}): FleetRow {
	return { id: 'veh-1', plate_no: '7S-6158', brand: 'hino', ...over };
}

describe('licenseCardOf — vehicle-first register mapping', () => {
	it('maps the expanded last_license pointer onto the card', () => {
		const card = licenseCardOf(
			fleet({
				last_license: {
					id: 'per-1',
					license_no: '  YGN/26/100  ',
					place: ' Yangon ',
					expiry_date: '2999-12-31',
					created_at: '2026-01-02T00:00:00Z',
				},
			}),
		);
		expect(card.id).toBe('veh-1');
		expect(card.vehicleId).toBe('veh-1');
		expect(card.plate).toBe('7S-6158');
		expect(card.brand).toBe('HINO');
		expect(card.hasRecord).toBe(true);
		expect(card.licenseNo).toBe('YGN/26/100');
		expect(card.place).toBe('Yangon');
		expect(card.expiryDate).toBe('2999-12-31');
		expect(card.createdAt).toBe('2026-01-02T00:00:00Z');
		expect(card.tone).toBe('ok');
		expect(card.remainingDays).toBeGreaterThan(0);
	});

	it('renders an explicit no-record card for a vehicle with no permit', () => {
		const card = licenseCardOf(fleet({ last_license: null }));
		expect(card.hasRecord).toBe(false);
		expect(card.licenseNo).toBeNull();
		expect(card.place).toBeNull();
		expect(card.expiryDate).toBeNull();
		expect(card.remainingDays).toBeNull();
		expect(card.tone).toBe('ok');
		// The vehicle identity still paints, so the row is not omitted.
		expect(card.plate).toBe('7S-6158');
		expect(card.brand).toBe('HINO');
	});

	it('treats a STALE pointer (the engine resolved a soft-deleted doc to null) as no record', () => {
		// `resolveM2O` hides trashed targets → a pointer at a deleted permit reads
		// as null here, so a deleted document is never shown as current.
		const card = licenseCardOf(fleet({ last_license: null }));
		expect(card.hasRecord).toBe(false);
	});

	it('ignores an unexpanded bare-id pointer (never leaks the raw key as a document)', () => {
		const card = licenseCardOf(fleet({ last_license: 'per-1' as unknown as FleetRow['last_license'] }));
		expect(card.hasRecord).toBe(false);
		expect(card.licenseNo).toBeNull();
	});

	it('tones an overdue expiry as alert with negative remaining days', () => {
		const card = licenseCardOf(fleet({ last_license: { id: 'per-1', expiry_date: '2000-01-01' } }));
		expect(card.tone).toBe('alert');
		expect(card.remainingDays).toBeLessThan(0);
	});

	it('trims a blank plate to null and maps an unknown brand to null', () => {
		const card = licenseCardOf(fleet({ plate_no: '   ', brand: 'not-a-brand' }));
		expect(card.plate).toBeNull();
		expect(card.brand).toBeNull();
	});
});

/**
 * The kiosk plate lookup's hit→row mapping (`licenseMatchOf`) — the SAME pointer
 * the register reads, so a suggestion row can never disagree with the register
 * card for that truck. Also pins the null-vs-empty distinction the renewal gate
 * depends on (`record: null` for a truck with no permit).
 */
describe('licenseMatchOf — kiosk pointer mapping', () => {
	it('carries the current permit from the SAME last_license pointer as the register', () => {
		const match = licenseMatchOf(
			fleet({
				last_license: { id: 'per-1', license_no: 'YGN/26/100', expiry_date: '2999-12-31' },
			}),
		);
		expect(match).not.toBeNull();
		expect(match?.vehicleId).toBe('veh-1');
		expect(match?.plate).toBe('7S-6158');
		expect(match?.brand).toBe('HINO');
		expect(match?.record?.licenseNo).toBe('YGN/26/100');
	});

	it('returns record null for a truck with no permit (the renewal gate allows a first record)', () => {
		const match = licenseMatchOf(fleet({ last_license: null }));
		expect(match?.record).toBeNull();
	});

	it('drops a hit with no plate (the row has no identity to render)', () => {
		expect(licenseMatchOf(fleet({ plate_no: '   ' }))).toBeNull();
	});
});
