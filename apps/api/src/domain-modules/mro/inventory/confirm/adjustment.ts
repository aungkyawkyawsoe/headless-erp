/**
 * Confirm — adjustment (a reported correction an approver authorizes). Moved verbatim
 * out of `inventory.service.ts`, which now delegates here so its public surface is
 * unchanged; runs on the shared `MroContext`.
 */
import { dateOrNull, isLocation, isTracking, nowIso, parseSerials, qtyOf, strId, uid } from '../codecs';
import { moneyOrNull } from '../money';
import { insertSql, planEventInserts } from '../guarded-batch';
import type { Op, SerialEventSeed } from '../guarded-batch';
import { MM_INSUFFICIENT, MRO_LOCATIONS, MroError } from '../types';
import type { MroContext } from '../context';

export class AdjustmentConfirm {
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

	// ── Confirm — adjustment (report → authorize applies signed changes) ────

	/**
	 * Apply a draft stock adjustment: an operator's reported correction to the
	 * header location, in ONE atomic batch. Per line (direction add/remove, by
	 * the model's tracking policy):
	 *   add · standard    — balance rises by qty (creates the row when new);
	 *   add · batch       — a new lot (batch_no required, expiry optional) raises it;
	 *   add · serial      — refused: a serial unit needs a source serial, so route
	 *                       the receipt through an inbound (clear 400);
	 *   remove · standard — guarded balance deduction (409 when short/absent);
	 *   remove · batch    — lots written off FEFO, balance lowered;
	 *   remove · serial   — the exact units flip out of stock (409 not in stock).
	 * Authorization is the approval: the acting employee (approved_by) MUST differ
	 * from the reporter (reported_by) and is what flips the doc + applies stock.
	 * Each line records the expected_qty/diff_qty it reconciled. Guard failure
	 * reverses everything (409); replay of an approved doc is a no-op.
	 */
	async confirmAdjustment(docId: string, approver: { approvedBy?: string | null } = {}): Promise<Record<string, unknown>> {
		const t = this.tables;
		const doc = await this.docs.docAdjustment(strId(docId, 'id'));
		if (!doc) throw new MroError(404, 'Adjustment document not found');
		const status = doc.doc_status ?? 'draft';
		if (status === 'confirmed') {
			const re = await this.db.first<Record<string, unknown>>({
				sql: `SELECT display_number, total_qty, line_count FROM ${t.adjustment} WHERE id = ?1`,
				bindings: [docId],
			});
			return { adjustmentId: docId, already: true, doc_status: 'confirmed', ...(re ?? {}) };
		}
		if (status === 'cancelled') throw new MroError(409, 'Cancelled adjustment cannot be authorized');
		if (status !== 'draft') throw new MroError(409, `Only draft documents can be authorized (current: ${status})`);

		// Two-person rule: the acting approver must be present and not the reporter.
		const reportedBy = (doc.reported_by ?? '').trim();
		const approvedBy = (approver.approvedBy ?? '').trim();
		if (!reportedBy) throw new MroError(400, 'Adjustment is missing its reporter');
		if (!approvedBy) throw new MroError(400, 'An adjustment must be approved — pass the approving employee id');
		if (approvedBy === reportedBy) throw new MroError(409, 'An adjustment must be approved by a different employee than its reporter');

		const location = doc.location;
		if (!isLocation(location)) throw new MroError(400, `Location must be one of: ${MRO_LOCATIONS.join(', ')}`);

		const lineRows = await this.docs.adjustmentLines(docId);
		if (lineRows.length === 0) throw new MroError(400, 'Adjustment has no lines — add at least one before authorizing');

		const now = nowIso();
		const statements: { sql: string; bindings: unknown[] }[] = [];
		const ops: Op[] = [];
		const adjustmentEvents: SerialEventSeed[] = [];
		const guardIndex = new Map<number, string>();
		// (model) planned balance increase vs decrease (one header location).
		const bump = new Map<string, number>();
		const demand = new Map<string, number>();
		const add = (map: Map<string, number>, modelId: string, qty: number) => map.set(modelId, (map.get(modelId) ?? 0) + qty);

		let totalQty = 0;

		for (const [index, line] of lineRows.entries()) {
			const idx = index + 1;
			const modelId = strId(line.item_model, `line ${idx} item_model`);
			const qty = qtyOf(line.qty, `line ${idx} qty`);
			const direction = line.direction === 'remove' ? 'remove' : line.direction === 'add' ? 'add' : null;
			if (!direction) throw new MroError(400, `line ${idx}: direction must be 'add' or 'remove'`);
			const model = await this.docs.resolveModel(modelId);
			const tracking = isTracking(model.tracking);
			const invRow = await this.docs.inventoryRow(modelId, location);
			const onHand = Number(invRow?.qty_on_hand ?? 0);
			totalQty += qty;

			// Audit on the confirmed line: the on-hand it corrected + the delta applied.
			statements.push({
				sql: `UPDATE ${t.adjustmentLines} SET expected_qty = ?1, diff_qty = ?2 WHERE id = ?3`,
				bindings: [onHand, direction === 'add' ? qty : -qty, line.id],
			});
			ops.push({
				kind: 'line_restore',
				lineId: line.id,
				expectedQty: line.expected_qty ?? null,
				diffQty: line.diff_qty ?? null,
				stmt: null,
			});

			if (direction === 'add') {
				if (tracking === 'serial') {
					throw new MroError(400, `line ${idx}: serial models can't be added through an adjustment — receive them via an inbound instead`);
				}
				if (tracking === 'batch') {
					const batchNo = (line.batch_no ?? '').trim();
					if (!batchNo) throw new MroError(400, `line ${idx}: adding batch stock needs a batch_no`);
					const lotId = uid();
					statements.push(
						insertSql(t.lots, {
							id: lotId,
							model: modelId,
							location,
							batch_no: batchNo,
							expiry_date: dateOrNull(line.expiry_date),
							remaining_qty: qty,
							status: 'active',
							source_inbound: null,
							source_line: null,
							unit_cost: moneyOrNull(line.unit_cost),
							_meta: `{"adjustment":${JSON.stringify(doc.display_number ?? docId)}}`,
							created_at: now,
							updated_at: now,
						}),
					);
					ops.push({ kind: 'delete_lot', lotId, stmt: null });
					// TRACE: the lot this line created. The reversal deletes exactly this row
					// — an added lot can never be undone by re-deriving anything.
					statements.push(
						insertSql(t.adjustmentLots, {
							id: uid(),
							adjustment_id: docId,
							lot_id: lotId,
							direction: 'add',
							qty,
							adjustment_line: line.id,
							_meta: '{}',
							created_at: now,
							updated_at: now,
						}),
					);
				}
				add(bump, modelId, qty);
			} else {
				if (tracking === 'batch') {
					const alloc = await this.allocation.allocateLots(modelId, location, qty, 'write_offs');
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
						// TRACE: which lot this FEFO take came out of, so the reversal puts the
						// qty back into THAT lot instead of guessing (or re-running FEFO).
						statements.push(
							insertSql(t.adjustmentLots, {
								id: uid(),
								adjustment_id: docId,
								lot_id: take.lotId,
								direction: 'remove',
								qty: take.take,
								adjustment_line: line.id,
								_meta: '{}',
								created_at: now,
								updated_at: now,
							}),
						);
					}
				} else if (tracking === 'serial') {
					const picks = await this.allocation.pickSerials(
						modelId,
						location,
						parseSerials(line.serials, `line ${idx} serials`),
						qty,
						'write_offs',
					);
					for (const s of picks) {
						const stmtIdx = statements.length;
						statements.push({
							sql: `UPDATE ${t.serials} SET status = 'scrapped', updated_at = ?1 WHERE id = ?2 AND status = 'in_stock'`,
							bindings: [now, s.id],
						});
						guardIndex.set(stmtIdx, `line ${idx}: serial ${s.serial_no} is no longer in stock — retry`);
						ops.push({ kind: 'serial_flip', serialId: s.id, fromStatus: 'in_stock', stmt: stmtIdx });
						// TRACE: exactly which unit this line removed.
						statements.push(
							insertSql(t.adjustmentSerials, {
								id: uid(),
								adjustment_id: docId,
								serial_id: s.id,
								adjustment_line: line.id,
								_meta: '{}',
								created_at: now,
								updated_at: now,
							}),
						);
						adjustmentEvents.push({
							id: uid(),
							serial: s.id,
							event: 'adjusted',
							from_location: location,
							ref_kind: 'adjustment',
							ref_doc: doc.display_number ?? docId,
							by_user: approvedBy,
							note: doc.description ?? null,
						});
					}
				}
				add(demand, modelId, qty);
			}
		}

