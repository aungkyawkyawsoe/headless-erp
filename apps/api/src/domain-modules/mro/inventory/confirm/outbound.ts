/**
 * Confirm — outbound (goods issue / write-off / defects-missing). Moved verbatim out
 * of `inventory.service.ts`, which now delegates here so its public surface is
 * unchanged; runs on the shared `MroContext`.
 */
import { isLocation, isOutboundType, isTracking, nowIso, parseSerials, qtyOf, strId, uid } from '../codecs';
import { moneyOrNull, round2 } from '../money';
import { insertSql, planEventInserts } from '../guarded-batch';
import type { Op, SerialEventSeed } from '../guarded-batch';
import { MM_INSUFFICIENT, MRO_LOCATIONS, MRO_OUTBOUND_TYPES, MroError } from '../types';
import type { DocRow } from '../types';
import type { MroContext } from '../context';

export class OutboundConfirm {
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

	/**
	 * The store a line's stock actually moves at — the line's own `location` when it
	 * names one, the header's otherwise. ONE rule, read by the confirm (which takes
	 * the stock FROM there) and by the cancel (which must put it back THERE): a
	 * line-level override is legal, so a reversal that assumed the header store would
	 * file the returned stock at the wrong location — a silent discrepancy, not a
	 * refusal, which is the one outcome a stock ledger must never produce.
	 */
	private lineLocation(line: { location?: string | null }, defaultLocation: string): string {
		return line.location && isLocation(line.location) ? line.location : defaultLocation;
	}

