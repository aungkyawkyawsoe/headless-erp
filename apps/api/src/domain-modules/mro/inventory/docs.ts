/**
 * MRO document + line READS — the leaf reads every use-case calls: the engine-owned
 * document/line rows, a model's tracking policy, a serial unit's live holder seam,
 * the balance/serial lookups, the asset-request row and its approver gate, plus the
 * read-cache drop every writer ends with. Split out of `inventory.service.ts`
 * verbatim; the service keeps thin delegating methods so its own method names and
 * signatures are unchanged.
 */
import type { D1Client } from '@mmbix/core';
import { invalidateCollectionReads } from '@mmbix/core';
import { MroError, PAID_AT_RECEIPT_SOURCE } from './types';
import type { AdjustmentLineRow, DocRow, InventoryRow, LineRow, ModelRow, RequisitionLineRow, SerialRow, Tables } from './types';

export class DocReads {
	constructor(
		private readonly db: D1Client,
		private readonly tables: Tables,
	) {}

	invalidate(): void {
		for (const slug of [
			'mro_inbounds',
			'mro_inbound_lines',
			'mro_outbounds',
			'mro_outbound_lines',
			'mro_transfers',
			'mro_transfer_lines',
			'mro_transfer_lots',
			'mro_transfer_serials',
			'mro_adjustments',
			'mro_adjustment_lines',
			'mro_adjustment_lots',
			'mro_adjustment_serials',
			'mro_requisitions',
			'mro_requisition_lines',
			'mro_stock_lots',
			'mro_stock_serials',
			'mro_serial_events',
			'mro_outbound_lots',
			'mro_outbound_serials',
			'mro_inventory',
			'mro_asset_requests',
		]) {
			invalidateCollectionReads(slug);
		}
	}

	// ── Document + line reads (engine-owned rows, read straight from D1) ────

	async docIn(id: string): Promise<DocRow | null> {
		const row = await this.db.first<DocRow>({
			sql: `SELECT id, type, location, purchase_date, note, doc_status, display_number, paid_at_receipt, cancelled_at, cancelled_by
			 FROM ${this.tables.inbound} WHERE id = ?1 AND deleted_at IS NULL`,
			bindings: [id],
		});
		return row ?? null;
	}

	async docOut(id: string): Promise<DocRow | null> {
		const row = await this.db.first<DocRow>({
			sql: `SELECT id, type, location, effective_date, note, doc_status, display_number, request, to_vehicle, to_employee, cancelled_at, cancelled_by
			 FROM ${this.tables.outbound} WHERE id = ?1 AND deleted_at IS NULL`,
			bindings: [id],
		});
		return row ?? null;
	}

	async inLines(parentId: string): Promise<LineRow[]> {
		return this.db.all<LineRow>({
			sql: `SELECT id, item_model, qty, unit_price, location, batch_no, expiry_date, serials, note
			 FROM ${this.tables.inLines} WHERE parent_id = ?1 AND deleted_at IS NULL ORDER BY id ASC`,
			bindings: [parentId],
		});
	}

	async outLines(parentId: string): Promise<LineRow[]> {
		return this.db.all<LineRow>({
			sql: `SELECT id, item_model, qty, unit_price, location, serials, note
			 FROM ${this.tables.outLines} WHERE parent_id = ?1 AND deleted_at IS NULL ORDER BY id ASC`,
			bindings: [parentId],
		});
	}

	async docTransfer(id: string): Promise<{
		id: string;
		from_location: string | null;
		to_location: string | null;
		transfer_date: string | null;
		note: string | null;
		doc_status: string | null;
		display_number: string | null;
		cancelled_at: string | null;
		cancelled_by: string | null;
	} | null> {
		const row = await this.db.first<{
			id: string;
			from_location: string | null;
			to_location: string | null;
			transfer_date: string | null;
			note: string | null;
			doc_status: string | null;
			display_number: string | null;
			cancelled_at: string | null;
			cancelled_by: string | null;
		}>({
			sql: `SELECT id, from_location, to_location, transfer_date, note, doc_status, display_number, cancelled_at, cancelled_by
				 FROM ${this.tables.transfer} WHERE id = ?1 AND deleted_at IS NULL`,
			bindings: [id],
		});
		return row ?? null;
	}