		// Balance increases (adds) — create the row if the model/store pair is new.
		for (const [modelId, qty] of bump) {
			const existing = await this.docs.inventoryRow(modelId, location);
			if (existing) {
				const stmtIdx = statements.length;
				statements.push({
					sql: `UPDATE ${t.inv} SET qty_on_hand = qty_on_hand + ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL`,
					bindings: [qty, now, existing.id],
				});
				guardIndex.set(stmtIdx, 'Balance changed while authorizing — retry');
				ops.push({ kind: 'bal_up', invId: existing.id, qty, stmt: stmtIdx });
			} else {
				const invId = uid();
				statements.push(
					insertSql(t.inv, {
						id: invId,
						model: modelId,
						location,
						qty_on_hand: qty,
						reorder_level: 0,
						_meta: '{}',
						created_at: now,
						updated_at: now,
					}),
				);
				ops.push({ kind: 'delete_inv', invId, stmt: null });
			}
		}

		// Balance decreases (removes) — pre-checked + guarded per model.
		for (const [modelId, qty] of demand) {
			const existing = await this.docs.inventoryRow(modelId, location);
			if (!existing || Number(existing.qty_on_hand ?? 0) < qty) throw new MroError(409, `${MM_INSUFFICIENT} (${location})`);
			const stmtIdx = statements.length;
			statements.push({
				sql: `UPDATE ${t.inv} SET qty_on_hand = qty_on_hand - ?1, updated_at = ?2
				 WHERE id = ?3 AND deleted_at IS NULL AND qty_on_hand >= ?1`,
				bindings: [qty, now, existing.id],
			});
			guardIndex.set(stmtIdx, `${MM_INSUFFICIENT} (${location})`);
			ops.push({ kind: 'bal_down', invId: existing.id, qty, stmt: stmtIdx });
		}

