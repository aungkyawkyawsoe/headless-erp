/**
 * Fitment PLAN — turn a vehicle's ordered wheel-seat list into the "wheel map"
 * the fitment sheet draws: front-to-rear axle rows, each row split left | right
 * around the chassis spine, and each side holding ONE tile (single steer wheel)
 * or TWO tiles (outer + inner of a dual rear wheel).
 *
 * The seat vocabulary is deliberately tolerant so the SAME pure resolver works
 * for every seat shape a fleet row can carry today:
 *
 *  - the board scaffold's `drv1-lo / drv1-li / drv1-ri / drv1-ro` dual codes
 *    (labels `RL1-O / RL1-I / RR1-I / RR1-O`…) and `steer-l / steer-r` front
 *    singles — the layout the seed scripts write;
 *  - the compact plan codes (`fl1`, `fr1`, `rl1-o`, `rr2-i`…) when a fleet row
 *    declares them directly;
 *  - a bare numbered plane (`wheel-1 … wheel-N` — the fallback for plates with
 *    no declared `wheel_slots`), drawn as symmetric L/R pairs.
 *
 * The mount keying stays UNCHANGED (seat id → serial `slot`); this module only
 * decides WHERE on the drawing a seat's tyre appears.
 */
import type { VehicleBoardState } from './board';
import type { VehWheelSeat } from './spec';
import type { TyreCardModel } from './types';

/** Where a seat sits across the truck — center only for odd/legacy layouts. */
export type WheelSide = 'left' | 'right' | 'center';

/** Wheel shape at a seat: steer singles carry no inner/outer marker. */
export type WheelKind = 'single' | 'outer' | 'inner';

/** One seat on the plan — the declared wheel + whichever mounted tyre fills it
 *  (null when the block is a vacant gap). `code` is the DISPLAY name derived from
 *  the row (see `assignCodes`): `A2`, `A2-1`, `B4-3`… — never the stored
 *  `seat.label` (that stays the raw vocabulary, used by the inventory list). */
export interface WheelOnAxle {
	seat: VehWheelSeat;
	kind: WheelKind;
	tyre: TyreCardModel | null;
	code: string;
}

/** One horizontal axle row of the plan: the left wheel group, the right wheel
 *  group, and any side-less seats (centered under the chassis spine). */
export interface AxleRow {
	/** Stable key (derived from the axle's seat-code prefix). */
	key: string;
	/** The row's DISPLAY name — its letter + how many tyres it carries (`A2`,
	 *  `B4`). Empty for a side-less row — those render no caption. */
	code: string;
	left: WheelOnAxle[];
	right: WheelOnAxle[];
	center: WheelOnAxle[];
}

interface DecodedSeat {
	axleKey: string;
	side: WheelSide;
	kind: WheelKind;
}

/** Dual-pair suffix → side + inner/outer (left group outer→inner reads toward
 *  the spine, right group the mirror image). */
const DUAL_SUFFIX: Record<string, { side: 'left' | 'right'; kind: WheelKind }> = {
	l: { side: 'left', kind: 'single' },
	r: { side: 'right', kind: 'single' },
	lo: { side: 'left', kind: 'outer' },
	li: { side: 'left', kind: 'inner' },
	ro: { side: 'right', kind: 'outer' },
	ri: { side: 'right', kind: 'inner' },
};

/** Decode one seat id into its axle + side + wheel shape. Unrecognised seats
 *  decode to their own centered row (keyed by list index) so no declared wheel
 *  is ever dropped from the drawing. */
function decodeSeat(seat: VehWheelSeat, index: number): DecodedSeat {
	const id = seat.id.trim().toLowerCase();

	// Compact plan codes — e.g. fl1 / fr1 (front singles), rl1-o / rr2-i (rear
	// dual pairs). Rear index counts axles from the front backwards (RL1 = the
	// first rear axle) so the plan reads like the workshop's own shorthand.
	const compact = /^(fl|fr|rl|rr)(\d{0,2})(?:-(o|i))?$/.exec(id);
	if (compact) {
		const [, code, axleRaw, io] = compact;
		const left = code[1] === 'l';
		if (code[0] === 'f') return { axleKey: 'front', side: left ? 'left' : 'right', kind: 'single' };
		const num = axleRaw ? Number(axleRaw) : 1;
		return {
			axleKey: `rear-${num}`,
			side: left ? 'left' : 'right',
			kind: io === 'o' ? 'outer' : io === 'i' ? 'inner' : 'single',
		};
	}

	// Front steer axle — steer-l / steer-r singles (the board scaffold ids).
	const steer = /^steer[-_]?([lr])$/.exec(id);
	if (steer) return { axleKey: 'front', side: steer[1] === 'l' ? 'left' : 'right', kind: 'single' };

	// Drive / trailer axles with an optional dual suffix — drv1-lo, drv2-ri,
	// tr3-l … (suffix-less bare axles centre under the spine).
	const rear = /^(drv|drive|tr|trailer)(\d*)(?:[-_]([a-z]+))?$/.exec(id);
	if (rear) {
		const [, token, numRaw, suffix] = rear;
		const num = numRaw ? Number(numRaw) : 1;
		const axleKey = token === 'tr' || token === 'trailer' ? `trailer-${num}` : `drive-${num}`;
		if (!suffix) return { axleKey, side: 'center', kind: 'single' };
		const mapped = DUAL_SUFFIX[suffix];
		if (mapped) return { axleKey, ...mapped };
		return { axleKey, side: 'center', kind: 'single' };
	}

	// Legacy numbered spares (axle-x1 …) — each gets its own centered row so the
	// count is honest even though the plate declares no side for them.
	const spare = /^axle[-_]?x(\d+)$/.exec(id);
	if (spare) return { axleKey: `spare-${spare[1]}`, side: 'center', kind: 'single' };

	// Anything else — keep the wheel visible on its own centered row.
	return { axleKey: `seat-${index}`, side: 'center', kind: 'single' };
}

