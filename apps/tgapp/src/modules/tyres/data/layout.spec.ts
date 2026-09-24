import { describe, expect, it } from 'vitest';
import { axleRowsOf } from './layout';
import type { VehicleBoardState } from './board';
import { wheelSlotsOfVehicle, type VehWheelSeat } from './spec';
import type { TyreCardModel } from './types';

const SEATS_10: VehWheelSeat[] = [
	{ id: 'steer-l', label: 'FL1' },
	{ id: 'steer-r', label: 'FR1' },
	{ id: 'drv1-lo', label: 'RL1-O' },
	{ id: 'drv1-li', label: 'RL1-I' },
	{ id: 'drv1-ri', label: 'RR1-I' },
	{ id: 'drv1-ro', label: 'RR1-O' },
	{ id: 'drv2-lo', label: 'RL2-O' },
	{ id: 'drv2-li', label: 'RL2-I' },
	{ id: 'drv2-ri', label: 'RR2-I' },
	{ id: 'drv2-ro', label: 'RR2-O' },
];

const tyre = (id: string, slot: string, treadMm: number): TyreCardModel => ({
	id,
	kind: 'tyre',
	modelName: 'Tyre 11R22.5',
	serialNo: `TY-${id}`,
	status: 'issued',
	itemNameEn: null,
	itemNameMm: null,
	plateNo: 'TRK-1001',
	slot,
	employeeId: null,
	employeeName: null,
	locationLabel: null,
	treadMm,
	psi: null,
	condition: null,
	referenceTreadMm: null,
});

function vehicle(seats: VehWheelSeat[], mounted: TyreCardModel[]): VehicleBoardState {
	return {
		id: 'v1',
		plateNo: 'TRK-1001',
		brandLabel: 'hino',
		unitLabel: 'tractor_unit',
		wheelCount: seats.length,
		seats,
		mount: new Map(mounted.filter((t) => t.slot).map((t) => [t.slot!, t])),
	};
}

describe('axleRowsOf — fallback plans (no declared wheel_slots)', () => {
	it('a 12-wheel trailer = three dual axles, no steer row', () => {
		const seats = wheelSlotsOfVehicle(null, 12, 'trailer');
		expect(seats).toHaveLength(12);
		const rows = axleRowsOf(vehicle(seats, []));
		expect(rows.map((r) => r.key)).toEqual(['drive-1', 'drive-2', 'drive-3']);
		for (const row of rows) {
			expect(row.center).toHaveLength(0);
			expect(row.left).toHaveLength(2); // outer + inner
			expect(row.right).toHaveLength(2);
			expect(row.left[0].seat.label).toMatch(/-O$/);
			expect(row.left[1].seat.label).toMatch(/-I$/);
		}
	});

	it('a 10-wheel tractor without slots matches the seeded steer + two-dual plan', () => {
		const seats = wheelSlotsOfVehicle(null, 10, 'tractor_unit');
		expect(seats.map((s) => s.id)).toEqual(SEATS_10.map((s) => s.id));
		const rows = axleRowsOf(vehicle(seats, []));
		expect(rows.map((r) => r.key)).toEqual(['front', 'drive-1', 'drive-2']);
	});

	it('a 4-wheel box closes with a single rear axle (not a phantom dual)', () => {
		const seats = wheelSlotsOfVehicle(null, 4, 'box');
		expect(seats).toHaveLength(4);
		const rows = axleRowsOf(vehicle(seats, []));
		expect(rows.map((r) => r.key)).toEqual(['front', 'drive-1']);
		expect(rows[1].left).toHaveLength(1);
		expect(rows[1].right).toHaveLength(1);
		expect(rows[1].left[0].seat.id).toBe('drv1-l');
	});
});

