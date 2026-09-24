/**
 * Tyre kiosk chores — the seat-level writers (`fit` / `return` / `scrap` /
 * `unseat` / `swap`). Moved verbatim out of `inventory.service.ts`, which now
 * delegates here so its public surface is unchanged: every method runs on the
 * shared `MroContext` (one `DocReads`, one `GuardedBatch`).
 */
import { isLocation, normalizeEventDate, nowIso, strId, uid } from '../codecs';
import { insertSql, planEventInserts } from '../guarded-batch';
import type { GuardedBatchFragment, Op, SerialEventSeed } from '../guarded-batch';
import { AUTHORIZED_BY_ASSET_REQUEST } from '../custody';
import type { CustodyAuthorization } from '../custody';
import { MM_INSUFFICIENT, MroError } from '../types';
import type { MroContext } from '../context';

export class TyreChores {
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

	// ── Tyre kiosk chore — quick fit / return / scrap / swap (seat-level moves) ──

	/**
	 * Fit a tyre onto a vehicle — the fitment board's tap-to-fit / inventory
	 * writers (`POST /api/mro/serials/:id/fit`). `toSlot` names a VACANT wheel
	 * position; OMIT it to place the tyre into that truck's INVENTORY tray as a
	 * standby spare (issued to the truck, not yet on a wheel — the game-like
	 * holding area the wheel plan draws as its inventory control). Accepted
	 * source states, matching how a spare can reach the depot:
	 *
	 *   · `in_stock` at a store   → the unit LEAVES that store's balance (one
	 *     guarded deduction) and becomes `issued` on the truck — event `fitted`;
	 *   · `issued` + no vehicle   → a loose spare (e.g. issued to a store) just
	 *     binds to the truck, no balance move;
	 *   · `issued` + THIS truck's tray (vehicle set, no slot) → the spare is
	 *     placed onto a wheel of the SAME truck (fit-from-inventory); a spare
	 *     riding ANOTHER truck must be moved from that truck's board instead.
	 *
	 * A wheel fit requires the target (vehicle, slot) to be EMPTY — unlike a
	 * rotate/refit, this is a fresh seat so a double-fill is a hard error. One
	 * guarded batch appends the immutable `fitted` history row so the serial's
	 * lifecycle stays the truth. `eventDate` (YYYY-MM-DD) is the operator-chosen
	 * PHYSICAL day of the fit — the serial timeline reads it in preference to the
	 * engine `created_at`, so a back-dated "wear" narrates the right day.
	 */
	async fitSerialToSeat(input: {
		serialId: string;
		actorId?: string | null;
		toVehicle?: string | null;
		toSlot?: string | null;
		note?: string | null;
		/** The physical day this fit happened (`YYYY-MM-DD`) — the operator-chosen
		 *  "wear date" when back-dating. Omitted ⇒ the history falls back to the
		 *  engine `created_at`. */
		eventDate?: string | null;
	}): Promise<Record<string, unknown>> {
		const serialId = strId(input.serialId, 'serialId');
		const toVehicle = (input.toVehicle ?? '').trim() || null;
		const eventDate = normalizeEventDate(input.eventDate);
		if (!toVehicle) throw new MroError(400, 'A fitted tyre must be seated on a vehicle — pass toVehicle');
		const toSlot = (input.toSlot ?? '').trim() || null;
		const actorId = (input.actorId ?? '').trim() || null;

		const row = await this.docs.serialRow(serialId);
		if (!row) throw new MroError(404, 'Serial unit not found');
		const status = row.status ?? 'in_stock';
		if (status === 'scrapped') throw new MroError(409, 'That asset is scrapped — it cannot be fitted');
		// Held by a person: fitting it onto a truck is a MOVE, never a re-fit.
		if (row.employee) throw new MroError(409, 'That asset is held by an employee — move it onto the truck instead of fitting it');
		// Already ON a wheel: rotating/re-fitting is the Move action, never a re-fit.
		if (status === 'issued' && row.vehicle && row.slot)
			throw new MroError(409, 'That tyre is already seated on a vehicle — move or rotate it instead of re-fitting');
		// Riding ANOTHER truck's tray: it has to move from that truck's board first.
		if (status === 'issued' && row.vehicle && !row.slot && row.vehicle !== toVehicle)
			throw new MroError(409, `That tyre is a spare on another truck — open that truck's wheel plan to move it`);
		// Already this truck's standby spare: nothing to fit (a tray placement is a no-op).
		if (status === 'issued' && row.vehicle && !row.slot && !toSlot)
			throw new MroError(409, 'That tyre is already in this truck’s inventory (standby spare)');
		if (status !== 'issued' && status !== 'in_stock')
			throw new MroError(409, `That tyre is ${status} — only an in-stock or spare (issued, unseated) tyre can be fitted`);

		// A fresh WHEEL fit needs the seat empty; a tray placement has no seat.
		if (toSlot && (await this.docs.seatTaken(toVehicle, toSlot)))
			throw new MroError(409, 'That wheel position is already filled — pick a vacant seat');

		const now = nowIso();
		const statements: { sql: string; bindings: unknown[] }[] = [];
		const ops: Op[] = [];
		const guardIndex = new Map<number, string>();

		// Store stock → the unit leaves its store's balance in the SAME batch.
		const fromStock = status === 'in_stock';
		if (fromStock) {
			const inv = await this.docs.inventoryRow(row.model ?? '', row.location ?? '');
			if (!inv || Number(inv.qty_on_hand ?? 0) < 1) throw new MroError(409, `${MM_INSUFFICIENT} (${row.location ?? 'unknown store'})`);
			const statusIdx = statements.length;
			statements.push({
				sql: `UPDATE ${this.tables.serials} SET status = 'issued', updated_at = ?1 WHERE id = ?2 AND status = 'in_stock' AND vehicle IS NULL AND employee IS NULL`,
				bindings: [now, serialId],
			});
			guardIndex.set(statusIdx, 'That asset left the store while you were fitting it — retry');
			ops.push({ kind: 'serial_flip', serialId, fromStatus: 'in_stock', stmt: statusIdx });

			const balIdx = statements.length;
			statements.push({
				sql: `UPDATE ${this.tables.inv} SET qty_on_hand = qty_on_hand - 1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL AND qty_on_hand >= 1`,
				bindings: [now, inv.id],
			});
			guardIndex.set(balIdx, MM_INSUFFICIENT);
			ops.push({ kind: 'bal_down', invId: inv.id, qty: 1, stmt: balIdx });
		}

		// Claim the destination — guarded on the exact source seam so a concurrent
		// move of the SAME unit reverses the whole batch (event included). A tray
		// spare of THIS truck only gains the seat; a store/loose spare binds to the
		// truck (vehicle + optional seat) in one write.
		const fromTray = status === 'issued' && row.vehicle != null;
		const seatIdx = statements.length;
		if (fromTray) {
			statements.push({
				sql: `UPDATE ${this.tables.serials} SET slot = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'issued' AND vehicle = ?4 AND slot IS NULL`,
				bindings: [toSlot, now, serialId, row.vehicle],
			});
		} else {
			statements.push({
				sql: `UPDATE ${this.tables.serials} SET vehicle = ?1, slot = ?2, updated_at = ?3 WHERE id = ?4 AND status = 'issued' AND vehicle IS NULL AND employee IS NULL`,
				bindings: [toVehicle, toSlot, now, serialId],
			});
		}
		guardIndex.set(seatIdx, `That tyre moved while you were fitting it — retry (${row.serial_no ?? 'serial ' + serialId})`);
		ops.push({ kind: 'fit_change', serialId, fromVehicle: fromTray ? row.vehicle : null, fromSlot: null, stmt: seatIdx });

		const events: SerialEventSeed[] = [
			{
				id: uid(),
				serial: serialId,
				event: 'fitted',
				from_location: row.location ?? null,
				to_vehicle: toVehicle,
				to_slot: toSlot,
				ref_kind: 'fit',
				ref_doc: row.serial_no ?? serialId,
				by_user: actorId,
				event_date: eventDate,
				note:
					input.note ??
					(toSlot
						? fromTray
							? 'Fitted onto a wheel from the truck inventory'
							: fromStock
								? 'Fitted from store onto a vehicle'
								: 'Fitted spare onto a vehicle'
						: 'Placed in the truck inventory as a standby spare'),
			},
		];
		planEventInserts(this.tables.events, events, statements, ops, now);

		const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Could not fit the tyre');
		if (failed) throw new MroError(409, failed);

		this.docs.invalidate();
		return { serialId, serial_no: row.serial_no, vehicle: toVehicle, slot: toSlot, event: 'fitted', from_status: status };
	}

