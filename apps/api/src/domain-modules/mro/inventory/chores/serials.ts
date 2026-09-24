/**
 * Serial/asset chores — issuing an asset out of a store into a person's custody,
 * recording an inspection reading, and the two serial READS the detail screens use
 * (the immutable lifecycle history and a holder's assets). Moved verbatim out of
 * `inventory.service.ts`, which now delegates here so its public surface is
 * unchanged; runs on the shared `MroContext`.
 */
import { collectionTable } from '@/lib/utils/table-name';
import { isCondition, nowIso, strId, uid } from '../codecs';
import { round2 } from '../money';
import { insertSql, planEventInserts } from '../guarded-batch';
import type { Op, SerialEventSeed } from '../guarded-batch';
import { MM_INSUFFICIENT, MRO_ASSET_CONDITIONS, MroError } from '../types';
import type { HolderAssetRow } from '../types';
import type { MroContext } from '../context';

export class SerialChores {
	constructor(private readonly c: MroContext) {}

	private get db() {
		return this.c.db;
	}

	private get tables() {
		return this.c.tables;
	}

	private get docs() {
		return this.c.docs;
	}

	private get guarded() {
		return this.c.guarded;
	}

	/**
	 * Issue an asset OUT of a store into an employee's custody — the "hand this to a
	 * person" writer (`POST /api/mro/serials/:id/issue`). An `in_stock` unit LEAVES
	 * its store's balance (one guarded deduction) and becomes `issued` with
	 * `employee` set; a loose issued unit (no truck, no person) just binds to the
	 * person. ONE immutable `issued` history row records it. A unit on a truck must
	 * be moved off the truck first (`/move`); one already held by the SAME person is
	 * a no-op (409).
	 */
	async issueSerialToHolder(input: {
		serialId: string;
		/** The storekeeper/technician performing the change (hrm_employees m2o id). */
		actorId?: string | null;
		/** The employee (hrm_employees m2o id) taking custody of the unit. */
		toEmployee?: string | null;
		note?: string | null;
	}): Promise<Record<string, unknown>> {
		const t = this.tables;
		const serialId = strId(input.serialId, 'serialId');
		const toEmployee = (input.toEmployee ?? '').trim() || null;
		if (!toEmployee) throw new MroError(400, 'Name the employee taking custody — pass toEmployee');
		const actorId = (input.actorId ?? '').trim() || null;

		const row = await this.docs.serialRow(serialId);
		if (!row) throw new MroError(404, 'Serial unit not found');
		const status = row.status ?? 'in_stock';
		if (status === 'scrapped') throw new MroError(409, 'That asset is scrapped — it cannot be issued');
		if (status === 'issued' && row.vehicle)
			throw new MroError(409, 'That asset is on a vehicle — move it off the truck before issuing it to a person');
		if (status === 'issued' && row.employee) {
			if (row.employee === toEmployee) throw new MroError(409, 'That asset is already held by that employee');
			throw new MroError(409, 'That asset is held by another employee — reassign it with a move instead');
		}
		if (status !== 'issued' && status !== 'in_stock')
			throw new MroError(409, `That asset is ${status} — only an in-stock or loose unit can be issued`);

		const now = nowIso();
		const statements: { sql: string; bindings: unknown[] }[] = [];
		const ops: Op[] = [];
		const guardIndex = new Map<number, string>();

		const fromStock = status === 'in_stock';
		if (fromStock) {
			const inv = await this.docs.inventoryRow(row.model ?? '', row.location ?? '');
			if (!inv || Number(inv.qty_on_hand ?? 0) < 1) throw new MroError(409, `${MM_INSUFFICIENT} (${row.location ?? 'unknown store'})`);
			const statusIdx = statements.length;
			statements.push({
				sql: `UPDATE ${t.serials} SET status = 'issued', employee = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'in_stock' AND vehicle IS NULL`,
				bindings: [toEmployee, now, serialId],
			});
			guardIndex.set(statusIdx, 'That asset left the store while you were issuing it — retry');
			ops.push({ kind: 'serial_flip', serialId, fromStatus: 'in_stock', stmt: statusIdx, employeeReset: true });

			const balIdx = statements.length;
			statements.push({
				sql: `UPDATE ${t.inv} SET qty_on_hand = qty_on_hand - 1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL AND qty_on_hand >= 1`,
				bindings: [now, inv.id],
			});
			guardIndex.set(balIdx, MM_INSUFFICIENT);
			ops.push({ kind: 'bal_down', invId: inv.id, qty: 1, stmt: balIdx });
		} else {
			// A loose issued unit (no truck, no person) just binds to the person.
			const idx = statements.length;
			statements.push({
				sql: `UPDATE ${t.serials} SET employee = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'issued' AND vehicle IS NULL AND employee IS NULL`,
				bindings: [toEmployee, now, serialId],
			});
			guardIndex.set(idx, 'That asset moved while you were issuing it — retry');
			ops.push({ kind: 'fit_change', serialId, fromVehicle: null, fromSlot: null, fromEmployee: null, stmt: idx });
		}

		const events: SerialEventSeed[] = [
			{
				id: uid(),
				serial: serialId,
				event: 'issued',
				from_location: row.location ?? null,
				to_employee: toEmployee,
				ref_kind: 'issue',
				ref_doc: row.serial_no ?? serialId,
				by_user: actorId,
				note: input.note ?? 'Issued into an employee’s custody',
			},
		];
		planEventInserts(t.events, events, statements, ops, now);

		const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Could not issue the asset');
		if (failed) throw new MroError(409, failed);

		this.docs.invalidate();
		return { serialId, serial_no: row.serial_no, employee: toEmployee, vehicle: null, slot: null, event: 'issued', from_status: status };
	}

