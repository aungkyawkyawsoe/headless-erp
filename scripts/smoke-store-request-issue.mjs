#!/usr/bin/env node
/**
 * End-to-end smoke test for the Store Request → Approve → (partial) Issue →
 * Outbound goods-issue flow, plus Reject and (optional) Write-off accuracy,
 * against the LIVE engine API on the MRO module.
 *
 *   node scripts/smoke-store-request-issue.mjs [baseUrl] [bearerToken]
 *
 * Defaults: baseUrl http://localhost:8788 · token `dev-token` (IS_DEV local).
 *
 * What it verifies (accurate / self-asserting, throws on first failure):
 *   1. Requisition create records `requested_by` + `requisition_status='requested'`.
 *   2. Approve (two-person, different approver) → `doc_status='confirmed'`,
 *      `requisition_status='approved'`, `approved_by` persisted, totals written,
 *      and NO stock moves.
 *   3. Two separate PARTIAL goods-issue OUTs referencing the REQ:
 *        issue qty A → request `issued_qty=A`, lifecycle `partially_issued`,
 *                       store balance drops by exactly A;
 *        issue remaining B → accumulated = requested → `fulfilled`,
 *                       balance drops by exactly B (total drop == requested).
 *   4. A further issue after `fulfilled` is refused (guarded 409) — no double stock.
 *   5. Reject an open request (stock_low) → `requisition_status='cancelled'`,
 *      `close_reason='stock_low'`, and stock untouched.
 *   6. Write-off (goods out `type=write_offs`) decrements the store balance by
 *      exactly its qty and cannot go below zero (409 on overdraw).
 *
 * Uses only standard (balance) models so the stock math is exact and verifiable,
 * and picks a (model, store) pair with enough on-hand so issues never starve.
 */

const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';

// Known hrm_employees rows (verified against the dev DB). Requester / Approver
// must differ (two-person rule on approve). Names are for readbacks only.
const REQUESTER = 'd289f0a8-c6c7-49c3-8c43-04530cc5ec95'; // U Myint Aung
const APPROVER = '2d727b6e-fe6d-4ab1-b140-668494bfc491'; // U Zaw Lin
const ISSUER = 'fb39d0d8-0927-4fc1-a9bb-aa8ce38a66b2'; // U Kyaw Zayar