		// Serial lifecycle history — appended atomically with the serial state changes.
		planEventInserts(t.events, adjustmentEvents, statements, ops, now);

		// Header flip LAST — records the approver in the same guarded batch.
		const flipIdx = statements.length;
		statements.push({
			sql: `UPDATE ${t.adjustment}
			 SET doc_status = 'confirmed', confirmed_at = ?1, total_qty = ?2, line_count = ?3,
			   approved_by = COALESCE(?4, approved_by), updated_at = ?5
			 WHERE id = ?6 AND COALESCE(doc_status, '') IN ('', 'draft')`,
			bindings: [now, totalQty, lineRows.length, approvedBy, now, docId],
		});
		guardIndex.set(flipIdx, 'Adjustment was already approved or cancelled — retry');
		ops.push({ kind: 'doc_unflip', table: t.adjustment, docId, fromStatus: doc.doc_status ?? null, stmt: flipIdx });
		// The adjustment's own trace rows go with a confirm that did not land, exactly
		// like the outbound's — a failed approval must leave no trace claiming an effect.
		ops.push({ kind: 'delete_links', table: t.adjustmentLots, column: 'adjustment_id', docId, stmt: null });
		ops.push({ kind: 'delete_links', table: t.adjustmentSerials, column: 'adjustment_id', docId, stmt: null });

		const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Adjustment could not be approved');
		if (failed) throw new MroError(409, failed);

