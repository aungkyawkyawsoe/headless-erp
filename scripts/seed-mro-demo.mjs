#!/usr/bin/env node
/**
 * MRO demo seed + end-to-end smoke — multi-line documents with a confirm gate.
 *
 *   node scripts/seed-mro-demo.mjs [baseUrl] [bearerToken]
 *
 * Defaults: baseUrl http://localhost:8788 · token `dev-token` (IS_DEV local).
 * Prereq: `node scripts/apply-mro-schema.mjs` has run (schema v1, development).
 *
 * Story it exercises (the REAL workflow, nothing bypassed):
 *   1. Catalog: supplier + item-name masters + item models (engine API).
 *      The MRO stock-keeping unit IS the item model; each demo model is
 *      classified by item_name (mro_item_name) while `name_en`/`name_mm` carry
 *      the bilingual pair (see scripts/mro-model-names.mjs). The stock tracking
 *      policy lives on the item name.
 *   2. Inbound 1 (purchase, main_store) — ONE document, THREE lines:
 *      serial tyres (per-unit) + batch oil (lot + expiry) + standard bolts
 *      → draft INB-00001 (stock untouched) → confirm → lots/serials/balance.
 *   3. Inbound 2 (purchase, mandalay_store): two more serial tyres.
 *   4. Inbound 3 (purchase, main_store): an ALREADY-EXPIRED oil batch.
 *   5. Outbound 1 (goods_issue, main_store): issue tyre TY-…-0001,
 *      oil (FEFO picks the nearer expiry lot first) and bolts → OUT-00001.
 *   6. Outbound 2 (write_offs, main_store): strike the expired oil batch.
 *   7. Return (inbound type=return): the fitted tyre comes back → re-instock.
 *   8. Transfer (TRF-00001): move a tyre + oil (FEFO) + bolts from main_store
 *      to admin_store — lot identity survives; serial flips location.
 *   9. Adjustment (AJT-00001): the clerk REPORTS main_store is 10 bolts short
 *      on the shelf; the store manager (a DIFFERENT authorizer) approves and
 *      the +10 add applies in that single authorized step; the line records
 *      expected_qty/diff_qty on the confirmed document.
 * 10. Requisition (REQ-00001): the workshop asks main_store for 2 tyres +
 *      6L oil + 50 bolts — approving NEVER touches stock (totals + status
 *      only); the goods issue that fulfils it is confirmed separately.
 * 11. Alerts: set reorder_level 400 on the main_store bolts balance (340 ≤ 400
 *      → on-hand below_reorder=true) and receive near-expiry oil OIL-2601B
 *      (+25d) that falls inside the model's 30-day expiry alert window.
 * 12. Reports: on-hand flags + expiry feed (days_left/alert); re-confirm no-op.
 *
 * Idempotent for the catalog (find-or-create by name); movement docs are
 * created fresh on every run so you can watch INB-/OUT-/TRF-/STK- numbers
 * climb. The movement story expects an EMPTY MRO stock state (fresh dev DB or
 * right after `apply-mro-schema.mjs` on a new environment) — serial numbers
 * are fixed, so a re-run on a DB that already holds them stops with a 409.
 */
import { randomUUID } from 'node:crypto';

import { modelNames } from './mro-model-names.mjs';
import { listAllRows } from './lib/list-all-rows.mjs';
import { refuseIfSuperseded } from './lib/superseded-seed.mjs';

refuseIfSuperseded({
	script: 'seed-mro-demo.mjs',
	replacement: [
		'node scripts/seed-mro-catalog.mjs --apply   (item names + their policies + SKUs)',
		'node scripts/reset-mro-stock.mjs --apply    (blank the stock screens)',
	],
});

const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const H = (init) => ({ ...init, headers: { ...headers, ...(init?.headers ?? {}) } });

