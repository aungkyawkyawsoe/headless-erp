/**
 * Confirm — requisition (approve a request; no stock effect), reject it, and issue
 * against it. Moved verbatim out of `inventory.service.ts`, which now delegates here
 * so its public surface is unchanged; runs on the shared `MroContext`.
 */
import { todayMmtDate } from '@mmbix/utils';
import { closeReasonOf, nowIso, qtyOf, strId } from '../codecs';
import type { Op } from '../guarded-batch';
import { MRO_REQUISITION_OPEN_STATUSES, MroError } from '../types';
import type { MroContext } from '../context';
import { OutboundConfirm } from './outbound';

export class RequisitionConfirm {
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

	private get outbound() {
		return new OutboundConfirm(this.c);
	}

	// ── Confirm — requisition (approve, no stock effect) ─────────────────────

	/**
	 * Approve a draft requisition. A requisition is a REQUEST document: approving
	 * it never touches stock — it validates that the draft carries at least one
	 * line with positive quantities, writes the header totals and flips
	 * `doc_status` → `confirmed`, recording the approving employee (approved_by)
	 * and setting `requisition_status = 'approved'`, all in one atomic batch. When
	 * the request records its requester (requested_by), approval must come from a
	 * DIFFERENT employee (two-person, adjustment parity). The same guards apply:
	 * cancelled cannot be approved, a replay of an already-approved document is an
	 * idempotent no-op. Stock only moves later when a goods-issue outbound
	 * (fulfilling this request) is itself confirmed.
	 */
	async confirmRequisition(docId: string, approver: { approvedBy?: string | null } = {}): Promise<Record<string, unknown>> {
		const t = this.tables;
		const doc = await this.docs.docRequisition(strId(docId, 'id'));
		if (!doc) throw new MroError(404, 'Requisition document not found');
		const status = doc.doc_status ?? 'draft';
		if (status === 'confirmed') {
			const re = await this.db.first<Record<string, unknown>>({
				sql: `SELECT display_number, total_qty, line_count, approved_by, issued_qty,
				  COALESCE(requisition_status, 'approved') AS requisition_status FROM ${t.requisition} WHERE id = ?1`,
				bindings: [docId],
			});
			return { requisitionId: docId, already: true, doc_status: 'confirmed', ...(re ?? {}) };
		}
		if (status === 'cancelled') throw new MroError(409, 'Cancelled requisition cannot be approved');
		if (status !== 'draft') throw new MroError(409, `Only draft documents can be approved (current: ${status})`);

		// Two-person rule (adjustment parity): when the request records its requester,
		// approval must come from a DIFFERENT employee. Legacy rows that predate the
		// requested_by field (or creators that omit it) are not hard-failed — approving
		// just requires the approver to differ from whoever is on record.
		const requestedBy = (doc.requested_by ?? '').trim();
		const approvedBy = (approver.approvedBy ?? '').trim();
		if (approvedBy && requestedBy && approvedBy === requestedBy)
			throw new MroError(409, 'A requisition must be approved by a different employee than its requester');
		if (requestedBy && !approvedBy) throw new MroError(400, 'This requisition requests stock — pass the approving employee id');

		const lineRows = await this.docs.requisitionLines(docId);
		if (lineRows.length === 0) throw new MroError(400, 'Requisition has no lines — add at least one line before approving');

		let totalQty = 0;
		for (const [index, line] of lineRows.entries()) {
			const idx = index + 1;
			strId(line.item_model, `line ${idx} item_model`);
			totalQty += qtyOf(line.qty, `line ${idx} qty`);
		}

		const now = nowIso();
		const statements: { sql: string; bindings: unknown[] }[] = [];
		const ops: Op[] = [];
		const guardIndex = new Map<number, string>();

		// Header flip — records the approver + lifecycle status in the same guarded statement.
		const flipIdx = statements.length;
		statements.push({
			sql: `UPDATE ${t.requisition}
			 SET doc_status = 'confirmed', confirmed_at = ?1, total_qty = ?2, line_count = ?3,
			   approved_by = COALESCE(?4, approved_by), requisition_status = 'approved', updated_at = ?5
			 WHERE id = ?6 AND COALESCE(doc_status, '') IN ('', 'draft')`,
			bindings: [now, totalQty, lineRows.length, approvedBy || null, now, docId],
		});
		guardIndex.set(flipIdx, 'Requisition was already approved or cancelled — retry');
		ops.push({ kind: 'doc_unflip', table: t.requisition, docId, fromStatus: doc.doc_status ?? null, stmt: flipIdx });

		const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Requisition could not be approved');
		if (failed) throw new MroError(409, failed);

		this.docs.invalidate();
		return {
			requisitionId: docId,
			display_number: doc.display_number,
			doc_status: 'confirmed',
			requisition_status: 'approved',
			approved_by: approvedBy || null,
			line_count: lineRows.length,
			total_qty: totalQty,
		};
	}

