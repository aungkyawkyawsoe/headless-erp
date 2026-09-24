/**
 * Confirm — stock in (a draft inbound's stock effect, and its reversal). Moved
 * verbatim out of `inventory.service.ts`, which now delegates here so its public
 * surface is unchanged; runs on the shared `MroContext`.
 */
import { todayMmtDate } from '@mmbix/utils';
import { dateOrNull, isInboundType, isLocation, isTracking, nowIso, parseSerials, qtyOf, strId, uid } from '../codecs';
import { moneyOrNull, round2 } from '../money';
import { insertManySql, insertSql, planEventInserts } from '../guarded-batch';
import type { Op, SerialEventSeed } from '../guarded-batch';
import { MRO_LOCATIONS, MroError, PAID_AT_RECEIPT_SOURCE } from '../types';
import type { DocRow, SerialRow } from '../types';
import type { MroContext } from '../context';

/**
 * The `method` a PAID-AT-RECEIPT confirm records on its ledger entry — mirrors the
 * collection's DECLARED default (`mro_inbound_payments.method` in
 * schema-defs.json), because this write bypasses the generic API that would apply
 * it: a receipt paid at the counter is cash. Keep the two in step.
 */
const RECEIPT_PAYMENT_METHOD = 'cash';

/** The entry's own explanation — the payment sheet renders it under the amount. */
const PAID_AT_RECEIPT_NOTE = 'Paid in full at receipt';

export class InboundConfirm {
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

	// ── Confirm — stock in ─────────────────────────────────────────────────

