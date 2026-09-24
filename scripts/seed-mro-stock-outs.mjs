/**
 * MRO stock-out seed — give the /app/stocks "Stock Out" tab real, genuine rows
 * on `main_store`, created through the engine's OWN confirmed path (nothing
 * bypassed):
 *
 *   node scripts/seed-mro-stock-outs.mjs [baseUrl] [bearerToken] [howMany]
 *
 * Defaults: http://localhost:8788 · `dev-token` · 5 models.
 *
 * What it does (mirrors `seed-mro-stock-populate.mjs` but leaves the balance at
 * ZERO, i.e. a true stock-out):
 *   1. Create `howMany` NEW standard `mro_item_model` rows from the list below
 *      (find-or-create by name, so re-runs never duplicate masters).
 *   2. Receive each into `main_store` through a purchase inbound (small qty),
 *      then confirm — real stock lands.
 *   3. Immediately issue the ENTIRE received qty out through a `goods_issue`
 *      outbound on `main_store`, then confirm. The engine deducts the balance to
 *      exactly 0 and KEEPS the row (deductions never delete), so `/stock/onhand`
 *      reports `qty_on_hand === 0` → the item lands under the Stock Out tab the
 *      same way a real "used it all up" does.
 *   4. Sets `reorder_level` above the (now zero) on-hand so the row also reads
 *      `below_reorder` — it is both out AND needs reordering.
 *
 * Re-run safe: a part already drained to zero on main_store is skipped, and a
 * part already counted is not re-received.
 */
import { modelNames } from './mro-model-names.mjs';
import { listAllRows } from './lib/list-all-rows.mjs';
import { refuseIfSuperseded } from './lib/superseded-seed.mjs';

refuseIfSuperseded({
	script: 'seed-mro-stock-outs.mjs',
	replacement: [
		'node scripts/seed-mro-catalog.mjs --apply   (item names + their policies + SKUs)',
		'node scripts/reset-mro-stock.mjs --apply    (blank the stock screens)',
	],
});

const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';
const howMany = Number(process.argv[4] ?? 5);
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const H = (init) => ({ ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
const log = (...a) => console.log(...a);
const title = (s) => log(`\n── ${s}`);
const today = new Date().toISOString().slice(0, 10);

async function api(path, init = {}) {
	const res = await fetch(`${baseUrl}${path}`, H(init));
	const body = await res.json().catch(() => null);
	if (!res.ok && !(body && body.success)) {
		throw new Error(`${init.method ?? 'GET'} ${path} → HTTP ${res.status}: ${body?.error ?? JSON.stringify(body)}`);
	}
	return body.data;
}

/** Standard spare parts NOT otherwise stocked on main_store, so each run lands a
 *  clean receive-then-fully-issue cycle. Re-run never re-receives: a name that
 *  already sits at qty 0 on main_store is skipped. */
const OUT_STOCK_NAMES = [
	'Radiator Cap 1.1 bar',
	'Brake Master Cylinder Kit',
	'Wiper Linkage Arm',
	'Fan Clutch',
	'Rear Brake Drum',
	'Handbrake Cable',
	'Dashboard Fuse Relay',
	'AC Compressor Clutch',
].map((n) => n);

async function listModels() {
	// Whole-collection read — the list route paginates at 25 by default, so a
	// single bare request would miss rows past page 1 and duplicate them.
	return listAllRows(baseUrl, token, 'mro_item_model', 'id,name_en');
}

async function findOrCreateModel(name) {
	const existing = await listModels();
	const found = existing.find((r) => r.name_en === name && !r.deleted_at);
	if (found) return found;
	return api('/api/entities/mro_item_model', { method: 'POST', body: JSON.stringify(modelNames(name)) });
}

async function onHandRow(modelId, location) {
	const onhand = await api('/api/mro/stock/onhand');
	return onhand.rows.find((r) => r.location === location && r.model === modelId);
}

async function main() {
	const count = Math.min(howMany, OUT_STOCK_NAMES.length);
	title(`Targeting ${count} stock-out items in main_store`);
	const names = OUT_STOCK_NAMES.slice(0, count);

	const suppliers = await api('/api/entities/mro_suppliers?per_page=50');
	const supplier = (Array.isArray(suppliers) ? suppliers : []).find((s) => !s.deleted_at);
	if (!supplier) throw new Error('no supplier found — run a schema/demo seed first');

	let made = 0;
	let skipped = 0;
	for (const name of names) {
		const model = await findOrCreateModel(name);

		// Re-run safe: already drained to zero → nothing to do.
		let row = await onHandRow(model.id, 'main_store');
		if (row && Number(row.qty_on_hand) === 0) {
			skipped += 1;
			log(`  · ${name.padEnd(34)} already out (qty 0) — skip`);
			continue;
		}

		// Receive (creates a balance) …
		const qty = 10;
		const inbound = await api('/api/entities/mro_inbounds', {
			method: 'POST',
			body: JSON.stringify({
				supplier: supplier.id,
				purchase_date: today,
				type: 'purchase',
				location: 'main_store',
				lines: [{ item_model: model.id, qty, unit_price: 1500 }],
			}),
		});
		await api(`/api/mro/inbounds/${inbound.id}/confirm`, { method: 'POST', body: JSON.stringify({}) });

		// … then issue the WHOLE thing out → row lands at exactly 0.
		const outbound = await api('/api/entities/mro_outbounds', {
			method: 'POST',
			body: JSON.stringify({
				type: 'goods_issue',
				effective_date: today,
				location: 'main_store',
				lines: [{ item_model: model.id, qty, unit_price: 1500 }],
			}),
		});
		await api(`/api/mro/outbounds/${outbound.id}/confirm`, { method: 'POST', body: JSON.stringify({}) });

		// Clamp reorder above zero so the row reads both out AND below reorder.
		row = await onHandRow(model.id, 'main_store');
		if (row?.id) {
			await api(`/api/entities/mro_inventory/${row.id}`, { method: 'PUT', body: JSON.stringify({ reorder_level: qty }) });
		}
		made += 1;
		log(`  · ${name.padEnd(34)} received ${qty} → issued ${qty} → qty 0 ✓`);
	}

	title('Verify');
	const onhand = await api('/api/mro/stock/onhand');
	const zero = onhand.rows.filter((r) => r.location === 'main_store' && Number(r.qty_on_hand) === 0);
	log(`  main_store Stock Out rows: ${zero.length}`);
	zero.forEach((r) => log(`    - ${r.model_name} @ ${r.location} (reorder ${r.reorder_level})`));
	return zero.length;
}

try {
	const n = await main();
	log(`\nDone — ${n} genuine stock-out item(s) now show on main_store Stock Out.`);
	log('Refresh /app/stocks (or tap ↻) to see them.');
} catch (err) {
	console.error('SEED FAILED:', err.message);
	process.exitCode = 1;
}
