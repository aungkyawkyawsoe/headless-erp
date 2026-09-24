/**
 * Confirm — location-to-location transfer. Moved verbatim out of
 * `inventory.service.ts`, which now delegates here so its public surface is
 * unchanged; runs on the shared `MroContext`.
 */
import { isLocation, isTracking, nowIso, parseSerials, qtyOf, strId, uid } from '../codecs';
import { insertSql, planEventInserts } from '../guarded-batch';
import type { Op, SerialEventSeed } from '../guarded-batch';
import { MM_INSUFFICIENT, MRO_LOCATIONS, MroError } from '../types';
import type { MroContext } from '../context';

export class TransferConfirm {
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

	private get allocation() {
		return this.c.allocation;
	}

	private get guarded() {
		return this.c.guarded;
	}

	// ── Confirm — location-to-location transfer ─────────────────────────────

	/**
	 * Confirm a draft transfer: the source location deducts, the destination
	 * receives, in ONE atomic batch. Per line, by policy:
	 *   standard — balance −qty at source, +qty at destination;
	 *   batch    — FEFO lot allocation at the source (expired lots stay put —
	 *              write them off where they sit); each take is merged into the
	 *              destination lot with the same (batch_no, expiry_date) or, when
	 *              none exists, re-created there — lot identity survives the move;
	 *   serial   — the listed units must be in_stock at the source and simply
	 *              flip their location.
	 * Trace rows land in mro_transfer_lots / mro_transfer_serials. Guard failure
	 * reverses everything (409, no partial state); replay is a no-op.
	 */
	async confirmTransfer(docId: string, approver: { approvedBy?: string | null } = {}): Promise<Record<string, unknown>> {
		const t = this.tables;
		const doc = await this.docs.docTransfer(strId(docId, 'id'));
		if (!doc) throw new MroError(404, 'Transfer document not found');
		const status = doc.doc_status ?? 'draft';
		if (status === 'confirmed') {
			const re = await this.db.first<Record<string, unknown>>({
				sql: `SELECT display_number, total_qty, line_count FROM ${t.transfer} WHERE id = ?1`,
				bindings: [docId],
			});
			return { transferId: docId, already: true, doc_status: 'confirmed', ...(re ?? {}) };
		}
		if (status === 'cancelled') throw new MroError(409, 'Cancelled transfer cannot be confirmed');
		if (status !== 'draft') throw new MroError(409, `Only draft documents can be confirmed (current: ${status})`);

		// The confirming operator (whoever validates the arrival at the destination
		// store, `approved_by`) is recorded on the header at the flip. It must be a
		// real actor id, but — unlike a stock ADJUSTMENT — a transfer may legitimately
		// be reported AND confirmed by the same store keeper, so no "must differ"
		// gate is enforced here.
		const approvedBy = (approver.approvedBy ?? '').trim();
		if (!approvedBy) throw new MroError(400, "A transfer must be confirmed — pass the confirming operator's employee id");

		const from = doc.from_location;
		const to = doc.to_location;
		if (!isLocation(from) || !isLocation(to)) throw new MroError(400, `Locations must be one of: ${MRO_LOCATIONS.join(', ')}`);
		if (from === to) throw new MroError(400, 'from_location and to_location must be different');

		const lineRows = await this.docs.transferLines(docId);
		if (lineRows.length === 0) throw new MroError(400, 'Transfer has no lines — add at least one line before confirming');

		const now = nowIso();
		const statements: { sql: string; bindings: unknown[] }[] = [];
		const ops: Op[] = [];
		const transferEvents: SerialEventSeed[] = [];
		const guardIndex = new Map<number, string>();
		const demand = new Map<string, { model: string; qty: number }>(); // (model) → source deduction
		const bump = new Map<string, { model: string; qty: number }>(); // (model) → destination receipt
		const add = (map: Map<string, { model: string; qty: number }>, modelId: string, qty: number) => {
			const d = map.get(modelId) ?? { model: modelId, qty: 0 };
			d.qty += qty;
			map.set(modelId, d);
		};

		let totalQty = 0;

		for (const [index, line] of lineRows.entries()) {
			const idx = index + 1;
			const modelId = strId(line.item_model, `line ${idx} item_model`);
			const qty = qtyOf(line.qty, `line ${idx} qty`);
			const model = await this.docs.resolveModel(modelId);
			const tracking = isTracking(model.tracking);
			totalQty += qty;
			add(demand, modelId, qty);
			add(bump, modelId, qty);

			if (tracking === 'batch') {
				const alloc = await this.allocation.allocateLots(modelId, from, qty, 'transfer', line.batch_no?.trim() || null);
				for (const take of alloc) {
					const stmtIdx = statements.length;
					statements.push({
						sql: `UPDATE ${t.lots} SET remaining_qty = remaining_qty - ?1,
						 status = CASE WHEN remaining_qty - ?1 <= 0 THEN 'empty' ELSE status END, updated_at = ?2
						 WHERE id = ?3 AND status = 'active' AND remaining_qty >= ?1`,
						bindings: [take.take, now, take.lotId],
					});
					guardIndex.set(stmtIdx, MM_INSUFFICIENT);
					ops.push({ kind: 'lot_deduct', lotId: take.lotId, qty: take.take, stmt: stmtIdx });

					// Destination: merge into the matching (batch, expiry) lot or create it.
					const dest = await this.allocation.lotByIdentity(modelId, to, take.batch_no, take.expiry_date);
					let toLotId: string;
					if (dest) {
						const mergeIdx = statements.length;
						statements.push({
							sql: `UPDATE ${t.lots} SET remaining_qty = remaining_qty + ?1, updated_at = ?2 WHERE id = ?3 AND status = 'active'`,
							bindings: [take.take, now, dest.id],
						});
						guardIndex.set(mergeIdx, 'Destination lot changed while transferring — retry');
						ops.push({ kind: 'lot_merge', lotId: dest.id, qty: take.take, stmt: mergeIdx });
						toLotId = dest.id;
					} else {
						toLotId = uid();
						statements.push(
							insertSql(t.lots, {
								id: toLotId,
								model: modelId,
								location: to,
								batch_no: take.batch_no,
								expiry_date: take.expiry_date,
								remaining_qty: take.take,
								status: 'active',
								source_inbound: null,
								source_line: null,
								unit_cost: take.unit_cost,
								_meta: '{}',
								created_at: now,
								updated_at: now,
							}),
						);
						ops.push({ kind: 'delete_lot', lotId: toLotId, stmt: null });
					}
					statements.push(
						insertSql(t.transferLots, {
							id: uid(),
							transfer_id: docId,
							from_lot: take.lotId,
							to_lot: toLotId,
							qty: take.take,
							transfer_line: line.id,
							_meta: '{}',
							created_at: now,
							updated_at: now,
						}),
					);
				}
			} else if (tracking === 'serial') {
				const picks = await this.allocation.pickSerials(modelId, from, parseSerials(line.serials, `line ${idx} serials`), qty, 'transfer');
				for (const s of picks) {
					const stmtIdx = statements.length;
					statements.push({
						sql: `UPDATE ${t.serials} SET location = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'in_stock' AND location = ?4`,
						bindings: [to, now, s.id, from],
					});
					guardIndex.set(stmtIdx, `line ${idx}: serial ${s.serial_no} is no longer in stock at ${from} — retry`);
					ops.push({ kind: 'serial_move', serialId: s.id, fromLocation: from, stmt: stmtIdx });
					transferEvents.push({
						id: uid(),
						serial: s.id,
						event: 'store_transferred',
						from_location: from,
						to_location: to,
						ref_kind: 'transfer',
						ref_doc: doc.display_number ?? docId,
						by_user: approvedBy,
					});
					statements.push(
						insertSql(t.transferSerials, {
							id: uid(),
							transfer_id: docId,
							serial_id: s.id,
							transfer_line: line.id,
							_meta: '{}',
							created_at: now,
							updated_at: now,
						}),
					);
				}
			}
		}

		// Source deduction — pre-checked + guarded per (model).
		for (const d of demand.values()) {
			const existing = await this.docs.inventoryRow(d.model, from);
			if (!existing || Number(existing.qty_on_hand ?? 0) < d.qty) {
				throw new MroError(409, `${MM_INSUFFICIENT} (${from})`);
			}
			const stmtIdx = statements.length;
			statements.push({
				sql: `UPDATE ${t.inv} SET qty_on_hand = qty_on_hand - ?1, updated_at = ?2
				 WHERE id = ?3 AND deleted_at IS NULL AND qty_on_hand >= ?1`,
				bindings: [d.qty, now, existing.id],
			});
			guardIndex.set(stmtIdx, `${MM_INSUFFICIENT} (${from})`);
			ops.push({ kind: 'bal_down', invId: existing.id, qty: d.qty, stmt: stmtIdx });
		}

		// Destination receipt — guarded increment, or a fresh balance row.
		for (const b of bump.values()) {
			const existing = await this.docs.inventoryRow(b.model, to);
			if (existing) {
				const stmtIdx = statements.length;
				statements.push({
					sql: `UPDATE ${t.inv} SET qty_on_hand = qty_on_hand + ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL`,
					bindings: [b.qty, now, existing.id],
				});
				guardIndex.set(stmtIdx, 'Balance changed while transferring — retry');
				ops.push({ kind: 'bal_up', invId: existing.id, qty: b.qty, stmt: stmtIdx });
			} else {
				const invId = uid();
				statements.push(
					insertSql(t.inv, {
						id: invId,
						model: b.model,
						location: to,
						qty_on_hand: b.qty,
						reorder_level: 0,
						_meta: '{}',
						created_at: now,
						updated_at: now,
					}),
				);
				ops.push({ kind: 'delete_inv', invId, stmt: null });
			}
		}

		// Serial lifecycle history — appended atomically with the move.
		planEventInserts(t.events, transferEvents, statements, ops, now);

		const flipIdx = statements.length;
		statements.push({
			sql: `UPDATE ${t.transfer}
			 SET doc_status = 'confirmed', confirmed_at = ?1, total_qty = ?2, line_count = ?3,
			   approved_by = COALESCE(?4, approved_by), updated_at = ?5
			 WHERE id = ?6 AND COALESCE(doc_status, '') IN ('', 'draft')`,
			bindings: [now, totalQty, lineRows.length, approvedBy, now, docId],
		});
		guardIndex.set(flipIdx, 'Transfer was already confirmed or cancelled — retry');
		ops.push({ kind: 'doc_unflip', table: t.transfer, docId, fromStatus: doc.doc_status ?? null, stmt: flipIdx });
		ops.push({ kind: 'delete_links', table: t.transferLots, column: 'transfer_id', docId, stmt: null });
		ops.push({ kind: 'delete_links', table: t.transferSerials, column: 'transfer_id', docId, stmt: null });

		const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Transfer could not be confirmed');
		if (failed) throw new MroError(409, failed);

		this.docs.invalidate();
		return {
			transferId: docId,
			display_number: doc.display_number,
			doc_status: 'confirmed',
			line_count: lineRows.length,
			total_qty: totalQty,
		};
	}

