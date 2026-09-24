#!/usr/bin/env node
/**
 * End-to-end smoke test for the MRO stock lifecycle — NEW PURCHASE → USE →
 * WRITE-OFF → RETURN, across all three tracking policies (standard / batch /
 * serial), against the LIVE engine API.
 *
 *   node scripts/smoke-mro-lifecycle.mjs [baseUrl] [bearerToken]
 *
 * Defaults: baseUrl http://localhost:8788 · token `dev-token` (IS_DEV local).
 *
 * WHY it starts from a purchase: `smoke-store-request-issue.mjs` assumes stock
 * already exists and aborts with "No standard model with >=60 on hand" on a
 * blank instance. This test CREATES the stock it needs with a real purchase
 * document, so it passes on an empty catalog+stock DB — and every assertion is
 * a DELTA (before → after), so whatever stock already exists is irrelevant.
 *
 * What it verifies (accurate / self-asserting):
 *   1. NEW PURCHASE — one inbound draft with a line per policy. The draft moves
 *      NO stock; confirm (INB-) adds exactly +20 / +20 / +3, creates the batch
 *      lot and three serial rows, and a re-confirm is an idempotent no-op
 *      (`already: true`, never a double-stock).
 *   2. USE — a goods-issue draft moves no stock; confirm deducts exactly
 *      −8 / −5 / −1 (batch FEFO), flips the picked serial to `issued`, and a
 *      re-confirm is again an idempotent no-op.
 *   3. WRITE-OFF — confirm deducts exactly −4 / −3 / −1 and marks the picked
 *      serial `scrapped`.
 *   4. RETURN — an inbound `type=return` re-instocks the issued serial (+1, no
 *      duplicate row); returning an in-stock unit is refused (409).
 *   5. GUARDS — overdraw is refused (409, stock untouched); issuing a scrapped
 *      serial is refused; an EXPIRED batch lot is excluded from goods-issue
 *      allocation (so an issue larger than the FRESH stock is refused) and is
 *      then struck by a write-off, which leaves the fresh stock untouched.
 *   6. END STATE — balances are exactly standard +8 / batch +12 / serial +2.
 *
 * The models are resolved from the live catalog (one per policy, found by
 * reading each SKU's inherited `item_name.tracking`) and the run uses unique
 * serial numbers + batch numbers (a `Date.now()` tag), so it is safe to re-run
 * any number of times against the same database.
 */
import { listAllRows } from './lib/list-all-rows.mjs';

const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const LOCATION = 'safety_store';
const TAG = Date.now().toString(36);
const SERIALS = [`SMK-${TAG}-1`, `SMK-${TAG}-2`, `SMK-${TAG}-3`];
const BATCH = `SMK-${TAG}-A`;
const BATCH_OLD = `SMK-${TAG}-OLD`;

/** Resolved in setup — every inbound (purchase AND return) must carry a
 *  supplier, so it is filled in ONE place instead of at each call site. */
let SUPPLIER = null;

const mmt = (offsetDays = 0) => {
	const t = Date.now() + 6.5 * 3600_000 + offsetDays * 86_400_000;
	return new Date(t).toISOString().slice(0, 10);
};