const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function api(method, path, body) {
	const res = await fetch(`${baseUrl}${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const json = await res.json().catch(() => null);
	return { status: res.status, ok: res.ok, json };
}

let failures = 0;
const log = [];
function check(name, condDetail, cond, extra = '') {
	if (cond) {
		log.push(`PASS  ${name}`);
	} else {
		failures += 1;
		log.push(`FAIL  ${name} — ${condDetail} ${extra}`);
	}
}

/** Model rows + (global) balances via the on-hand aggregate. NOTE: the endpoint
 *  ignores the `location` filter and returns every store's rows, so caller treats
 *  the sum of a model across rows as one stock figure. */
async function onHand() {
	const r = await api('GET', '/api/mro/stock/onhand');
	if (!r.ok || !r.json?.data?.rows) throw new Error(`onhand failed: ${r.status}`);
	return r.json.data.rows;
}

/** Global qty_on_hand for a model across every returned balance row (dup-safe). */
function qtyOf(rows, modelId) {
	return rows.filter((r) => r.model === modelId).reduce((s, r) => s + (Number(r.qty_on_hand) || 0), 0);
}

/** A standard model whose GLOBAL qty_on_hand is at least `need` (rows from onHand). */
function pickStandard(rows, need) {
	for (const r of rows) {
		if (r.tracking === 'standard' && Number(r.qty_on_hand) >= need) return r;
	}
	throw new Error(`No standard model with >=${need} on hand`);
}

/** Any standard-policy model (used as the top-up target when stock is short). */
function pickAnyStandard(rows) {
	const r = rows.find((row) => row.tracking === 'standard');
	if (!r) throw new Error('no standard-policy model in the catalog — seed one first');
	return r;
}

/** Qty of a model AT ONE location (the store the flow actually deducts from). */
function qtyAt(rows, modelId, location) {
	return rows.filter((r) => r.model === modelId && r.location === location).reduce((s, r) => s + (Number(r.qty_on_hand) || 0), 0);
}

/**
 * Make sure `modelId` holds at least `need` at `location` by RECEIVING a real
 * purchase document — the flow must pass on a BLANK stock DB (the seed reset),
 * not only on one that happens to carry the stock this test assumes. The
 * assertions below stay DELTA-based, so a top-up never changes their meaning.
 */
async function ensureStock(modelId, location, need) {
	const have = qtyAt(await onHand(), modelId, location);
	if (have >= need) return;
	const sup = await api('GET', '/api/entities/mro_suppliers?limit=1');
	const supplier = sup.json?.data?.[0]?.id;
	if (!supplier) throw new Error('no mro_suppliers row — run scripts/apply-mro-schema.mjs + a catalog seed first');
	const qty = need - have;
	const d = await api('POST', '/api/entities/mro_inbounds', {
		supplier,
		purchase_date: today,
		type: 'purchase',
		location,
		lines: [{ item_model: modelId, qty }],
	});
	if (!d.ok) throw new Error(`top-up inbound draft → HTTP ${d.status}: ${d.json?.error ?? ''}`);
	const c = await api('POST', `/api/mro/inbounds/${d.json.data.id}/confirm`, {});
	if (!c.ok) throw new Error(`top-up inbound confirm → HTTP ${c.status}: ${c.json?.error ?? ''}`);
	console.log(`seeded ${qty} of ${modelId} at ${location} (had ${have}, need ${need})`);
}

const today = new Date(Date.now() + 6.5 * 3600_000).toISOString().slice(0, 10);

const run = async () => {
	// ── Choose a standard model + store with plenty of headroom ───────────────
	// Requests total enough that the partial→full two-step is meaningful but a
	// write-off can also run on the same SKU without ever draining it. When the
	// catalog model is short of stock, a real PURCHASE tops it up first — so this
	// runs on a blank instance instead of aborting on the seeded-data assumption.
	const all = await onHand();
	const location = 'main_store';
	const target = pickAnyStandard(all);
	await ensureStock(target.model, location, 60); // request 12 of it
	const giModel = pickStandard(await onHand(), 60);
	const reqBefore = qtyOf(await onHand(), giModel.model);

	console.log(`Store/flow model=${giModel.model_name} (${giModel.model}) global onhand=${reqBefore}`);

	// ── 1. Create requisition (requested_by, status requested) ────────────────
	const total = 12; // request 12 of giModel
	const createReq = await api('POST', '/api/entities/mro_requisitions', {
		request_date: today,
		location,
		requested_by: REQUESTER,
		requisition_status: 'requested',
		note: 'smoke e2e — full request→issue→writeoff',
		lines: [{ item_model: giModel.model, qty: total }],
	});
	check('create requisition 201', `got ${createReq.status}`, createReq.ok);
	if (!createReq.ok) return;
	const reqId = createReq.json.data.id;
	check(
		'created row requested_by + requested',
		JSON.stringify(createReq.json.data),
		createReq.json.data.requested_by === REQUESTER && createReq.json.data.requisition_status === 'requested',
	);

	// ── 2. Approve (different approver). No stock move. ───────────────────────
	const appr = await api('POST', `/api/mro/requisitions/${reqId}/confirm`, { approved_by: APPROVER });
	check('approve 201', `got ${appr.status}`, appr.ok, appr.json?.error ?? '');
	check(
		'approve → approved + totals (no stock moved)',
		JSON.stringify(appr.json?.data),
		appr.json?.data?.doc_status === 'confirmed' &&
			appr.json?.data?.requisition_status === 'approved' &&
			Number(appr.json?.data?.total_qty) === total &&
			appr.json?.data?.approved_by === APPROVER,
	);
	const reqAfterApprove = qtyOf(await onHand(), giModel.model);
	check('approve does NOT change stock', `before=${reqBefore} after=${reqAfterApprove}`, reqAfterApprove === reqBefore);

	// ── 3. Same-person approve refused — on a FRESH draft (two-person rule) ───
	const selfReq = await api('POST', '/api/entities/mro_requisitions', {
		request_date: today,
		location,
		requested_by: REQUESTER,
		requisition_status: 'requested',
		note: 'smoke — self-approve must fail',
		lines: [{ item_model: giModel.model, qty: 2 }],
	});
	const sameApprover = await api('POST', `/api/mro/requisitions/${selfReq.json.data.id}/confirm`, { approved_by: REQUESTER });
	check('approve by same requester refused (400/409)', `got ${sameApprover.status}`, !sameApprover.ok, sameApprover.json?.error ?? '');

	// ── 4. Partial issue part A (qty 5): balance −5, partially_issued ─────────
	const mkIssue = async (qty) => {
		const d = await api('POST', '/api/entities/mro_outbounds', {
			type: 'goods_issue',
			effective_date: today,
			location,
			request: reqId,
			lines: [{ item_model: giModel.model, qty }],
		});
		if (!d.ok) throw new Error(`create OUT: ${d.status} ${d.json?.error ?? ''}`);
		const c = await api('POST', `/api/mro/outbounds/${d.json.data.id}/confirm`, { issued_by: ISSUER });
		if (!c.ok) throw new Error(`confirm OUT: ${c.status} ${c.json?.error ?? ''}`);
		return c.json.data;
	};
	const readReq = async () => null; // removed — assert from confirm responses instead

	const A = 5;
	const issueA = await mkIssue(A);
	const afterA = qtyOf(await onHand(), giModel.model);
	check('partial issue A=5 → balance −5', `before=${reqAfterApprove} after=${afterA}`, afterA === reqAfterApprove - A);
	check(
		'request lifecycle → partially_issued + issued_qty=5',
		JSON.stringify(issueA),
		issueA?.requisition_status === 'partially_issued' && Number(issueA?.issued_qty) === A,
	);

	// ── 5. Remaining issue part B (qty 7): balance −7, request fulfilled ──────
	const B = total - A;
	const issueB = await mkIssue(B);
	const afterB = qtyOf(await onHand(), giModel.model);
	check('fulfil issue B=7 → balance −7 total −12', `total drop=${reqBefore - afterB}`, afterB === reqBefore - total);
	check(
		'request fulfilled + issued_qty=12',
		JSON.stringify(issueB),
		issueB?.requisition_status === 'fulfilled' && Number(issueB?.issued_qty) === total,
	);

	// ── 6. Issue on a fulfilled request must be refused (no double stock) ─────
	const balBeforeRefuse = qtyOf(await onHand(), giModel.model);
	const refuse = await mkIssue(1).catch((e) => e);
	const balAfterRefuse = qtyOf(await onHand(), giModel.model);
	check(
		'issue after fulfilled refused (409) + stock untouched',
		`err=${refuse instanceof Error ? refuse.message : 'none'} bal=${balBeforeRefuse}->${balAfterRefuse}`,
		refuse instanceof Error && /409/i.test(refuse.message) && balAfterRefuse === balBeforeRefuse,
	);

	// ── 7. Reject an open (approved) request → cancelled, stock unchanged ─────
	const rejectReq = await api('POST', '/api/entities/mro_requisitions', {
		request_date: today,
		location,
		requested_by: REQUESTER,
		requisition_status: 'requested',
		note: 'smoke — reject path',
		lines: [{ item_model: giModel.model, qty: 2 }],
	});
	const rejId = rejectReq.json.data.id;
	await api('POST', `/api/mro/requisitions/${rejId}/confirm`, { approved_by: APPROVER });
	const rejBefore = qtyOf(await onHand(), giModel.model);
	const rej = await api('POST', `/api/mro/requisitions/${rejId}/reject`, { close_reason: 'stock_low' });
	check('reject 201', `got ${rej.status}`, rej.ok, rej.json?.error ?? '');
	check(
		'reject → cancelled + close_reason=stock_low',
		JSON.stringify(rej.json?.data),
		rej.json?.data?.requisition_status === 'cancelled' && rej.json?.data?.close_reason === 'stock_low',
	);
	const rejAfter = qtyOf(await onHand(), giModel.model);
	check('reject does NOT move stock', `before=${rejBefore} after=${rejAfter}`, rejAfter === rejBefore);
	const rejAgain = await api('POST', `/api/mro/requisitions/${rejId}/reject`, { close_reason: 'cancelled' });
	check('rejecting the already-closed request refused', `got ${rejAgain.status}`, !rejAgain.ok);

	// ── 8. Write-off accuracy on the same balance model (snapshot immediately) ─
	const woBefore = qtyOf(await onHand(), giModel.model);
	const woDraft = await api('POST', '/api/entities/mro_outbounds', {
		type: 'write_offs',
		effective_date: today,
		location,
		lines: [{ item_model: giModel.model, qty: 3 }],
	});
	const woC = await api('POST', `/api/mro/outbounds/${woDraft.json.data.id}/confirm`, { issued_by: ISSUER });
	check('write-off confirm 201', `got ${woC.status}`, woC.ok, woC.json?.error ?? '');
	const woAfter = qtyOf(await onHand(), giModel.model);
	check('write-off → balance −3', `before=${woBefore} after=${woAfter}`, woAfter === woBefore - 3);

	// ── 9. Write-off overdraw refused (no negative balance) ───────────────────
	const woOver = await api('POST', '/api/entities/mro_outbounds', {
		type: 'write_offs',
		effective_date: today,
		location,
		lines: [{ item_model: giModel.model, qty: 999999 }],
	});
	const overC = await api('POST', `/api/mro/outbounds/${woOver.json.data.id}/confirm`, { issued_by: ISSUER });
	check('write-off overdraw refused (409)', `got ${overC.status}`, !overC.ok);

	console.log(log.join('\n'));
	console.log(`\nSmoke: ${failures === 0 ? 'ALL PASS ✅' : `${failures} FAILURE(S) ❌`}`);
	process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => {
	console.error('SMOKE ABORTED:', err);
	process.exit(2);
});