	// ── Cancel — the ONE verb, decided by the DOCUMENT's own state ──────────────

	/**
	 * CANCEL a transfer — ONE entry point decided by the DOCUMENT's own state: a
	 * draft is a pure lifecycle flip (nothing ever moved), a CONFIRMED move is
	 * REVERSED, and an already-cancelled document is an idempotent no-op.
	 *
	 * The reversal reads the confirm's OWN TRACE (`mro_transfer_lots` /
	 * `mro_transfer_serials`) rather than re-deriving an allocation: re-running FEFO
	 * today would take back DIFFERENT lots than this move put at the destination, and
	 * a re-derived serial list could restore the wrong unit. Per trace row:
	 *
	 *   · the SOURCE lot gets its exact take back (an `empty` status revived);
	 *   · the DESTINATION lot is deducted by that same take — REFUSED while it no
	 *     longer holds that much, because the moved stock has been drawn on there;
	 *     a lot the confirm CREATED and this reversal empties is left inert (`empty`,
	 *     remaining 0), exactly as a source lot the confirm drained is left, so no
	 *     zero-stock lot is counted as stock by any read;
	 *   · a moved UNIT flips back to the source store — REFUSED if it has since left
	 *     `in_stock` at the destination (issued, fitted, returned, moved);
	 *   · each `(model, store)` balance moves back: the source up, the destination
	 *     down (REFUSED if the destination no longer holds what arrived);
	 *   · the trace rows and this transfer's OWN serial events are withdrawn, and the
	 *     header flips to `cancelled` (+ `cancelled_at` / `cancelled_by`) LAST — any
	 *     lost guard rolls the WHOLE batch back.
	 */
	async cancelTransfer(docId: string, actor: { cancelledBy?: string | null } = {}): Promise<Record<string, unknown>> {
		const t = this.tables;
		const doc = await this.docs.docTransfer(strId(docId, 'id'));
		if (!doc) throw new MroError(404, 'Transfer document not found');
		const status = doc.doc_status ?? 'draft';
		const cancelledBy = (actor.cancelledBy ?? '').trim() || null;

		// A second cancel is a no-op — the caller ends up holding the document's real
		// state instead of an error, so a double tap (or a retried request) is harmless.
		if (status === 'cancelled') {
			return {
				transferId: docId,
				display_number: doc.display_number,
				doc_status: 'cancelled',
				already: true,
				reversed: false,
				cancelled_at: doc.cancelled_at,
				cancelled_by: doc.cancelled_by,
			};
		}
		if (status !== 'draft' && status !== 'confirmed') throw new MroError(409, `A ${status} transfer cannot be cancelled`);

		const now = nowIso();
		const statements: { sql: string; bindings: unknown[] }[] = [];
		const ops: Op[] = [];
		const guardIndex = new Map<number, string>();

		if (status === 'draft') {
			const flipIdx = statements.length;
			statements.push({
				sql: `UPDATE ${t.transfer} SET doc_status = 'cancelled', cancelled_at = ?1, cancelled_by = ?2, updated_at = ?1
				 WHERE id = ?3 AND COALESCE(doc_status, '') IN ('', 'draft')`,
				bindings: [now, cancelledBy, docId],
			});
			guardIndex.set(flipIdx, 'This transfer was confirmed or cancelled elsewhere — reload and retry');
			ops.push({ kind: 'doc_unflip', table: t.transfer, docId, fromStatus: doc.doc_status ?? null, stmt: flipIdx });
			const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Transfer could not be cancelled');
			if (failed) throw new MroError(409, failed);
			this.docs.invalidate();
			return {
				transferId: docId,
				display_number: doc.display_number,
				doc_status: 'cancelled',
				reversed: false,
				cancelled_at: now,
				cancelled_by: cancelledBy,
			};
		}

		// ── The reversal — a CONFIRMED move, undone from its own trace ──
		const from = doc.from_location;
		const to = doc.to_location;
		if (!isLocation(from) || !isLocation(to)) throw new MroError(400, `Locations must be one of: ${MRO_LOCATIONS.join(', ')}`);

		const lineRows = await this.docs.transferLines(docId);
		if (lineRows.length === 0) throw new MroError(400, 'Transfer has no lines — nothing to reverse');
		const trace = await this.docs.transferTrace(docId);
		const refDoc = doc.display_number ?? docId;

		let totalQty = 0;
		const sourceBack = new Map<string, { model: string; qty: number }>();
		const destDown = new Map<string, { model: string; qty: number }>();
		const add = (map: Map<string, { model: string; qty: number }>, modelId: string, qty: number) => {
			const d = map.get(modelId) ?? { model: modelId, qty: 0 };
			d.qty += qty;
			map.set(modelId, d);
		};

		for (const [index, line] of lineRows.entries()) {
			const idx = index + 1;
			const modelId = strId(line.item_model, `line ${idx} item_model`);
			const qty = qtyOf(line.qty, `line ${idx} qty`);
			const model = await this.docs.resolveModel(modelId);
			const tracking = isTracking(model.tracking);
			totalQty += qty;
			add(sourceBack, modelId, qty);
			add(destDown, modelId, qty);
			const lineLots = trace.lots.filter((r) => r.transfer_line === line.id);
			const lineSerials = trace.serials.filter((r) => r.transfer_line === line.id);

			if (tracking === 'batch') {
				// The trace must account for the line EXACTLY. A shortfall means the effect is
				// not fully recorded — refuse rather than guess (a guessed restore is a silently
				// wrong balance, the one thing a reversal must never produce).
				const traced = lineLots.reduce((sum, r) => sum + Number(r.qty ?? 0), 0);
				if (traced !== qty)
					throw new MroError(
						409,
						`line ${idx}: the batch trace accounts for ${traced} of ${qty} units — this transfer's stock effect is incomplete; run the reconciliation report`,
					);
				const ids = [...lineLots.map((r) => String(r.from_lot ?? '')), ...lineLots.map((r) => String(r.to_lot ?? ''))].filter(Boolean);
				const lotRows = await this.docs.lotRowsByIds(ids);
				for (const row of lineLots) {
					const takeQty = Number(row.qty ?? 0);
					const fromId = String(row.from_lot ?? '');
					const toId = String(row.to_lot ?? '');
					const fromLot = fromId ? lotRows.get(fromId) : undefined;
					const toLot = toId ? lotRows.get(toId) : undefined;
					if (!fromLot)
						throw new MroError(409, `line ${idx}: a lot this transfer moved from no longer exists — run the reconciliation report`);
					if (!toLot) throw new MroError(409, `line ${idx}: the destination lot this transfer fed is gone — run the reconciliation report`);
					if (Number(toLot.remaining_qty ?? 0) < takeQty)
						throw new MroError(
							409,
							`line ${idx}: the transferred stock at ${to} was already drawn on (${toLot.remaining_qty} of ${takeQty} left) — clear the remainder before cancelling`,
						);

					// SOURCE lot: add the take back, revive an emptied lot. ADDITIVE, so the
					// mirror op is `lot_merge` (deduct + restore status) — never `lot_deduct`.
					let stmtIdx = statements.length;
					statements.push({
						sql: `UPDATE ${t.lots} SET remaining_qty = remaining_qty + ?1,
						 status = CASE WHEN status = 'empty' THEN 'active' ELSE status END, updated_at = ?2
						 WHERE id = ?3 AND deleted_at IS NULL`,
						bindings: [takeQty, now, fromId],
					});
					guardIndex.set(stmtIdx, `line ${idx}: a lot this transfer moved from changed while cancelling — retry`);
					ops.push({ kind: 'lot_merge', lotId: fromId, qty: takeQty, stmt: stmtIdx, restoreStatus: String(fromLot.status ?? 'active') });

					// DESTINATION lot: take the moved qty back out — the mirror of the merge/create
					// the confirm did. An emptied lot is left inert (`empty`, remaining 0).
					stmtIdx = statements.length;
					statements.push({
						sql: `UPDATE ${t.lots} SET remaining_qty = remaining_qty - ?1,
						 status = CASE WHEN remaining_qty - ?1 <= 0 THEN 'empty' ELSE status END, updated_at = ?2
						 WHERE id = ?3 AND deleted_at IS NULL AND remaining_qty >= ?1`,
						bindings: [takeQty, now, toId],
					});
					guardIndex.set(stmtIdx, `line ${idx}: a destination lot changed while cancelling — retry`);
					ops.push({ kind: 'lot_deduct', lotId: toId, qty: takeQty, stmt: stmtIdx, fromStatus: String(toLot.status ?? 'active') });
				}
			} else if (tracking === 'serial') {
				const expected = parseSerials(line.serials, `line ${idx} serials`);
				if (lineSerials.length !== expected.length || lineSerials.length !== qty)
					throw new MroError(
						409,
						`line ${idx}: the serial trace holds ${lineSerials.length} unit(s) for ${qty} — this transfer's stock effect is incomplete; run the reconciliation report`,
					);
				const seams = await this.docs.serialSeamsByIds(lineSerials.map((r) => String(r.serial_id)));
				for (const row of lineSerials) {
					const serialId = String(row.serial_id);
					const seam = seams.get(serialId);
					// A unit that has moved on since the transfer is REFUSED, never yanked: the
					// reversal must undo exactly what this document did, and nothing else.
					if (!seam)
						throw new MroError(409, `line ${idx}: a unit of this transfer is gone from the stock files — run the reconciliation report`);
					if ((seam.status ?? '') !== 'in_stock' || (seam.location ?? null) !== to)
						throw new MroError(
							409,
							`line ${idx}: ${seam.serial_no ?? 'serial'} is no longer in stock at ${to} — it has moved on since this transfer, so there is nothing left to reverse for it`,
						);
					const stmtIdx = statements.length;
					statements.push({
						sql: `UPDATE ${t.serials} SET location = ?1, updated_at = ?2
						 WHERE id = ?3 AND status = 'in_stock' AND location = ?4 AND deleted_at IS NULL`,
						bindings: [from, now, serialId, to],
					});
					guardIndex.set(stmtIdx, `line ${idx}: a unit of this transfer moved while cancelling — retry`);
					ops.push({ kind: 'serial_move', serialId, fromLocation: to, stmt: stmtIdx });
				}
			}
		}

		// Withdraw this transfer's trace rows (what actually moved) — one delete per table,
		// restored verbatim if a later guard loses.
		if (trace.lots.length > 0) {
			const stmtIdx = statements.length;
			statements.push({ sql: `DELETE FROM ${t.transferLots} WHERE transfer_id = ?1`, bindings: [docId] });
			ops.push({
				kind: 'restore_rows',
				table: t.transferLots,
				rows: trace.lots as unknown as Array<Record<string, unknown>>,
				stmt: stmtIdx,
			});
		}
		if (trace.serials.length > 0) {
			const stmtIdx = statements.length;
			statements.push({ sql: `DELETE FROM ${t.transferSerials} WHERE transfer_id = ?1`, bindings: [docId] });
			ops.push({
				kind: 'restore_rows',
				table: t.transferSerials,
				rows: trace.serials as unknown as Array<Record<string, unknown>>,
				stmt: stmtIdx,
			});
		}

		// This transfer's OWN serial events go with it. A `checked` reading taken while the
		// unit sat elsewhere is a measurement of the physical unit and STAYS.
		const movedSerialIds = trace.serials.map((r) => String(r.serial_id));
		if (movedSerialIds.length > 0) {
			const binds = movedSerialIds.map((_, i) => `?${i + 1}`);
			const docSlot = `?${movedSerialIds.length + 1}`;
			const mine = await this.db.all<Record<string, unknown>>({
				sql: `SELECT * FROM ${t.events} WHERE serial IN (${binds.join(', ')}) AND deleted_at IS NULL AND ref_doc IS ${docSlot}`,
				bindings: [...movedSerialIds, refDoc],
			});
			if (mine.length > 0) {
				const stmtIdx = statements.length;
				statements.push({
					sql: `DELETE FROM ${t.events} WHERE id IN (${mine.map((_, i) => `?${i + 1}`).join(', ')})`,
					bindings: mine.map((r) => String(r.id)),
				});
				ops.push({ kind: 'restore_rows', table: t.events, rows: mine, stmt: stmtIdx });
			}
		}

		// Balances: the source goes back up, the destination comes back down.
		for (const b of sourceBack.values()) {
			const existing = await this.docs.inventoryRow(b.model, from);
			if (!existing) throw new MroError(409, `No stock balance at ${from} to restore — run the reconciliation report`);
			const stmtIdx = statements.length;
			statements.push({
				sql: `UPDATE ${t.inv} SET qty_on_hand = qty_on_hand + ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL`,
				bindings: [b.qty, now, existing.id],
			});
			guardIndex.set(stmtIdx, `The balance at ${from} changed while cancelling — retry`);
			ops.push({ kind: 'bal_up', invId: existing.id, qty: b.qty, stmt: stmtIdx });
		}
		for (const b of destDown.values()) {
			const existing = await this.docs.inventoryRow(b.model, to);
			if (!existing || Number(existing.qty_on_hand ?? 0) < b.qty)
				throw new MroError(409, `The stock this transfer moved into ${to} was already drawn on — clear the remainder before cancelling`);
			const stmtIdx = statements.length;
			statements.push({
				sql: `UPDATE ${t.inv} SET qty_on_hand = qty_on_hand - ?1, updated_at = ?2
				 WHERE id = ?3 AND deleted_at IS NULL AND qty_on_hand >= ?1`,
				bindings: [b.qty, now, existing.id],
			});
			guardIndex.set(stmtIdx, `${MM_INSUFFICIENT} (${to})`);
			ops.push({ kind: 'bal_down', invId: existing.id, qty: b.qty, stmt: stmtIdx });
		}

		// Header flip LAST — the whole-batch business guard.
		const flipIdx = statements.length;
		statements.push({
			sql: `UPDATE ${t.transfer} SET doc_status = 'cancelled', cancelled_at = ?1, cancelled_by = ?2, updated_at = ?1
			 WHERE id = ?3 AND doc_status = 'confirmed'`,
			bindings: [now, cancelledBy, docId],
		});
		guardIndex.set(flipIdx, 'Transfer was already reversed or cancelled — retry');
		ops.push({ kind: 'doc_unflip', table: t.transfer, docId, fromStatus: 'confirmed', stmt: flipIdx });

		const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Transfer could not be reversed');
		if (failed) throw new MroError(409, failed);

		this.docs.invalidate();
		return {
			transferId: docId,
			display_number: doc.display_number,
			doc_status: 'cancelled',
			reversed: true,
			reversed_qty: totalQty,
			line_count: lineRows.length,
			cancelled_at: now,
			cancelled_by: cancelledBy,
		};
	}
}