	/**
	 * Reject / close an OPEN stock request — the store keeper's no-stock way of
	 * retiring a request they will not fulfil (or will only partly fulfil, with the
	 * remainder closed). It NEVER touches stock and NEVER applies to an already
	 * fulfilled or cancelled request. On success the request is set to
	 * `requisition_status = 'cancelled'` with the chosen `close_reason` (default
	 * `cancelled`); when the request never left the engineering draft it ALSO flips
	 * `doc_status → 'cancelled'` in the same atomic guarded batch so a rejected
	 * draft reads as cancelled there too, while already-approved/partially-issued
	 * requests keep their `doc_status = 'confirmed'` and expose the closure purely
	 * through `requisition_status` (the UI's source of truth). No rejector column is
	 * written — attribution is optional and the UI records none today.
	 */
	async rejectRequisition(docId: string, intent: { closeReason?: string | null } = {}): Promise<Record<string, unknown>> {
		const t = this.tables;
		const id = strId(docId, 'id');
		const doc = await this.docs.docRequisition(id);
		if (!doc) throw new MroError(404, 'Requisition document not found');

		const closeReason = closeReasonOf(intent.closeReason);

		// Friendly pre-check for the common already-closed case; the guarded UPDATE is
		// the authoritative race-safe guard (a concurrent approve/fulfil wins → 409).
		const reqStatus = doc.req_status ?? 'requested';
		const docStatus = doc.doc_status ?? 'draft';
		const isOpen = docStatus !== 'cancelled' && (MRO_REQUISITION_OPEN_STATUSES as string[]).includes(reqStatus);
		if (!isOpen)
			throw new MroError(
				409,
				`A requisition in state "${reqStatus}" cannot be rejected — only requested/approved/partially_issued are open`,
			);

		const now = nowIso();
		const statements: { sql: string; bindings: unknown[] }[] = [];
		const ops: Op[] = [];
		const guardIndex = new Map<number, string>();

		// Single guarded header close. `doc_status` flips to `cancelled` only for docs
		// still in the engineering draft; already-confirmed docs keep their doc_status.
		const flipIdx = statements.length;
		statements.push({
			sql: `UPDATE ${t.requisition}
			 SET requisition_status = 'cancelled', close_reason = ?1,
			   doc_status = CASE WHEN COALESCE(doc_status, '') IN ('', 'draft') THEN 'cancelled' ELSE doc_status END,
			   updated_at = ?2
			 WHERE id = ?3
			   AND COALESCE(requisition_status, 'requested') IN ('requested', 'approved', 'partially_issued')
			   AND COALESCE(doc_status, '') <> 'cancelled'`,
			bindings: [closeReason, now, id],
		});
		guardIndex.set(flipIdx, 'Requisition was already fulfilled or cancelled — cannot reject');
		ops.push({ kind: 'doc_unflip', table: t.requisition, docId: id, fromStatus: doc.doc_status ?? null, stmt: flipIdx });

		const failed = await this.guarded.runGuarded(statements, guardIndex, ops, 'Requisition could not be rejected');
		if (failed) throw new MroError(409, failed);

		this.docs.invalidate();
		return {
			requisitionId: id,
			display_number: doc.display_number,
			doc_status: docStatus === 'draft' || docStatus === '' ? 'cancelled' : doc.doc_status,
			requisition_status: 'cancelled',
			close_reason: closeReason,
		};
	}

	/**
	 * Issue stock against an APPROVED requisition in ONE server call — the single
	 * seam that owns the create-outbound-draft → confirm pair, so a browser abort
	 * between the two can no longer strand an orphaned DRAFT (the failure class the
	 * client's two-call path had). It reuses the engine's own composite creator (so
	 * the outbound is numbered and its lines written exactly like a hand-made
	 * draft) and the existing atomic `confirmOutbound`, and — if the confirm fails —
	 * discards the just-created draft before surfacing the error.
	 *
	 * The requester/approver model is unchanged: the request must already be
	 * approved (or partially issued), the caller still holds `write` on
	 * `mro_outbounds` (the route gate), and the issuer is the session actor.
	 */
	async issueRequisition(
		docId: string,
		opts: {
			issuedBy?: string | null;
			lines?: Array<{ item_model?: unknown; qty?: unknown }>;
			createOutbound: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
			discardOutbound: (outboundId: string) => Promise<void>;
		},
	): Promise<Record<string, unknown>> {
		const id = strId(docId, 'id');
		const doc = await this.docs.docRequisition(id);
		if (!doc) throw new MroError(404, 'Requisition document not found');
		const reqStatus = doc.req_status ?? (doc.doc_status === 'confirmed' ? 'approved' : 'requested');
		if (reqStatus !== 'approved' && reqStatus !== 'partially_issued')
			throw new MroError(409, `This requisition is "${reqStatus}" — only an approved request can be issued`);
		if (!doc.location) throw new MroError(409, 'This request has no store to issue from');

		const lines = (opts.lines ?? [])
			.map((line) => ({
				item_model: typeof line.item_model === 'string' ? line.item_model.trim() : '',
				qty: Number(line.qty),
			}))
			.filter((line) => line.item_model !== '' && Number.isFinite(line.qty) && line.qty > 0);
		if (lines.length === 0) throw new MroError(400, 'Choose at least one item to issue');

		const outbound = await opts.createOutbound({
			type: 'goods_issue',
			effective_date: todayMmtDate(),
			location: doc.location,
			request: id,
			lines,
		});
		const outboundId = String(outbound.id ?? '');
		if (!outboundId) throw new MroError(500, 'Could not create the goods issue');

		try {
			const result = await this.outbound.confirmOutbound(outboundId, { issuedBy: opts.issuedBy });
			return { ...result, requisition_id: id, outbound_id: outboundId };
		} catch (err) {
			// The create + confirm is two writes, not one transaction — a failed
			// confirm must not leave an orphaned DRAFT for a later operator to pick
			// up. Discard it (the compensating half); a discard failure is swallowed
			// so the ORIGINAL confirm error still surfaces.
			await opts.discardOutbound(outboundId).catch(() => undefined);
			throw err;
		}
	}
}