	/**
	 * Unmount an issued tyre off a truck back into a STORE — the fitment board's
	 * "remove" writer (`POST /api/mro/serials/:id/return`). Works for a tyre SEATED
	 * on a wheel AND for a truck-inventory spare (issued to the truck, no wheel).
	 * The unit flips `issued` → `in_stock` at the target store (default
	 * `vehicle_store`), its vehicle binding + seat are cleared, ONE unit is added
	 * back to that store's balance, and an immutable `returned` history row
	 * records where it came from (plate + wheel position when seated).
	 */
	async returnSerialToStore(input: {
		serialId: string;
		actorId?: string | null;
		toLocation?: string | null;
		note?: string | null;
		/**
		 * The custody authorization token. A return is ALWAYS a holder → store change, so
		 * every caller needs it: only an approved return request's execute passes it, and
		 * the direct kiosk route is refused (see `assertCustodyChangeAllowed`).
		 */
		authorizedBy?: CustodyAuthorization;
		/** Governance pin — the move is only valid from this EXACT source (an approved
		 *  request's recorded origin), so a unit that moved in the meantime is never
		 *  silently returned from its new place. */
		expectFrom?: { vehicle?: string | null; slot?: string | null; employee?: string | null };
		/** Override the event's reference kind / doc (the ATR execute tags them). */
		refKind?: string | null;
		refDoc?: string | null;
		/** Extra GUARDED statements merged into the SAME atomic batch (e.g. the request's
		 *  status flip), so the return and the request state commit or reverse together. */
		compose?: (base: number) => GuardedBatchFragment;
	}): Promise<Record<string, unknown>> {
		const serialId = strId(input.serialId, 'serialId');
		const toLocation = isLocation(input.toLocation) ? input.toLocation : 'vehicle_store';
		const actorId = (input.actorId ?? '').trim() || null;

		const row = await this.docs.serialRow(serialId);
		if (!row) throw new MroError(404, 'Serial unit not found');
		if ((row.status ?? '') !== 'issued' || (!row.vehicle && !row.employee))
			throw new MroError(409, 'Only an issued asset (on a vehicle or held by an employee) can be returned to store');

		// A return is a holder→store change, so — like a move — it is GOVERNED: only an
		// approved return request reaches this writer. The check is spelled out here
		// rather than routed through `assertCustodyChangeAllowed`, whose null (store) side
		// is the ungoverned direction by design.
		if (input.authorizedBy !== AUTHORIZED_BY_ASSET_REQUEST)
			throw new MroError(
				403,
				`${row.serial_no ?? 'That asset'} is held by ${row.employee ? 'an employee' : 'a truck'} — file a return request and have a superior approve it before sending it back to store`,
			);

		// Governance pin — the approved request recorded WHERE the unit was; a unit that
		// has since moved elsewhere is refused rather than returned from its new seat.
		if (input.expectFrom) {
			const e = input.expectFrom;
			const mismatch =
				(e.vehicle !== undefined && (row.vehicle ?? null) !== (e.vehicle ?? null)) ||
				(e.slot !== undefined && (row.slot ?? null) !== (e.slot ?? null)) ||
				(e.employee !== undefined && (row.employee ?? null) !== (e.employee ?? null));
			if (mismatch)
				throw new MroError(409, `${row.serial_no ?? 'That asset'} is no longer at the requested source — refresh and re-file the return`);
		}

		const t = this.tables;
		const now = nowIso();
		const statements: { sql: string; bindings: unknown[] }[] = [];
		const ops: Op[] = [];
		const guardIndex = new Map<number, string>();
		const retryMsg = `That asset moved while you were removing it — retry (${row.serial_no ?? 'serial ' + serialId})`;
		const hadSeat = Boolean(row.slot);

		// Flip back to store stock — guarded on the exact source seam (wheel seat,
		// truck tray OR person custody) so a concurrent move leaves the unit
		// untouched and the whole batch (balance + event) reverses on a guard loss.
		const flipIdx = statements.length;
		if (hadSeat) {
			statements.push({
				sql: `UPDATE ${t.serials} SET status = 'in_stock', location = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'issued' AND vehicle = ?4 AND slot = ?5`,
				bindings: [toLocation, now, serialId, row.vehicle, row.slot],
			});
			// Clear the seat once it is store stock (separate undo dimension).
			const seatIdx = statements.length;
			statements.push({
				sql: `UPDATE ${t.serials} SET vehicle = NULL, slot = NULL, updated_at = ?1 WHERE id = ?2 AND status = 'in_stock' AND vehicle = ?3 AND slot = ?4`,
				bindings: [now, serialId, row.vehicle, row.slot],
			});
			guardIndex.set(seatIdx, retryMsg);
			ops.push({ kind: 'fit_change', serialId, fromVehicle: row.vehicle, fromSlot: row.slot ?? null, stmt: seatIdx });
		} else if (row.vehicle) {
			// A truck-inventory spare: one write clears the truck binding too.
			statements.push({
				sql: `UPDATE ${t.serials} SET status = 'in_stock', location = ?1, vehicle = NULL, employee = NULL, updated_at = ?2 WHERE id = ?3 AND status = 'issued' AND vehicle = ?4 AND slot IS NULL`,
				bindings: [toLocation, now, serialId, row.vehicle],
			});
			ops.push({ kind: 'fit_change', serialId, fromVehicle: row.vehicle, fromSlot: null, stmt: flipIdx });
		} else {
			// A person-held asset: one write clears the employee binding.
			statements.push({
				sql: `UPDATE ${t.serials} SET status = 'in_stock', location = ?1, employee = NULL, updated_at = ?2 WHERE id = ?3 AND status = 'issued' AND employee = ?4 AND vehicle IS NULL`,
				bindings: [toLocation, now, serialId, row.employee],
			});
			ops.push({ kind: 'fit_change', serialId, fromVehicle: null, fromSlot: null, fromEmployee: row.employee, stmt: flipIdx });
		}
		guardIndex.set(flipIdx, retryMsg);
		ops.push({ kind: 'return_flip', serialId, fromStatus: 'issued', fromLocation: row.location ?? null, stmt: flipIdx });

		// One unit back on the target store's balance (create the row when the store
		// never held this model before — same pattern as the inbound confirm).
		const existing = await this.docs.inventoryRow(row.model ?? '', toLocation);
		if (existing) {
			const balIdx = statements.length;
			statements.push({
				sql: `UPDATE ${t.inv} SET qty_on_hand = qty_on_hand + 1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL`,
				bindings: [now, existing.id],
			});
			guardIndex.set(balIdx, 'Balance changed while returning the tyre — retry');
			ops.push({ kind: 'bal_up', invId: existing.id, qty: 1, stmt: balIdx });
		} else {
			const invId = uid();
			statements.push(
				insertSql(t.inv, {
					id: invId,
					model: row.model ?? '',
					location: toLocation,
					qty_on_hand: 1,
					reorder_level: 0,
					_meta: '{}',
					created_at: now,
					updated_at: now,
				}),
			);
			ops.push({ kind: 'delete_inv', invId, stmt: null });
		}

		const events: SerialEventSeed[] = [
			{
				id: uid(),
				serial: serialId,
				event: 'returned',
				from_vehicle: row.vehicle,
				from_slot: row.slot ?? null,
				from_employee: row.employee ?? null,
				from_location: row.location ?? null,
				to_location: toLocation,
				ref_kind: input.refKind ?? 'return',
				ref_doc: input.refDoc ?? row.serial_no ?? serialId,
				by_user: actorId,
				note: input.note ?? (row.employee ? 'Returned from an employee’s custody to store' : 'Removed from the truck back into store'),
			},
		];
		planEventInserts(t.events, events, statements, ops, now);

		// Merge any caller-supplied guarded statements (the return request's status flip)
		// into THIS batch, so the return and the request state settle together.
		if (input.compose) {
			const base = statements.length;
			const extra = input.compose(base);
			for (const s of extra.statements) statements.push(s);
			for (const g of extra.guards) guardIndex.set(base + g.index, g.message);
			for (const o of extra.ops) ops.push(o);
		}

		const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Could not return the tyre to store');
		if (failed) throw new MroError(409, failed);

		this.docs.invalidate();
		return {
			serialId,
			serial_no: row.serial_no,
			status: 'in_stock',
			vehicle: null,
			slot: null,
			event: 'returned',
			to_location: toLocation,
		};
	}