async function api(method, path, body) {
	const res = await fetch(`${baseUrl}${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const json = await res.json().catch(() => null);
	return { status: res.status, ok: res.ok, json };
}

const data = (r) => r.json?.data;
const err = (r) => r.json?.error ?? JSON.stringify(r.json);

let failures = 0;
const log = [];
function check(name, cond, detail = '') {
	if (cond) log.push(`PASS  ${name}`);
	else {
		failures += 1;
		log.push(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
	}
}
const title = (s) => log.push(`\n── ${s} ─${'─'.repeat(Math.max(0, 64 - s.length))}`);

// ── Stock reads ────────────────────────────────────────────────────────────
// The on-hand report is the SAME single source the app's စတော့ screens read.
async function onHand() {
	const r = await api('GET', '/api/mro/stock/onhand');
	if (!r.ok || !r.json?.data?.rows) throw new Error(`GET /stock/onhand → HTTP ${r.status}: ${err(r)}`);
	return r.json.data.rows;
}
/** The model's qty across every returned balance row (one store here). */
async function qtyOf(modelId) {
	const rows = await onHand();
	return rows.filter((r) => r.model === modelId).reduce((s, r) => s + (Number(r.qty_on_hand) || 0), 0);
}
/** One serial unit's lifecycle status (`in_stock` / `issued` / `scrapped`). */
async function serialStatus(serialNo) {
	const r = await api(
		'GET',
		`/api/entities/mro_stock_serials?limit=1&fields=serial_no,status&filter[serial_no][_eq]=${encodeURIComponent(serialNo)}`,
	);
	const row = data(r)?.[0];
	return row?.status ?? null;
}

// ── Draft + confirm helpers (the real client flow) ─────────────────────────
async function inboundDraft(lines, extra = {}) {
	return api('POST', '/api/entities/mro_inbounds', {
		supplier: SUPPLIER,
		purchase_date: mmt(),
		type: 'purchase',
		location: LOCATION,
		lines,
		...extra,
	});
}
async function outboundDraft(lines, extra = {}) {
	return api('POST', '/api/entities/mro_outbounds', {
		type: 'goods_issue',
		effective_date: mmt(),
		location: LOCATION,
		lines,
		...extra,
	});
}
const confirm = (kind, id, body = {}) => api('POST', `/api/mro/${kind}/${id}/confirm`, body);

/** Create + confirm a draft, throwing on either failure (the caller then
 *  asserts the RESULT — the numbers — not just that the HTTP call worked). */
async function confirmInbound(lines, extra = {}) {
	const d = await inboundDraft(lines, extra);
	if (!d.ok) throw new Error(`create inbound → HTTP ${d.status}: ${err(d)}`);
	const c = await confirm('inbounds', d.json.data.id);
	if (!c.ok) throw new Error(`confirm inbound → HTTP ${c.status}: ${err(c)}`);
	return { draft: d.json.data, confirmed: c.json.data };
}
async function confirmOutbound(lines, extra = {}) {
	const d = await outboundDraft(lines, extra);
	if (!d.ok) throw new Error(`create outbound → HTTP ${d.status}: ${err(d)}`);
	const c = await confirm('outbounds', d.json.data.id, { issued_by: extra.issued_by });
	return { draft: d.json.data, confirmed: c.json.data, status: c.status };
}

const run = async () => {
	// ── 0. Setup — one model per policy + a supplier ─────────────────────────
	title('Setup — resolve one model per tracking policy');
	const suppliers = await listAllRows(baseUrl, token, 'mro_suppliers', 'id,name');
	if (!suppliers.length) throw new Error('no mro_suppliers row — run scripts/apply-mro-schema.mjs + a catalog seed first');
	SUPPLIER = suppliers[0].id;

	const models = await listAllRows(baseUrl, token, 'mro_item_model', 'id,name_en,item_name.tracking');
	const policyOf = (m) => (typeof m.item_name === 'object' ? m.item_name?.tracking : null);
	const pick = (policy) => models.find((m) => policyOf(m) === policy);
	const std = pick('standard');
	const batch = pick('batch');
	const serial = pick('serial');
	if (!std || !batch || !serial) {
		throw new Error(
			`need one SKU per policy — found standard=${!!std} batch=${!!batch} serial=${!!serial}; add item names with those tracking policies`,
		);
	}
	log.push(`supplier : ${suppliers[0].name}`);
	log.push(`standard : ${std.name_en} (${std.id})`);
	log.push(`batch    : ${batch.name_en} (${batch.id})`);
	log.push(`serial   : ${serial.name_en} (${serial.id})`);
	log.push(`store    : ${LOCATION} · run tag ${TAG}`);

	// ── 1. NEW PURCHASE ─────────────────────────────────────────────────────
	title('1. New purchase (inbound draft → confirm)');
	const before = { std: await qtyOf(std.id), batch: await qtyOf(batch.id), serial: await qtyOf(serial.id) };
	log.push(`stock before : standard ${before.std} · batch ${before.batch} · serial ${before.serial}`);

	const lines = [
		{ item_model: std.id, qty: 20, unit_price: 100 },
		{ item_model: batch.id, qty: 20, unit_price: 120, batch_no: BATCH, expiry_date: mmt(90) },
		{ item_model: serial.id, qty: 3, unit_price: 350000, serials: SERIALS },
	];
	const draft = await inboundDraft(lines);
	check(
		'purchase draft → 201 + draft + INB- number',
		draft.ok && data(draft)?.doc_status === 'draft' && /^INB-/.test(String(data(draft)?.display_number ?? '')),
		`HTTP ${draft.status} ${err(draft)}`,
	);
	check(
		'purchase draft moves NO stock',
		(await qtyOf(std.id)) === before.std && (await qtyOf(batch.id)) === before.batch && (await qtyOf(serial.id)) === before.serial,
	);
	if (!draft.ok) throw new Error(`purchase draft failed: ${err(draft)}`);

	const inId = data(draft).id;
	const inC = await confirm('inbounds', inId);
	const inD = data(inC);
	check('purchase confirm → 201 + confirmed', inC.status === 201 && inD?.doc_status === 'confirmed', `HTTP ${inC.status} ${err(inC)}`);
	check(
		'purchase confirm writes totals (3 lines · qty 43)',
		Number(inD?.line_count) === 3 && Number(inD?.total_qty) === 43,
		JSON.stringify(inD),
	);

	const afterPurchase = { std: await qtyOf(std.id), batch: await qtyOf(batch.id), serial: await qtyOf(serial.id) };
	check('purchase +20 standard', afterPurchase.std === before.std + 20, `${before.std} → ${afterPurchase.std}`);
	check('purchase +20 batch', afterPurchase.batch === before.batch + 20, `${before.batch} → ${afterPurchase.batch}`);
	check('purchase +3 serial', afterPurchase.serial === before.serial + 3, `${before.serial} → ${afterPurchase.serial}`);
	check(
		'serial units created as in_stock',
		(await serialStatus(SERIALS[0])) === 'in_stock' &&
			(await serialStatus(SERIALS[1])) === 'in_stock' &&
			(await serialStatus(SERIALS[2])) === 'in_stock',
	);

	const reConfirm = await confirm('inbounds', inId);
	check(
		're-confirming a confirmed inbound is an idempotent no-op (already:true)',
		reConfirm.status === 201 && data(reConfirm)?.already === true && data(reConfirm)?.doc_status === 'confirmed',
		`HTTP ${reConfirm.status} ${JSON.stringify(data(reConfirm))}`,
	);
	check(
		'idempotent re-confirm left stock untouched',
		(await qtyOf(std.id)) === afterPurchase.std &&
			(await qtyOf(batch.id)) === afterPurchase.batch &&
			(await qtyOf(serial.id)) === afterPurchase.serial,
	);

	// ── 2. USE (goods issue) ────────────────────────────────────────────────
	title('2. Use (goods-issue draft → confirm)');
	const issueLines = [
		{ item_model: std.id, qty: 8 },
		{ item_model: batch.id, qty: 5 },
		{ item_model: serial.id, qty: 1, serials: [SERIALS[0]] },
	];
	const issueDraft = await outboundDraft(issueLines);
	check(
		'goods-issue draft → 201 + draft + OUT- number',
		issueDraft.ok && data(issueDraft)?.doc_status === 'draft' && /^OUT-/.test(String(data(issueDraft)?.display_number ?? '')),
		`HTTP ${issueDraft.status} ${err(issueDraft)}`,
	);
	check(
		'goods-issue draft moves NO stock',
		(await qtyOf(std.id)) === afterPurchase.std &&
			(await qtyOf(batch.id)) === afterPurchase.batch &&
			(await qtyOf(serial.id)) === afterPurchase.serial,
	);
	if (!issueDraft.ok) throw new Error(`goods-issue draft failed: ${err(issueDraft)}`);

	const issueC = await confirm('outbounds', data(issueDraft).id, { issued_by: 'dev' });
	check(
		'goods-issue confirm → 201 + confirmed',
		issueC.status === 201 && data(issueC)?.doc_status === 'confirmed',
		`HTTP ${issueC.status} ${err(issueC)}`,
	);
	const afterIssue = { std: await qtyOf(std.id), batch: await qtyOf(batch.id), serial: await qtyOf(serial.id) };
	check('use −8 standard', afterIssue.std === afterPurchase.std - 8, `${afterPurchase.std} → ${afterIssue.std}`);
	check('use −5 batch (FEFO)', afterIssue.batch === afterPurchase.batch - 5, `${afterPurchase.batch} → ${afterIssue.batch}`);
	check('use −1 serial', afterIssue.serial === afterPurchase.serial - 1, `${afterPurchase.serial} → ${afterIssue.serial}`);
	check('issued serial flips to `issued`', (await serialStatus(SERIALS[0])) === 'issued', `status=${await serialStatus(SERIALS[0])}`);

	const issueReplay = await confirm('outbounds', data(issueDraft).id, { issued_by: 'dev' });
	check(
		're-confirming a confirmed outbound is an idempotent no-op (already:true)',
		issueReplay.status === 201 && data(issueReplay)?.already === true,
		`HTTP ${issueReplay.status} ${JSON.stringify(data(issueReplay))}`,
	);
	check(
		'idempotent outbound re-confirm did NOT double-deduct',
		(await qtyOf(std.id)) === afterIssue.std &&
			(await qtyOf(batch.id)) === afterIssue.batch &&
			(await qtyOf(serial.id)) === afterIssue.serial,
	);

	// ── 3. WRITE-OFF ────────────────────────────────────────────────────────
	title('3. Write-off (goods-out type=write_offs → confirm)');
	const wo = await confirmOutbound(
		[
			{ item_model: std.id, qty: 4 },
			{ item_model: batch.id, qty: 3 },
			{ item_model: serial.id, qty: 1, serials: [SERIALS[1]] },
		],
		{ type: 'write_offs' },
	);
	check(
		'write-off confirm → 201 + confirmed',
		wo.status === 201 && wo.confirmed?.doc_status === 'confirmed',
		`HTTP ${wo.status} ${err({ json: wo.confirmed })}`,
	);
	const afterWo = { std: await qtyOf(std.id), batch: await qtyOf(batch.id), serial: await qtyOf(serial.id) };
	check('write-off −4 standard', afterWo.std === afterIssue.std - 4, `${afterIssue.std} → ${afterWo.std}`);
	check('write-off −3 batch', afterWo.batch === afterIssue.batch - 3, `${afterIssue.batch} → ${afterWo.batch}`);
	check('write-off −1 serial', afterWo.serial === afterIssue.serial - 1, `${afterIssue.serial} → ${afterWo.serial}`);
	check('written-off serial is `scrapped`', (await serialStatus(SERIALS[1])) === 'scrapped', `status=${await serialStatus(SERIALS[1])}`);

	// ── 4. RETURN (close the loop) ──────────────────────────────────────────
	title('4. Return (inbound type=return re-instocks the issued serial)');
	const ret = await confirmInbound([{ item_model: serial.id, qty: 1, serials: [SERIALS[0]] }], { type: 'return' });
	check('return confirm → 201 + confirmed', ret.confirmed?.doc_status === 'confirmed', JSON.stringify(ret.confirmed));
	check(
		'return +1 serial (no duplicate row)',
		(await qtyOf(serial.id)) === afterWo.serial + 1,
		`${afterWo.serial} → ${await qtyOf(serial.id)}`,
	);
	check('returned serial is back `in_stock`', (await serialStatus(SERIALS[0])) === 'in_stock', `status=${await serialStatus(SERIALS[0])}`);

	const retAgain = await inboundDraft([{ item_model: serial.id, qty: 1, serials: [SERIALS[0]] }], { type: 'return' });
	const retAgainC = await confirm('inbounds', data(retAgain).id);
	check('returning an in-stock serial refused (409)', retAgainC.status === 409, `HTTP ${retAgainC.status}`);

	// ── 5. GUARDS ───────────────────────────────────────────────────────────
	title('5. Guards — overdraw · scrapped serial · expired lot');
	const guardBefore = { std: await qtyOf(std.id), batch: await qtyOf(batch.id) };
	const over = await outboundDraft([{ item_model: std.id, qty: 999999 }]);
	const overC = await confirm('outbounds', data(over).id);
	check('overdraw refused (409)', overC.status === 409, `HTTP ${overC.status}`);
	check('overdraw left stock untouched', (await qtyOf(std.id)) === guardBefore.std, `${guardBefore.std} → ${await qtyOf(std.id)}`);

	const scrapped = await outboundDraft([{ item_model: serial.id, qty: 1, serials: [SERIALS[1]] }]);
	const scrappedC = await confirm('outbounds', data(scrapped).id);
	check('issuing a scrapped serial refused (409)', scrappedC.status === 409, `HTTP ${scrappedC.status}`);

	// An already-expired lot can NEVER satisfy a goods issue: the engine excludes
	// expired lots from issue allocation (it uses FRESH stock first), so the issue
	// only fails when the USABLE stock is short — and the expired lot is struck by
	// a write-off, which is its purpose. (`qty_of_hand` still counts the expired
	// lot while it exists — it is on hand, just not issuable.)
	const fresh = await qtyOf(batch.id);
	const exp = await confirmInbound([{ item_model: batch.id, qty: 5, batch_no: BATCH_OLD, expiry_date: mmt(-30) }]);
	check('expired lot received (for the guard)', exp.confirmed?.doc_status === 'confirmed');
	check('expired lot IS on hand (unusable, but counted)', (await qtyOf(batch.id)) === fresh + 5, `${fresh} → ${await qtyOf(batch.id)}`);

	const blocked = await outboundDraft([{ item_model: batch.id, qty: fresh + 1 }]);
	const blockedC = await confirm('outbounds', data(blocked).id);
	check('issue larger than FRESH stock refused — expired lots are not issuable (409)', blockedC.status === 409, `HTTP ${blockedC.status}`);
	check('refused issue left BOTH lots untouched', (await qtyOf(batch.id)) === fresh + 5, `${fresh + 5} → ${await qtyOf(batch.id)}`);

	const struck = await confirmOutbound([{ item_model: batch.id, qty: 5 }], { type: 'write_offs' });
	check('write-off strikes the expired lot (201)', struck.status === 201, `HTTP ${struck.status}`);
	check(
		'write-off struck ONLY the expired lot (fresh untouched)',
		(await qtyOf(batch.id)) === fresh,
		`${fresh + 5} → ${await qtyOf(batch.id)}`,
	);

	// ── 6. END STATE ────────────────────────────────────────────────────────
	title('6. End state — exact balances');
	const end = { std: await qtyOf(std.id), batch: await qtyOf(batch.id), serial: await qtyOf(serial.id) };
	const expected = { std: before.std + 20 - 8 - 4, batch: before.batch + 20 - 5 - 3, serial: before.serial + 3 - 1 - 1 + 1 };
	check(`final standard = ${expected.std}`, end.std === expected.std, `got ${end.std}`);
	check(`final batch = ${expected.batch}`, end.batch === expected.batch, `got ${end.batch}`);
	check(`final serial = ${expected.serial}`, end.serial === expected.serial, `got ${end.serial}`);
	check(
		'end state: serial is +2 vs start (1 returned, 1 scrapped)',
		end.serial === before.serial + 2,
		`start ${before.serial} → end ${end.serial}`,
	);

	console.log(log.join('\n'));
	console.log(`\nSmoke: ${failures === 0 ? 'ALL PASS ✅' : `${failures} FAILURE(S) ❌`}`);
	process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
	console.log(log.join('\n'));
	console.error(`\nSMOKE ABORTED: ${error instanceof Error ? error.message : error}`);
	process.exit(2);
});
