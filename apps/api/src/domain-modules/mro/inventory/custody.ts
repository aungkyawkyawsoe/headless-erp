import { MroError } from './types';

/** The authorization token that lets a writer CHANGE a unit's holder. Only an
 *  approved asset request's execute passes it (see `AUTHORIZED_BY_ASSET_REQUEST`). */
export const AUTHORIZED_BY_ASSET_REQUEST = 'asset_request';
export type CustodyAuthorization = typeof AUTHORIZED_BY_ASSET_REQUEST | null;

/** A custody seam — the place a unit is held: an employee, a vehicle, or neither (a store). */
export interface CustodySeam {
	vehicle?: string | null;
	employee?: string | null;
}

/**
 * The holder a custody seam DERIVES to — `e:<id>` (a person), `v:<id>` (a truck),
 * or `null` (a store / loose). The wheel `slot` is deliberately NOT part of the key:
 * a change of seat on the SAME truck is the SAME holder, which is what keeps a
 * rotation, a take-off or a tray placement direct instead of approval-gated.
 */
export function holderKeyOf(seam: CustodySeam): string | null {
	const employee = (seam.employee ?? '').trim();
	if (employee) return `e:${employee}`;
	const vehicle = (seam.vehicle ?? '').trim();
	if (vehicle) return `v:${vehicle}`;
	return null;
}

/**
 * THE custody rule (deny-by-default), called by EVERY writer that can change a
 * unit's holder before it plans its batch:
 *
 *   · same holder, or a store on either side → allowed. Issuing out of a store,
 *     fitting store stock, and seat changes on one truck are the storekeeper's own
 *     chore (store→holder already has its own document gate).
 *   · truck ↔ person → refused ALWAYS, authorized or not: a unit changes hands
 *     through the store, never straight between a truck and a person.
 *   · truck→truck / person→person → allowed ONLY when `authorized` (an approved
 *     asset request). Every other caller — Studio, CLI, import, a stale client —
 *     is refused.
 */
export function assertCustodyChangeAllowed(input: {
	from: CustodySeam;
	to: CustodySeam;
	authorized: boolean;
	serialNo?: string | null;
}): void {
	const from = holderKeyOf(input.from);
	const to = holderKeyOf(input.to);
	if (!from || !to || from === to) return;
	const label = input.serialNo ?? 'That asset';
	if (from[0] !== to[0])
		throw new MroError(
			403,
			`${label} cannot move straight between a truck and a person — return it to store first, then issue it to the person`,
		);
	if (!input.authorized)
		throw new MroError(403, `${label} is changing holder — file a transfer request and have a superior approve it before moving it`);
}