/** All seats are the numbered fallback plane (`wheel-N` — a plate with no
 *  declared `wheel_slots`): pair consecutive seats L/R into axles. */
function isNumberedPlane(seats: VehWheelSeat[]): boolean {
	return seats.length > 0 && seats.every((seat) => /^wheel-\d+$/i.test(seat.id.trim()));
}

/** Display rank within a side group — the outer tyre sits farthest from the
 *  chassis spine on BOTH sides (left reads outer→inner, right inner→outer). */
function groupRank(side: WheelSide, kind: WheelKind): number {
	if (side === 'left') return kind === 'inner' ? 1 : 0;
	if (side === 'right') return kind === 'outer' ? 1 : 0;
	return 0;
}

/**
 * Stamp every row + wheel with its DISPLAY name — the row's letter (front `A`,
 * then `B`, `C`…) plus how many tyres that row carries, and each tyre a
 * `row-index` within the row. A 10-wheeler reads `A2-1 A2-2 | B4-1…B4-4 |
 * C4-1…C4-4`; a side-less row carries no code, so no name is invented for it.
 * invented. Index 1→N sweeps left-outer → left-inner → right-inner →
 * right-outer (the order the side groups are already sorted in). Row letters
 * skip side-less rows, so a centered seat never consumes a letter.
 */
function assignCodes(rows: AxleRow[]): AxleRow[] {
	let letter = 0;
	return rows.map((row) => {
		const sideCount = row.left.length + row.right.length;
		if (sideCount === 0) {
			return { ...row, code: '', center: row.center.map((wheel) => ({ ...wheel, code: '' })) };
		}
		const rowCode = `${String.fromCharCode(65 + letter)}${sideCount}`;
		letter += 1;
		return {
			...row,
			code: rowCode,
			left: row.left.map((wheel, index) => ({ ...wheel, code: `${rowCode}-${index + 1}` })),
			right: row.right.map((wheel, index) => ({ ...wheel, code: `${rowCode}-${row.left.length + index + 1}` })),
			center: row.center.map((wheel) => ({ ...wheel, code: '' })),
		};
	});
}

/** Seat id → its DISPLAY code (`A2-1`, `B4-3`) for a whole vehicle — the ONE map
 *  any truck-context surface (action sheet header, wear dialog notes) reads so a
 *  position reads the SAME everywhere it appears. Empty-coded (spare) seats are
 *  omitted, so a caller falls back to its own label for those. */
export function seatCodeById(vehicle: VehicleBoardState): Map<string, string> {
	const map = new Map<string, string>();
	for (const row of axleRowsOf(vehicle)) {
		for (const wheel of [...row.left, ...row.right, ...row.center]) {
			if (wheel.code) map.set(wheel.seat.id, wheel.code);
		}
	}
	return map;
}

/** Build the axle rows the fitment sheet draws for one vehicle. Deterministic:
 *  axles keep their first-appearance (front→rear) order from the declared seat
 *  list; each side group is re-ordered outer→inner toward the spine. */
export function axleRowsOf(vehicle: VehicleBoardState): AxleRow[] {
	const seats = vehicle.seats;
	const mount = vehicle.mount;
	if (seats.length === 0) return [];

	// The numbered fallback plane has no side info — draw symmetric L/R pairs.
	if (isNumberedPlane(seats)) {
		const rows: AxleRow[] = [];
		for (let i = 0; i < seats.length; i += 2) {
			const leftSeat = seats[i];
			const rightSeat = seats[i + 1];
			const wheel = (seat: VehWheelSeat): WheelOnAxle => ({ seat, kind: 'single', tyre: mount.get(seat.id) ?? null, code: '' });
			const row: AxleRow = { key: `axle-${i / 2 + 1}`, code: '', left: [wheel(leftSeat)], right: [], center: [] };
			if (rightSeat) {
				row.right = [wheel(rightSeat)];
				row.key = `axle-${i / 2 + 1}`;
			} else {
				row.left = [];
				row.center = [wheel(leftSeat)];
			}
			rows.push(row);
		}
		return assignCodes(rows);
	}

	const byAxle = new Map<string, AxleRow>();
	const order: string[] = [];
	for (let i = 0; i < seats.length; i += 1) {
		const seat = seats[i];
		const decoded = decodeSeat(seat, i);
		let row = byAxle.get(decoded.axleKey);
		if (!row) {
			row = { key: decoded.axleKey, code: '', left: [], right: [], center: [] };
			byAxle.set(decoded.axleKey, row);
			order.push(decoded.axleKey);
		}
		const wheel: WheelOnAxle = { seat, kind: decoded.kind, tyre: mount.get(seat.id) ?? null, code: '' };
		if (decoded.side === 'left') row.left.push(wheel);
		else if (decoded.side === 'right') row.right.push(wheel);
		else row.center.push(wheel);
	}

	// Seat each side group outward→inward (stable so same-rank seats keep their
	// declared order), then stamp every row + wheel with its display code.
	const byRank = (side: WheelSide) => (a: WheelOnAxle, b: WheelOnAxle) => groupRank(side, a.kind) - groupRank(side, b.kind);
	const ordered = order.map((key) => {
		const row = byAxle.get(key)!;
		return {
			key: row.key,
			code: '',
			left: [...row.left].sort(byRank('left')),
			right: [...row.right].sort(byRank('right')),
			center: row.center,
		};
	});
	return assignCodes(ordered);
}
