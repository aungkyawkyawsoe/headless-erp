/**
 * Asset holder chore — relocate an ALREADY-ISSUED unit between holders (a wheel
 * position, a truck's inventory tray, an employee's custody). Moved verbatim out of
 * `inventory.service.ts`, which now delegates here so its public surface is
 * unchanged; runs on the shared `MroContext`.
 */
import { nowIso, strId, uid } from '../codecs';
import { planEventInserts } from '../guarded-batch';
import type { GuardedBatchFragment, Op, SerialEventSeed } from '../guarded-batch';
import { AUTHORIZED_BY_ASSET_REQUEST, assertCustodyChangeAllowed } from '../custody';
import type { CustodyAuthorization } from '../custody';
import { MroError } from '../types';
import type { MroContext } from '../context';

export class AssetChores {
	constructor(private readonly c: MroContext) {}

	private get tables() {
		return this.c.tables;
	}

	private get docs() {
		return this.c.docs;
	}

	private get guarded() {
		return this.c.guarded;
	}

	// ── Asset holder chore — move an issued unit between holders (no stock move) ──

	/**
	 * Relocate an ALREADY-ISSUED asset unit between holders — a wheel position, a
	 * truck's inventory tray, or an employee's custody. Unlike a transfer/issue/
	 * return this NEVER touches a store's `qty_on_hand` (the unit stays `issued`);
	 * it only rewrites the unit's holder seam (vehicle + slot + employee) in ONE
	 * guarded batch that also appends the truthful immutable event:
	 *
	 *   · same vehicle, different wheel    → `rotated`
	 *   · another vehicle (from a vehicle) → `refitted`
	 *   · from an employee onto a vehicle   → `fitted`
	 *   · from a vehicle onto an employee   → `issued`
	 *   · employee → employee               → `reissued`
	 *
	 * EXACTLY ONE target holder must be named (`toEmployee` XOR `toVehicle`); a wheel
	 * destination must be EMPTY. A failed guard (somebody moved the unit first)
	 * reverses the appended event so the log always matches the live snapshot.
	 * Writing a unit back INTO a store is `/return`; issuing one out of a store is
	 * `/fit` (to a truck) or `/issue` (to a person).
	 */
	async moveSerialAsset(input: {
		serialId: string;
		/** The storekeeper/technician performing the change (hrm_employees m2o id). */
		actorId?: string | null;
		/** The vehicle (veh_fleets m2o id) the unit is moving onto. */
		toVehicle?: string | null;
		/** The wheel position on `toVehicle` (e.g. "A1-L"); omit for a tray spare. */
		toSlot?: string | null;
		/** The employee (hrm_employees m2o id) taking custody of the unit. */
		toEmployee?: string | null;
		/**
		 * Governance pin: the move is only valid from this EXACT source (an approved
		 * asset-transfer request's recorded origin). Compared against the SAME row read
		 * the holder CAS uses, so it can never race. `undefined` skips a key; `null`
		 * means "must be empty".
		 */
		expectFrom?: { vehicle?: string | null; slot?: string | null; employee?: string | null };
		/** Override the event's reference kind / doc (defaults from the derived event). */
		refKind?: string | null;
		refDoc?: string | null;
		/**
		 * The custody authorization token. ONLY an approved asset request's execute passes
		 * it; every other caller leaves it unset, so a move that CHANGES the holder
		 * (truck→truck / person→person) is refused — see `assertCustodyChangeAllowed`.
		 */
		authorizedBy?: CustodyAuthorization;
		/**
		 * Extra GUARDED statements merged into the SAME atomic batch (e.g. the ATR
		 * status flip). `base` is the statement count at merge time so the builder can
		 * point its ops at absolute slots.
		 */
		compose?: (base: number) => GuardedBatchFragment;
		note?: string | null;
	}): Promise<Record<string, unknown>> {
		const t = this.tables;
		const serialId = strId(input.serialId, 'serialId');
		const toVehicle = (input.toVehicle ?? '').trim() || null;
		const toEmployee = (input.toEmployee ?? '').trim() || null;
		const toSlot = (input.toSlot ?? '').trim() || null;
		const actorId = (input.actorId ?? '').trim() || null;
		if (toEmployee && toVehicle) throw new MroError(400, 'An asset is held by a vehicle OR an employee — not both');
		if (!toEmployee && !toVehicle) throw new MroError(400, 'Name the destination holder — toVehicle (with optional toSlot) or toEmployee');
		if (toEmployee && toSlot) throw new MroError(400, 'A person-held asset has no wheel position — drop toSlot');

		const row = await this.docs.serialRow(serialId);
		if (!row) throw new MroError(404, 'Serial unit not found');
		if ((row.status ?? '') !== 'issued')
			throw new MroError(409, `That unit is ${row.status ?? 'unknown'} — only an issued (in-use) asset can be moved`);

		const fromVehicle = row.vehicle ?? null;
		const fromSlot = row.slot ?? null;
		const fromEmployee = row.employee ?? null;

		// Governance pin — an approved transfer names the source it expects; a unit
		// that has since moved elsewhere must NOT be silently relocated from there.
		// Checked against THIS read, which the holder CAS below also pins to.
		if (input.expectFrom) {
			const e = input.expectFrom;
			const mismatch =
				(e.vehicle !== undefined && fromVehicle !== (e.vehicle ?? null)) ||
				(e.slot !== undefined && fromSlot !== (e.slot ?? null)) ||
				(e.employee !== undefined && fromEmployee !== (e.employee ?? null));
			if (mismatch)
				throw new MroError(409, `${row.serial_no ?? 'That asset'} is no longer at the requested source — refresh and re-file the transfer`);
		}

		// The custody rule — a move that CHANGES the holder (truck→truck / person→person)
		// is the approval-gated shape; a same-holder seat change and everything touching a
		// store stay direct. Checked BEFORE any batch is planned, so a refused move writes
		// nothing at all.
		assertCustodyChangeAllowed({
			from: { vehicle: fromVehicle, employee: fromEmployee },
			to: { vehicle: toVehicle, employee: toEmployee },
			authorized: input.authorizedBy === AUTHORIZED_BY_ASSET_REQUEST,
			serialNo: row.serial_no,
		});

		// A same-holder seat change is direct (the storekeeper rotating or re-seating);
		// any other write to an already-held unit must go through the transfer engine.
		if (toEmployee && fromEmployee === toEmployee) throw new MroError(409, 'That asset is already held by that employee');
		if (toVehicle && fromVehicle === toVehicle && fromSlot === toSlot) throw new MroError(409, 'That asset is already at that position');
		if (toVehicle && toSlot && (await this.docs.seatTaken(toVehicle, toSlot, serialId)))
			throw new MroError(409, 'That wheel position is already filled — pick a vacant seat');

		const sameVehicle = Boolean(toVehicle && fromVehicle === toVehicle);
		const event = toEmployee ? (fromVehicle ? 'issued' : 'reissued') : sameVehicle ? 'rotated' : fromVehicle ? 'refitted' : 'fitted';
		const refKind =
			input.refKind ??
			(event === 'rotated' ? 'rotate' : event === 'refitted' ? 'refit' : event === 'issued' || event === 'reissued' ? 'issue' : 'fit');

		const now = nowIso();
		const statements: { sql: string; bindings: unknown[] }[] = [];
		const ops: Op[] = [];
		const guardIndex = new Map<number, string>();

		// Guarded holder-seam update — null-safe `IS` pins the unit to its CURRENT
		// holder so a concurrent move leaves it untouched and reverses the event below.
		const stmtIdx = statements.length;
		statements.push({
			sql: `UPDATE ${t.serials} SET vehicle = ?1, slot = ?2, employee = ?3, updated_at = ?4
			      WHERE id = ?5 AND status = 'issued' AND vehicle IS ?6 AND slot IS ?7 AND employee IS ?8`,
			bindings: [toVehicle, toSlot, toEmployee, now, serialId, fromVehicle, fromSlot, fromEmployee],
		});
		guardIndex.set(stmtIdx, `That asset moved while you were editing it — retry (${row.serial_no ?? 'serial ' + serialId})`);
		ops.push({ kind: 'fit_change', serialId, fromVehicle, fromSlot, fromEmployee, stmt: stmtIdx });

		const events: SerialEventSeed[] = [
			{
				id: uid(),
				serial: serialId,
				event,
				from_vehicle: fromVehicle,
				to_vehicle: toVehicle,
				from_employee: fromEmployee,
				to_employee: toEmployee,
				from_slot: fromSlot,
				to_slot: toSlot,
				ref_kind: refKind,
				ref_doc: input.refDoc ?? row.serial_no ?? serialId,
				by_user: actorId,
				note: input.note ?? null,
			},
		];
		planEventInserts(t.events, events, statements, ops, now);

		// Merge any caller-supplied guarded statements (e.g. the ATR status flip) into
		// THIS batch, so the move and the request state change commit or reverse together.
		if (input.compose) {
			const base = statements.length;
			const extra = input.compose(base);
			for (const s of extra.statements) statements.push(s);
			for (const g of extra.guards) guardIndex.set(base + g.index, g.message);
			for (const o of extra.ops) ops.push(o);
		}

		const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Could not move the asset');
		if (failed) throw new MroError(409, failed);

		this.docs.invalidate();
		return { serialId, serial_no: row.serial_no, vehicle: toVehicle, slot: toSlot, employee: toEmployee, event };
	}
}