	async transferLines(parentId: string): Promise<LineRow[]> {
		return this.db.all<LineRow>({
			sql: `SELECT id, item_model, qty, batch_no, serials, note
			 FROM ${this.tables.transferLines} WHERE parent_id = ?1 AND deleted_at IS NULL ORDER BY id ASC`,
			bindings: [parentId],
		});
	}

	async docAdjustment(id: string): Promise<{
		id: string;
		location: string | null;
		reported_by: string | null;
		adjustment_date: string | null;
		description: string | null;
		doc_status: string | null;
		display_number: string | null;
		cancelled_at: string | null;
		cancelled_by: string | null;
	} | null> {
		const row = await this.db.first<{
			id: string;
			location: string | null;
			reported_by: string | null;
			adjustment_date: string | null;
			description: string | null;
			doc_status: string | null;
			display_number: string | null;
			cancelled_at: string | null;
			cancelled_by: string | null;
		}>({
			sql: `SELECT id, location, reported_by, adjustment_date, description, doc_status, display_number, cancelled_at, cancelled_by
			 FROM ${this.tables.adjustment} WHERE id = ?1 AND deleted_at IS NULL`,
			bindings: [id],
		});
		return row ?? null;
	}

	async adjustmentLines(parentId: string): Promise<AdjustmentLineRow[]> {
		return this.db.all<AdjustmentLineRow>({
			sql: `SELECT id, item_model, direction, qty, batch_no, expiry_date, serials, unit_cost, expected_qty, diff_qty
			 FROM ${this.tables.adjustmentLines} WHERE parent_id = ?1 AND deleted_at IS NULL ORDER BY id ASC`,
			bindings: [parentId],
		});
	}

	async docRequisition(id: string): Promise<{
		id: string;
		location: string | null;
		request_date: string | null;
		note: string | null;
		requested_by: string | null;
		approved_by: string | null;
		req_status: string | null;
		issued_qty: number | null;
		doc_status: string | null;
		display_number: string | null;
	} | null> {
		const row = await this.db.first<{
			id: string;
			location: string | null;
			request_date: string | null;
			note: string | null;
			requested_by: string | null;
			approved_by: string | null;
			req_status: string | null;
			issued_qty: number | null;
			doc_status: string | null;
			display_number: string | null;
		}>({
			sql: `SELECT id, location, request_date, note, requested_by, approved_by,
			  requisition_status AS req_status, issued_qty, doc_status, display_number
			 FROM ${this.tables.requisition} WHERE id = ?1 AND deleted_at IS NULL`,
			bindings: [id],
		});
		return row ?? null;
	}

	async requisitionLines(parentId: string): Promise<RequisitionLineRow[]> {
		return this.db.all<RequisitionLineRow>({
			sql: `SELECT id, item_model, qty, note
			 FROM ${this.tables.requisitionLines} WHERE parent_id = ?1 AND deleted_at IS NULL ORDER BY id ASC`,
			bindings: [parentId],
		});
	}

	/**
	 * Sum of `total_qty` already confirmed by goods-issue outbounds fulfilling the
	 * given request (excludes any still-draft doc that has yet to hit the batch).
	 */
	async confirmedIssueTo(requestId: string): Promise<number> {
		const row = await this.db.first<{ s: number | null }>({
			sql: `SELECT COALESCE(SUM(total_qty), 0) AS s FROM ${this.tables.outbound}
			 WHERE request = ?1 AND type = 'goods_issue' AND doc_status = 'confirmed' AND deleted_at IS NULL`,
			bindings: [requestId],
		});
		return Number(row?.s ?? 0);
	}

	/** The model's tracking policy — resolved through its item NAME (the policy
	 *  lives on `mro_item_name`, never on the SKU), unknown/missing → `standard`.
	 *  The display name is English-first (`name_en`) so callers echo a label the
	 *  operator recognizes. */
	async resolveModel(modelId: string): Promise<ModelRow> {
		const t = this.tables;
		const row = await this.db.first<{ tracking: string | null; name_en: string | null }>({
			sql: `SELECT g.tracking AS tracking, m.name_en AS name_en
			        FROM ${t.model} m
			        LEFT JOIN ${t.group} g ON g.id = m.item_name AND g.deleted_at IS NULL
			       WHERE m.id = ?1 AND m.deleted_at IS NULL`,
			bindings: [modelId],
		});
		if (!row) throw new MroError(404, 'Item model not found');
		return { tracking: row.tracking, name_en: row.name_en };
	}

