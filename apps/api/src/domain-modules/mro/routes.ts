/**
 * MRO Routes — /api/mro
 *
 * Documents are engine-owned: a client creates multi-line DRAFT inbound /
 * outbound documents through the GENERIC entity API
 * (POST /api/entities/mro_inbounds with `lines: [...]`), which assigns the
 * document number (`INB-00001` / `OUT-00001`) and tracks `doc_status`. The
 * endpoints here own ONLY the confirm moment — the single server-side atomic
 * D1 batch that actually moves stock (see `inventory/confirm/`) — so a failed
 * confirm never leaves partial state and a replay cannot double-deduct:
 *
 *   POST /api/mro/inbounds/:id/confirm  — receipt effect: per line create lot
 *        rows / serial rows (or re-instock returned serials) + balance, then
 *        flip the draft to `confirmed`.
 *   POST /api/mro/outbounds/:id/confirm — issue/write-off effect: FEFO/FIFO
 *        lot allocation or explicit serial pick + balance, then flip.
 *   POST /api/mro/transfers/:id/confirm — location-to-location move: source
 *        store deducts, destination receives, lot/serial identity preserved;
 *        the confirming operator (`approved_by`, an m2o id) is recorded at the
 *        flip (who confirms need not differ from the initiator).
 *   POST /api/mro/transfers/:id/cancel — the same ONE verb as the other stock
 *        documents: a draft flips, a CONFIRMED move is reversed from its own
 *        lot/serial trace (see above).
 *   POST /api/mro/adjustments/:id/confirm — apply an operator-reported stock
 *        correction (AJT-…): add/remove signed per-line changes to one store;
 *        requires a separate approver (`approved_by != reported_by`), applies
 *        stock and flips the draft to confirmed.
 *   POST /api/mro/requisitions/check-duplicate — pre-flight WARNING for the
 *        same-day duplicate guard: reads the guard's own verdict for a basket and
 *        returns { duplicate, message, display_number, ack }. A client that
 *        confirms the warning files the request anyway by sending the returned
 *        `ack` token back in the `X-Write-Ack` header on the create.
 *   POST /api/mro/requisitions/:id/confirm — APPROVE a stock request (REQ-…):
 *        validates the lines and flips the draft to confirmed WITHOUT touching
 *        stock — the approved requisition is the authority a later goods-issue
 *        outbound fulfils.
 *   POST /api/mro/requisitions/:id/reject — REJECT/close an OPEN request (REQ-…):
 *        no-stock closure for a request the keeper will not (fully) fulfil —
 *        sets requisition_status = cancelled + close_reason (409 if already
 *        fulfilled/cancelled); drafts also flip engine doc_status → cancelled.
 *   POST /api/mro/{inbounds|outbounds|transfers|adjustments}/:id/cancel — END a document, decided by
 *        the DOCUMENT's own state (never a caller flag): a DRAFT is a pure lifecycle
 *        flip (no stock ever moved), a POSTED one is REVERSED in the same atomic
 *        batch that flips it, and an already-cancelled document is an idempotent
 *        no-op. A reversal that cannot be honest is REFUSED (409) with the reason —
 *        partially consumed stock, a unit that has moved on, money recorded against
 *        a receipt — so no cancel path can leave the ledger disagreeing with stock.
 *        Replaces the old one-way `/inbounds/:id/reverse` (same behaviour, plus the
 *        draft path and the audit stamp), so a client has ONE verb to reach for.
 *   POST /api/mro/inbounds/:id/payments — FILE a payment on a purchase receipt
 *        (ledger row + the header's money mirror, the derivation AWAITED); its
 *        DELETE twin (`.../payments/:paymentId`) REMOVES one — the correction the
 *        immutable money columns require. Both are gated on `write` for
 *        `mro_inbounds` (the collection whose money they change) rather than on
 *        the ledger, because NO operator role carries `delete` on
 *        `mro_inbound_payments` — see the routes below.
 *   GET  /api/mro/stock/expiring[?days=30] — expired + soon-to-expire lots/serials;
 *        omitting `days` derives the horizon from the widest per-model alert window.
 *   GET  /api/mro/stock/onhand — balances per (model, location) with a drift
 *        check for batch/serial models.
 *   GET  /api/mro/stock/reconcile — admin-gated integrity report (balance drift,
 *        orphan stock, stale serial snapshots); clean data = zero rows.
 *   GET  /api/mro/asset-requests[?status=&search=&cursor=] — the approver-scoped
 *        transfer-request feed: requests THIS session may decide (admin = all;
 *        otherwise requests filed by a recorded subordinate), newest first,
 *        keyset-paged. The SAME scope `approve`/`reject` enforce, so the feed
 *        never offers a request the decision would 403 on.
 *   POST /api/mro/asset-requests/:id/approve|reject|execute — see below.
 */