	/**
	 * Scrap a MOUNTED tyre where it sits — the APPROVED WRITE-OFF's execute
	 * (`mro_asset_requests.write_off`), reached through `POST
	 * /api/mro/serials/:id/scrap` carrying the asset-request token. The unit leaves
	 * the truck (seat cleared) straight to `scrapped`; no store balance moves
	 * because an issued unit is already out of every store's stock. One immutable
	 * `written_off` history row records which plate + position it came off, tagged
	 * with the document that authorised it.
	 *
	 * GOVERNED — a write-off ends a unit's custody, so it is refused unless the
	 * caller carries the custody token (`authorizedBy: AUTHORIZED_BY_ASSET_REQUEST`),
	 * which only an approved write-off request's execute passes. A worn-out unit is
	 * written off by FILING a request (`mro_asset_requests` with `write_off`) and
	 * having the requester's recorded superior approve it — there is no
	 * direct-write-off path left, exactly as there is none for a return. Admin does
	 * NOT bypass this: `authorizedBy` is passed by the service caller, never taken
	 * from a request body.
	 */
	async scrapMountedSerial(input: {
		serialId: string;
		actorId?: string | null;
		note?: string | null;
		/** The approved write-off request's token — the governance gate above. */
		authorizedBy?: CustodyAuthorization;
		/** The source the approving request recorded; a unit that has moved since is
		 *  refused rather than scrapped somewhere nobody approved. */
		expectFrom?: { vehicle?: string | null; slot?: string | null; employee?: string | null };
		/** Override the event's reference kind / doc (the ATR execute tags them). */
		refKind?: string | null;
		refDoc?: string | null;
		/** Extra GUARDED statements merged into the SAME atomic batch (the request's
		 *  status flip), so the write-off and the request state settle together. */
		compose?: (base: number) => GuardedBatchFragment;
	}): Promise<Record<string, unknown>> {
		const serialId = strId(input.serialId, 'serialId');
		const actorId = (input.actorId ?? '').trim() || null;

		const row = await this.docs.serialRow(serialId);
		if (!row) throw new MroError(404, 'Serial unit not found');
		if ((row.status ?? '') !== 'issued' || (!row.vehicle && !row.employee))
			throw new MroError(409, 'Only an issued asset (on a vehicle or held by an employee) can be written off');

		// The token is the ONLY way in — spelled out here rather than routed through
		// `assertCustodyChangeAllowed`, because a write-off is an OWNER decision, not
		// a holder change: the custody rule leaves the direction alone by design.
		if (input.authorizedBy !== AUTHORIZED_BY_ASSET_REQUEST)
			throw new MroError(
				403,
				`${row.serial_no ?? 'That asset'} is written off through an approved write-off request — file one and have a superior approve it before scrapping it`,
			);

		// Governance pin — the approved request recorded WHERE the unit was; a unit
		// that has moved elsewhere since is refused rather than scrapped from its new
		// seat.
		if (input.expectFrom) {
			const e = input.expectFrom;
			const mismatch =
				(e.vehicle !== undefined && (row.vehicle ?? null) !== (e.vehicle ?? null)) ||
				(e.slot !== undefined && (row.slot ?? null) !== (e.slot ?? null)) ||
				(e.employee !== undefined && (row.employee ?? null) !== (e.employee ?? null));
			if (mismatch)
				throw new MroError(
					409,
					`${row.serial_no ?? 'That asset'} is no longer at the requested source — refresh and re-file the write-off`,
				);
		}

		const t = this.tables;
		const now = nowIso();
		const statements: { sql: string; bindings: unknown[] }[] = [];
		const ops: Op[] = [];
		const guardIndex = new Map<number, string>();
		const retryMsg = `That asset moved while you were writing it off — retry (${row.serial_no ?? 'serial ' + serialId})`;
		const hadSeat = Boolean(row.slot);

		// Scrap first (guarded on the source seam), then clear the holder binding —
		// reverse order to the return path so each statement's guard sees the state
		// the prior one left.
		const scrapIdx = statements.length;
		if (hadSeat) {
			statements.push({
				sql: `UPDATE ${t.serials} SET status = 'scrapped', updated_at = ?1 WHERE id = ?2 AND status = 'issued' AND vehicle = ?3 AND slot = ?4`,
				bindings: [now, serialId, row.vehicle, row.slot],
			});
		} else if (row.vehicle) {
			statements.push({
				sql: `UPDATE ${t.serials} SET status = 'scrapped', updated_at = ?1 WHERE id = ?2 AND status = 'issued' AND vehicle = ?3 AND slot IS NULL`,
				bindings: [now, serialId, row.vehicle],
			});
		} else {
			statements.push({
				sql: `UPDATE ${t.serials} SET status = 'scrapped', updated_at = ?1 WHERE id = ?2 AND status = 'issued' AND employee = ?3 AND vehicle IS NULL`,
				bindings: [now, serialId, row.employee],
			});
		}
		guardIndex.set(scrapIdx, retryMsg);
		ops.push({ kind: 'serial_flip', serialId, fromStatus: 'issued', stmt: scrapIdx });

		const seatIdx = statements.length;
		if (hadSeat) {
			statements.push({
				sql: `UPDATE ${t.serials} SET vehicle = NULL, slot = NULL, employee = NULL, updated_at = ?1 WHERE id = ?2 AND status = 'scrapped' AND vehicle = ?3 AND slot = ?4`,
				bindings: [now, serialId, row.vehicle, row.slot],
			});
		} else if (row.vehicle) {
			statements.push({
				sql: `UPDATE ${t.serials} SET vehicle = NULL, employee = NULL, updated_at = ?1 WHERE id = ?2 AND status = 'scrapped' AND vehicle = ?3 AND slot IS NULL`,
				bindings: [now, serialId, row.vehicle],
			});
		} else {
			statements.push({
				sql: `UPDATE ${t.serials} SET employee = NULL, updated_at = ?1 WHERE id = ?2 AND status = 'scrapped' AND employee = ?3 AND vehicle IS NULL`,
				bindings: [now, serialId, row.employee],
			});
		}
		guardIndex.set(seatIdx, retryMsg);
		ops.push({
			kind: 'fit_change',
			serialId,
			fromVehicle: row.vehicle,
			fromSlot: row.slot ?? null,
			fromEmployee: row.employee ?? null,
			stmt: seatIdx,
		});

		const events: SerialEventSeed[] = [
			{
				id: uid(),
				serial: serialId,
				event: 'written_off',
				from_vehicle: row.vehicle,
				from_slot: row.slot ?? null,
				from_employee: row.employee ?? null,
				from_location: row.location ?? null,
				ref_kind: input.refKind ?? 'scrap',
				ref_doc: input.refDoc ?? row.serial_no ?? serialId,
				by_user: actorId,
				note: input.note ?? 'Written off from the truck',
			},
		];
		planEventInserts(t.events, events, statements, ops, now);

		// Merge any caller-supplied guarded statements (the write-off request's status
		// flip) into THIS batch, so the write-off and the request state settle together.
		if (input.compose) {
			const base = statements.length;
			const extra = input.compose(base);
			for (const s of extra.statements) statements.push(s);
			for (const g of extra.guards) guardIndex.set(base + g.index, g.message);
			for (const o of extra.ops) ops.push(o);
		}

		const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Could not write off the tyre');
		if (failed) throw new MroError(409, failed);

		this.docs.invalidate();
		return { serialId, serial_no: row.serial_no, status: 'scrapped', vehicle: null, slot: null, event: 'written_off' };
	}