	/**
	 * Confirm a draft inbound. One atomic batch: per-line stock effect
	 * (lot rows / serial rows / re-instock of returned serials) + balance moves
	 * + header totals + `doc_status='confirmed'`. Guards + reversal → 409 with
	 * no partial state; replay of an already-confirmed doc is a no-op. The session
	 * actor (`receivedBy`) is stamped on the header so a receipt records WHO booked
	 * the stock in, mirroring `mro_outbounds.issued_by` (Repudiation guard) — and it
	 * rides each serial event's `by_user` too, so the tyre timeline's actor is the
	 * same person the header names rather than an anonymous receipt.
	 */
	async confirmInbound(docId: string, receiver: { receivedBy?: string | null } = {}): Promise<Record<string, unknown>> {
		const t = this.tables;
		const doc = await this.docs.docIn(strId(docId, 'id'));
		if (!doc) throw new MroError(404, 'Inbound document not found');
		const status = doc.doc_status ?? 'draft';
		// WHO booked the stock in — the actor this confirm was handed (the signed session
		// in the app, an explicit id for an admin/CLI caller). It is the same value the
		// header stamps below, so the events and the header can never tell two stories.
		const receivedBy = (receiver.receivedBy ?? '').trim() || null;
		if (status === 'confirmed') {
			const re = await this.db.first<Record<string, unknown>>({
				sql: `SELECT display_number, total_qty, line_count, total_amount FROM ${t.inbound} WHERE id = ?1`,
				bindings: [docId],
			});
			return { inboundId: docId, already: true, doc_status: 'confirmed', ...(re ?? {}) };
		}
		if (status === 'cancelled') throw new MroError(409, 'Cancelled inbound cannot be confirmed');
		if (status !== 'draft') throw new MroError(409, `Only draft documents can be confirmed (current: ${status})`);
		const type = isInboundType(doc.type) ? doc.type : 'purchase';
		const defaultLocation = doc.location;
		if (!isLocation(defaultLocation)) throw new MroError(400, `Inbound location must be one of: ${MRO_LOCATIONS.join(', ')}`);

		const lineRows = await this.docs.inLines(docId);
		if (lineRows.length === 0) throw new MroError(400, 'Inbound has no lines — add at least one line before confirming');

		const now = nowIso();
		const statements: { sql: string; bindings: unknown[] }[] = [];
		const ops: Op[] = [];
		const inboundEvents: SerialEventSeed[] = [];
		const guardIndex = new Map<number, string>(); // statement index → user message when it matched 0 rows

		// (model|location) → planned balance increase
		const balance = new Map<string, { model: string; location: string; qty: number }>();
		const bump = (modelId: string, location: string, qty: number) => {
			const key = `${modelId}|${location}`;
			const b = balance.get(key) ?? { model: modelId, location, qty: 0 };
			b.qty += qty;
			balance.set(key, b);
		};

		let totalQty = 0;
		let totalAmount = 0;

		for (const [index, line] of lineRows.entries()) {
			const idx = index + 1;
			const modelId = strId(line.item_model, `line ${idx} item_model`);
			const qty = qtyOf(line.qty, `line ${idx} qty`);
			const location = line.location && isLocation(line.location) ? line.location : defaultLocation;
			const model = await this.docs.resolveModel(modelId);
			const tracking = isTracking(model.tracking);
			const unitPrice = moneyOrNull(line.unit_price);
			const expiry = dateOrNull(line.expiry_date);
			totalQty += qty;
			totalAmount += qty * (unitPrice ?? 0);

			if (tracking === 'standard') {
				bump(modelId, location, qty);
			} else if (tracking === 'batch') {
				const stamp = `${String(Date.now()).slice(-5)}${Math.random().toString(36).slice(2, 4)}`;
				const batchNo = line.batch_no?.trim() || `B-${String(doc.purchase_date ?? todayMmtDate()).replaceAll('-', '')}-${stamp}`;
				const lotId = uid();
				statements.push(
					insertSql(t.lots, {
						id: lotId,
						model: modelId,
						location,
						batch_no: batchNo,
						expiry_date: expiry,
						remaining_qty: qty,
						status: 'active',
						source_inbound: docId,
						source_line: line.id,
						unit_cost: unitPrice,
						_meta: '{}',
						created_at: now,
						updated_at: now,
					}),
				);
				ops.push({ kind: 'delete_lot', lotId, stmt: null });
				bump(modelId, location, qty);
			} else {
				// serial policy
				const serials = parseSerials(line.serials, `line ${idx} serials`);
				if (serials.length !== qty) {
					throw new MroError(400, `line ${idx}: serial model — serials must list exactly ${qty} serial(s), got ${serials.length}`);
				}
				if (new Set(serials).size !== serials.length) throw new MroError(400, `line ${idx}: serials contains duplicates`);

				if (type === 'return') {
					// Re-instock previously-issued units — never duplicate a serial.
					const existing = await this.docs.serialRowsByNo(serials);
					const problems: string[] = [];
					const picks: SerialRow[] = [];
					for (const serialNo of serials) {
						const row = existing.get(serialNo);
						if (!row) problems.push(`${serialNo} (not found)`);
						else if (row.status === 'scrapped') problems.push(`${serialNo} (scrapped — cannot return)`);
						else if (row.status === 'in_stock' && row.location === location) problems.push(`${serialNo} (already in stock here)`);
						else if (row.status === 'in_stock') problems.push(`${serialNo} (in stock at ${row.location} — use a transfer)`);
						else picks.push(row);
					}
					if (problems.length > 0) throw new MroError(409, `Cannot return: ${problems.join(', ')}`);
					for (const s of picks) {
						const stmtIdx = statements.length;
						statements.push({
							sql: `UPDATE ${t.serials} SET status = 'in_stock', location = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'issued'`,
							bindings: [location, now, s.id],
						});
						guardIndex.set(stmtIdx, `line ${idx}: serial ${s.serial_no} is no longer issued — retry`);
						ops.push({ kind: 'return_flip', serialId: s.id, fromStatus: 'issued', fromLocation: s.location, stmt: stmtIdx });
						inboundEvents.push({
							id: uid(),
							serial: s.id,
							event: 'returned',
							from_location: s.location,
							to_location: location,
							ref_kind: 'return',
							ref_doc: doc.display_number ?? docId,
							by_user: receivedBy,
						});
					}
					bump(modelId, location, serials.length);
				} else {
					const conflicts = await this.docs.existingSerials(serials);
					if (conflicts.length > 0) {
						throw new MroError(
							409,
							`line ${idx}: serial(s) already exist: ${conflicts.slice(0, 5).join(', ')}${conflicts.length > 5 ? '…' : ''}`,
						);
					}
					const serialRows = serials.map((serialNo) => {
						const serialId = uid();
						inboundEvents.push({
							id: uid(),
							serial: serialId,
							event: 'purchased',
							to_location: location,
							ref_kind: doc.type,
							ref_doc: doc.display_number ?? docId,
							by_user: receivedBy,
						});
						return {
							id: serialId,
							model: modelId,
							location,
							serial_no: serialNo,
							status: 'in_stock',
							expiry_date: expiry,
							source_inbound: docId,
							source_line: line.id,
							unit_cost: unitPrice,
							note: null,
							_meta: '{}',
							created_at: now,
							updated_at: now,
						};
					});
					statements.push(insertManySql(t.serials, serialRows));
					ops.push({ kind: 'delete_serials', serialIds: serialRows.map((r) => r.id), stmt: null });
					bump(modelId, location, serialRows.length);
				}
			}
		}

		// Aggregate balance — one statement per (model, location).
		for (const b of balance.values()) {
			const existing = await this.docs.inventoryRow(b.model, b.location);
			if (existing) {
				const stmtIdx = statements.length;
				statements.push({
					sql: `UPDATE ${t.inv} SET qty_on_hand = qty_on_hand + ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL`,
					bindings: [b.qty, now, existing.id],
				});
				guardIndex.set(stmtIdx, 'Balance changed while confirming — retry');
				ops.push({ kind: 'bal_up', invId: existing.id, qty: b.qty, stmt: stmtIdx });
			} else {
				const invId = uid();
				statements.push(
					insertSql(t.inv, {
						id: invId,
						model: b.model,
						location: b.location,
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

		// Serial lifecycle history — appended atomically with the serial state changes.
		planEventInserts(t.events, inboundEvents, statements, ops, now);

		// A receipt marked `paid_at_receipt` came in SETTLED — the money was handed
		// over with the goods. File the ONE ledger entry that says so, inside THIS
		// atomic batch (with an undo op): a receipt must never be confirmed "paid at
		// receipt" without the row that settles it, and the mirror derivation must
		// never see a header whose money has no ledger behind it.
		//
		// The amount is the total THIS confirm just computed — the client sends the
		// FLAG, never money — the day is the receipt date, and the recorder is the
		// same session actor stamped on the header. Refused outright for the kinds
		// that owe nobody (a return / opening balance) and for a receipt with no
		// total: either would file a payment nothing can justify.
		if (doc.paid_at_receipt === 1 || doc.paid_at_receipt === true) {
			if (type !== 'purchase') throw new MroError(400, 'Only a purchase receipt can be marked paid at receipt');
			const receiptPaid = round2(totalAmount);
			if (!(receiptPaid > 0)) {
				throw new MroError(400, 'Marking the receipt paid needs a total — set a unit price on its lines');
			}
			const paymentId = uid();
			statements.push(
				insertSql(t.payments, {
					id: paymentId,
					parent_id: docId,
					paid_on: doc.purchase_date ?? todayMmtDate(),
					amount: receiptPaid,
					method: RECEIPT_PAYMENT_METHOD,
					note: PAID_AT_RECEIPT_NOTE,
					recorded_by: receivedBy,
					// PROVENANCE, not decoration: this marker is what tells the un-post
					// that this ONE entry is the confirm's own (and may therefore be
					// withdrawn with the receipt) while every other entry is money a
					// person recorded and must never be erased by a stock reversal.
					_meta: JSON.stringify({ source: PAID_AT_RECEIPT_SOURCE }),
					created_at: now,
					updated_at: now,
				}),
			);
			ops.push({ kind: 'delete_payment', paymentId, stmt: null });
		}

		// Header flip LAST — the business guard for the whole batch.
		const flipIdx = statements.length;
		statements.push({
			sql: `UPDATE ${t.inbound}
				 SET doc_status = 'confirmed', confirmed_at = ?1, total_qty = ?2, line_count = ?3, total_amount = ?4,
				   received_by = COALESCE(?5, received_by), updated_at = ?6
				 WHERE id = ?7 AND COALESCE(doc_status, '') IN ('', 'draft')`,
			bindings: [now, totalQty, lineRows.length, round2(totalAmount), receivedBy, now, docId],
		});
		guardIndex.set(flipIdx, 'Inbound was already confirmed or cancelled — retry');
		ops.push({ kind: 'doc_unflip', table: t.inbound, docId, fromStatus: doc.doc_status ?? null, stmt: flipIdx });

		const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Inbound could not be confirmed');
		if (failed) throw new MroError(409, failed);

		this.docs.invalidate();
		return {
			inboundId: docId,
			display_number: doc.display_number,
			doc_status: 'confirmed',
			line_count: lineRows.length,
			total_qty: totalQty,
			total_amount: round2(totalAmount),
		};
	}

	/**
	 * CANCEL an inbound — ONE entry point whose behaviour is decided by the
	 * DOCUMENT's own state, never by a caller flag (so a client cannot pick the wrong
	 * verb, and `cancelled` cannot mean two different things to two screens):
	 *
	 *   draft     → a pure lifecycle flip. A draft never moved stock.
	 *   confirmed → REVERSE the receipt and then flip (see below).
	 *   cancelled → an idempotent no-op that still answers with the document.
	 *
	 * Both live paths stamp `cancelled_at` / `cancelled_by` from the SESSION in the
	 * same guarded batch that flips the status, so a cancelled document always names
	 * who ended it and when — including a reversal, which is the material case.
	 */
	async cancelInbound(docId: string, actor: { cancelledBy?: string | null } = {}): Promise<Record<string, unknown>> {
		const doc = await this.docs.docIn(strId(docId, 'id'));
		if (!doc) throw new MroError(404, 'Inbound document not found');
		const status = doc.doc_status ?? 'draft';
		const cancelledBy = (actor.cancelledBy ?? '').trim() || null;

		// A second cancel is a no-op — the caller ends up holding the document's real
		// state instead of an error, so a double tap (or a retried request) is harmless.
		if (status === 'cancelled') {
			return {
				inboundId: docId,
				display_number: doc.display_number,
				doc_status: 'cancelled',
				already: true,
				reversed: false,
				cancelled_at: doc.cancelled_at,
				cancelled_by: doc.cancelled_by,
			};
		}
		if (status !== 'draft' && status !== 'confirmed') throw new MroError(409, `A ${status} inbound cannot be cancelled`);

		if (status === 'draft') return this.cancelDraftInbound(doc, cancelledBy);
		return this.reverseConfirmedInbound(doc, cancelledBy);
	}

	/** The DRAFT path — a guarded status flip and nothing else (no stock ever moved). */
	private async cancelDraftInbound(doc: DocRow, cancelledBy: string | null): Promise<Record<string, unknown>> {
		const t = this.tables;
		const now = nowIso();
		const statements: { sql: string; bindings: unknown[] }[] = [];
		const ops: Op[] = [];
		const guardIndex = new Map<number, string>();

		const flipIdx = statements.length;
		statements.push({
			sql: `UPDATE ${t.inbound} SET doc_status = 'cancelled', cancelled_at = ?1, cancelled_by = ?2, updated_at = ?1
			 WHERE id = ?3 AND COALESCE(doc_status, '') IN ('', 'draft')`,
			bindings: [now, cancelledBy, doc.id],
		});
		guardIndex.set(flipIdx, 'This receipt was confirmed or cancelled elsewhere — reload and retry');
		ops.push({ kind: 'doc_unflip', table: t.inbound, docId: doc.id, fromStatus: doc.doc_status ?? null, stmt: flipIdx });

		const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Inbound could not be cancelled');
		if (failed) throw new MroError(409, failed);

		this.docs.invalidate();
		return {
			inboundId: doc.id,
			display_number: doc.display_number,
			doc_status: 'cancelled',
			reversed: false,
			cancelled_at: now,
			cancelled_by: cancelledBy,
		};
	}

	/**
	 * REVERSE a CONFIRMED inbound — the domain-service way to UNDO a receipt. A raw
	 * generic delete is refused (it would leave stock, lots, serials and the ledger
	 * inconsistent); this is the ONE atomic, guarded batch that puts the receipt back:
	 *
	 *   · decrements each `(model, location)` balance by exactly what the receipt
	 *     added — guarded `qty_on_hand >= added`, so a partly-consumed receipt is
	 *     refused (issue the remainder back first);
	 *   · removes the BATCH lots the receipt created — only while UNTOUCHED
	 *     (`remaining_qty` still the full line qty);
	 *   · removes the SERIAL units the receipt created — only while still `in_stock`
	 *     AND carrying no history beyond this receipt's own event;
	 *   · withdraws the ledger entry the CONFIRM itself filed (a `paid_at_receipt`
	 *     draft) and REFUSES while any payment a person recorded stands — money is
	 *     never silently erased;
	 *   · flips the header to `cancelled` (+ `cancelled_at` / `cancelled_by`) LAST, the
	 *     whole-batch business guard.
	 *
	 * A `return` inbound is REFUSED: reversing it means re-issuing units whose prior
	 * holder the return overwrote and no longer records — re-issue those from the
	 * store instead. Anything already consumed refuses the whole reversal (409).
	 */
	private async reverseConfirmedInbound(doc: DocRow, cancelledBy: string | null): Promise<Record<string, unknown>> {
		const docId = doc.id;
		const t = this.tables;
		const type = isInboundType(doc.type) ? doc.type : 'purchase';
		const defaultLocation = doc.location;
		if (!isLocation(defaultLocation)) throw new MroError(400, `Inbound location must be one of: ${MRO_LOCATIONS.join(', ')}`);

		const lineRows = await this.docs.inLines(docId);
		if (lineRows.length === 0) throw new MroError(400, 'Inbound has no lines — nothing to reverse');

		// Money first: a receipt that somebody paid against is NOT reversible as a
		// bookkeeping act. The ONE exception is the entry the confirm itself filed for
		// a paid-at-receipt draft (marked in `_meta`) — withdraw it with the receipt.
		const payments = await this.docs.livePayments(docId);
		const recordedPayments = payments.filter((p) => !this.docs.isReceiptFiledPayment(p._meta));
		if (recordedPayments.length > 0)
			throw new MroError(
				409,
				`This receipt has ${recordedPayments.length} payment(s) recorded against it — remove them first (the receipt cannot be un-posted while money stands on it)`,
			);

		const now = nowIso();
		const statements: { sql: string; bindings: unknown[] }[] = [];
		const ops: Op[] = [];
		const guardIndex = new Map<number, string>();

		// (model|location) → qty to REMOVE from the balance.
		const balance = new Map<string, { model: string; location: string; qty: number }>();
		const bump = (modelId: string, location: string, qty: number) => {
			const key = `${modelId}|${location}`;
			const b = balance.get(key) ?? { model: modelId, location, qty: 0 };
			b.qty += qty;
			balance.set(key, b);
		};

		let totalQty = 0;

		for (const [index, line] of lineRows.entries()) {
			const idx = index + 1;
			const modelId = strId(line.item_model, `line ${idx} item_model`);
			const qty = qtyOf(line.qty, `line ${idx} qty`);
			const location = line.location && isLocation(line.location) ? line.location : defaultLocation;
			const model = await this.docs.resolveModel(modelId);
			const tracking = isTracking(model.tracking);
			totalQty += qty;

			if (tracking === 'batch') {
				const lots = await this.db.all<Record<string, unknown>>({
					sql: `SELECT * FROM ${t.lots} WHERE source_inbound = ?1 AND source_line = ?2 AND deleted_at IS NULL`,
					bindings: [docId, line.id],
				});
				if (lots.length === 0) throw new MroError(409, `line ${idx}: the received lot is gone — this inbound was already reversed`);
				const remaining = lots.reduce((sum, lot) => sum + Number(lot.remaining_qty ?? 0), 0);
				if (remaining !== qty)
					throw new MroError(
						409,
						`line ${idx}: the received lot was partly consumed (${remaining} of ${qty} left) — move the remainder back before reversing`,
					);
				for (const lot of lots) {
					const stmtIdx = statements.length;
					statements.push({
						sql: `DELETE FROM ${t.lots} WHERE id = ?1 AND remaining_qty = ?2 AND deleted_at IS NULL`,
						bindings: [lot.id, lot.remaining_qty],
					});
					guardIndex.set(stmtIdx, `line ${idx}: the received lot changed while reversing — retry`);
					ops.push({ kind: 'restore_lot', row: lot, stmt: stmtIdx });
				}
				bump(modelId, location, qty);
			} else if (tracking === 'serial') {
				if (type === 'return')
					throw new MroError(
						409,
						`line ${idx}: a return inbound cannot be auto-reversed — the units' prior holder is no longer recorded; re-issue them from the store instead`,
					);
				const serials = parseSerials(line.serials, `line ${idx} serials`);
				const rows = await this.db.all<Record<string, unknown>>({
					sql: `SELECT * FROM ${t.serials} WHERE source_inbound = ?1 AND source_line = ?2 AND deleted_at IS NULL`,
					bindings: [docId, line.id],
				});
				if (rows.length !== serials.length)
					throw new MroError(
						409,
						`line ${idx}: ${rows.length} of ${serials.length} received serial(s) are still on file — some were moved or removed; bring them back to stock first`,
					);
				// Their LIFECYCLE must belong to this receipt alone. A unit the receipt
				// created carries exactly the one `purchased` event this confirm wrote; any
				// other event means the unit has a life beyond the receipt (fitted, checked,
				// written off…) and deleting it would erase real history.
				const foreign = await this.docs.foreignSerialEvents(
					rows.map((r) => String(r.id)),
					doc.display_number ?? docId,
				);
				if (foreign.length > 0)
					throw new MroError(
						409,
						`line ${idx}: serial ${String(foreign[0].serial ?? '')} has history beyond this receipt — bring the unit back to plain stock first`,
					);
				const ownEvents = await this.db.all<Record<string, unknown>>({
					sql: `SELECT * FROM ${t.events} WHERE serial IN (${rows.map((_, i) => `?${i + 1}`).join(', ')}) AND deleted_at IS NULL`,
					bindings: rows.map((r) => String(r.id)),
				});
				for (const row of rows) {
					if (row.status !== 'in_stock')
						throw new MroError(409, `line ${idx}: serial ${row.serial_no ?? row.id} is ${row.status} — bring it back to stock first`);
					const stmtIdx = statements.length;
					statements.push({
						sql: `DELETE FROM ${t.serials} WHERE id = ?1 AND status = 'in_stock' AND deleted_at IS NULL`,
						bindings: [row.id],
					});
					guardIndex.set(stmtIdx, `line ${idx}: serial ${row.serial_no ?? row.id} changed while reversing — retry`);
					ops.push({ kind: 'restore_serials', rows: [row], stmt: stmtIdx });
				}
				if (ownEvents.length > 0) {
					const stmtIdx = statements.length;
					statements.push({
						sql: `DELETE FROM ${t.events} WHERE serial IN (${rows.map((_, i) => `?${i + 1}`).join(', ')})`,
						bindings: rows.map((r) => String(r.id)),
					});
					ops.push({ kind: 'restore_rows', table: t.events, rows: ownEvents, stmt: stmtIdx });
				}
				bump(modelId, location, serials.length);
			} else {
				// standard — only the balance moved.
				bump(modelId, location, qty);
			}
		}

		// Balance decrements — one guarded statement per (model, location); the guard
		// (`qty_on_hand >= added`) refuses a receipt whose stock was already issued.
		for (const b of balance.values()) {
			const existing = await this.docs.inventoryRow(b.model, b.location);
			if (!existing) throw new MroError(409, `No stock balance at ${b.location} to reverse — this inbound was already reversed`);
			const stmtIdx = statements.length;
			statements.push({
				sql: `UPDATE ${t.inv} SET qty_on_hand = qty_on_hand - ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL AND qty_on_hand >= ?1`,
				bindings: [b.qty, now, existing.id],
			});
			guardIndex.set(stmtIdx, `Not enough stock at ${b.location} to reverse — the received stock was already issued`);
			ops.push({ kind: 'bal_down', invId: existing.id, qty: b.qty, stmt: stmtIdx });
		}

		// The confirm's OWN ledger entry, withdrawn with the receipt it settled.
		for (const payment of payments) {
			const stmtIdx = statements.length;
			statements.push({ sql: `DELETE FROM ${t.payments} WHERE id = ?1`, bindings: [payment.id] });
			ops.push({ kind: 'restore_rows', table: t.payments, rows: [payment], stmt: stmtIdx });
		}

		// Header flip LAST — the whole-batch business guard.
		const flipIdx = statements.length;
		statements.push({
			sql: `UPDATE ${t.inbound} SET doc_status = 'cancelled', cancelled_at = ?1, cancelled_by = ?2, updated_at = ?1
			 WHERE id = ?3 AND doc_status = 'confirmed'`,
			bindings: [now, cancelledBy, docId],
		});
		guardIndex.set(flipIdx, 'Inbound was already reversed or cancelled — retry');
		ops.push({ kind: 'doc_unflip', table: t.inbound, docId, fromStatus: 'confirmed', stmt: flipIdx });

		const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Inbound could not be reversed');
		if (failed) throw new MroError(409, failed);

		this.docs.invalidate();
		return {
			inboundId: docId,
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