import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { AppError } from '@mmbix/utils';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { PermissionEvaluator } from '@/lib/services/permission-evaluator';
import { SmartCollectionService } from '@/lib/services/smart-collection.service';
import { success, fail } from '@/lib/api/response';
import type { AuthContext } from '@/lib/services/auth.service';
import { idempotencyMiddleware } from '@/plugins/idempotency/plugin';
import {
	MroError,
	MroInventoryService,
	MRO_LOCATIONS,
	MRO_MOVEMENT_DIRECTIONS,
	type MroLocation,
	type MroMovementDirection,
} from './inventory.service';
import { relinkAllFleets } from './veh-relink';
import { relinkCareAllFleets } from './veh-care-denorm';
import { relinkInboundPayments, relinkAllInboundPayments } from './inbound-payments';
import { collectionTable } from '@/lib/utils/table-name';
import { findDuplicateRequisition, REQUISITION_DUPLICATE_ACK, REQUISITION_DUPLICATE_MESSAGE } from './requisition-guard';
import { notifyAssetRequestDecided } from './asset-request-notify';
import { notifyRequisitionDecided } from './requisition-notify';

type MroBindings = {
	Bindings: { DB: D1Database };
	Variables: { auth: AuthContext };
};

const app = new Hono<MroBindings>();
app.use('*', requireAuth);
app.use('*', idempotencyMiddleware());

function serviceOf(c: Context<MroBindings>): MroInventoryService {
	return new MroInventoryService(new D1Client(c.env.DB));
}

/**
 * The collection-level business gate for a raw `/api/mro` route — the SAME
 * `_role_permissions` check the generic entity route enforces (`write` for the
 * routes that confirm documents, `create` for a pre-flight of a create), so an
 * operator can never reach through a service route what the generic API denies.
 * An admin (and the dev-token path) is the trusted root and passes.
 */
async function gateBusiness(c: Context<MroBindings>, collection: string, action: 'create' | 'write'): Promise<Response | true> {
	const auth = c.get('auth');
	if (auth.is_admin) return true;
	const allowed = await PermissionEvaluator.checkBusiness(new D1Client(c.env.DB), auth, collection, action);
	if (!allowed) return fail(c, `You do not have "${action}" permission on "${collection}"`, 403);
	return true;
}

/** Gate a route that MOVES/UPDATES records (confirm, reject, issue, …). */
function gateWrite(c: Context<MroBindings>, collection: string): Promise<Response | true> {
	return gateBusiness(c, collection, 'write');
}

/** The module's error → response mapping. `MroError` is the module's own refusal
 *  and carries its own status; an engine `AppError` (a `ValidationError` from a
 *  compiled guard, a `ForbiddenError` from the write lock, a `ConflictError` from
 *  optimistic concurrency) is passed through with ITS status + code rather than
 *  flattened to a 500 — the 500 would tell the caller to retry a write that can
 *  never succeed, and would hide a deliberate refusal ("a void receipt takes no
 *  payment") behind "Internal error". */
function handleError(c: Context<MroBindings>, err: unknown) {
	if (err instanceof MroError) return fail(c, err.message, err.status);
	if (err instanceof AppError) return fail(c, err.message, err.statusCode, err.code);
	console.error('[mro] unhandled route error', err);
	return fail(c, 'Internal error — nothing was changed, try again', 500);
}

/**
 * The acting employee for a write — bound to the SESSION, never to the request
 * body. The signed JWT carries `employee_id` (embedded at login from the
 * employee directory), so a non-admin can never forge `by_user` / `approved_by`
 * / `issued_by` by naming someone else in the payload. Only an admin — the
 * trusted root, and the dev-token path — may name another actor explicitly
 * (e.g. recording a movement on a kiosk operator's behalf). An identity with no
 * directory row resolves to undefined, which the services record as an unknown
 * actor rather than a false name.
 */
function actorOf(c: Context<MroBindings>, bodyValue?: unknown): string | undefined {
	const auth = c.get('auth');
	if (auth.employee_id) return auth.employee_id;
	if (auth.is_admin && typeof bodyValue === 'string' && bodyValue.trim()) return bodyValue.trim();
	return undefined;
}

// ── Vehicle directory — recompute fleet "current document" pointers ───────

// Recompute EVERY fleet's last_license / last_insurance from its own document
// set (date-ordered — see veh-relink.ts). The create/update lifecycle hooks
// keep the pointers fresh automatically; this maintenance route exists because
// the engine has NO after_delete event and a doc moved to another vehicle
// leaves its old fleet stale. Idempotent (rewrites from the document source of
// truth) — safe to run anytime, e.g. nightly via a scheduler http.request task.
app.post('/veh/relink', requireAdmin, async (c: Context<MroBindings>) => {
	try {
		const relinked = await relinkAllFleets(new D1Client(c.env.DB));
		return success(c, { relinked });
	} catch (err) {
		return handleError(c, err);
	}
});