	/**
	 * Record a tyre inspection (``checked``) — measure the remaining tread depth /
	 * pressure on an ALREADY-ISSUED serial tyre and persist the reading honestly.
	 * It is a MEASUREMENT, never an estimate: it updates the serial unit's live
	 * ``tread_mm`` / ``psi`` snapshot and appends ONE immutable ``checked`` event
	 * row carrying the same readings (the single source of truth for the fitment
	 * board's remaining-tread %). No stock/track state changes — the tyre stays
	 * ``issued`` where it sits; only the last-measured snapshot advances.
	 *
	 *   { serialId, actorId, treadMm, psi, note }:
	 *     · the unit must be ``issued`` (a tyre out on a truck / in use) — an
	 *       in-stock or scrapped unit has no wear to measure;
	 *     · ``treadMm`` is required (the whole point); ``psi`` is optional;
	 *     · ``treadMm`` is CAPPED at the SKU's ``mro_item_model.reference_tread_mm``
	 *       (its depth when NEW) — a tyre is never thicker than brand new, so a
	 *       larger number is a typo or a wrong unit and is refused here, not just in
	 *       the kiosk form (the generic API cannot write an impossible reading either);
	 *     · the guarded batch reverses if a concurrent move removes the unit first.
	 */
	async recordSerialCheck(input: {
		serialId: string;
		/** The storekeeper/technician taking the reading (hrm_employees m2o id). */
		actorId?: string | null;
		/** The measured remaining tread depth in millimetres — required, real reading. */
		treadMm?: number | null;
		/** The measured inflation pressure in psi — optional. */
		psi?: number | null;
		/** The wear/condition reading for ANY asset (tyres included) — optional but
		 *  the equipment counterpart of tread/psi, so a jack/toolbox can be graded. */
		condition?: string | null;
		note?: string | null;
	}): Promise<Record<string, unknown>> {
		const t = this.tables;
		const serialId = strId(input.serialId, 'serialId');
		const treadMm = input.treadMm == null || !Number.isFinite(Number(input.treadMm)) ? null : round2(Math.max(0, Number(input.treadMm)));
		const psi = input.psi == null || !Number.isFinite(Number(input.psi)) ? null : round2(Math.max(0, Number(input.psi)));
		const rawCondition = (input.condition ?? '').trim() || null;
		if (rawCondition && !isCondition(rawCondition)) throw new MroError(400, `condition must be one of: ${MRO_ASSET_CONDITIONS.join(', ')}`);
		const condition = rawCondition;
		const actorId = (input.actorId ?? '').trim() || null;

		const row = await this.db.first<{
			id: string;
			serial_no: string;
			status: string | null;
			tread_mm: number | null;
			psi: number | null;
			condition: string | null;
			/** `mro_item_model.reference_tread_mm` — the SKU's NEW-tread depth, JOINed
			 *  here so the ceiling costs no second read. */
			reference_tread_mm: number | null;
		}>({
			sql: `SELECT s.id AS id, s.serial_no AS serial_no, s.status AS status, s.tread_mm AS tread_mm,
			             s.psi AS psi, s.condition AS condition, M.reference_tread_mm AS reference_tread_mm
			        FROM ${t.serials} s
			        LEFT JOIN ${t.model} M ON M.id = s.model AND M.deleted_at IS NULL
			       WHERE s.id = ?1 AND s.deleted_at IS NULL`,
			bindings: [serialId],
		});
		if (!row) throw new MroError(404, 'Serial unit not found');
		if ((row.status ?? '') !== 'issued')
			throw new MroError(409, `That asset is ${row.status ?? 'unknown'} — only an issued (in-use) unit has wear to measure`);
		if (treadMm == null && psi == null && condition == null)
			throw new MroError(400, 'A check needs at least a tread depth (tread_mm), pressure (psi) or condition reading');

		// The NEW-tread ceiling. Absent baseline (a non-tyre SKU, or a catalog row that
		// never declared one) ⇒ nothing to cap against. The ceiling itself is allowed —
		// a brand-new tyre measures exactly its baseline; only a reading PAST it is
		// refused, since that is a typo or a wrong unit, never a measurement.
		const referenceTreadMm = row.reference_tread_mm == null ? null : Number(row.reference_tread_mm);
		if (treadMm != null && referenceTreadMm != null && referenceTreadMm > 0 && treadMm > referenceTreadMm)
			throw new MroError(400, `Tread depth cannot exceed this tyre's new-tread reading of ${referenceTreadMm} mm`);

		const now = nowIso();
		const statements: { sql: string; bindings: unknown[] }[] = [];
		const ops: Op[] = [];
		const guardIndex = new Map<number, string>();

		// Guarded live-snapshot update — only when the unit is STILL issued (a
		// concurrent return/scrap leaves the reading untouched and reverses below).
		const setCols: string[] = [];
		const liveVals: unknown[] = [];
		if (treadMm != null) {
			setCols.push('tread_mm = ?' + (setCols.length + 1));
			liveVals.push(treadMm);
		}
		if (psi != null) {
			setCols.push('psi = ?' + (setCols.length + 1));
			liveVals.push(psi);
		}
		if (condition != null) {
			setCols.push('condition = ?' + (setCols.length + 1));
			liveVals.push(condition);
		}
		const liveIdx = statements.length;
		statements.push({
			sql: `UPDATE ${t.serials} SET ${setCols.join(', ')}, updated_at = ?${setCols.length + 1} WHERE id = ?${setCols.length + 2} AND status = 'issued' AND deleted_at IS NULL`,
			bindings: [...liveVals, now, serialId],
		});
		guardIndex.set(liveIdx, `That asset moved while you were reading it — retry (${row.serial_no ?? 'serial ' + serialId})`);
		ops.push({
			kind: 'check_reading',
			serialId,
			treadMm: row.tread_mm ?? null,
			psi: row.psi ?? null,
			condition: row.condition ?? null,
			stmt: liveIdx,
		});

		// One immutable ``checked`` event carrying the measurement — the history
		// body the asset detail / fitment board derives remaining-tread from.
		const eventId = uid();
		const eventRow: Record<string, unknown> = {
			id: eventId,
			serial: serialId,
			event: 'checked',
			from_vehicle: null,
			to_vehicle: null,
			from_employee: null,
			to_employee: null,
			from_slot: null,
			to_slot: null,
			from_location: null,
			to_location: null,
			ref_kind: 'check',
			ref_doc: row.serial_no ?? serialId,
			by_user: actorId,
			note: input.note ?? null,
			tread_mm: treadMm,
			psi,
			condition,
			_meta: '{}',
			created_at: now,
			updated_at: now,
		};
		statements.push(insertSql(t.events, eventRow));
		ops.push({ kind: 'delete_events', eventIds: [eventId], stmt: null });

		const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Could not record the asset check');
		if (failed) throw new MroError(409, failed);

		this.docs.invalidate();
		return { serialId, serial_no: row.serial_no, event: 'checked', tread_mm: treadMm, psi, condition };
	}