	/**
	 * Unseat a tyre off a wheel INTO this truck's inventory tray — the wheel-plan's
	 * "keep as a spare on this truck" writer (`POST /api/mro/serials/:id/unseat`).
	 * The unit STAYS `issued` and stays bound to the SAME truck (no store balance
	 * moves — it is still out on the vehicle), it only drops its wheel slot
	 * (`slot = NULL` = truck-inventory standby spare). One immutable `unseated`
	 * history row records which plate + wheel position it came off, so the serial's
	 * timeline narrates the removal before its next fit. `eventDate` (YYYY-MM-DD)
	 * is the operator-chosen PHYSICAL "un-wear" day — the timeline reads it in
	 * preference to `created_at`. From the tray the spare
	 * can be fitted onto another wheel of the SAME truck (`/fit` without a seat
	 * change), moved to another truck (`/position`), returned to store or written
	 * off.
	 */
	async unseatSerialToTray(input: {
		serialId: string;
		actorId?: string | null;
		note?: string | null;
		/** The physical day this un-seat happened (`YYYY-MM-DD`) — the operator-chosen
		 *  "un-wear date". Omitted ⇒ the history falls back to the engine `created_at`. */
		eventDate?: string | null;
	}): Promise<Record<string, unknown>> {
		const serialId = strId(input.serialId, 'serialId');
		const actorId = (input.actorId ?? '').trim() || null;
		const eventDate = normalizeEventDate(input.eventDate);

		const row = await this.docs.serialRow(serialId);
		if (!row) throw new MroError(404, 'Serial unit not found');
		if ((row.status ?? '') !== 'issued' || !row.vehicle || !row.slot)
			throw new MroError(409, 'Only a tyre seated on a wheel can be moved into the truck inventory');

		const t = this.tables;
		const now = nowIso();
		const statements: { sql: string; bindings: unknown[] }[] = [];
		const ops: Op[] = [];
		const guardIndex = new Map<number, string>();

		// Drop the wheel slot only — guarded on the exact seat so a concurrent move
		// leaves the unit untouched and reverses the batch (event included).
		const unseatIdx = statements.length;
		statements.push({
			sql: `UPDATE ${t.serials} SET slot = NULL, updated_at = ?1 WHERE id = ?2 AND status = 'issued' AND vehicle = ?3 AND slot = ?4`,
			bindings: [now, serialId, row.vehicle, row.slot],
		});
		guardIndex.set(unseatIdx, `That tyre moved while you were removing it — retry (${row.serial_no ?? 'serial ' + serialId})`);
		ops.push({ kind: 'fit_change', serialId, fromVehicle: row.vehicle, fromSlot: row.slot ?? null, stmt: unseatIdx });

		const events: SerialEventSeed[] = [
			{
				id: uid(),
				serial: serialId,
				event: 'unseated',
				from_vehicle: row.vehicle,
				from_slot: row.slot ?? null,
				to_vehicle: row.vehicle,
				ref_kind: 'tray',
				ref_doc: row.serial_no ?? serialId,
				by_user: actorId,
				event_date: eventDate,
				note: input.note ?? `Taken off ${row.slot} — not on a wheel`,
			},
		];
		planEventInserts(t.events, events, statements, ops, now);

		const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Could not move the tyre into the truck inventory');
		if (failed) throw new MroError(409, failed);

		this.docs.invalidate();
		return { serialId, serial_no: row.serial_no, vehicle: row.vehicle, slot: null, event: 'unseated' };
	}