const mmt = (offsetDays = 0) => {
	const t = Date.now() + 6.5 * 3600_000 + offsetDays * 86_400_000;
	return new Date(t).toISOString().slice(0, 10);
};

async function api(path, init = {}) {
	const res = await fetch(`${baseUrl}${path}`, H(init));
	const body = await res.json().catch(() => null);
	if (!res.ok && !body?.success)
		throw new Error(`${init.method ?? 'GET'} ${path} → HTTP ${res.status}: ${body?.error ?? JSON.stringify(body)}`);
	return body.data;
}

/** Find-or-create a catalog row (match on `name` or the given key field). */
async function findOrCreate(slug, key, value, payload) {
	// Whole-collection read — the list route paginates at 25 by default, so a
	// single bare request would miss rows past page 1 and duplicate them.
	const rows = await listAllRows(baseUrl, token, slug, `id,${key}`);
	const found = rows.find((r) => r[key] === value);
	if (found) return found;
	return api(`/api/entities/${slug}`, { method: 'POST', body: JSON.stringify(payload) });
}

const log = (...a) => console.log(...a);
const title = (s) => log(`\n── ${s} ─${'─'.repeat(Math.max(0, 64 - s.length))}`);

const ids = {}; // name → uuid used later in lines

// ── 1. Catalog ──────────────────────────────────────────────────────────
	title('Catalog (supplier / item-name masters + item models)');
{
	const nameRow = async (slug, name) => findOrCreate(slug, 'name', name, { name });
	const tyreItem = await nameRow('mro_item_name', 'Tyre');
	const oilItem = await nameRow('mro_item_name', 'Engine Oil');
	const boltItem = await nameRow('mro_item_name', 'Bolt');
	const mkModel = async (name, tracking, extra = {}) =>
		findOrCreate('mro_item_model', 'name_en', name, {
			...modelNames(name),
			tracking,
			expiry_alert_days: tracking === 'batch' ? 30 : null,
			...extra,
		});
	const tyre = await mkModel('Tyre 11R22.5 (Serial)', 'serial', {
		item_name: tyreItem.id,
	});
	const oil = await mkModel('Engine Oil 10W-40 (Batch)', 'batch', {
		item_name: oilItem.id,
	});
	const bolt = await mkModel('Bolt M10 x 50', 'standard', { item_name: boltItem.id });
	ids.tyre = tyre.id;
	ids.oil = oil.id;
	ids.bolt = bolt.id;

	const sup = await findOrCreate('mro_suppliers', 'name', 'MMB Tyre & Parts Co., Ltd', {
		name: 'MMB Tyre & Parts Co., Ltd',
	});
	ids.sup = sup.id;
	log(`supplier ${sup.id} · models: ${tyre.name} / ${oil.name} / ${bolt.name}`);
}

// Reports/approvals on transfers & adjustments are m2o → hrm_employees. Resolve
// TWO real employee ids for the (reporter, approver) pair so the two-person gate
// is satisfied; skip both when no employees exist yet.
const employees = await api('/api/entities/hrm_employees?per_page=200');
const people = Array.isArray(employees) ? employees.filter((e) => e && e.id) : [];
const reporterId = people[0]?.id ?? null;
const approverId = people[1]?.id ?? (people[0]?.id ?? null);
const draftInbound = async (lines, extra = {}, location = 'main_store') =>
	api('/api/entities/mro_inbounds', {
		method: 'POST',
		body: JSON.stringify({ supplier: ids.sup, purchase_date: mmt(), type: 'purchase', location, lines, ...extra }),
	});
const draftOutbound = async (lines, extra = {}, location = 'main_store') =>
	api('/api/entities/mro_outbounds', {
		method: 'POST',
		body: JSON.stringify({ type: 'goods_issue', effective_date: mmt(), location, lines, ...extra }),
	});
const confirmDoc = async (kind, id) => api(`/api/mro/${kind}/${id}/confirm`, { method: 'POST', body: JSON.stringify({}) });