	/**
	 * The ONE serial unit's immutable lifecycle history, newest first, read straight
	 * from D1 — a direct filtered query because the generic engine entity-list
	 * `?filter=` is intentionally IGNORED for these service-owned MRO tables (it
	 * silently returns ALL rows, not just this serial's). Each event returns the
	 * owning serial + m2o vehicle(s)/people resolved to their display fields so the
	 * tyre detail timeline needs no extra master fetches:
	 *
	 *   from_vehicle / to_vehicle     → plate_no          (veh_fleets)
	 *   from_employee / to_employee   → name_en           (hrm_employees)
	 *   by_user                       → name_en + avatar  (hrm_employees)
	 *   approved_by                   → name_en + avatar  (hrm_employees)
	 *
	 * Both PERSON projections carry `avatar` because both are candidates for the
	 * timeline's leading face: the actor when the directory has a photo for them, the
	 * approver when it does not. A projection that dropped the approver's photo would
	 * leave a photo-less actor showing an abstract glyph while a real face sat one
	 * join away, unread.
	 *
	 * `by_user` is DATA LINEAGE too, on one path: an event records who acted, but the
	 * receipts written before the confirm started stamping its receiver carry NO actor
	 * at all, and a receipt's receiver IS the actor by definition (that is what the
	 * document says happened). So the actor resolves to `COALESCE(ev.by_user,
	 * inbound.received_by)` — the event's own stamp first, and only for an INB- the
	 * header's receiver. Deliberately NOT generalised to the other three doc families:
	 * their `approved_by` AUTHORISED the movement, which is a different fact from
	 * performing it, and borrowing it as the actor would attribute an act to whoever
	 * signed it off.
	 *
	 * `approved_by` is DATA LINEAGE, not a column on the event: an event row carries
	 * only `ref_kind`/`ref_doc`, so the AUTHORISER is the approver of the DOCUMENT
	 * that authorised the movement, resolved through `ref_doc` ↔ `display_number`.
	 * Exactly four doc families record one — the rest have no approver to show, and
	 * the read must NOT invent one:
	 *
	 *   TRF-…  mro_transfers.approved_by        (the receiving store's confirmer)
	 *   AJT-…  mro_adjustments.approved_by      (the two-person rule's second hand)
	 *   ATR-…  mro_asset_requests.approved_by   (the superior who decided the move)
	 *   OUT-…  mro_requisitions.approved_by     (via mro_outbounds.request — a goods
	 *                                           issue is authorised by the approved
	 *                                           requisition it fulfils)
	 *
	 * An INB- receipt names no approver at all (nobody approves stock arriving), and
	 * a kiosk event's `ref_doc` is the SERIAL NUMBER (`fit`/`rotate`/`tray`/`scrap`/
	 * `check`/`issue`), which matches no `display_number` — so those rows resolve to
	 * null by construction rather than by a special case. The five probes are keyed
	 * on the outer row's own `ref_doc`, i.e. once per event of the one serial being
	 * read (bounded by history length, never by table size × events).
	 *
	 * `event_date` on the way OUT is the row's EFFECTIVE date — the day it took
	 * effect, which the timeline prints, ages from and orders by. It is DERIVED here
	 * in one expression (`effectiveAt`), never left to a client: the day the WRITER
	 * stored (an operator's back-dated wear for a fit/un-seat), else the governing
	 * DOCUMENT's own date (a receipt's `purchase_date`, an issue's `effective_date`,
	 * a transfer's `transfer_date`, an adjustment's `adjustment_date` — the same
	 * joins the approver uses), else the day the row was recorded. So a receipt filed
	 * today for stock bought in June reads as June, and it is never null.
	 *
	 * A serial with no history returns an EMPTY array (not an error).
	 */
	async serialEvents(serialId: string): Promise<Array<Record<string, unknown>>> {
		const t = this.tables;
		const sid = strId(serialId, 'serialId');
		const vehicleTable = collectionTable('veh_fleets');
		const empTable = collectionTable('hrm_employees');
		// The four doc families that record an approver (+ the outbound whose REQUEST
		// carries it). ONE expression, so the id joined on and the id returned can
		// never disagree about which document authorised the movement.
		const approverId = 'COALESCE(ap_t.approved_by, ap_a.approved_by, ap_r.approved_by, ap_q.approved_by)';
		// The day a movement TOOK EFFECT — the date the timeline PRINTS, ages every row
		// from and orders by. ONE expression, used by the projection AND the `ORDER BY`
		// below, so a row can never sort by one day while displaying another:
		//
		//   1. the day the WRITER stored on the event — the operator's chosen physical
		//      wear day for a fit/un-seat (back-dating), the one date a client supplies;
		//   2. else the governing DOCUMENT's own date, resolved through the SAME
		//      `ref_doc` ↔ `display_number` joins the approver uses: stock bought in
		//      June and booked in today took effect in JUNE, so a receipt / issue /
		//      transfer / adjustment row reads (and sorts) by its document's date, never
		//      by the day someone typed it in;
		//   3. else the day the row was recorded — the kiosk chores (fit/rotate/tray/
		//      scrap/issue/check), an ATR execution and an inspection take effect when
		//      they happen.
		const effectiveAt =
			`COALESCE(NULLIF(TRIM(ev.event_date), ''),` +
			` CASE WHEN ap_i.id IS NOT NULL THEN ap_i.purchase_date` +
			`      WHEN ap_o.id IS NOT NULL THEN ap_o.effective_date` +
			`      WHEN ap_t.id IS NOT NULL THEN ap_t.transfer_date` +
			`      WHEN ap_a.id IS NOT NULL THEN ap_a.adjustment_date END,` +
			` ev.created_at)`;
		const rows = await this.db.all<Record<string, unknown>>({
			sql: `SELECT ev.id, ev.serial, ev.event,
				 fv.id AS from_vehicle_id, fv.plate_no AS from_vehicle_plate,
				 tv.id AS to_vehicle_id, tv.plate_no AS to_vehicle_plate,
				 fe.id AS from_employee_id, fe.name_en AS from_employee_name,
				 te.id AS to_employee_id, te.name_en AS to_employee_name,
				 ev.from_slot, ev.to_slot,
				 ev.from_location, ev.to_location,
				 ev.ref_kind, ev.ref_doc,
				 bu.id AS by_user_id, bu.name_en AS by_user_name, bu.avatar AS by_user_avatar,
				 au.id AS approved_by_id, au.name_en AS approved_by_name, au.avatar AS approved_by_avatar,
				 ev.tread_mm, ev.psi, ev.condition,
				 ev.note, substr(${effectiveAt}, 1, 10) AS effective_at, ev.created_at, ev.updated_at
			 FROM ${t.events} ev
			 LEFT JOIN ${vehicleTable} fv ON fv.id = ev.from_vehicle AND fv.deleted_at IS NULL
			 LEFT JOIN ${vehicleTable} tv ON tv.id = ev.to_vehicle AND tv.deleted_at IS NULL
			 LEFT JOIN ${empTable} fe ON fe.id = ev.from_employee AND fe.deleted_at IS NULL
			 LEFT JOIN ${empTable} te ON te.id = ev.to_employee AND te.deleted_at IS NULL
			 LEFT JOIN ${t.inbound} ap_i ON ap_i.display_number = ev.ref_doc AND ap_i.deleted_at IS NULL
			 LEFT JOIN ${empTable} bu ON bu.id = COALESCE(ev.by_user, ap_i.received_by) AND bu.deleted_at IS NULL
			 LEFT JOIN ${t.transfer} ap_t ON ap_t.display_number = ev.ref_doc AND ap_t.deleted_at IS NULL
			 LEFT JOIN ${t.adjustment} ap_a ON ap_a.display_number = ev.ref_doc AND ap_a.deleted_at IS NULL
			 LEFT JOIN ${t.assetRequest} ap_r ON ap_r.display_number = ev.ref_doc AND ap_r.deleted_at IS NULL
			 LEFT JOIN ${t.outbound} ap_o ON ap_o.display_number = ev.ref_doc AND ap_o.deleted_at IS NULL
			 LEFT JOIN ${t.requisition} ap_q ON ap_q.id = ap_o.request AND ap_q.deleted_at IS NULL
			 LEFT JOIN ${empTable} au ON au.id = ${approverId} AND au.deleted_at IS NULL
			 WHERE ev.serial = ?1 AND ev.deleted_at IS NULL
			 -- NEWEST FIRST, at the granularity the row DISPLAYS:
			 --   1. the effective DAY (effectiveAt) — the very day the row prints and
			 --      ages from, so a wear dated last month (or a receipt for stock bought
			 --      in June) sorts under ITS date instead of on top of today's rows while
			 --      saying "last month";
			 --   2. the record time within that day (the honest "newest" there);
			 --   3. the APPEND order for exact ties — ONE confirm writes several events at
			 --      the same millisecond, and a random UUID would shuffle them.
			 ORDER BY substr(${effectiveAt}, 1, 10) DESC,
			          ev.created_at DESC,
			          ev.rowid DESC`,
			bindings: [sid],
		});
		return rows.map((r) => ({
			id: r.id,
			serial: r.serial ? { id: String(r.serial) } : null,
			event: r.event ?? null,
			from_vehicle: r.from_vehicle_id ? { id: String(r.from_vehicle_id), plate_no: r.from_vehicle_plate ?? null } : null,
			to_vehicle: r.to_vehicle_id ? { id: String(r.to_vehicle_id), plate_no: r.to_vehicle_plate ?? null } : null,
			from_employee: r.from_employee_id ? { id: String(r.from_employee_id), name_en: r.from_employee_name ?? null } : null,
			to_employee: r.to_employee_id ? { id: String(r.to_employee_id), name_en: r.to_employee_name ?? null } : null,
			from_slot: r.from_slot ?? null,
			to_slot: r.to_slot ?? null,
			from_location: r.from_location ?? null,
			to_location: r.to_location ?? null,
			ref_kind: r.ref_kind ?? null,
			ref_doc: r.ref_doc ?? null,
			by_user: r.by_user_id ? { id: String(r.by_user_id), name_en: r.by_user_name ?? null, avatar: r.by_user_avatar ?? null } : null,
			approved_by: r.approved_by_id
				? { id: String(r.approved_by_id), name_en: r.approved_by_name ?? null, avatar: r.approved_by_avatar ?? null }
				: null,
			tread_mm: r.tread_mm == null ? null : Number(r.tread_mm),
			psi: r.psi == null ? null : Number(r.psi),
			condition: r.condition ?? null,
			note: r.note ?? null,
			// The EFFECTIVE date of the event (`effectiveAt` above), so no caller has to
			// fall back to the record time: a kiosk fit/un-seat stores the operator's
			// physical day (back-dating), a document-backed movement takes the date of
			// the document that authorised it, and everything else takes effect on the
			// day it was recorded. The timeline prints, ages and orders each row by THIS,
			// never by `created_at`, which is why it is never null.
			event_date: r.effective_at ?? (r.created_at == null ? null : String(r.created_at).slice(0, 10)),
			created_at: r.created_at ?? null,
		}));
	}

