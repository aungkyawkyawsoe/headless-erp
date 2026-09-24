/**
 * Ordered wheel-seat vocabulary — normalize a vehicle's declared `wheel_slots`
 * (array | JSON string | none) into the seat list the fitment board renders.
 * A seat is the smallest thing a tyre can wear:  { id, label }.
 * No declared list → a unit-type-aware PLAN for its `wheel` count (never blank):
 * a cabbed truck leads with steer singles then dual rear axles; a trailer is a
 * pure set of dual axles — the same shape the seed scripts write, so the board
 * never draws a bare numbered plane.
 */
export interface VehWheelSeat {
	/** id — matches the serial's stored `slot` (e.g. "steer-l", "drv2-ro"). */
	id: string;
	/** human label — the position code shown on the plan tile (e.g. "FL1"). */
	label: string;
}

/**
 * Physical seat plan for a plate that declares NO `wheel_slots` — derived from
 * the unit type + wheel count so the drawing is honest:
 *
 *  - a cabbed unit (box / tractor_unit …) leads with steer singles (`FL1/FR1`)
 *    and fills the rest as dual rear axles;
 *  - a TRAILER carries no steering axle — every axle is a dual pair (a 12-wheel
 *    trailer = three dual axles, not six single rows);
 *  - wheel budgets that don't resolve into full dual axles close with single
 *    rear wheels / one extra single.
 *
 * The ids + labels are the SAME vocabulary the seed scripts write, so mounted
 * serials key to identical seats whether a plate declares its list or not.
 */
export function fallbackSeatsFor(unitType: string | null | undefined, wheel?: number | null): VehWheelSeat[] {
	const count = typeof wheel === 'number' && Number.isFinite(wheel) && wheel > 0 ? Math.floor(wheel) : 0;
	if (count === 0) return [];

	const cabbed = unitType !== 'trailer' && unitType !== 'forklift';
	const seats: VehWheelSeat[] = [];
	let remaining = count;
	if (cabbed && count >= 4) {
		seats.push({ id: 'steer-l', label: 'FL1' });
		seats.push({ id: 'steer-r', label: 'FR1' });
		remaining -= 2;
	}

	let axle = 1;
	// Dual rear/trailer axles — one outer + inner seat per side, ordered as the
	// plan reads: left outer, left inner, right inner, right outer.
	while (remaining >= 4) {
		seats.push({ id: `drv${axle}-lo`, label: `RL${axle}-O` });
		seats.push({ id: `drv${axle}-li`, label: `RL${axle}-I` });
		seats.push({ id: `drv${axle}-ri`, label: `RR${axle}-I` });
		seats.push({ id: `drv${axle}-ro`, label: `RR${axle}-O` });
		remaining -= 4;
		axle += 1;
	}
	// Leftover (unusual) budgets become single rear wheels, two per axle.
	while (remaining >= 2) {
		seats.push({ id: `drv${axle}-l`, label: `R${axle}L` });
		seats.push({ id: `drv${axle}-r`, label: `R${axle}R` });
		remaining -= 2;
		axle += 1;
	}
	// An odd number of wheels leaves ONE single wheel — its own seat, labelled by
	// what it physically is (never by a stockroom word like "spare").
	if (remaining === 1) seats.push({ id: 'axle-x1', label: 'Extra wheel' });
	return seats;
}

export function wheelSlotsOfVehicle(rawSlots: unknown, wheel?: number | null, unitType?: string | null): VehWheelSeat[] {
	let arr: unknown = rawSlots;
	if (typeof rawSlots === 'string' && rawSlots.trim()) {
		try {
			arr = JSON.parse(rawSlots);
		} catch {
			arr = null;
		}
	}
	if (Array.isArray(arr)) {
		const seats: VehWheelSeat[] = [];
		for (const item of arr) {
			if (!item || typeof item !== 'object') continue;
			const id = (item as { id?: unknown }).id;
			if (typeof id !== 'string' || !id.trim()) continue;
			const label = (item as { label?: unknown }).label;
			seats.push({ id: id.trim(), label: (typeof label === 'string' && label.trim() ? label.trim() : null) ?? id.trim() });
		}
		if (seats.length) return seats;
	}
	// No usable declared list — derive the physical plan from unit type + count.
	return fallbackSeatsFor(unitType, wheel);
}