	async inventoryRow(modelId: string, location: string): Promise<InventoryRow | null> {
		const row = await this.db.first<InventoryRow>({
			sql: `SELECT id, model, location, qty_on_hand FROM ${this.tables.inv} WHERE model = ?1 AND location = ?2 AND deleted_at IS NULL LIMIT 1`,
			bindings: [modelId, location],
		});
		return row ?? null;
	}

	async serialRowsByNo(serialNos: string[]): Promise<Map<string, SerialRow>> {
		const binds = serialNos.map((_, i) => `?${i + 1}`);
		const rows = await this.db.all<SerialRow>({
			sql: `SELECT id, serial_no, status, location, expiry_date FROM ${this.tables.serials}
			 WHERE serial_no IN (${binds.join(', ')}) AND deleted_at IS NULL`,
			bindings: serialNos,
		});
		return new Map(rows.map((r) => [r.serial_no, r]));
	}

	async existingSerials(serials: string[]): Promise<string[]> {
		const binds = serials.map((_, i) => `?${i + 1}`);
		const rows = await this.db.all<{ serial_no: string }>({
			sql: `SELECT serial_no FROM ${this.tables.serials} WHERE serial_no IN (${binds.join(', ')}) AND deleted_at IS NULL`,
			bindings: serials,
		});
		return rows.map((r) => r.serial_no);
	}

	// ── Reversal reads — the EXACT stock effect a document applied ──────────────
	// A reversal must put back what came out, not what a re-run of FEFO would take
	// today: the trace rows the confirm wrote are the single source of truth for a
	// posted document's effect, so every cancel path reads THEM.

	/** Every live trace row of an outbound — which lot gave how much, which unit left.
	 *  The WHOLE row comes back, because the reversal re-inserts it verbatim when its
	 *  own batch guard loses: restoring a column subset would leave a `_meta`-less,
	 *  freshly-timestamped row behind, i.e. a rollback that is not a rollback. */
	async outboundTrace(outboundId: string): Promise<{
		lots: Array<{ id: string; lot_id: string | null; qty: number | null; outbound_line: string | null }>;
		serials: Array<{ id: string; serial_id: string | null; outbound_line: string | null }>;
	}> {
		const [lots, serials] = await Promise.all([
			this.db.all<{ id: string; lot_id: string | null; qty: number | null; outbound_line: string | null }>({
				sql: `SELECT * FROM ${this.tables.outLots} WHERE outbound_id = ?1 AND deleted_at IS NULL ORDER BY id ASC`,
				bindings: [outboundId],
			}),
			this.db.all<{ id: string; serial_id: string | null; outbound_line: string | null }>({
				sql: `SELECT * FROM ${this.tables.outSerials} WHERE outbound_id = ?1 AND deleted_at IS NULL ORDER BY id ASC`,
				bindings: [outboundId],
			}),
		]);
		return { lots, serials };
	}

	/** Every live trace row of an adjustment — the lot each line created/took, the unit each removed.
	 *  Full rows for the same reason as `outboundTrace`: they are restored verbatim on a lost guard. */
	async adjustmentTrace(adjustmentId: string): Promise<{
		lots: Array<{ id: string; lot_id: string | null; direction: string | null; qty: number | null; adjustment_line: string | null }>;
		serials: Array<{ id: string; serial_id: string | null; adjustment_line: string | null }>;
	}> {
		const [lots, serials] = await Promise.all([
			this.db.all<{ id: string; lot_id: string | null; direction: string | null; qty: number | null; adjustment_line: string | null }>({
				sql: `SELECT * FROM ${this.tables.adjustmentLots} WHERE adjustment_id = ?1 AND deleted_at IS NULL ORDER BY id ASC`,
				bindings: [adjustmentId],
			}),
			this.db.all<{ id: string; serial_id: string | null; adjustment_line: string | null }>({
				sql: `SELECT * FROM ${this.tables.adjustmentSerials} WHERE adjustment_id = ?1 AND deleted_at IS NULL ORDER BY id ASC`,
				bindings: [adjustmentId],
			}),
		]);
		return { lots, serials };
	}

