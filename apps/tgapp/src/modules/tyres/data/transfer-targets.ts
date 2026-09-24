/**
 * Which holders a governed custody request may NAME as its destination — the
 * pure rule the filer renders. Types only (no SDK), so the whole rule is
 * unit-tested without a running app.
 *
 * A unit's `kind` is DERIVED, never stored (the register's own split): a wheel
 * unit — a new-tread baseline on its SKU, or a seated slot — is a `tyre`;
 * anything else (a jack, a toolbox…) is an `asset`. The transfer table is ONE
 * (`mro_asset_requests`) for both, but the valid destinations differ.
 *
 * WHAT IS GOVERNED (the engine's rule, mirrored here so the filer can never
 * offer a shape the writer would 403 on — see `assertCustodyChangeAllowed`):
 *
 *   · store       → truck / employee   DIRECT (fit, issue) — no request
 *   · same truck  → another seat       DIRECT (rotate / re-seat)
 *   · truck A     → truck B            REQUEST
 *   · employee A  → employee B         REQUEST
 *   · truck / emp → store              REQUEST (a RETURN)
 *   · truck       ↔ employee           NEVER — return to store, then issue
 *
 * The last row is why a destination list is HOLDER-TYPED: a truck-held unit is
 * offered trucks and the store, never a person.
 */
import type { VehicleMasterRow } from '@/shared/lookups/types';
import type { TyreCardModel } from './types';

/** True when a fleet row can seat a tyre — declares a wheel count or a seat list.
 *  The ONE capacity predicate the fitment board and the transfer request share. */
export function vehicleCarriesTyres(vehicle: Pick<VehicleMasterRow, 'wheel' | 'wheel_slots'>): boolean {
	return (
		(typeof vehicle.wheel === 'number' && vehicle.wheel > 0) ||
		(vehicle.wheel_slots != null && vehicle.wheel_slots !== '' && (!Array.isArray(vehicle.wheel_slots) || vehicle.wheel_slots.length > 0))
	);
}

/**
 * The trucks a transfer request may target, deterministically plate-sorted.
 *
 * The request names a DESTINATION TRUCK (its inventory tray), never a wheel
 * position — the receiving truck wears the unit later through its own fitment
 * picker — so the two kinds differ only in which trucks are worth naming:
 *
 *   · TYRE — a truck it can be WORN on, so only a wheel-capable truck qualifies.
 *   · ASSET — it rides LOOSE on any truck that has a plate.
 *
 * Either way the truck ALREADY holding the unit is dropped: with no position to
 * pick, naming it is the no-op move the engine rejects (`already at that
 * position`).
 */
export function transferTargetTrucks(
	kind: TyreCardModel['kind'],
	vehicles: VehicleMasterRow[],
	currentPlateNo: string | null,
): VehicleMasterRow[] {
	const current = currentPlateNo?.trim() || null;
	return vehicles
		.filter((vehicle) => (vehicle.plate_no ?? '').trim())
		.filter((vehicle) => (kind === 'tyre' ? vehicleCarriesTyres(vehicle) : true))
		.filter((vehicle) => (current ? (vehicle.plate_no ?? '').trim() !== current : true))
		.sort((a, b) => (a.plate_no ?? '').trim().localeCompare((b.plate_no ?? '').trim()));
}

/**
 * WHERE a held unit may be sent — the ONE destination-holder discriminator the
 * filer branches on. `store` is the return shape (an `mro_asset_requests` row
 * carrying `to_location`); the other two name a receiving holder (or a wheel
 * position on one).
 */
export type CustodyDestinationKind = 'vehicle' | 'employee' | 'store';

/**
 * The holder KINDS a unit may be sent to, given where it is now.
 *
 * A truck-held unit may go to another truck or back to the store; an
 * employee-held unit may go to another employee or back to the store. A person
 * is never offered a truck-held unit and vice versa: that direction has no
 * writer at all (the custody rule refuses it on every path), so routing it
 * through the store is the ONLY correct way to say it — and the filer should
 * say so rather than offer a form that cannot succeed.
 *
 * A unit held by NEITHER (store stock surfaced by a cold link) gets no
 * destination: from the store every move is direct, so there is nothing to file.
 *
 * A TRUCK wins when both are somehow set: a seated unit is truck-held, and a
 * stale `employeeId` left on the row must not route it to the person list.
 */
export function custodyDestinationKinds(holder: { plateNo: string | null; employeeId: string | null }): CustodyDestinationKind[] {
	if ((holder.plateNo ?? '').trim()) return ['vehicle', 'store'];
	if ((holder.employeeId ?? '').trim()) return ['employee', 'store'];
	return [];
}

/**
 * The employees a transfer request may hand a unit to — everyone EXCEPT the
 * person already holding it (naming them is the no-op `move` the engine
 * rejects as `already held by that employee`). Sorted by display name so the
 * picker's order never depends on the directory's row order.
 */
export function transferTargetEmployees<T extends { id: string; name: string }>(people: T[], currentEmployeeId: string | null): T[] {
	const current = currentEmployeeId?.trim() || null;
	return people
		.filter((person) => person.id)
		.filter((person) => (current ? person.id !== current : true))
		.sort((a, b) => a.name.localeCompare(b.name));
}