// Fleet care denorm recompute — rebuilds veh_fleets.last_odo /
// last_engine_oil / last_gear_oil from each vehicle's month + fill rows. The
// create/update lifecycle hooks keep them fresh automatically; this route
// exists because the engine has NO after_delete event and a soft-deleted /
// re-homed reading or fill leaves a stale pointer.
app.post('/veh/care/relink', requireAdmin, async (c: Context<MroBindings>) => {
	try {
		const relinked = await relinkCareAllFleets(new D1Client(c.env.DB));
		return success(c, { relinked });
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Stock in — confirm a draft inbound ───────────────────────────────────

app.post('/inbounds/:id/confirm', async (c) => {
	const gate = await gateWrite(c, 'mro_inbounds');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await serviceOf(c).confirmInbound(c.req.param('id'), {
			// Session actor first (see actorOf) — the body only names one for an admin.
			receivedBy: actorOf(c, body?.received_by),
		});
		// The receipt's money mirror is a function of (total_amount, live ledger) and
		// this confirm just moved BOTH — the totals it wrote, and the entry a
		// `paid_at_receipt` draft asked for. The hook would land a tick later; AWAIT
		// the derivation so the response already carries the settled state, exactly
		// like the payment routes do.
		const payment = await relinkInboundPayments(new D1Client(c.env.DB), c.req.param('id'));
		return success(c, { ...result, payment }, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Stock in — CANCEL an inbound (a draft flip, or a POSTED receipt reversed) ───
// ONE endpoint for both ends of the lifecycle, because the DOCUMENT decides which
// one applies: a client that had to choose between "cancel draft" and "reverse"
// could pick wrong, and a wrong pick writes a conflict into the ledger.

app.post('/inbounds/:id/cancel', async (c) => {
	const gate = await gateWrite(c, 'mro_inbounds');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await serviceOf(c).cancelInbound(c.req.param('id'), {
			// The session actor — a reversal moves stock, so it is never anonymous.
			cancelledBy: actorOf(c, body?.cancelled_by),
		});
		// The receipt's money mirror follows its ledger: a paid-at-receipt entry is
		// withdrawn with the reversal, so re-derive (and AWAIT) it before answering.
		const payment = await relinkInboundPayments(new D1Client(c.env.DB), c.req.param('id'));
		return success(c, { ...result, payment }, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

// Purchase receipts — re-derive every receipt's payment mirror from its ledger.
// The write hooks keep it fresh; this repairs rows that predate the feature (their
// mirror columns are still NULL) and any drift. Idempotent — safe to run anytime.
app.post('/inbounds/relink-payments', requireAdmin, async (c: Context<MroBindings>) => {
	try {
		const relinked = await relinkAllInboundPayments(new D1Client(c.env.DB));
		return success(c, { relinked });
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Purchase receipt — record ONE payment (ledger write + its mirror) ──────
// The generic entity API also files a payment (and Studio/CLI/import use it),
// but there the receipt's mirror is re-derived by an after-insert hook, which is
// FIRE-AND-FORGET — so a screen that refreshes the instant the response lands can
// still read the previous Paid figure. A money figure deserves better: this route
// runs the SAME engine create (same validation, same policies, same guard) and
// then AWAITS the derivation, so `data.payment` carries the receipt's new state
// and the client never has to guess. Guarded by `write` on `mro_inbounds` — the
// collection whose money it changes.
app.post('/inbounds/:id/payments', async (c) => {
	const gate = await gateWrite(c, 'mro_inbounds');
	if (gate !== true) return gate;
	const inboundId = c.req.param('id');
	try {
		const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
		const amount = Number(body?.amount);
		const paidOn = typeof body?.paid_on === 'string' ? body.paid_on.trim() : '';
		if (!paidOn || !Number.isFinite(amount) || amount <= 0) {
			return fail(c, 'A payment needs a paid_on date and a positive amount', 400);
		}

		const svc = new SmartCollectionService(new D1Client(c.env.DB), c.get('auth'));
		const row = await svc.createItem(
			'mro_inbound_payments',
			{
				parent_id: inboundId,
				paid_on: paidOn,
				amount,
				...(typeof body?.method === 'string' && body.method ? { method: body.method } : {}),
				...(typeof body?.reference === 'string' && body.reference.trim() ? { reference: body.reference.trim() } : {}),
				...(typeof body?.note === 'string' && body.note.trim() ? { note: body.note.trim() } : {}),
			},
			c,
		);
		const payment = await relinkInboundPayments(new D1Client(c.env.DB), inboundId);
		return success(c, { ...row, payment }, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Purchase receipt — REMOVE one payment (ledger soft-delete + its mirror) ──
// The missing half of the correction path: a recorded payment's money columns are
// IMMUTABLE, so a mistake is fixed by removing the entry and filing the right one.
// The generic `DELETE /api/entities/mro_inbound_payments/:id` CANNOT be that path
// for a real operator: it needs `can_delete` on the ledger, and no operational role
// carries it (the standard grant set is read/write/create/submit — see
// `scripts/reconcile-storekeeper-role.mjs`, where the ledger is deliberately
// read-only), so a storekeeper met
//   `You do not have "delete" permission on "mro_inbound_payments"`.
// Removal therefore gets the SAME treatment as filing: a domain route gated on
// `write` for `mro_inbounds` — the collection whose money it changes — with the
// mirror re-derived and AWAITED, so the sheet that asked never renders a stale
// Paid figure.
//
// The receipt is part of the payment's IDENTITY, not a hint: a row whose
// `parent_id` is another receipt is REFUSED (409), because there the mirror of the
// wrong document is what would be stepped back. The delete itself is the engine's
// soft delete — `deleted_by` is stamped from the session, the row leaves the live
// set, and a restore brings it back (the correction path, end to end, is
// remove → re-file and stays traceable either way).
app.delete('/inbounds/:id/payments/:paymentId', async (c) => {
	const gate = await gateWrite(c, 'mro_inbounds');
	if (gate !== true) return gate;
	const inboundId = c.req.param('id');
	const paymentId = c.req.param('paymentId');
	try {
		const db = new D1Client(c.env.DB);
		const existing = await db.first<{ parent_id: string | null; deleted_at: string | null }>({
			sql: `SELECT parent_id, deleted_at FROM ${collectionTable('mro_inbound_payments')} WHERE id = ?1`,
			bindings: [paymentId],
		});
		if (!existing) return fail(c, 'No such payment entry', 404);
		if (existing.parent_id !== inboundId) return fail(c, 'That payment belongs to another receipt', 409);

		// A replay (or a double tap) is a NO-OP that still re-derives: the caller
		// always ends up holding the receipt's current money state, never a stale one.
		if (!existing.deleted_at) {
			await new SmartCollectionService(db, c.get('auth')).softDeleteItem('mro_inbound_payments', paymentId, c);
		}
		const payment = await relinkInboundPayments(db, inboundId);
		return success(c, { id: paymentId, payment });
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Stock out — confirm a draft outbound ─────────────────────────────────

app.post('/outbounds/:id/confirm', async (c) => {
	const gate = await gateWrite(c, 'mro_outbounds');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await serviceOf(c).confirmOutbound(c.req.param('id'), {
			// Body optional — preserves the prior no-body shape for write-offs/legacy.
			issuedBy: actorOf(c, body?.issued_by),
		});
		return success(c, result, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Stock out — CANCEL an outbound (a draft flip, or a POSTED issue reversed) ──
// The mirror of the inbound route: the document's own state decides, a posted issue
// is put back from its own allocation trace, and any unit that has since moved on
// refuses the whole reversal instead of being yanked.

app.post('/outbounds/:id/cancel', async (c) => {
	const gate = await gateWrite(c, 'mro_outbounds');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await serviceOf(c).cancelOutbound(c.req.param('id'), {
			cancelledBy: actorOf(c, body?.cancelled_by),
		});
		return success(c, result, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Location-to-location transfer — confirm a draft transfer ──────────────

app.post('/transfers/:id/confirm', async (c) => {
	const gate = await gateWrite(c, 'mro_transfers');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await serviceOf(c).confirmTransfer(c.req.param('id'), {
			approvedBy: actorOf(c, body?.approved_by),
		});
		return success(c, result, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Location-to-location transfer — CANCEL it (a draft flip, or a CONFIRMED move
// reversed from its own lot/serial trace) ────────────────────────────────────
// A confirmed move is undone from its own trace: the source lots get their takes
// back, the destination lots come down, each moved unit returns to the source
// store, both balances are restored, and the move's trace rows + OWN serial events
// go with it — all in the same atomic batch that flips the header. Refused (409)
// when the moved stock has been drawn on at the destination or a unit has moved on.

app.post('/transfers/:id/cancel', async (c) => {
	const gate = await gateWrite(c, 'mro_transfers');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await serviceOf(c).cancelTransfer(c.req.param('id'), {
			cancelledBy: actorOf(c, body?.cancelled_by),
		});
		return success(c, result, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Adjustment — confirm an operator-reported stock change ────────────────

app.post('/adjustments/:id/confirm', async (c) => {
	const gate = await gateWrite(c, 'mro_adjustments');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await serviceOf(c).confirmAdjustment(c.req.param('id'), {
			approvedBy: actorOf(c, body?.approved_by),
		});
		return success(c, result, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Adjustment — CANCEL it (a draft flip, or an APPLIED correction reversed) ──
// An approved correction is undone from its own line trace: an added lot is taken
// back whole (or refused while it has been drawn on), a removed lot gets its FEFO
// takes back, and a removed unit returns to stock.

app.post('/adjustments/:id/cancel', async (c) => {
	const gate = await gateWrite(c, 'mro_adjustments');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await serviceOf(c).cancelAdjustment(c.req.param('id'), {
			cancelledBy: actorOf(c, body?.cancelled_by),
		});
		return success(c, result, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Requisition — pre-flight duplicate WARNING (read-only) ─────────────────
// The same-day duplicate guard refuses an identical basket filed through the
// generic API. The form asks HERE first, so an operator who taps Submit sees a
// confirmation instead of a refusal: the check reads the SAME verdict the guard
// enforces (`findDuplicateRequisition` — one rule, two readers), and the client
// may then file the request anyway by returning the `ack` token in the
// `X-Write-Ack` header (see lib/write-ack.ts). Deny-by-default is untouched: an
// unacknowledged create is still refused on every path.
//
// The requester is the SESSION actor (`actorOf`) — exactly the identity the
// create will record — so the pre-flight can never disagree with the guard.
app.post('/requisitions/check-duplicate', async (c) => {
	const gate = await gateBusiness(c, 'mro_requisitions', 'create');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const duplicate = await findDuplicateRequisition(new D1Client(c.env.DB), {
			requested_by: actorOf(c, body?.requested_by),
			request_date: body?.request_date,
			lines: body?.lines,
		});
		return success(c, {
			duplicate: duplicate !== null,
			message: duplicate ? REQUISITION_DUPLICATE_MESSAGE : null,
			display_number: duplicate?.displayNumber ?? null,
			ack: duplicate ? REQUISITION_DUPLICATE_ACK : null,
		});
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Requisition — approve a draft stock request (no stock effect) ──────────

app.post('/requisitions/:id/confirm', async (c) => {
	const gate = await gateWrite(c, 'mro_requisitions');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await serviceOf(c).confirmRequisition(c.req.param('id'), {
			approvedBy: actorOf(c, body?.approved_by),
		});
		await notifyRequisitionDecided(new D1Client(c.env.DB), c.req.param('id'), 'approved');
		return success(c, result, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Requisition — reject/close an open request (no stock effect) ───────────
// Store keeper closes a request they will not fulfil (or will only partly fulfil,
// with the remainder closed). NO-stock: never touches balances and guard-409s an
// already fulfilled/cancelled request. Optional body { close_reason }.

app.post('/requisitions/:id/reject', async (c) => {
	const gate = await gateWrite(c, 'mro_requisitions');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await serviceOf(c).rejectRequisition(c.req.param('id'), {
			closeReason: typeof body?.close_reason === 'string' ? body.close_reason : null,
		});
		await notifyRequisitionDecided(
			new D1Client(c.env.DB),
			c.req.param('id'),
			'rejected',
			typeof body?.close_reason === 'string' ? body.close_reason : '',
		);
		return success(c, result, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Requisition — ISSUE stock against an approved request (atomic) ─────────
// The single server seam that creates the goods-issue outbound AND confirms it,
// so a client abort between the two can never strand an orphaned draft. Reuses
// the engine's composite creator (numbering + lines) and `confirmOutbound`.
// Guarded by `write` on `mro_outbounds` (the collection the confirm writes).
app.post('/requisitions/:id/issue', async (c) => {
	const gate = await gateWrite(c, 'mro_outbounds');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const svc = new SmartCollectionService(new D1Client(c.env.DB), c.get('auth'));
		const result = await serviceOf(c).issueRequisition(c.req.param('id'), {
			issuedBy: actorOf(c, body?.issued_by),
			lines: Array.isArray(body?.lines) ? body.lines : [],
			createOutbound: (payload) => svc.createItem('mro_outbounds', payload, c),
			discardOutbound: async (outboundId) => {
				await svc.softDeleteItem('mro_outbounds', outboundId, c);
			},
		});
		await notifyRequisitionDecided(new D1Client(c.env.DB), c.req.param('id'), 'issued');
		return success(c, result, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Asset transfer request — superior approves/rejects, then execute moves ──
// A truck→truck (or person→person) asset move is FILED as an `mro_asset_requests`
// row (generic entity API), DECIDED here by a recorded superior of the requester
// (admin may decide any), then EXECUTED as one atomic move pinned to the source.

app.get('/asset-requests', async (c) => {
	const auth = c.get('auth');
	const raw = c.req.query('status');
	try {
		const result = await serviceOf(c).listAssetRequests({
			approverId: auth.employee_id ?? null,
			isAdmin: auth.is_admin,
			// The decide queue is the default; a caller may pass a comma list
			// (`approved,executed`) to fold the tracking view into one page.
			statuses:
				raw == null || raw.trim() === ''
					? ['requested']
					: raw
							.split(',')
							.map((s) => s.trim())
							.filter(Boolean),
			search: c.req.query('search')?.trim() || null,
			cursor: c.req.query('cursor') ?? null,
			limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
		});
		return success(c, result);
	} catch (err) {
		return handleError(c, err);
	}
});

app.post('/asset-requests/:id/approve', async (c) => {
	const gate = await gateWrite(c, 'mro_asset_requests');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await serviceOf(c).approveAssetRequest(c.req.param('id'), {
			actorId: actorOf(c, body?.actor_id),
			allowAnyApprover: c.get('auth').is_admin,
		});
		await notifyAssetRequestDecided(new D1Client(c.env.DB), c.req.param('id'), 'approved');
		return success(c, result, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

app.post('/asset-requests/:id/reject', async (c) => {
	const gate = await gateWrite(c, 'mro_asset_requests');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await serviceOf(c).rejectAssetRequest(c.req.param('id'), {
			actorId: actorOf(c, body?.actor_id),
			reason: typeof body?.reason === 'string' ? body.reason : null,
			allowAnyApprover: c.get('auth').is_admin,
		});
		await notifyAssetRequestDecided(
			new D1Client(c.env.DB),
			c.req.param('id'),
			'rejected',
			typeof body?.reason === 'string' ? body.reason : '',
		);
		return success(c, result, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

app.post('/asset-requests/:id/execute', async (c) => {
	const gate = await gateWrite(c, 'mro_asset_requests');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await serviceOf(c).executeAssetRequest(c.req.param('id'), {
			actorId: actorOf(c, body?.actor_id),
			allowAnyApprover: c.get('auth').is_admin,
		});
		await notifyAssetRequestDecided(new D1Client(c.env.DB), c.req.param('id'), 'executed');
		return success(c, result, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Expiry + on-hand reads ────────────────────────────────────────────────

app.get('/stock/expiring', async (c) => {
	// `?days` OMITTED → the server derives the horizon from the widest per-model
	// `expiry_alert_days` (see `expiringStock`), so no configured item is missed.
	const raw = c.req.query('days');
	const days = raw == null || raw.trim() === '' ? undefined : Number(raw);
	try {
		const result = await serviceOf(c).expiringStock(Number.isFinite(days) ? days : undefined);
		return success(c, result);
	} catch (err) {
		return handleError(c, err);
	}
});

app.get('/stock/onhand', async (c) => {
	try {
		const rows = await serviceOf(c).onHand();
		return success(c, { rows });
	} catch (err) {
		return handleError(c, err);
	}
});

// ONE SKU's stock composition — balances + lots + serials, display-ready, behind
// the stock card's drill-down PAGE (`/app/stocks/item/:modelId`) AND the
// outbound form's serial picker (`?location=` scopes the trace to ONE store, so
// the picker only offers units the issue can actually draw from). Server-scoped
// (NOT the generic entity API): `mro_stock_lots` is not in the Telegram role's
// config grant list, so a generic read would 403 a real employee. Read-only.
app.get('/stock/items/:modelId', async (c) => {
	try {
		return success(c, await serviceOf(c).itemComposition(c.req.param('modelId'), { location: c.req.query('location') }));
	} catch (err) {
		return handleError(c, err);
	}
});

// Integrity reconciliation — admin-gated (it exposes internal ledger defects, not
// operational stock). Read-only; clean data returns summary.total === 0.
app.get('/stock/reconcile', requireAdmin, async (c: Context<MroBindings>) => {
	try {
		return success(c, await serviceOf(c).reconcile());
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Asset holder chore — move an issued unit between holders (no stock move) ──
// Body { to_vehicle?, to_slot?, to_employee?, note?, actor_id? }: relocates an
// ALREADY-issued asset between a wheel position, a truck's inventory tray and an
// employee's custody in ONE guarded batch. Never touches a store balance (the
// unit stays `issued`); it only moves the holder seam and appends the truthful
// `rotated` / `refitted` / `fitted` / `issued` / `reissued` lifecycle event.
//
// GOVERNED — only the SAME-holder shapes are direct (rotating/re-seating a unit
// the SAME truck already holds, or re-slotting a truck's own spare). A move that
// CHANGES the holder (truck→truck, person→person) is the approval-gated shape:
// this route 403s, and the unit travels via `mro_asset_requests`
// (file → `.../approve` → `.../execute`). A truck↔person move is refused on
// EVERY path — route the unit through the store instead (return, then issue).
// See `assertCustodyChangeAllowed` in `inventory/custody.ts`.

app.post('/serials/:id/move', async (c) => {
	const gate = await gateWrite(c, 'mro_stock_serials');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await serviceOf(c).moveSerialAsset({
			serialId: c.req.param('id'),
			actorId: actorOf(c, body?.actor_id),
			toVehicle: typeof body?.to_vehicle === 'string' ? body.to_vehicle : undefined,
			toSlot: typeof body?.to_slot === 'string' ? body.to_slot : undefined,
			toEmployee: typeof body?.to_employee === 'string' ? body.to_employee : undefined,
			note: typeof body?.note === 'string' ? body.note : undefined,
		});
		return success(c, result, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Asset inspection — measure remaining tread / pressure / condition ──
// POST /api/mro/serials/:id/check — records REAL measurements on an issued
// (in-use) asset: updates its live tread_mm/psi/condition snapshot + appends one
// immutable `checked` event. Mirrors /move (guard issued state), never an estimate.

app.post('/serials/:id/check', async (c) => {
	const gate = await gateWrite(c, 'mro_stock_serials');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const tread = body?.tread_mm;
		const pressure = body?.psi;
		const result = await serviceOf(c).recordSerialCheck({
			serialId: c.req.param('id'),
			actorId: actorOf(c, body?.actor_id),
			treadMm: tread == null ? null : Number(tread),
			psi: pressure == null ? null : Number(pressure),
			condition: typeof body?.condition === 'string' ? body.condition : undefined,
			note: typeof body?.note === 'string' ? body.note : undefined,
		});
		return success(c, result, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

// POST /api/mro/serials/:id/issue — hand an in-store / loose asset to an employee.
app.post('/serials/:id/issue', async (c) => {
	const gate = await gateWrite(c, 'mro_stock_serials');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await serviceOf(c).issueSerialToHolder({
			serialId: c.req.param('id'),
			actorId: actorOf(c, body?.actor_id),
			toEmployee: typeof body?.to_employee === 'string' ? body.to_employee : undefined,
			note: typeof body?.note === 'string' ? body.note : undefined,
		});
		return success(c, result, 201);
	} catch (err) {
		return handleError(c, err);
	}
});
// ── Tyre kiosk chore — fit / return / scrap / swap (fitment-board fast path) ──
// POST /api/mro/serials/:id/fit — seat an in-store OR issued-spare tyre onto a
// VACANT wheel position (guard seat-empty). Store stock leaves that store's
// balance in the same batch; one immutable `fitted` event is appended. An
// optional `event_date` (YYYY-MM-DD) records the operator-chosen PHYSICAL day
// (the "wear date") on that event; omitted ⇒ the history uses `created_at`.

app.post('/serials/:id/fit', async (c) => {
	const gate = await gateWrite(c, 'mro_stock_serials');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await serviceOf(c).fitSerialToSeat({
			serialId: c.req.param('id'),
			actorId: actorOf(c, body?.actor_id),
			toVehicle: typeof body?.to_vehicle === 'string' ? body.to_vehicle : undefined,
			toSlot: typeof body?.to_slot === 'string' ? body.to_slot : undefined,
			note: typeof body?.note === 'string' ? body.note : undefined,
			eventDate: typeof body?.event_date === 'string' ? body.event_date : undefined,
		});
		return success(c, result, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

// POST /api/mro/serials/:id/return — unmount an issued asset back into a store
// (default `vehicle_store`): flips to in_stock, clears the seat, adds ONE unit
// back to the target store's balance and appends a `returned` event.
//
// GOVERNED — a return is ALWAYS a holder→store change, so this route is the
// INTERNAL wrinkle only: it 403s unless the caller carries the custody token
// (`authorizedBy: AUTHORIZED_BY_ASSET_REQUEST`), which only an approved RETURN
// request's execute does. A truck or an employee returns a unit by filing a
// return request (`mro_asset_requests` with `to_location`) and having the
// requester's recorded superior approve it — there is no direct-return path.
// Admin does NOT bypass this: `authorizedBy` is passed by the service caller,
// never taken from the request body.

app.post('/serials/:id/return', async (c) => {
	const gate = await gateWrite(c, 'mro_stock_serials');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await serviceOf(c).returnSerialToStore({
			serialId: c.req.param('id'),
			actorId: actorOf(c, body?.actor_id),
			toLocation: typeof body?.to_location === 'string' ? body.to_location : undefined,
			note: typeof body?.note === 'string' ? body.note : undefined,
		});
		return success(c, result, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

// POST /api/mro/serials/:id/scrap — write a MOUNTED tyre off where it sits:
// `issued` → `scrapped`, seat cleared (no store balance move — issued units are
// already out of every store's stock), one `written_off` event appended.
//
// GOVERNED — a write-off ends the unit's custody, so this route is the INTERNAL
// wrinkle only: it 403s unless the caller carries the custody token
// (`authorizedBy: AUTHORIZED_BY_ASSET_REQUEST`), which only an approved WRITE-OFF
// request's execute does. A worn-out unit is written off by filing a request
// (`mro_asset_requests` with `write_off`) and having the requester's recorded
// superior approve it — there is no direct-write-off path, exactly as there is
// none for a return. Admin does NOT bypass this: `authorizedBy` is passed by the
// service caller, never taken from the request body.

app.post('/serials/:id/scrap', async (c) => {
	const gate = await gateWrite(c, 'mro_stock_serials');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await serviceOf(c).scrapMountedSerial({
			serialId: c.req.param('id'),
			actorId: actorOf(c, body?.actor_id),
			note: typeof body?.note === 'string' ? body.note : undefined,
		});
		return success(c, result, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

// POST /api/mro/serials/swap — exchange TWO seated tyres on the SAME truck in one
// guarded batch: each takes the other's wheel slot and both log `rotated`. A
// cross-truck exchange is refused (400) — that movement goes through an
// approval-gated asset-transfer request. Body { serial_a, serial_b, note?, actor_id? }.

app.post('/serials/swap', async (c) => {
	const gate = await gateWrite(c, 'mro_stock_serials');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await serviceOf(c).swapSerialSeats({
			serialA: typeof body?.serial_a === 'string' ? body.serial_a : '',
			serialB: typeof body?.serial_b === 'string' ? body.serial_b : '',
			actorId: actorOf(c, body?.actor_id),
			note: typeof body?.note === 'string' ? body.note : undefined,
		});
		return success(c, result, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

// GET /api/mro/serials/:id/events — ONE `mro_stock_serials` unit's immutable
// lifecycle timeline, newest first. Read-only (no stock effect): a direct D1
// query because the generic entity-list `?filter=` is ignored for these MRO
// tables. Vehicle + actor m2o values come back resolved to plate_no/name_en.

app.get('/serials/:id/events', async (c) => {
	try {
		const rows = await serviceOf(c).serialEvents(c.req.param('id'));
		return success(c, { rows });
	} catch (err) {
		return handleError(c, err);
	}
});

// GET /api/mro/assets/holder — every ASSET UNIT a holder currently has: one
// truck (`?vehicle=`) or one employee (`?employee=`). ONE read for the whole
// register: a tyre or any `assets` item (jack, toolbox) resolved with its SKU,
// plate, holder and live readings. The holder is DERIVED server-side (employee ?
// person : vehicle ? truck+slot : store) — the client never joins masters and
// never walks the register. Without a holder it returns every held asset.
app.get('/assets/holder', async (c) => {
	try {
		const vehicle = c.req.query('vehicle')?.trim() || null;
		const employee = c.req.query('employee')?.trim() || null;
		const rows = await serviceOf(c).holderAssets({ vehicle, employee });
		return success(c, { rows, holder: { vehicle, employee } });
	} catch (err) {
		return handleError(c, err);
	}
});

// POST /api/mro/serials/:id/unseat — take a seated tyre OFF a wheel and keep it
// on the SAME truck as a standby spare (the truck's inventory tray). The unit
// stays `issued` + vehicle-bound; only its wheel slot clears and one immutable
// `unseated` history row is appended. Body { note?, actor_id?, event_date? } —
// an optional `event_date` (YYYY-MM-DD) is the operator-chosen PHYSICAL day (the
// "un-wear date"); omitted ⇒ the history uses `created_at`.
app.post('/serials/:id/unseat', async (c) => {
	const gate = await gateWrite(c, 'mro_stock_serials');
	if (gate !== true) return gate;
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await serviceOf(c).unseatSerialToTray({
			serialId: c.req.param('id'),
			actorId: actorOf(c, body?.actor_id),
			note: typeof body?.note === 'string' ? body.note : undefined,
			eventDate: typeof body?.event_date === 'string' ? body.event_date : undefined,
		});
		return success(c, result, 201);
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Doc-level category read — in/out docs whose lines carry a category ────
// Rows are headers (newest first) so clients reuse the plain list's card.
app.get('/documents/category', async (c) => {
	const kind = c.req.query('kind');
	const categoryId = c.req.query('category');
	const location = c.req.query('location');
	const type = c.req.query('type');
	if (kind !== 'inbounds' && kind !== 'outbounds') return fail(c, 'kind must be inbounds or outbounds', 400);
	if (!categoryId || !location || !type) return fail(c, 'category, location and type are required', 400);
	try {
		const rows = await serviceOf(c).documentsInCategory({
			kind,
			categoryId,
			location: location as MroLocation,
			type,
		});
		return success(c, { rows });
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Parts-movement — Screen 1's moving groups + Screen 2/3 line/ledger reads ──
// The Movement app (tgapp `/app/movements`): Screen 1 lists the item-name
// groups that have CONFIRMED movement (`/movement/groups`, keyset-paged — never
// a whole-catalog walk); Screens 2 + 3 read that group's lines / one model's
// ledger.

const movementDirectionOf = (c: Context<MroBindings>): MroMovementDirection | Response => {
	const direction = c.req.query('direction') ?? 'all';
	if (!(MRO_MOVEMENT_DIRECTIONS as string[]).includes(direction))
		return fail(c, `direction must be one of: ${MRO_MOVEMENT_DIRECTIONS.join(', ')}`, 400);
	return direction as MroMovementDirection;
};

const movementLocationOf = (c: Context<MroBindings>): MroLocation | null | Response => {
	const location = c.req.query('location');
	if (location && !(MRO_LOCATIONS as string[]).includes(location)) return fail(c, 'unknown location', 400);
	return (location as MroLocation) ?? null;
};

// The moving item-name masters (Screen 1 rows) — the groups with CONFIRMED
// movement, name-sorted + keyset-paginated. No auth-agnostic whole-catalog read.
// An optional `?search=` term narrows it server-side (the groups kiosk's
// type-ahead): the group's display names OR any of its live models' names.
app.get('/movement/groups', async (c) => {
	try {
		const result = await serviceOf(c).movementGroups({
			cursor: c.req.query('cursor') ?? null,
			search: c.req.query('search')?.trim() || null,
		});
		return success(c, result);
	} catch (err) {
		return handleError(c, err);
	}
});

// ── Catalogue directory — the item-groups hub ────────────────────────────
// The whole-catalogue item-group directory (tgapp `/app/mro-categories`): every
// item-name master that has at least one live SKU, with its SKU count. Same
// shape the hub already renders — but ONE aggregate query server-side instead
// of the client cursor-walking the whole `mro_item_model` catalogue.
app.get('/catalog/groups', async (c) => {
	try {
		const result = await serviceOf(c).catalogGroups();
		return success(c, result);
	} catch (err) {
		return handleError(c, err);
	}
});

// The models of one item-name group that have confirmed movement (Screen 2's
// DEFAULT rows) — the group's SKUs with their totals, keyset-paged.
app.get('/movement/models', async (c) => {
	const group = c.req.query('group');
	if (!group) return fail(c, 'group is required', 400);
	const direction = movementDirectionOf(c);
	if (direction instanceof Response) return direction;
	const location = movementLocationOf(c);
	if (location instanceof Response) return location;
	try {
		const result = await serviceOf(c).movementModels({
			group,
			direction,
			location,
			cursor: c.req.query('cursor') ?? null,
		});
		return success(c, result);
	} catch (err) {
		return handleError(c, err);
	}
});

// One item-name group's CONFIRMED movement LINE feed (Screen 2 — the group
// screen shows every in/out/transfer line of its models, not a model summary).
app.get('/movement/lines', async (c) => {
	const group = c.req.query('group');
	if (!group) return fail(c, 'group is required', 400);
	const direction = movementDirectionOf(c);
	if (direction instanceof Response) return direction;
	const location = movementLocationOf(c);
	if (location instanceof Response) return location;
	try {
		const result = await serviceOf(c).movementGroupLines({
			group,
			direction,
			location,
			cursor: c.req.query('cursor') ?? null,
		});
		return success(c, result);
	} catch (err) {
		return handleError(c, err);
	}
});

// One model's line-level ledger + header summary (Screen 3).
app.get('/movement/ledger', async (c) => {
	const model = c.req.query('model');
	if (!model) return fail(c, 'model is required', 400);
	const direction = movementDirectionOf(c);
	if (direction instanceof Response) return direction;
	const location = movementLocationOf(c);
	if (location instanceof Response) return location;
	try {
		const result = await serviceOf(c).movementLedger({
			model,
			direction,
			location,
			cursor: c.req.query('cursor') ?? null,
		});
		return success(c, result);
	} catch (err) {
		return handleError(c, err);
	}
});

export const mroRoutes = app;