	/**
	 * SWAP two seated tyres — the fitment board's exchange writer
	 * (`POST /api/mro/serials/swap`). Both units stay `issued`; each takes the
	 * OTHER's (vehicle, slot) in ONE guarded batch, so the lifecycle log narrates
	 * the exchange truthfully for both tyres.
	 *
	 * SAME TRUCK ONLY — a rotation, never a transfer. A cross-truck exchange would
	 * re-fit two trucks' wheels with no superior in the loop: exactly the movement
	 * `mro_asset_requests` exists to gate. It is refused here (400) and the operator
	 * is pointed at the request flow, so there is ONE writer per cross-truck move
	 * and the approval trail cannot be bypassed by a board gesture.
	 */
	async swapSerialSeats(input: {
		serialA: string;
		serialB: string;
		actorId?: string | null;
		note?: string | null;
	}): Promise<Record<string, unknown>> {
		const serialA = strId(input.serialA, 'serialA');
		const serialB = strId(input.serialB, 'serialB');
		if (serialA === serialB) throw new MroError(400, 'Choose two different tyres to swap');
		const actorId = (input.actorId ?? '').trim() || null;

		const t = this.tables;
		const a = await this.docs.serialRow(serialA);
		const b = await this.docs.serialRow(serialB);
		if (!a || !b) throw new MroError(404, 'One of the tyres was not found');
		if ((a.status ?? '') !== 'issued' || !a.vehicle || !a.slot)
			throw new MroError(409, `Tyre ${a.serial_no ?? serialA} is not seated on a vehicle`);
		if ((b.status ?? '') !== 'issued' || !b.vehicle || !b.slot)
			throw new MroError(409, `Tyre ${b.serial_no ?? serialB} is not seated on a vehicle`);
		if (a.vehicle !== b.vehicle)
			throw new MroError(
				400,
				'A swap exchanges two wheel positions on the SAME truck — to move a tyre onto another truck, file a transfer request for a superior to approve',
			);
		if (a.slot === b.slot) throw new MroError(400, 'Those two tyres already share the same wheel position');

		const now = nowIso();
		const statements: { sql: string; bindings: unknown[] }[] = [];
		const ops: Op[] = [];
		const guardIndex = new Map<number, string>();

		// Each tyre takes the other's seat — guards pin each unit to its CURRENT seat
		// so a concurrent move of either one reverses the whole exchange.
		const aIdx = statements.length;
		statements.push({
			sql: `UPDATE ${t.serials} SET vehicle = ?1, slot = ?2, updated_at = ?3 WHERE id = ?4 AND status = 'issued' AND vehicle = ?5 AND slot = ?6`,
			bindings: [b.vehicle, b.slot, now, serialA, a.vehicle, a.slot],
		});
		guardIndex.set(aIdx, `Tyre ${a.serial_no ?? serialA} moved while swapping — retry`);
		ops.push({ kind: 'fit_change', serialId: serialA, fromVehicle: a.vehicle, fromSlot: a.slot, stmt: aIdx });

		const bIdx = statements.length;
		statements.push({
			sql: `UPDATE ${t.serials} SET vehicle = ?1, slot = ?2, updated_at = ?3 WHERE id = ?4 AND status = 'issued' AND vehicle = ?5 AND slot = ?6`,
			bindings: [a.vehicle, a.slot, now, serialB, b.vehicle, b.slot],
		});
		guardIndex.set(bIdx, `Tyre ${b.serial_no ?? serialB} moved while swapping — retry`);
		ops.push({ kind: 'fit_change', serialId: serialB, fromVehicle: b.vehicle, fromSlot: b.slot, stmt: bIdx });

		const events: SerialEventSeed[] = [
			{
				id: uid(),
				serial: serialA,
				event: 'rotated',
				from_vehicle: a.vehicle,
				to_vehicle: b.vehicle,
				from_slot: a.slot,
				to_slot: b.slot,
				ref_kind: 'rotate',
				ref_doc: a.serial_no ?? serialA,
				by_user: actorId,
				note: input.note ?? 'Swapped wheel positions',
			},
			{
				id: uid(),
				serial: serialB,
				event: 'rotated',
				from_vehicle: b.vehicle,
				to_vehicle: a.vehicle,
				from_slot: b.slot,
				to_slot: a.slot,
				ref_kind: 'rotate',
				ref_doc: b.serial_no ?? serialB,
				by_user: actorId,
				note: input.note ?? 'Swapped wheel positions',
			},
		];
		planEventInserts(t.events, events, statements, ops, now);

		const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Could not swap the tyres');
		if (failed) throw new MroError(409, failed);

		this.docs.invalidate();
		return { event: 'rotated', swapped: [serialA, serialB] };
	}
}
