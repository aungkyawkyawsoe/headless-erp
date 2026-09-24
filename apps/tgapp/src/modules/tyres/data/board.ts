/**
 * Assemble the fitment board data model — vehicles with their ordered wheel
 * seats and which register tyre card fills each. Pure client assembly over the
 * SAME read the register uses (shared `veh_fleets` + the issued serial cards),
 * so the board can never disagree with the tyre list.
 *
 * The board is VEHICLE-first: one row per plate, N seat blocks from its declared
 * `wheel_slots`, each seat filled by exactly the mounted card whose stored
 * `slot` equals that seat's id. The mount keying is deliberately STRICT — a
 * plate-bound tyre whose recorded slot matches no declared seat is a write-time
 * anomaly worth surfacing, not a case to paper over with synthetic positions.
 */
import type { VehicleMasterRow } from '@/shared/lookups/types';
import type { TyreCardModel } from './types';
import { wheelSlotsOfVehicle, type VehWheelSeat } from './spec';

/** One vehicle row on the board, ready to render. */
export interface VehicleBoardState {
	/** `veh_fleets.id`. */
	id: string;
	/** The plate — the board list's primary identity. */
	plateNo: string;
	/** Brand label (e.g. "HINO") when the master row carries one. */
	brandLabel: string | null;
	/** Unit type (box / tractor_unit / trailer…) when declared. */
	unitLabel: string | null;
	/** How many wheels the vehicle seats — falls back to the seat-list length. */
	wheelCount: number | null;
	/** Every seat the vehicle declares — the board draws exactly this many blocks. */
	seats: VehWheelSeat[];
	/** seat id → mounted serial tyre card (an empty seat has no entry). */
	mount: Map<string, TyreCardModel>;
}

/**
 * Turn the plate master (`veh_fleets`) + the mounted serial cards (issued
 * register tyres carrying `plateNo`) into board rows. A card keys under its
 * plate ONLY when its stored `slot` names one of that plate's declared seats;
 * anything else falls out of the grid (the sheet/tyre list still sees it).
 */
export function buildFleetBoard(vehicles: VehicleMasterRow[], mounted: TyreCardModel[]): VehicleBoardState[] {
	// Index the mounted (plate-bound) serial cards per plate by their stored slot.
	const mountedByPlate = new Map<string, Map<string, TyreCardModel>>();
	for (const tyre of mounted) {
		if (!tyre.plateNo || !tyre.slot) continue;
		let bySlot = mountedByPlate.get(tyre.plateNo);
		if (!bySlot) mountedByPlate.set(tyre.plateNo, (bySlot = new Map()));
		bySlot.set(tyre.slot, tyre);
	}

	const rows: VehicleBoardState[] = [];
	for (const v of vehicles) {
		const plateNo = v.plate_no?.trim();
		if (!plateNo) continue;
		// Only units that can carry tyres show on the board — require scope.
		const canCarryWheels =
			(typeof v.wheel === 'number' && v.wheel > 0) ||
			(v.wheel_slots != null && v.wheel_slots !== '' && (!Array.isArray(v.wheel_slots) || v.wheel_slots.length > 0));
		if (!canCarryWheels) continue;

		const seats = wheelSlotsOfVehicle(v.wheel_slots, v.wheel, v.unit_type);
		if (seats.length === 0) continue;

		const bySlot = mountedByPlate.get(plateNo) ?? new Map<string, TyreCardModel>();
		const mount = new Map<string, TyreCardModel>();
		for (const seat of seats) {
			const seated = bySlot.get(seat.id);
			if (seated) mount.set(seat.id, seated);
		}

		rows.push({
			id: v.id,
			plateNo,
			brandLabel: v.brand?.trim() || null,
			unitLabel: v.unit_type?.trim() || null,
			wheelCount: seats.length,
			seats,
			mount,
		});
	}
	rows.sort((a, b) => a.plateNo.localeCompare(b.plateNo));
	return rows;
}