	/** Every live trace row of a transfer — which source lot fed the move and which
	 *  destination lot received it, per line. Full rows for the same reason as the
	 *  other traces: a reversal re-inserts them verbatim when its own batch guard loses. */
	async transferTrace(transferId: string): Promise<{
		lots: Array<{ id: string; from_lot: string | null; to_lot: string | null; qty: number | null; transfer_line: string | null }>;
		serials: Array<{ id: string; serial_id: string | null; transfer_line: string | null }>;
	}> {
		const [lots, serials] = await Promise.all([
			this.db.all<{ id: string; from_lot: string | null; to_lot: string | null; qty: number | null; transfer_line: string | null }>({
				sql: `SELECT * FROM ${this.tables.transferLots} WHERE transfer_id = ?1 AND deleted_at IS NULL ORDER BY id ASC`,
				bindings: [transferId],
			}),
			this.db.all<{ id: string; serial_id: string | null; transfer_line: string | null }>({
				sql: `SELECT * FROM ${this.tables.transferSerials} WHERE transfer_id = ?1 AND deleted_at IS NULL ORDER BY id ASC`,
				bindings: [transferId],
			}),
		]);
		return { lots, serials };
	}

	/** The lot rows behind a set of trace rows (keyed by id) — the reversal's guard reads. */
	async lotRowsByIds(ids: string[]): Promise<Map<string, Record<string, unknown>>> {
		if (ids.length === 0) return new Map();
		const binds = ids.map((_, i) => `?${i + 1}`);
		const rows = await this.db.all<Record<string, unknown>>({
			sql: `SELECT * FROM ${this.tables.lots} WHERE id IN (${binds.join(', ')}) AND deleted_at IS NULL`,
			bindings: ids,
		});
		return new Map(rows.map((r) => [String(r.id), r]));
	}

	/** The live serial units behind a set of ids (keyed by id) — the full seam a
	 *  reversal guards (`status` + `location` + `vehicle`/`slot`/`employee`), because a
	 *  unit that has since moved on must REFUSE the reversal instead of being yanked. */
	async serialSeamsByIds(ids: string[]): Promise<
		Map<
			string,
			{
				id: string;
				serial_no: string | null;
				status: string | null;
				location: string | null;
				vehicle: string | null;
				slot: string | null;
				employee: string | null;
			}
		>
	> {
		if (ids.length === 0) return new Map();
		const binds = ids.map((_, i) => `?${i + 1}`);
		const rows = await this.db.all<{
			id: string;
			serial_no: string | null;
			status: string | null;
			location: string | null;
			vehicle: string | null;
			slot: string | null;
			employee: string | null;
		}>({
			sql: `SELECT id, serial_no, status, location, vehicle, slot, employee FROM ${this.tables.serials} WHERE id IN (${binds.join(', ')}) AND deleted_at IS NULL`,
			bindings: ids,
		});
		return new Map(rows.map((r) => [r.id, r]));
	}

	/** The serial events of the given units that a DIFFERENT document wrote. A
	 *  receipt may only be reversed while its units carry no other history, so this
	 *  is the guard's whole verdict (empty ⇒ nothing has happened to them since). */
	async foreignSerialEvents(
		serialIds: string[],
		refDoc: string | null,
	): Promise<Array<{ id: string; serial: string | null; event: string | null }>> {
		if (serialIds.length === 0) return [];
		const binds = serialIds.map((_, i) => `?${i + 1}`);
		const docSlot = `?${serialIds.length + 1}`;
		return this.db.all<{ id: string; serial: string | null; event: string | null }>({
			sql: `SELECT id, serial, event FROM ${this.tables.events}
			 WHERE serial IN (${binds.join(', ')}) AND deleted_at IS NULL AND ref_doc IS NOT ${docSlot}`,
			bindings: [...serialIds, refDoc],
		});
	}

	/** A receipt's LIVE payment ledger rows — the money a cancellation must account
	 *  for before it can un-post a receipt (`_meta` marks the entry the confirm itself
	 *  filed for a paid-at-receipt draft). Full rows, because a withdrawn entry is
	 *  restored verbatim if the reversal's own batch guard loses. */
	async livePayments(parentId: string): Promise<Array<Record<string, unknown>>> {
		return this.db.all<Record<string, unknown>>({
			sql: `SELECT * FROM ${this.tables.payments} WHERE parent_id = ?1 AND deleted_at IS NULL ORDER BY id ASC`,
			bindings: [parentId],
		});
	}

	/** Splits a "paid at receipt" ledger row from money a person recorded: the confirm
	 *  stamps this marker in `_meta`, so the un-post can delete exactly its own entry
	 *  and refuse while a human-recorded payment stands. */
	isReceiptFiledPayment(meta: unknown): boolean {
		const raw = meta == null ? '' : String(meta);
		if (!raw) return false;
		try {
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			return parsed?.source === PAID_AT_RECEIPT_SOURCE;
		} catch {
			return false;
		}
	}