describe('axleRowsOf — truck plan from the demo 10-wheel seat list', () => {
	it('groups front singles + two dual drive axles in order', () => {
		const rows = axleRowsOf(vehicle(SEATS_10, [tyre('t1', 'steer-l', 12.9)]));
		expect(rows.map((r) => r.key)).toEqual(['front', 'drive-1', 'drive-2']);
		expect(rows[0].left.map((w) => w.seat.label)).toEqual(['FL1']);
		expect(rows[0].right.map((w) => w.seat.label)).toEqual(['FR1']);
		expect(rows[1].left.map((w) => w.seat.label)).toEqual(['RL1-O', 'RL1-I']);
		expect(rows[1].right.map((w) => w.seat.label)).toEqual(['RR1-I', 'RR1-O']);
		expect(rows[2].left.map((w) => w.seat.label)).toEqual(['RL2-O', 'RL2-I']);
		expect(rows[2].right.map((w) => w.seat.label)).toEqual(['RR2-I', 'RR2-O']);
		// The mounted steer-l tyre keys under FL1 on the front axle.
		expect(rows[0].left[0].tyre?.serialNo).toBe('TY-t1');
		expect(rows[0].right[0].tyre).toBeNull();
		expect(rows[1].left[0].tyre).toBeNull();
	});

	it('renders every seat exactly once across the plan', () => {
		const rows = axleRowsOf(vehicle(SEATS_10, []));
		const labels = rows.flatMap((r) => [...r.left, ...r.right, ...r.center]).map((w) => w.seat.label);
		expect(labels.sort()).toEqual(SEATS_10.map((s) => s.label).sort());
	});
});

describe('axleRowsOf — tolerance paths', () => {
	it('pairs a numbered fallback plane into L/R axles', () => {
		const seats: VehWheelSeat[] = [
			{ id: 'wheel-1', label: 'Wheel 1' },
			{ id: 'wheel-2', label: 'Wheel 2' },
			{ id: 'wheel-3', label: 'Wheel 3' },
			{ id: 'wheel-4', label: 'Wheel 4' },
			{ id: 'wheel-5', label: 'Wheel 5' },
		];
		const rows = axleRowsOf(vehicle(seats, []));
		expect(rows.length).toBe(3);
		expect(rows[0].left[0].seat.id).toBe('wheel-1');
		expect(rows[0].right[0].seat.id).toBe('wheel-2');
		expect(rows[2].center[0].seat.id).toBe('wheel-5');
	});

	it('keeps legacy single-per-side drive seats on their own axle rows', () => {
		const seats: VehWheelSeat[] = [
			{ id: 'steer-l', label: 'Steer Left' },
			{ id: 'steer-r', label: 'Steer Right' },
			{ id: 'drv1-l', label: 'Drive Left' },
			{ id: 'drv1-r', label: 'Drive Right' },
			{ id: 'axle-x1', label: 'Axle 1' },
			{ id: 'axle-x2', label: 'Axle 2' },
		];
		const rows = axleRowsOf(vehicle(seats, []));
		expect(rows.map((r) => r.key)).toEqual(['front', 'drive-1', 'spare-1', 'spare-2']);
		expect(rows[1].left[0].seat.id).toBe('drv1-l');
		expect(rows[2].center[0].seat.id).toBe('axle-x1');
	});
});

describe('axleRowsOf — display codes (row letter + tyre count)', () => {
	it('names a 10-wheeler A2 / B4 / C4, indexing left→right across each axle', () => {
		const rows = axleRowsOf(vehicle(SEATS_10, []));
		expect(rows.map((r) => r.code)).toEqual(['A2', 'B4', 'C4']);
		expect(rows[0].left.map((w) => w.code)).toEqual(['A2-1']);
		expect(rows[0].right.map((w) => w.code)).toEqual(['A2-2']);
		// 1→4 sweeps left-outer, left-inner, right-inner, right-outer.
		expect(rows[1].left.map((w) => w.code)).toEqual(['B4-1', 'B4-2']);
		expect(rows[1].right.map((w) => w.code)).toEqual(['B4-3', 'B4-4']);
		expect(rows[2].right.map((w) => w.code)).toEqual(['C4-3', 'C4-4']);
	});

	it('leaves a side-less (spare) row uncoded, so no spare name is invented', () => {
		const seats: VehWheelSeat[] = [
			{ id: 'steer-l', label: 'FL1' },
			{ id: 'steer-r', label: 'FR1' },
			{ id: 'axle-x1', label: 'Spare' },
		];
		const rows = axleRowsOf(vehicle(seats, []));
		expect(rows.map((r) => r.code)).toEqual(['A2', '']);
		expect(rows[1].center.map((w) => w.code)).toEqual(['']);
	});
});
