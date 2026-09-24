import { describe, expect, it } from 'vitest';

import { insuranceCardOf, insuranceMatchOf } from './api';
import type { FleetRow } from './types';

/**
 * The vehicle-first register's row→card mapping (`insuranceCardOf`) — pure, so
 * it runs in the default node environment with no DOM. It pins the two facts the
 * register depends on: the policy facts come from the expanded `last_insurance`
 * pointer, and a missing/stale pointer becomes the explicit "no record" card
 * (`hasRecord: false`) rather than a vanished row.
 */
function fleet(over: Partial<FleetRow> = {}): FleetRow {
	return { id: 'veh-1', plate_no: '7S-6158', brand: 'hino', ...over };
}

describe('insuranceCardOf — vehicle-first register mapping', () => {
	it('maps the expanded last_insurance pointer onto the card', () => {
		const card = insuranceCardOf(
			fleet({
				last_insurance: {
					id: 'pol-1',
					provider: 'AYI',
					policy_no: 'AYA/YGN/118',
					expiry_date: '2999-12-31',
					betterment: true,
					premium_amount: '1250000',
					sum_insured: 5000000,
					note: ' Full cover ',
					created_at: '2026-01-02T00:00:00Z',
				},
			}),
		);
		expect(card.id).toBe('veh-1');
		expect(card.vehicleId).toBe('veh-1');
		expect(card.plateNo).toBe('7S-6158');
		expect(card.brandLabel).toBe('HINO');
		expect(card.hasRecord).toBe(true);
		expect(card.provider).toBe('AYA');
		expect(card.policyNo).toBe('AYA/YGN/118');
		expect(card.expiryDate).toBe('2999-12-31');
		expect(card.betterment).toBe(true);
		expect(card.premiumAmount).toBe(1250000);
		expect(card.sumInsured).toBe(5000000);
		expect(card.note).toBe('Full cover');
		expect(card.createdAt).toBe('2026-01-02T00:00:00Z');
		expect(card.status).toBe('valid');
		expect(card.remainingDays).toBeGreaterThan(0);
	});

	it('renders an explicit no-record card for a vehicle with no policy', () => {
		const card = insuranceCardOf(fleet({ last_insurance: null }));
		expect(card.hasRecord).toBe(false);
		expect(card.provider).toBeNull();
		expect(card.policyNo).toBeNull();
		expect(card.expiryDate).toBeNull();
		expect(card.remainingDays).toBeNull();
		// An undated policy derives `expired`; a vehicle with NO policy is filtered
		// out of every status view by the page's `hasRecord` guard.
		expect(card.status).toBe('expired');
		expect(card.plateNo).toBe('7S-6158');
		expect(card.brandLabel).toBe('HINO');
	});

	it('treats a STALE pointer (the engine resolved a soft-deleted doc to null) as no record', () => {
		const card = insuranceCardOf(fleet({ last_insurance: null }));
		expect(card.hasRecord).toBe(false);
	});

	it('ignores an unexpanded bare-id pointer (never leaks the raw key as a policy)', () => {
		const card = insuranceCardOf(fleet({ last_insurance: 'pol-1' as unknown as FleetRow['last_insurance'] }));
		expect(card.hasRecord).toBe(false);
		expect(card.provider).toBeNull();
	});

	it('derives an expired status for a past expiry', () => {
		const card = insuranceCardOf(fleet({ last_insurance: { id: 'pol-1', provider: 'GGI', expiry_date: '2000-01-01' } }));
		expect(card.status).toBe('expired');
		expect(card.remainingDays).toBeLessThan(0);
	});
});

/**
 * The kiosk plate lookup's hit→row mapping (`insuranceMatchOf`) — the SAME
 * pointer the register reads, so a suggestion row can never disagree with the
 * register card for that truck. Also pins the null-vs-empty distinction the
 * renew gate depends on (`record: null` for a truck with no policy).
 */
describe('insuranceMatchOf — kiosk pointer mapping', () => {
	it('carries the current policy from the SAME last_insurance pointer as the register', () => {
		const match = insuranceMatchOf(
			fleet({
				last_insurance: { id: 'pol-1', provider: 'AYI', policy_no: 'AYA/YGN/118', expiry_date: '2999-12-31' },
			}),
		);
		expect(match).not.toBeNull();
		expect(match?.vehicleId).toBe('veh-1');
		expect(match?.plate).toBe('7S-6158');
		expect(match?.brand).toBe('HINO');
		expect(match?.record?.policyNo).toBe('AYA/YGN/118');
	});

	it('returns record null for a truck with no policy (the renew gate allows a first record)', () => {
		const match = insuranceMatchOf(fleet({ last_insurance: null }));
		expect(match?.record).toBeNull();
	});

	it('drops a hit with no plate (the row has no identity to render)', () => {
		expect(insuranceMatchOf(fleet({ plate_no: '   ' }))).toBeNull();
	});
});