		this.docs.invalidate();
		return {
			adjustmentId: docId,
			display_number: doc.display_number,
			doc_status: 'confirmed',
			line_count: lineRows.length,
			total_qty: totalQty,
		};
	}

	/**
	 * CANCEL an adjustment — ONE entry point decided by the DOCUMENT's own state: a
	 * draft is a pure lifecycle flip (nothing was applied), an APPROVED adjustment is
	 * REVERSED from its own trace (`mro_adjustment_lots` / `mro_adjustment_serials`),
	 * and an already-cancelled document is an idempotent no-op.
	 *
	 *   · a line's ADD returns its created lot whole (REFUSED while that lot has been
	 *     drawn on — the added stock is gone, so there is no whole lot to take back)
	 *     and lowers the balance by the same qty;
	 *   · a line's REMOVE puts the exact FEFO takes back into the lots they came from
	 *     and raises the balance;
	 *   · a REMOVE of serial units returns those units to `in_stock` at the store —
	 *     REFUSED if a unit is no longer `scrapped` or has since been held;
	 *   · the lines' confirm-written `expected_qty` / `diff_qty` audit is cleared;
	 *   · the header flips to `cancelled` (+ `cancelled_at` / `cancelled_by`) LAST, and
	 *     any lost guard rolls the wholesale reversal back.
	 */
	async cancelAdjustment(docId: string, actor: { cancelledBy?: string | null } = {}): Promise<Record<string, unknown>> {
		const t = this.tables;
		const doc = await this.docs.docAdjustment(strId(docId, 'id'));
		if (!doc) throw new MroError(404, 'Adjustment document not found');
		const status = doc.doc_status ?? 'draft';
		const cancelledBy = (actor.cancelledBy ?? '').trim() || null;

		if (status === 'cancelled') {
			return {
				adjustmentId: docId,
				display_number: doc.display_number,
				doc_status: 'cancelled',
				already: true,
				reversed: false,
				cancelled_at: doc.cancelled_at,
				cancelled_by: doc.cancelled_by,
			};
		}
		if (status !== 'draft' && status !== 'confirmed') throw new MroError(409, `A ${status} adjustment cannot be cancelled`);

		const now = nowIso();
		const statements: { sql: string; bindings: unknown[] }[] = [];
		const ops: Op[] = [];
		const guardIndex = new Map<number, string>();

		if (status === 'draft') {
			const flipIdx = statements.length;
			statements.push({
				sql: `UPDATE ${t.adjustment} SET doc_status = 'cancelled', cancelled_at = ?1, cancelled_by = ?2, updated_at = ?1
				 WHERE id = ?3 AND COALESCE(doc_status, '') IN ('', 'draft')`,
				bindings: [now, cancelledBy, docId],
			});
			guardIndex.set(flipIdx, 'This adjustment was approved or cancelled elsewhere — reload and retry');
			ops.push({ kind: 'doc_unflip', table: t.adjustment, docId, fromStatus: doc.doc_status ?? null, stmt: flipIdx });
			const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Adjustment could not be cancelled');
			if (failed) throw new MroError(409, failed);
			this.docs.invalidate();
			return {
				adjustmentId: docId,
				display_number: doc.display_number,
				doc_status: 'cancelled',
				reversed: false,
				cancelled_at: now,
				cancelled_by: cancelledBy,
			};
		}

		// ── The reversal — an APPROVED adjustment, undone from its own trace ──
		const location = doc.location;
		if (!isLocation(location)) throw new MroError(400, `Location must be one of: ${MRO_LOCATIONS.join(', ')}`);
		const lineRows = await this.docs.adjustmentLines(docId);
		if (lineRows.length === 0) throw new MroError(400, 'Adjustment has no lines — nothing to reverse');
		const trace = await this.docs.adjustmentTrace(docId);
		const refDoc = doc.display_number ?? docId;

		// modelId → balance movement to apply (adds come DOWN, removes go UP).
		const down = new Map<string, number>();
		const up = new Map<string, number>();
		const bumpBy = (map: Map<string, number>, modelId: string, qty: number) => map.set(modelId, (map.get(modelId) ?? 0) + qty);

		for (const [index, line] of lineRows.entries()) {
			const idx = index + 1;
			const modelId = strId(line.item_model, `line ${idx} item_model`);
			const qty = qtyOf(line.qty, `line ${idx} qty`);
			const direction = line.direction === 'remove' ? 'remove' : line.direction === 'add' ? 'add' : null;
			if (!direction) throw new MroError(400, `line ${idx}: direction must be 'add' or 'remove'`);
			const model = await this.docs.resolveModel(modelId);
			const tracking = isTracking(model.tracking);

			// The confirm-written audit on the line is cleared — the document no longer
			// claims to have applied anything.
			statements.push({
				sql: `UPDATE ${t.adjustmentLines} SET expected_qty = NULL, diff_qty = NULL WHERE id = ?1`,
				bindings: [line.id],
			});
			ops.push({
				kind: 'line_restore',
				lineId: line.id,
				expectedQty: line.expected_qty ?? null,
				diffQty: line.diff_qty ?? null,
				stmt: null,
			});

			const lineLots = trace.lots.filter((r) => r.adjustment_line === line.id);
			const lineSerials = trace.serials.filter((r) => r.adjustment_line === line.id);

			if (tracking === 'batch') {
				const traced = lineLots.reduce((sum, r) => sum + Number(r.qty ?? 0), 0);
				if (traced !== qty)
					throw new MroError(
						409,
						`line ${idx}: the batch trace accounts for ${traced} of ${qty} units — this adjustment's stock effect is incomplete; run the reconciliation report`,
					);
				const lotRows = await this.docs.lotRowsByIds(lineLots.map((r) => String(r.lot_id)));
				for (const take of lineLots) {
					const lotId = String(take.lot_id);
					const takeQty = Number(take.qty ?? 0);
					const lot = lotRows.get(lotId);
					if (!lot) throw new MroError(409, `line ${idx}: a lot this adjustment touched no longer exists — run the reconciliation report`);
					if (direction === 'add') {
						// The lot this line CREATED. It can only be taken back whole: partly used
						// stock is not ours to delete.
						if (Number(lot.remaining_qty ?? 0) !== takeQty)
							throw new MroError(
								409,
								`line ${idx}: stock added by this adjustment was already used (${lot.remaining_qty} of ${takeQty} left) — clear the remainder before cancelling`,
							);
						const stmtIdx = statements.length;
						statements.push({
							sql: `DELETE FROM ${t.lots} WHERE id = ?1 AND remaining_qty = ?2 AND deleted_at IS NULL`,
							bindings: [lotId, takeQty],
						});
						guardIndex.set(stmtIdx, `line ${idx}: the added lot changed while cancelling — retry`);
						ops.push({ kind: 'restore_lot', row: lot, stmt: stmtIdx });
					} else {
						const stmtIdx = statements.length;
						statements.push({
							sql: `UPDATE ${t.lots} SET remaining_qty = remaining_qty + ?1,
							 status = CASE WHEN status = 'empty' THEN 'active' ELSE status END, updated_at = ?2
							 WHERE id = ?3 AND deleted_at IS NULL`,
							bindings: [takeQty, now, lotId],
						});
						guardIndex.set(stmtIdx, `line ${idx}: a lot this adjustment took from changed while cancelling — retry`);
						// ADDITIVE write (`remaining_qty + take`, `empty → active`) — its mirror is
						// `lot_merge` (deduct + restore status), never `lot_deduct` (which ADDS).
						ops.push({ kind: 'lot_merge', lotId, qty: takeQty, stmt: stmtIdx, restoreStatus: String(lot.status ?? 'active') });
					}
				}
			} else if (tracking === 'serial') {
				if (direction === 'add')
					throw new MroError(409, `line ${idx}: an adjustment can never have added serial units — run the reconciliation report`);
				if (lineSerials.length !== qty)
					throw new MroError(
						409,
						`line ${idx}: the serial trace holds ${lineSerials.length} unit(s) for ${qty} — this adjustment's stock effect is incomplete; run the reconciliation report`,
					);
				const seams = await this.docs.serialSeamsByIds(lineSerials.map((r) => String(r.serial_id)));
				for (const pick of lineSerials) {
					const serialId = String(pick.serial_id);
					const seam = seams.get(serialId);
					if (!seam)
						throw new MroError(409, `line ${idx}: a unit of this adjustment is gone from the stock files — run the reconciliation report`);
					if ((seam.status ?? '') !== 'scrapped')
						throw new MroError(
							409,
							`line ${idx}: ${seam.serial_no ?? 'serial'} is ${seam.status ?? 'unknown'} now, not scrapped — it has moved on since this adjustment`,
						);
					if (seam.vehicle || seam.slot || seam.employee)
						throw new MroError(
							409,
							`line ${idx}: ${seam.serial_no ?? 'serial'} has since been put in service — it cannot be brought back by cancelling`,
						);
					const stmtIdx = statements.length;
					statements.push({
						sql: `UPDATE ${t.serials} SET status = 'in_stock', location = ?1, updated_at = ?2
						 WHERE id = ?3 AND status = 'scrapped' AND deleted_at IS NULL`,
						bindings: [location, now, serialId],
					});
					guardIndex.set(stmtIdx, `line ${idx}: a unit of this adjustment moved while cancelling — retry`);
					ops.push({
						kind: 'serial_restore',
						serialId,
						status: seam.status,
						location: seam.location,
						vehicle: seam.vehicle,
						slot: seam.slot,
						employee: seam.employee,
						stmt: stmtIdx,
					});
				}
			}

			if (direction === 'add') bumpBy(down, modelId, qty);
			else bumpBy(up, modelId, qty);
		}

		// Withdraw the trace rows this adjustment wrote.
		if (trace.lots.length > 0) {
			const stmtIdx = statements.length;
			statements.push({ sql: `DELETE FROM ${t.adjustmentLots} WHERE adjustment_id = ?1`, bindings: [docId] });
			ops.push({
				kind: 'restore_rows',
				table: t.adjustmentLots,
				rows: trace.lots as unknown as Array<Record<string, unknown>>,
				stmt: stmtIdx,
			});
		}
		if (trace.serials.length > 0) {
			const stmtIdx = statements.length;
			statements.push({ sql: `DELETE FROM ${t.adjustmentSerials} WHERE adjustment_id = ?1`, bindings: [docId] });
			ops.push({
				kind: 'restore_rows',
				table: t.adjustmentSerials,
				rows: trace.serials as unknown as Array<Record<string, unknown>>,
				stmt: stmtIdx,
			});
			const ids = trace.serials.map((r) => String(r.serial_id));
			const binds = ids.map((_, i) => `?${i + 1}`);
			const mine = await this.db.all<Record<string, unknown>>({
				sql: `SELECT * FROM ${t.events} WHERE serial IN (${binds.join(', ')}) AND deleted_at IS NULL AND ref_doc IS ?${ids.length + 1}`,
				bindings: [...ids, refDoc],
			});
			if (mine.length > 0) {
				const evIdx = statements.length;
				statements.push({
					sql: `DELETE FROM ${t.events} WHERE id IN (${mine.map((_, i) => `?${i + 1}`).join(', ')})`,
					bindings: mine.map((r) => String(r.id)),
				});
				ops.push({ kind: 'restore_rows', table: t.events, rows: mine, stmt: evIdx });
			}
		}

		// Balances: an add came down, a remove went up.
		for (const [modelId, qty] of down) {
			const existing = await this.docs.inventoryRow(modelId, location);
			if (!existing || Number(existing.qty_on_hand ?? 0) < qty)
				throw new MroError(409, `${MM_INSUFFICIENT} (${location}) — stock added by this adjustment was already used`);
			const stmtIdx = statements.length;
			statements.push({
				sql: `UPDATE ${t.inv} SET qty_on_hand = qty_on_hand - ?1, updated_at = ?2
				 WHERE id = ?3 AND deleted_at IS NULL AND qty_on_hand >= ?1`,
				bindings: [qty, now, existing.id],
			});
			guardIndex.set(stmtIdx, `${MM_INSUFFICIENT} (${location})`);
			ops.push({ kind: 'bal_down', invId: existing.id, qty, stmt: stmtIdx });
		}
		for (const [modelId, qty] of up) {
			const existing = await this.docs.inventoryRow(modelId, location);
			if (!existing) throw new MroError(409, `No stock balance at ${location} to restore — run the reconciliation report`);
			const stmtIdx = statements.length;
			statements.push({
				sql: `UPDATE ${t.inv} SET qty_on_hand = qty_on_hand + ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL`,
				bindings: [qty, now, existing.id],
			});
			guardIndex.set(stmtIdx, `The balance at ${location} changed while cancelling — retry`);
			ops.push({ kind: 'bal_up', invId: existing.id, qty, stmt: stmtIdx });
		}

		// Header flip LAST — the whole-batch business guard.
		const flipIdx = statements.length;
		statements.push({
			sql: `UPDATE ${t.adjustment} SET doc_status = 'cancelled', cancelled_at = ?1, cancelled_by = ?2, updated_at = ?1
			 WHERE id = ?3 AND doc_status = 'confirmed'`,
			bindings: [now, cancelledBy, docId],
		});
		guardIndex.set(flipIdx, 'Adjustment was already reversed or cancelled — retry');
		ops.push({ kind: 'doc_unflip', table: t.adjustment, docId, fromStatus: 'confirmed', stmt: flipIdx });

		const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Adjustment could not be reversed');
		if (failed) throw new MroError(409, failed);

		this.docs.invalidate();
		return {
			adjustmentId: docId,
			display_number: doc.display_number,
			doc_status: 'cancelled',
			reversed: true,
			reversed_qty: [...lineRows].reduce((sum, l) => sum + Number(l.qty ?? 0), 0),
			line_count: lineRows.length,
			cancelled_at: now,
			cancelled_by: cancelledBy,
		};
	}
}