	async assetRequestRow(id: string): Promise<{
		id: string;
		serial: string | null;
		status: string | null;
		requested_by: string | null;
		from_vehicle: string | null;
		from_slot: string | null;
		from_employee: string | null;
		to_vehicle: string | null;
		to_slot: string | null;
		to_employee: string | null;
		/** Set on a RETURN request (holder → store) — what makes it a return, not a move. */
		to_location: string | null;
		/** Set on a WRITE-OFF request — the unit is scrapped where it sits, no destination. */
		write_off: boolean | number | null;
		note: string | null;
		display_number: string | null;
	} | null> {
		return this.db.first({
			sql: `SELECT id, serial, status, requested_by, from_vehicle, from_slot, from_employee,
			             to_vehicle, to_slot, to_employee, to_location, write_off, note, display_number
			      FROM ${this.tables.assetRequest} WHERE id = ?1 AND deleted_at IS NULL`,
			bindings: [id],
		});
	}

	/** True when `superiorId` is a recorded superior of `employeeId` (hrm_employee_links). */
	private async isSuperiorOf(superiorId: string, employeeId: string): Promise<boolean> {
		if (!superiorId || !employeeId) return false;
		const row = await this.db.first<{ id: string }>({
			sql: `SELECT id FROM ${this.tables.empLinks} WHERE superior = ?1 AND subordinate = ?2 AND deleted_at IS NULL LIMIT 1`,
			bindings: [superiorId, employeeId],
		});
		return Boolean(row);
	}

	/**
	 * The shared approve/reject gate: the actor must be present, must NOT be the
	 * requester (two-person), and — unless `allowAnyApprover` (admin) — must be a
	 * recorded superior of the requester. Identity comes from the SESSION, so this
	 * cannot be defeated by naming someone else in the payload.
	 */
	async guardRequestApprover(req: { requested_by: string | null }, actorId: string, allowAnyApprover: boolean): Promise<void> {
		const requester = (req.requested_by ?? '').trim();
		if (!actorId) throw new MroError(400, 'The deciding employee is required');
		if (requester && requester === actorId) throw new MroError(409, 'This request must be decided by someone other than the requester');
		if (allowAnyApprover) return;
		if (!requester) throw new MroError(409, 'This request has no recorded requester — only an admin can decide it');
		if (!(await this.isSuperiorOf(actorId, requester)))
			throw new MroError(403, 'Only a recorded superior of the requester (or an admin) may decide this request');
	}

	/** One serial unit's live row for the kiosk asset chore writers — the columns a
	 *  move / issue / return / scrap / swap op needs to plan its guarded batch. */
	async serialRow(serialId: string): Promise<{
		id: string;
		serial_no: string | null;
		status: string | null;
		vehicle: string | null;
		slot: string | null;
		employee: string | null;
		location: string | null;
		model: string | null;
		tread_mm: number | null;
		psi: number | null;
		condition: string | null;
	} | null> {
		const t = this.tables;
		return this.db.first<{
			id: string;
			serial_no: string | null;
			status: string | null;
			vehicle: string | null;
			slot: string | null;
			employee: string | null;
			location: string | null;
			model: string | null;
			tread_mm: number | null;
			psi: number | null;
			condition: string | null;
		}>({
			sql: `SELECT id, serial_no, status, vehicle, slot, employee, location, model, tread_mm, psi, condition FROM ${t.serials} WHERE id = ?1 AND deleted_at IS NULL`,
			bindings: [serialId],
		});
	}

	/** True when ANOTHER issued unit currently fills the given (vehicle, slot). */
	async seatTaken(vehicleId: string, slotId: string, excludeSerialId?: string): Promise<boolean> {
		const t = this.tables;
		const row = await this.db.first<{ id: string }>({
			sql: `SELECT id FROM ${t.serials}
			 WHERE status = 'issued' AND vehicle = ?1 AND slot = ?2 AND deleted_at IS NULL${excludeSerialId ? ' AND id <> ?3' : ''}
			 LIMIT 1`,
			bindings: excludeSerialId ? [vehicleId, slotId, excludeSerialId] : [vehicleId, slotId],
		});
		return !!row;
	}
}