	/**
	 * Every ASSET UNIT held by one holder — a truck (`?vehicle=`) or an employee
	 * (`?employee=`), or every holder when neither is given (`GET /api/mro/assets/
	 * holder`). ONE read for the whole register: the holder is DERIVED here
	 * (employee ? person : vehicle ? truck+slot : store), never stored. Only
	 * `assets`-flagged item names qualify (one row per physical unit — a tyre, a
	 * jack, a toolbox), so standard/batch consumables never appear. `kind` ('tyre'
	 * when the SKU declares a new-tread baseline or the unit sits on a wheel, else
	 * 'asset') lets a register split tabs without a second read. Only HELD units
	 * (`status = 'issued'`) — in-store units are store stock, not a holder's. Rows
	 * are item-name then serial-number sorted (deterministic).
	 */
	async holderAssets(holder: { vehicle?: string | null; employee?: string | null } = {}): Promise<HolderAssetRow[]> {
		const t = this.tables;
		const modelTable = collectionTable('mro_item_model');
		const vehicleTable = collectionTable('veh_fleets');
		const empTable = collectionTable('hrm_employees');
		const vehicle = (holder.vehicle ?? '').trim() || null;
		const employee = (holder.employee ?? '').trim() || null;
		const where: string[] = ["s.status = 'issued'", 's.deleted_at IS NULL'];
		const bindings: unknown[] = [];
		if (vehicle) {
			bindings.push(vehicle);
			where.push(`s.vehicle = ?${bindings.length}`);
		}
		if (employee) {
			bindings.push(employee);
			where.push(`s.employee = ?${bindings.length}`);
		}
		const rows = await this.db.all<Record<string, unknown>>({
			sql: `SELECT s.id AS id, s.serial_no AS serial_no, s.status AS status,
					             s.location AS location, s.vehicle AS vehicle, s.slot AS slot,
					             s.employee AS employee, s.tread_mm AS tread_mm, s.psi AS psi,
					             s.condition AS condition, s.unit_cost AS unit_cost,
					             M.id AS model, M.name_en AS model_name, M.image AS model_image,
					             M.reference_tread_mm AS reference_tread_mm,
					             G.id AS item_name, G.name_en AS item_name_en, G.name_mm AS item_name_mm,
					             V.plate_no AS plate_no, E.name_en AS employee_name
					        FROM ${t.serials} s
					        JOIN ${modelTable} M ON M.id = s.model AND M.deleted_at IS NULL
					        JOIN ${t.group} G ON G.id = M.item_name AND G.deleted_at IS NULL AND G.assets = 1
					        LEFT JOIN ${vehicleTable} V ON V.id = s.vehicle AND V.deleted_at IS NULL
					        LEFT JOIN ${empTable} E ON E.id = s.employee AND E.deleted_at IS NULL
					       WHERE ${where.join(' AND ')}
					       ORDER BY G.name_en COLLATE NOCASE ASC, s.serial_no COLLATE NOCASE ASC, s.id ASC`,
			bindings,
		});
		return rows.map((r) => {
			const referenceTreadMm = r.reference_tread_mm == null ? null : Number(r.reference_tread_mm);
			const slot = r.slot == null ? null : String(r.slot);
			return {
				id: String(r.id ?? ''),
				serial_no: r.serial_no == null ? null : String(r.serial_no),
				status: r.status == null ? null : String(r.status),
				model: r.model == null ? null : String(r.model),
				model_name: r.model_name == null ? null : String(r.model_name),
				model_image: r.model_image == null ? null : String(r.model_image),
				item_name: r.item_name == null ? null : String(r.item_name),
				item_name_en: r.item_name_en == null ? null : String(r.item_name_en),
				item_name_mm: r.item_name_mm == null ? null : String(r.item_name_mm),
				reference_tread_mm: referenceTreadMm,
				kind: (referenceTreadMm != null || slot != null ? 'tyre' : 'asset') as 'tyre' | 'asset',
				vehicle: r.vehicle == null ? null : String(r.vehicle),
				plate_no: r.plate_no == null ? null : String(r.plate_no),
				slot,
				employee: r.employee == null ? null : String(r.employee),
				employee_name: r.employee_name == null ? null : String(r.employee_name),
				location: r.location == null ? null : String(r.location),
				tread_mm: r.tread_mm == null ? null : Number(r.tread_mm),
				psi: r.psi == null ? null : Number(r.psi),
				condition: r.condition == null ? null : String(r.condition),
				unit_cost: r.unit_cost == null ? null : Number(r.unit_cost),
			};
		});
	}
}
