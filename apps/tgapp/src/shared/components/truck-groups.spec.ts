import { describe, expect, it } from 'vitest';

import { compareNewestCreated, docYearLabel, truckGroupsOf } from './truck-groups';

interface Doc {
	id: string;
	vehicleId?: string | null;
	plate?: string | null;
	brand?: string | null;
}

const trk1: Doc = { id: 'lic-1', vehicleId: 'v1', plate: 'TRK-1001', brand: 'HINO' };
const trk2a: Doc = { id: 'lic-2', vehicleId: 'v2', plate: 'TRK-1002', brand: 'FUSO' };
const trk2b: Doc = { id: 'lic-3', vehicleId: 'v2', plate: 'TRK-1002', brand: 'FUSO' };

describe('truckGroupsOf', () => {
	it('groups rows under their owning vehicle, keeping input order inside each group', () => {
		const groups = truckGroupsOf([trk2a, trk1, trk2b]);

		expect(groups).toHaveLength(2);
		expect(groups[0]).toMatchObject({ key: 'v2', plate: 'TRK-1002', brand: 'FUSO' });
		expect(groups[0].items.map((d) => d.id)).toEqual(['lic-2', 'lic-3']);
		expect(groups[1]).toMatchObject({ key: 'v1', plate: 'TRK-1001', brand: 'HINO' });
		expect(groups[1].items.map((d) => d.id)).toEqual(['lic-1']);
	});

	it('streaming a later page appends new trucks without reshuffling existing sections', () => {
		const first = truckGroupsOf([trk1]);
		const after = truckGroupsOf([trk1, trk2a]);

		expect(first[0].key).toBe('v1');
		expect(after.map((g) => g.key)).toEqual(['v1', 'v2']);
	});

	it('falls back to the plate when no vehicle id is present', () => {
		const groups = truckGroupsOf([
			{ id: 'a', plate: 'TRK-1001', brand: 'HINO' },
			{ id: 'b', plate: 'TRK-1001', brand: 'HINO' },
		]);

		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({ vehicleId: null, plate: 'TRK-1001' });
		expect(groups[0].items).toHaveLength(2);
	});

	it('sinks unlinked rows into ONE trailing Unassigned group', () => {
		const groups = truckGroupsOf([trk1, { id: 'orphan-1' }, { id: 'orphan-2', plate: '  ' }]);

		expect(groups).toHaveLength(2);
		expect(groups[1]).toMatchObject({ key: 'Unassigned', vehicleId: null, plate: null });
		expect(groups[1].items.map((d) => d.id)).toEqual(['orphan-1', 'orphan-2']);
	});

	it('supports a selector for modules whose models name the fields differently', () => {
		const policy = { id: 'p1', vehicleId: 'v1', plateNo: 'TRK-1001', brandLabel: 'HINO' };
		const groups = truckGroupsOf([policy], (p) => ({ vehicleId: p.vehicleId, plate: p.plateNo, brand: p.brandLabel }));

		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({ key: 'v1', plate: 'TRK-1001', brand: 'HINO' });
		expect(groups[0].items).toEqual([policy]);
	});

	it('returns no groups for an empty row set', () => {
		expect(truckGroupsOf([])).toEqual([]);
	});
});

describe('compareNewestCreated', () => {
	it('orders newest first, sinking rows with no created_at last', () => {
		const rows = [{ id: 'a', createdAt: '2026-01-03T00:00:00.000Z' }, { id: 'b' }, { id: 'c', createdAt: '2026-09-06T09:20:41.191Z' }];
		expect([...rows].sort(compareNewestCreated).map((r) => r.id)).toEqual(['c', 'a', 'b']);
	});
});

describe('docYearLabel', () => {
	it('reads the year from annual-style document numbers', () => {
		expect(docYearLabel('YGN/26/100')).toBe('2026');
		expect(docYearLabel('YGN/2026/LIC-8085')).toBe('2026');
		expect(docYearLabel('MDY/26/102')).toBe('2026');
	});

	it('returns null for a number with digits but no parseable year segment', () => {
		expect(docYearLabel('AYA/YGN/POL-8085', '2027-09-06')).toBeNull();
	});

	it('falls back to the date year only when the number is empty', () => {
		expect(docYearLabel(null, '2026-09-18')).toBe('2026');
		expect(docYearLabel(undefined, '2026-09-18')).toBe('2026');
		expect(docYearLabel('', '2026-09-18')).toBe('2026');
		expect(docYearLabel(null, null)).toBeNull();
	});
});