// ── 2. Inbound 1 — ONE purchase document with THREE different items ──────
title('Inbound 1 — purchase, main_store: 4 tyres (serial) + oil 20L (batch) + bolts 500 (standard)');
let d = await draftInbound([
	{ item_model: ids.tyre, qty: 4, unit_price: 350000, serials: ['TY-2026-0001', 'TY-2026-0002', 'TY-2026-0003', 'TY-2026-0004'] },
	{ item_model: ids.oil, qty: 20, unit_price: 12000, batch_no: 'OIL-2601', expiry_date: mmt(180) },
	{ item_model: ids.bolt, qty: 500, unit_price: 250 },
]);
log(`draft  → ${d.display_number} (${d.doc_status}) · id ${d.id}`);
const in1 = await confirmDoc('inbounds', d.id);
log(`confirm→ ${in1.display_number} confirmed · ${in1.line_count} lines · qty ${in1.total_qty} · amount ${in1.total_amount}`);

// ── 3. Inbound 2 — mandalay_store tyres ─────────────────────────────────
title('Inbound 2 — purchase, mandalay_store: 2 tyres');
d = await draftInbound(
	[{ item_model: ids.tyre, qty: 2, unit_price: 348000, serials: ['TY-2026-0101', 'TY-2026-0102'] }],
	{},
	'mandalay_store',
);
const in2 = await confirmDoc('inbounds', d.id);
log(`draft ${d.display_number} → confirm ${in2.display_number} (${in2.doc_status})`);

// ── 4. Inbound 3 — expired oil batch (for the write-off demo) ────────────
title('Inbound 3 — purchase, main_store: oil batch that is ALREADY expired');
d = await draftInbound([{ item_model: ids.oil, qty: 10, unit_price: 11000, batch_no: 'OIL-OLD', expiry_date: mmt(-30) }]);
const in3 = await confirmDoc('inbounds', d.id);
log(`draft ${d.display_number} → confirm ${in3.display_number}`);

// ── 5. Outbound 1 — goods issue ─────────────────────────────────────────
title('Outbound 1 — goods_issue, main_store: tyre + oil 8L (FEFO) + bolts 100');
d = await draftOutbound([
	{ item_model: ids.tyre, qty: 1, serials: ['TY-2026-0001'] },
	{ item_model: ids.oil, qty: 8 },
	{ item_model: ids.bolt, qty: 100 },
]);
const out1 = await confirmDoc('outbounds', d.id);
log(`draft ${d.display_number} → confirm ${out1.display_number} (${out1.doc_status}) · qty ${out1.total_qty}`);

// ── 6. Outbound 2 — write off the expired batch ─────────────────────────
title('Outbound 2 — write_offs, main_store: expired oil batch');
d = await draftOutbound([{ item_model: ids.oil, qty: 10 }], { type: 'write_offs' });
const out2 = await confirmDoc('outbounds', d.id);
log(`draft ${d.display_number} → confirm ${out2.display_number} (${out2.doc_status})`);

// ── 7. Return — the fitted tyre comes back into stock ───────────────────
title('Return — inbound type=return: TY-2026-0001 back to main_store');
d = await draftInbound([{ item_model: ids.tyre, qty: 1, serials: ['TY-2026-0001'] }], { type: 'return', purchase_date: mmt() });
const ret = await confirmDoc('inbounds', d.id);
log(`draft ${d.display_number} → confirm ${ret.display_number} (${ret.doc_status}) — re-instocks, no duplicate serial`);