	/**
	 * Confirm a draft outbound. Per line: standard = guarded balance deduction;
	 * batch = FEFO/FIFO allocation across active lots (expired blocked from
	 * goods issues, targeted by write-offs); serial = explicit serial pick.
	 * Header flips to `confirmed` in the same batch; guard failure reverses
	 * everything (409) — a draft outbound never reserves anything early.
	 * When the header carries a `request` (a goods-issue against an approved
	 * requisition) the same guarded batch also recomputes the source request's
	 * issued_qty and rolls its requisition_status to partial/fulfilled.
	 *
	 * A goods issue may also name a DESTINATION (`to_vehicle` XOR `to_employee`):
	 * every serial unit it picks is stamped into that holder in the SAME batch that
	 * flips it `issued`, which is what makes it appear on the truck's wheel-plan /
	 * on-board registry or the employee's asset register. Only an ASSET unit
	 * (`mro_item_name.assets`) has a holder to show — a standard / batch line is a
	 * plain store deduction and has nowhere to be held.
	 */
	async confirmOutbound(docId: string, issuer: { issuedBy?: string | null } = {}): Promise<Record<string, unknown>> {
		const t = this.tables;
		const doc = await this.docs.docOut(strId(docId, 'id'));
		if (!doc) throw new MroError(404, 'Outbound document not found');
		const status = doc.doc_status ?? 'draft';
		if (status === 'confirmed') {
			const re = await this.db.first<Record<string, unknown>>({
				sql: `SELECT display_number, total_qty, line_count, total_amount FROM ${t.outbound} WHERE id = ?1`,
				bindings: [docId],
			});
			return { outboundId: docId, already: true, doc_status: 'confirmed', ...(re ?? {}) };
		}
		if (status === 'cancelled') throw new MroError(409, 'Cancelled outbound cannot be confirmed');
		if (status !== 'draft') throw new MroError(409, `Only draft documents can be confirmed (current: ${status})`);
		if (!isOutboundType(doc.type)) throw new MroError(400, `type must be one of: ${MRO_OUTBOUND_TYPES.join(', ')}`);
		const defaultLocation = doc.location;
		if (!isLocation(defaultLocation)) throw new MroError(400, `Outbound location must be one of: ${MRO_LOCATIONS.join(', ')}`);

		// Issuer recorded on the header flip (who confirmed/issued), when provided.
		const issuedBy = (issuer.issuedBy ?? '').trim() || null;

		// The holder every unit this issue picks is stamped into — ONE computation,
		// shared with the cancel path (`issueDestination`), so the confirm and the
		// reversal can never disagree about where a unit was put. A destination that
		// only a write-off could mean is refused LOUDLY rather than ignored, so a
		// document written through the generic API (Studio / CLI / import) can never
		// carry one that silently does nothing.
		const { vehicle: holderVehicle, employee: holderEmployee } = await this.issueDestination(doc);

		const lineRows = await this.docs.outLines(docId);
		if (lineRows.length === 0) throw new MroError(400, 'Outbound has no lines — add at least one line before confirming');

		const now = nowIso();
		const statements: { sql: string; bindings: unknown[] }[] = [];
		const ops: Op[] = [];
		const outboundEvents: SerialEventSeed[] = [];
		const guardIndex = new Map<number, string>();
		// (model|location) → planned deduction (pre-checked against the balance).
		const demand = new Map<string, { model: string; location: string; qty: number }>();

		let totalQty = 0;
		let totalAmount = 0;

		for (const [index, line] of lineRows.entries()) {
			const idx = index + 1;
			const modelId = strId(line.item_model, `line ${idx} item_model`);
			const qty = qtyOf(line.qty, `line ${idx} qty`);
			const location = this.lineLocation(line, defaultLocation);
			const model = await this.docs.resolveModel(modelId);
			const tracking = isTracking(model.tracking);
			const unitPrice = moneyOrNull(line.unit_price);
			totalQty += qty;
			totalAmount += qty * (unitPrice ?? 0);

			const key = `${modelId}|${location}`;
			const d = demand.get(key) ?? { model: modelId, location, qty: 0 };
			d.qty += qty;
			demand.set(key, d);

			if (tracking === 'batch') {
				const alloc = await this.allocation.allocateLots(modelId, location, qty, doc.type);
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
					statements.push(
						insertSql(t.outLots, {
							id: uid(),
							outbound_id: docId,
							lot_id: take.lotId,
							qty: take.take,
							outbound_line: line.id,
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
					doc.type,
				);
				const newStatus = doc.type === 'goods_issue' ? 'issued' : 'scrapped';
				// The holder that rides the SAME guarded statement as the status flip — never a
				// second write, so a unit is never momentarily out of the store AND in nobody's
				// hands. A goods issue with no destination issues the unit out unheld (it simply
				// left the store); a write-off stamps nothing.
				const heldByVehicle = !!holderVehicle;
				const heldByEmployee = !!holderEmployee;
				for (const s of picks) {
					// Bindings are built with the SET clause so the placeholder numbers always
					// match what is actually passed (D1 rejects a surplus binding).
					const binds: unknown[] = [newStatus, now];
					const sets = ['status = ?1', 'updated_at = ?2'];
					if (heldByVehicle) {
						binds.push(holderVehicle);
						sets.push(`vehicle = ?${binds.length}`);
					}
					if (heldByEmployee) {
						binds.push(holderEmployee);
						sets.push(`employee = ?${binds.length}`);
					}
					const idIdx = binds.push(s.id);
					const stmtIdx = statements.length;
					statements.push({
						sql: `UPDATE ${t.serials} SET ${sets.join(', ')} WHERE id = ?${idIdx} AND status = 'in_stock'`,
						bindings: binds,
					});
					guardIndex.set(stmtIdx, `line ${idx}: serial ${s.serial_no} is no longer in stock — retry`);
					// A reversed unit goes back to plain in-stock, so the reversal clears exactly
					// the holder seam this flip stamped.
					ops.push({
						kind: 'serial_flip',
						serialId: s.id,
						fromStatus: 'in_stock',
						stmt: stmtIdx,
						hadVehicle: heldByVehicle,
						employeeReset: heldByEmployee,
					});
					if (heldByVehicle || heldByEmployee) {
						outboundEvents.push({
							id: uid(),
							serial: s.id,
							// A unit handed to a TRUCK is staged in its inventory (no wheel seat — the
							// truck's board does the fitting); a person TAKES CUSTODY of it.
							event: heldByEmployee ? 'issued' : 'fitted',
							from_location: location,
							...(heldByVehicle ? { to_vehicle: holderVehicle } : {}),
							...(heldByEmployee ? { to_employee: holderEmployee } : {}),
							ref_kind: 'goods_issue',
							ref_doc: doc.display_number ?? docId,
							by_user: issuedBy,
							note: heldByEmployee
								? 'Issued to an employee on a goods issue'
								: 'Handed to the vehicle on a goods issue (vehicle inventory)',
						});
					} else if (newStatus === 'scrapped') {
						outboundEvents.push({
							id: uid(),
							serial: s.id,
							event: 'written_off',
							from_location: location,
							ref_kind: doc.type,
							ref_doc: doc.display_number ?? docId,
							by_user: issuedBy,
						});
					}
					statements.push(
						insertSql(t.outSerials, {
							id: uid(),
							outbound_id: docId,
							serial_id: s.id,
							outbound_line: line.id,
							_meta: '{}',
							created_at: now,
							updated_at: now,
						}),
					);
				}
			}
		}

		// Pre-check + one guarded deduction per (model, location).
		for (const d of demand.values()) {
			const existing = await this.docs.inventoryRow(d.model, d.location);
			if (!existing || Number(existing.qty_on_hand ?? 0) < d.qty) throw new MroError(409, MM_INSUFFICIENT);
			const stmtIdx = statements.length;
			statements.push({
				sql: `UPDATE ${t.inv} SET qty_on_hand = qty_on_hand - ?1, updated_at = ?2
				 WHERE id = ?3 AND deleted_at IS NULL AND qty_on_hand >= ?1`,
				bindings: [d.qty, now, existing.id],
			});
			guardIndex.set(stmtIdx, MM_INSUFFICIENT);
			ops.push({ kind: 'bal_down', invId: existing.id, qty: d.qty, stmt: stmtIdx });
		}

		// Fulfilment recompute for a goods-issue backed by an approved request: same
		// guarded batch — nothing becomes confirmed/issued without the request header
		// tracking it, and any reversal restores the request's issued_qty/status too.
		const requestRef = (doc.request ?? '').trim();
		let reqUpdateIssued: number | undefined;
		let reqUpdateStatus: string | undefined;
		if (doc.type === 'goods_issue' && requestRef) {
			const source = await this.db.first<{
				id: string;
				doc_status: string | null;
				total_qty: number | null;
				requisition_status: string | null;
				issued_qty: number | null;
			}>({
				sql: `SELECT id, doc_status, total_qty, requisition_status, issued_qty FROM ${t.requisition} WHERE id = ?1 AND deleted_at IS NULL`,
				bindings: [requestRef],
			});
			if (!source) throw new MroError(400, `Source request ${requestRef} does not exist — fix the outbound's request reference`);
			if ((source.doc_status ?? '') !== 'confirmed')
				throw new MroError(409, 'Source request is not approved — approve the requisition before issuing stock');
			// A request that is already fulfilled or explicitly closed must not accept any
			// further goods issues (no double stock / no issue onto a closed request).
			const srcStatus = source.requisition_status ?? 'requested';
			if (srcStatus === 'fulfilled' || srcStatus === 'cancelled')
				throw new MroError(409, `Source request is ${srcStatus} — no further issues are allowed`);

			// Confirmed issues already on record for this request (this draft isn't there
			// yet) plus the qty this outbound will confirm now.
			const existingIssues = await this.docs.confirmedIssueTo(requestRef);
			const requested = Number(source.total_qty ?? 0);
			const issuedTotal = existingIssues + totalQty;
			// Refuse to over-issue past the requested quantity — fulfilment caps at the
			// request (partial issues stop once it is fully covered).
			if (requested > 0 && issuedTotal > requested)
				throw new MroError(409, `Issue would exceed the requested ${requested} units of this request (already ${existingIssues} issued)`);
			const nextStatus = requested > 0 && issuedTotal >= requested ? 'fulfilled' : 'partially_issued';

			const reqIdx = statements.length;
			statements.push({
				sql: `UPDATE ${t.requisition} SET issued_qty = ?1, requisition_status = ?2, updated_at = ?3
				 WHERE id = ?4 AND doc_status = 'confirmed'`,
				bindings: [issuedTotal, nextStatus, now, requestRef],
			});
			guardIndex.set(reqIdx, 'Source request changed while issuing — retry');
			ops.push({
				kind: 'requisition_restore',
				table: t.requisition,
				docId: requestRef,
				issuedQty: source.issued_qty == null ? null : Number(source.issued_qty),
				requisitionStatus: source.requisition_status ?? null,
				stmt: reqIdx,
			});
			reqUpdateIssued = issuedTotal;
			reqUpdateStatus = nextStatus;
		}

		// Serial lifecycle history — appended atomically with the stock deduction.
		planEventInserts(t.events, outboundEvents, statements, ops, now);

		const flipIdx = statements.length;
		statements.push({
			sql: `UPDATE ${t.outbound}
			 SET doc_status = 'confirmed', confirmed_at = ?1, total_qty = ?2, line_count = ?3, total_amount = ?4,
			   issued_by = COALESCE(?5, issued_by), updated_at = ?6
			 WHERE id = ?7 AND COALESCE(doc_status, '') IN ('', 'draft')`,
			bindings: [now, totalQty, lineRows.length, round2(totalAmount), issuedBy, now, docId],
		});
		guardIndex.set(flipIdx, 'Outbound was already confirmed or cancelled — retry');
		ops.push({ kind: 'doc_unflip', table: t.outbound, docId, fromStatus: doc.doc_status ?? null, stmt: flipIdx });
		ops.push({ kind: 'delete_links', table: t.outLots, column: 'outbound_id', docId, stmt: null });
		ops.push({ kind: 'delete_links', table: t.outSerials, column: 'outbound_id', docId, stmt: null });

		const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Outbound could not be confirmed');
		if (failed) throw new MroError(409, failed);

		this.docs.invalidate();
		const result: Record<string, unknown> = {
			outboundId: docId,
			display_number: doc.display_number,
			doc_status: 'confirmed',
			line_count: lineRows.length,
			total_qty: totalQty,
			total_amount: round2(totalAmount),
		};
		if (reqUpdateIssued !== undefined) result.issued_qty = reqUpdateIssued;
		if (reqUpdateStatus !== undefined) result.requisition_status = reqUpdateStatus;
		return result;
	}

	/**
	 * The ONE holder a goods issue stamps on every unit it picks — the doc's own
	 * `to_vehicle` / `to_employee`, else (for a request-linked issue that names none)
	 * the truck its source REQUEST declared. Read by BOTH the confirm (which stamps
	 * it) and the cancel (which must clear exactly it, never a guess), so the two can
	 * never disagree about where a unit was put. A write-off / disposal holds nothing.
	 */
	private async issueDestination(doc: DocRow): Promise<{ vehicle: string | null; employee: string | null }> {
		const toVehicle = (doc.to_vehicle ?? '').trim() || null;
		const toEmployee = (doc.to_employee ?? '').trim() || null;
		if (doc.type !== 'goods_issue' && (toVehicle || toEmployee))
			throw new MroError(400, 'Only a goods issue hands units to a holder — a write-off or a disposal names no destination');
		if (toVehicle && toEmployee) throw new MroError(400, 'Name ONE destination — a vehicle or an employee, not both');
		if (doc.type !== 'goods_issue') return { vehicle: null, employee: null };
		let sourceVehicle: string | null = null;
		if (!toVehicle && !toEmployee && (doc.request ?? '').trim()) {
			const src = await this.db.first<{ vehicle: string | null }>({
				sql: `SELECT vehicle FROM ${this.tables.requisition} WHERE id = ?1 AND deleted_at IS NULL`,
				bindings: [doc.request],
			});
			sourceVehicle = (src?.vehicle ?? '').trim() || null;
		}
		return { vehicle: toVehicle ?? sourceVehicle, employee: toEmployee };
	}

	/**
	 * CANCEL an outbound — ONE entry point decided by the DOCUMENT's own state: a
	 * draft is a pure lifecycle flip (no stock ever moved), a CONFIRMED issue is
	 * REVERSED, and an already-cancelled document is an idempotent no-op.
	 *
	 * The reversal reads the confirm's OWN TRACE (`mro_outbound_lots` /
	 * `mro_outbound_serials`) rather than re-deriving an allocation: re-running FEFO
	 * today would put stock back into different lots than it came out of, and a
	 * re-derived serial pick could restore the wrong unit. Every statement is guarded
	 * on the live state the confirm left, and the header flips LAST:
	 *
	 *   · each taken lot gets its exact `qty` back (an `empty` status restored to
	 *     `active`), guarded on the lot still existing;
	 *   · each issued/scrapped unit returns to `in_stock` at the issue's store with
	 *     its holder seam cleared — REFUSED if the unit has since been seated on a
	 *     wheel, returned, re-issued or moved (`status`, `slot` and `vehicle` /
	 *     `employee` must still be exactly what this issue left);
	 *   · each `(model, store)` balance goes back up by what left it;
	 *   · the source REQUEST's `issued_qty` / `requisition_status` are recomputed
	 *     without this issue — never resurrecting a cancelled request;
	 *   · the trace rows and this issue's OWN serial events are withdrawn, the header
	 *     flips to `cancelled` (+ `cancelled_at` / `cancelled_by`) — and if any guard
	 *     loses, the WHOLE batch (trace rows and events included) is rolled back.
	 */
	async cancelOutbound(docId: string, actor: { cancelledBy?: string | null } = {}): Promise<Record<string, unknown>> {
		const t = this.tables;
		const doc = await this.docs.docOut(strId(docId, 'id'));
		if (!doc) throw new MroError(404, 'Outbound document not found');
		const status = doc.doc_status ?? 'draft';
		const cancelledBy = (actor.cancelledBy ?? '').trim() || null;

		if (status === 'cancelled') {
			return {
				outboundId: docId,
				display_number: doc.display_number,
				doc_status: 'cancelled',
				already: true,
				reversed: false,
				cancelled_at: doc.cancelled_at,
				cancelled_by: doc.cancelled_by,
			};
		}
		if (status !== 'draft' && status !== 'confirmed') throw new MroError(409, `A ${status} outbound cannot be cancelled`);

		const now = nowIso();
		const statements: { sql: string; bindings: unknown[] }[] = [];
		const ops: Op[] = [];
		const guardIndex = new Map<number, string>();

		if (status === 'draft') {
			const flipIdx = statements.length;
			statements.push({
				sql: `UPDATE ${t.outbound} SET doc_status = 'cancelled', cancelled_at = ?1, cancelled_by = ?2, updated_at = ?1
				 WHERE id = ?3 AND COALESCE(doc_status, '') IN ('', 'draft')`,
				bindings: [now, cancelledBy, docId],
			});
			guardIndex.set(flipIdx, 'This issue was confirmed or cancelled elsewhere — reload and retry');
			ops.push({ kind: 'doc_unflip', table: t.outbound, docId, fromStatus: doc.doc_status ?? null, stmt: flipIdx });
			const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Outbound could not be cancelled');
			if (failed) throw new MroError(409, failed);
			this.docs.invalidate();
			return {
				outboundId: docId,
				display_number: doc.display_number,
				doc_status: 'cancelled',
				reversed: false,
				cancelled_at: now,
				cancelled_by: cancelledBy,
			};
		}

		// ── The reversal — a CONFIRMED issue, undone from its own trace ──
		if (!isOutboundType(doc.type)) throw new MroError(400, `type must be one of: ${MRO_OUTBOUND_TYPES.join(', ')}`);
		const defaultLocation = doc.location;
		if (!isLocation(defaultLocation)) throw new MroError(400, `Outbound location must be one of: ${MRO_LOCATIONS.join(', ')}`);
		const dest = await this.issueDestination(doc);

		const lineRows = await this.docs.outLines(docId);
		if (lineRows.length === 0) throw new MroError(400, 'Outbound has no lines — nothing to reverse');
		const trace = await this.docs.outboundTrace(docId);

		// The issue's OWN serial history marker — what makes "our events" decidable.
		const refDoc = doc.display_number ?? docId;

		let totalQty = 0;

		for (const [index, line] of lineRows.entries()) {
			const idx = index + 1;
			const modelId = strId(line.item_model, `line ${idx} item_model`);
			const qty = qtyOf(line.qty, `line ${idx} qty`);
			// The store this line took from — the SAME rule the confirm used.
			const lineLocation = this.lineLocation(line, defaultLocation);
			const model = await this.docs.resolveModel(modelId);
			const tracking = isTracking(model.tracking);
			totalQty += qty;
			const lineLots = trace.lots.filter((r) => r.outbound_line === line.id);
			const lineSerials = trace.serials.filter((r) => r.outbound_line === line.id);

			if (tracking === 'batch') {
				// The trace must account for the line EXACTLY. A shortfall means the effect is
				// not fully recorded — refuse rather than guess (guessing here is a silently
				// wrong balance, the one thing a reversal must never produce).
				const traced = lineLots.reduce((sum, r) => sum + Number(r.qty ?? 0), 0);
				if (traced !== qty)
					throw new MroError(
						409,
						`line ${idx}: the batch trace accounts for ${traced} of ${qty} units — this issue's stock effect is incomplete; run the reconciliation report`,
					);
				const lotRows = await this.docs.lotRowsByIds(lineLots.map((r) => String(r.lot_id)));
				for (const take of lineLots) {
					const lotId = String(take.lot_id);
					const lot = lotRows.get(lotId);
					if (!lot) throw new MroError(409, `line ${idx}: a lot this issue took from no longer exists — run the reconciliation report`);
					const takeQty = Number(take.qty ?? 0);
					const stmtIdx = statements.length;
					statements.push({
						sql: `UPDATE ${t.lots} SET remaining_qty = remaining_qty + ?1,
						 status = CASE WHEN status = 'empty' THEN 'active' ELSE status END, updated_at = ?2
						 WHERE id = ?3 AND deleted_at IS NULL`,
						bindings: [takeQty, now, lotId],
					});
					guardIndex.set(stmtIdx, `line ${idx}: a lot this issue took from changed while reversing — retry`);
					// `lot_merge` is the op for an ADDITIVE write (rollback deducts) — NOT
					// `lot_deduct`, whose rollback ADDS. The statement above adds the take back
					// and revives an emptied lot, so its mirror deducts and restores the status.
					ops.push({ kind: 'lot_merge', lotId, qty: takeQty, stmt: stmtIdx, restoreStatus: String(lot.status ?? 'active') });
				}
			} else if (tracking === 'serial') {
				const expectedSerials = parseSerials(line.serials, `line ${idx} serials`);
				if (lineSerials.length !== expectedSerials.length || lineSerials.length !== qty)
					throw new MroError(
						409,
						`line ${idx}: the serial trace holds ${lineSerials.length} unit(s) for ${qty} — this issue's stock effect is incomplete; run the reconciliation report`,
					);
				const expectedStatus = doc.type === 'goods_issue' ? 'issued' : 'scrapped';
				const seams = await this.docs.serialSeamsByIds(lineSerials.map((r) => String(r.serial_id)));
				for (const pick of lineSerials) {
					const serialId = String(pick.serial_id);
					const seam = seams.get(serialId);
					// A unit that has moved on since the issue is REFUSED, never yanked: the
					// reversal must undo exactly what this document did, and nothing else.
					if (!seam)
						throw new MroError(409, `line ${idx}: a unit of this issue is gone from the stock files — run the reconciliation report`);
					if ((seam.status ?? '') !== expectedStatus)
						throw new MroError(
							409,
							`line ${idx}: ${seam.serial_no ?? 'serial'} is ${seam.status ?? 'unknown'} now, not ${expectedStatus} — it has moved on since this issue, so there is nothing left to reverse for it`,
						);
					if (seam.slot)
						throw new MroError(
							409,
							`line ${idx}: ${seam.serial_no ?? 'serial'} has since been seated on a wheel — unseat it before reversing this issue`,
						);
					if ((seam.vehicle ?? null) !== dest.vehicle || (seam.employee ?? null) !== dest.employee)
						throw new MroError(
							409,
							`line ${idx}: ${seam.serial_no ?? 'serial'} is no longer held where this issue put it — bring it back to that holder first`,
						);
					if ((seam.location ?? null) !== lineLocation)
						throw new MroError(
							409,
							`line ${idx}: ${seam.serial_no ?? 'serial'} is no longer in the store this issue took it from — bring it back first`,
						);
					// One guarded write clears the WHOLE seam, so a unit is never momentarily in
					// stock AND still held by someone. The WHERE pins the unit to EXACTLY the state
					// this issue left (its store included), so a unit that drifted is REFUSED
					// rather than silently re-filed at another location.
					const stmtIdx = statements.length;
					statements.push({
						sql: `UPDATE ${t.serials} SET status = 'in_stock', location = ?1, vehicle = NULL, slot = NULL, employee = NULL, updated_at = ?2
						 WHERE id = ?3 AND status = ?4 AND location IS ?5 AND vehicle IS ?6 AND slot IS NULL AND employee IS ?7 AND deleted_at IS NULL`,
						bindings: [lineLocation, now, serialId, expectedStatus, lineLocation, dest.vehicle, dest.employee],
					});
					guardIndex.set(stmtIdx, `line ${idx}: a unit of this issue moved while reversing — retry`);
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
		}

		// Withdraw this issue's trace rows (what actually left) — one delete per table,
		// restored verbatim if a later guard loses.
		if (trace.lots.length > 0) {
			const stmtIdx = statements.length;
			statements.push({ sql: `DELETE FROM ${t.outLots} WHERE outbound_id = ?1`, bindings: [docId] });
			ops.push({ kind: 'restore_rows', table: t.outLots, rows: trace.lots as unknown as Array<Record<string, unknown>>, stmt: stmtIdx });
		}
		if (trace.serials.length > 0) {
			const stmtIdx = statements.length;
			statements.push({ sql: `DELETE FROM ${t.outSerials} WHERE outbound_id = ?1`, bindings: [docId] });
			ops.push({
				kind: 'restore_rows',
				table: t.outSerials,
				rows: trace.serials as unknown as Array<Record<string, unknown>>,
				stmt: stmtIdx,
			});
		}

		// This issue's OWN serial events go with it. A `checked` reading taken while the
		// unit was issued is a measurement of the physical unit and STAYS.
		const pickedSerialIds = trace.serials.map((r) => String(r.serial_id));
		if (pickedSerialIds.length > 0) {
			const binds = pickedSerialIds.map((_, i) => `?${i + 1}`);
			const docSlot = `?${pickedSerialIds.length + 1}`;
			const mine = await this.db.all<Record<string, unknown>>({
				sql: `SELECT * FROM ${t.events} WHERE serial IN (${binds.join(', ')}) AND deleted_at IS NULL AND ref_doc IS ${docSlot}`,
				bindings: [...pickedSerialIds, refDoc],
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

		// Balances back up — one guarded statement per (model, store).
		const restoreBalance = new Map<string, { model: string; location: string; qty: number }>();
		for (const line of lineRows) {
			const modelId = strId(line.item_model, 'line item_model');
			const location = this.lineLocation(line, defaultLocation);
			const key = `${modelId}|${location}`;
			const b = restoreBalance.get(key) ?? { model: modelId, location, qty: 0 };
			b.qty += qtyOf(line.qty, 'line qty');
			restoreBalance.set(key, b);
		}
		for (const b of restoreBalance.values()) {
			const existing = await this.docs.inventoryRow(b.model, b.location);
			if (!existing) throw new MroError(409, `No stock balance at ${b.location} to restore — run the reconciliation report`);
			const stmtIdx = statements.length;
			statements.push({
				sql: `UPDATE ${t.inv} SET qty_on_hand = qty_on_hand + ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL`,
				bindings: [b.qty, now, existing.id],
			});
			guardIndex.set(stmtIdx, `The balance at ${b.location} changed while reversing — retry`);
			ops.push({ kind: 'bal_up', invId: existing.id, qty: b.qty, stmt: stmtIdx });
		}

		// The source request's fulfilment, recomputed WITHOUT this issue. A request that
		// was cancelled (or is no longer approved) in the meantime is left alone — the
		// stock still comes back; only its bookkeeping would be wrong to reopen.
		const requestRef = (doc.request ?? '').trim();
		let reqRestore: { issuedQty: number; status: string } | null = null;
		if (doc.type === 'goods_issue' && requestRef) {
			const source = await this.db.first<{
				id: string;
				doc_status: string | null;
				total_qty: number | null;
				requisition_status: string | null;
				issued_qty: number | null;
			}>({
				sql: `SELECT id, doc_status, total_qty, requisition_status, issued_qty FROM ${t.requisition} WHERE id = ?1 AND deleted_at IS NULL`,
				bindings: [requestRef],
			});
			if (source && (source.doc_status ?? '') === 'confirmed' && (source.requisition_status ?? '') !== 'cancelled') {
				const still = await this.db.first<{ s: number | null }>({
					sql: `SELECT COALESCE(SUM(total_qty), 0) AS s FROM ${t.outbound}
					 WHERE request = ?1 AND type = 'goods_issue' AND doc_status = 'confirmed' AND deleted_at IS NULL AND id <> ?2`,
					bindings: [requestRef, docId],
				});
				const requested = Number(source.total_qty ?? 0);
				const issuedTotal = Number(still?.s ?? 0);
				const nextStatus = issuedTotal <= 0 ? 'approved' : requested > 0 && issuedTotal >= requested ? 'fulfilled' : 'partially_issued';
				const reqIdx = statements.length;
				statements.push({
					sql: `UPDATE ${t.requisition} SET issued_qty = ?1, requisition_status = ?2, updated_at = ?3
					 WHERE id = ?4 AND doc_status = 'confirmed' AND requisition_status <> 'cancelled'`,
					bindings: [issuedTotal, nextStatus, now, requestRef],
				});
				guardIndex.set(reqIdx, 'The source request changed while reversing — retry');
				ops.push({
					kind: 'requisition_restore',
					table: t.requisition,
					docId: requestRef,
					issuedQty: source.issued_qty == null ? null : Number(source.issued_qty),
					requisitionStatus: source.requisition_status ?? null,
					stmt: reqIdx,
				});
				reqRestore = { issuedQty: issuedTotal, status: nextStatus };
			}
		}

		// Header flip LAST — the whole-batch business guard.
		const flipIdx = statements.length;
		statements.push({
			sql: `UPDATE ${t.outbound} SET doc_status = 'cancelled', cancelled_at = ?1, cancelled_by = ?2, updated_at = ?1
			 WHERE id = ?3 AND doc_status = 'confirmed'`,
			bindings: [now, cancelledBy, docId],
		});
		guardIndex.set(flipIdx, 'Outbound was already reversed or cancelled — retry');
		ops.push({ kind: 'doc_unflip', table: t.outbound, docId, fromStatus: 'confirmed', stmt: flipIdx });

		const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Outbound could not be reversed');
		if (failed) throw new MroError(409, failed);

		this.docs.invalidate();
		const result: Record<string, unknown> = {
			outboundId: docId,
			display_number: doc.display_number,
			doc_status: 'cancelled',
			reversed: true,
			reversed_qty: totalQty,
			line_count: lineRows.length,
			cancelled_at: now,
			cancelled_by: cancelledBy,
		};
		if (reqRestore) {
			result.issued_qty = reqRestore.issuedQty;
			result.requisition_status = reqRestore.status;
		}
		return result;
	}
}