// ── 8. Transfer — location-to-location move ───────────────────────────────
// main_store → admin_store: one tyre (serial), oil 3L (batch FEFO) + bolts 50.
title('Transfer — main_store → admin_store: tyre + oil + bolts (TRF doc)');
	const trfDraft = await api('/api/entities/mro_transfers', {
		method: 'POST',
		body: JSON.stringify({
			from_location: 'main_store',
			to_location: 'admin_store',
			transfer_date: mmt(),
			note: 'Workshop tyre swap + monthly oil top-up to Admin Store',
			...(reporterId ? { reported_by: reporterId } : {}),
			lines: [
				{ item_model: ids.tyre, qty: 1, serials: ['TY-2026-0002'] },
				{ item_model: ids.oil, qty: 3 },
				{ item_model: ids.bolt, qty: 50 },
			],
		}),
	});
log(`draft  → ${trfDraft.display_number} (${trfDraft.doc_status}) · id ${trfDraft.id}`);
const trf = await api(`/api/mro/transfers/${trfDraft.id}/confirm`, {
	method: 'POST',
	body: JSON.stringify({ approved_by: approverId }),
});
log(`confirm→ ${trf.display_number} confirmed · ${trf.line_count} lines · qty ${trf.total_qty}`);
const movedSerial = (await api('/api/entities/mro_stock_serials?per_page=500')).find(
	(s) => s.serial_no === 'TY-2026-0002' && !s.deleted_at,
);
log(`  ${movedSerial.serial_no} now at ${movedSerial.location} (${movedSerial.status})`);

// ── 9. Adjustment — report a stock correction, a DIFFERENT employee approves ──
// The operator spots that main_store shows 10 fewer bolts than the shelf holds
// (a surplus). They REPORT the +10 adjustment; the store manager (a separate
// approver) approves it and the ± applies in that single approve step.
title('Adjustment — main_store: Bolt M10 x 50 +10 (reported → approved)');
const adjDraft = await api('/api/entities/mro_adjustments', {
	method: 'POST',
	body: JSON.stringify({
		location: 'main_store',
		adjustment_date: mmt(),
		description: 'Shelf count shows 10 more bolts than the balance — correct up',
		...(reporterId ? { reported_by: reporterId } : {}),
		lines: [{ item_model: ids.bolt, direction: 'add', qty: 10 }],
	}),
});
log(`draft  → ${adjDraft.display_number} (reported by ${reporterId}) · id ${adjDraft.id}`);
const adj = await api(`/api/mro/adjustments/${adjDraft.id}/confirm`, {
	method: 'POST',
	body: JSON.stringify({ approved_by: approverId }),
});
log(`confirm→ ${adj.display_number} approved by ${approverId} · ${adj.line_count} line · qty ${adj.total_qty}`);
const adjLines = await api('/api/entities/mro_adjustment_lines?per_page=200');
for (const l of adjLines.filter((x) => x.parent_id === adjDraft.id && !x.deleted_at))
	log(`  Bolt M10 x 50`.padEnd(28) + ` ${l.direction} ${String(l.qty).padStart(3)} · expected ${String(l.expected_qty).padStart(3)} · diff ${String(l.diff_qty).padStart(3)}`);

// ── 10. Requisition — workshop တောင်းခံ, approve without touching stock ────
// A stock REQUEST (REQ-…): the workshop asks main_store for 2 tyres + 6L oil +
// 50 bolts. Approving writes totals + status ONLY — the on-hand report after
// this section still shows the same quantities; a separate goods-issue outbound
// later fulfils the request.
title('Requisition — workshop asks main_store for 2 tyres + 6L oil + 50 bolts');
const reqDraft = await api('/api/entities/mro_requisitions', {
	method: 'POST',
	body: JSON.stringify({
		request_date: mmt(),
		location: 'main_store',
		note: 'Workshop weekly need — workshop line 2',
		lines: [
			{ item_model: ids.tyre, qty: 2 },
			{ item_model: ids.oil, qty: 6 },
			{ item_model: ids.bolt, qty: 50 },
		],
	}),
});
log(`draft  → ${reqDraft.display_number} (${reqDraft.doc_status}) · id ${reqDraft.id}`);
const req = await confirmDoc('requisitions', reqDraft.id);
log(`approve→ ${req.display_number} confirmed (approved) · ${req.line_count} lines · qty ${req.total_qty} — stock untouched`);

// ── 11. Alerts — reorder threshold + a near-expiry arrival ─────────────────
// Two live alert demos on top of the reconciled stock:
//   a. main_store bolts balance is 340 — configure reorder_level 400 (policy
//      only, no movement) → the on-hand report must flag below_reorder=true.
//   b. A NEW batch arrives AFTER the count (realistic): 6L OIL-2601B expiring
//      in 25 days — inside the model's 30-day window → expiry feed alert=true.
title('Alerts — reorder_level 400 on main_store bolts + near-expiry OIL-2601B (+25d)');
{
	const pre = await api('/api/mro/stock/onhand');
	const boltInv = pre.rows.find((r) => r.location === 'main_store' && r.model_name === 'Bolt M10 x 50');
	if (!boltInv) throw new Error('main_store bolts inventory row not found for the reorder demo');
	log(`  bolts main_store before: qty ${boltInv.qty_on_hand} · reorder ${boltInv.reorder_level} · below_reorder=${boltInv.below_reorder}`);
	await api(`/api/entities/mro_inventory/${boltInv.id}`, { method: 'PUT', body: JSON.stringify({ reorder_level: 400 }) });
	const post = await api('/api/mro/stock/onhand');
	const boltNow = post.rows.find((r) => r.id === boltInv.id);
	log(`  bolts main_store after : reorder 400 → below_reorder=${boltNow.below_reorder}`);

	d = await draftInbound([{ item_model: ids.oil, qty: 6, unit_price: 12500, batch_no: 'OIL-2601B', expiry_date: mmt(25) }]);
	const in4 = await confirmDoc('inbounds', d.id);
	log(`  draft ${d.display_number} → confirm ${in4.display_number} — OIL-2601B 6L main_store (expires ${mmt(25)})`);
}

// ── 12. Reports + idempotency ──────────────────────────────────────────────
title('Idempotency — re-confirming INB-00001 must not double-stock');
const replay = await api(`/api/mro/inbounds/${in1.inboundId}/confirm`, { method: 'POST', body: JSON.stringify({}) });
log(`re-confirm → ${replay.already ? 'no-op (already confirmed)' : 'APPLIED AGAIN?!'} — qty still ${replay.total_qty}`);

title('Stock lots (batch) — remaining per lot');
const lots = await api('/api/entities/mro_stock_lots?per_page=200');
for (const l of lots.filter((x) => !x.deleted_at))
	log(`  ${l.batch_no} · ${l.location} · remaining ${l.remaining_qty} · status ${l.status}`);

title('Serial units');
const serials = await api('/api/entities/mro_stock_serials?per_page=200');
for (const s of serials.filter((x) => !x.deleted_at)) log(`  ${s.serial_no} · ${s.location} · ${s.status}`);

title('On-hand balances (/api/mro/stock/onhand)');
const onhand = await api('/api/mro/stock/onhand');
for (const r of onhand.rows) {
	log(
		`  ${r.model_name.padEnd(28)} ${r.location.padEnd(14)} qty ${String(r.qty_on_hand).padStart(4)}  reorder ${String(r.reorder_level).padStart(4)}  below=${String(r.below_reorder).padStart(5)}  drift=${r.drift}`,
	);
}

title('Expiry feed (/api/mro/stock/expiring?days=60)');
const exp = await api('/api/mro/stock/expiring?days=60');
for (const r of [...exp.expired, ...exp.expiring])
	log(
		`  [${r.expiry_date < mmt() ? 'expired' : 'expiring'}] ${r.ref.padEnd(12)} ${r.location.padEnd(14)} qty ${String(r.qty).padStart(3)}  days_left ${String(r.days_left).padStart(4)}  alert=${String(r.alert)}`,
	);

log('\n✅ MRO demo complete — every step ran through the public API (draft → confirm → report).');
