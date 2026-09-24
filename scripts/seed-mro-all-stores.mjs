/**
 * MRO stock populate seed — distribute reorder + expiry demo data across stores.
 *
 *   node scripts/seed-mro-all-stores.mjs [baseUrl] [bearerToken]
 *
 * Defaults: http://localhost:8788 · `dev-token`.
 *
 * The dashboard (/app/stocks) is scoped to ONE store at a time, with two tabs:
 *   ပြန်မှာရန်       — balances at/below their reorder level (standard models)
 *   သက်တမ်းကုန်ခါနီး  — lots/serials expiring within their alert window (batch)
 *
 * So this seeds BOTH, spread across every store so each filter/tab combo can be
 * exercised with real volume:
 *
 *   1. Reorder (standard) — the spare-parts catalogue below is redistributed and
 *      received into all 5 stores (~6 rows each), each with a reorder_level just
 *      above its on-hand qty so every row reads `below_reorder`. Any old rows the
 *      earlier main_store-only run left behind are demoted (reorder_level=0) so
 *      main_store does not hog the whole list.
 *   2. Expiry (batch) — a small set of batch models received into every store
 *      with a lot that expires within the alert window (a few days → a few weeks
 *      out), plus one already-expired lot somewhere, so the သက်တမ်းကုန်ခါနီး feed
 *      lists rows in each store.
 *
 * Everything goes through the engine's CONFIRMED inbound path (nothing bypassed)
 * and is find-or-create on model name, so safe to re-run (growth is fine for a
 * demo).
 */
import { modelNames } from './mro-model-names.mjs';
import { listAllRows } from './lib/list-all-rows.mjs';
import { refuseIfSuperseded } from './lib/superseded-seed.mjs';

refuseIfSuperseded({
	script: 'seed-mro-all-stores.mjs',
	replacement: [
		'node scripts/seed-mro-catalog.mjs --apply   (item names + their policies + SKUs)',
		'node scripts/reset-mro-stock.mjs --apply    (blank the stock screens)',
	],
});

const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const H = (init) => ({ ...init, headers: { ...headers, ...(init?.headers ?? {}) } });

const log = (...a) => console.log(...a);
const title = (s) => log(`\n── ${s}`);

// The 5 physical stores (MRO_LOCATIONS), in display order.
async function api(path, init = {}) {
	const res = await fetch(`${baseUrl}${path}`, H(init));
	const body = await res.json().catch(() => null);
	if (!res.ok && !(body && body.success)) {
		throw new Error(`${init.method ?? 'GET'} ${path} → HTTP ${res.status}: ${body?.error ?? JSON.stringify(body)}`);
	}
	return body.data;
}

async function findOrCreateModel(name, tracking, extra = {}) {
	// Whole-collection read — the list route paginates at 25 by default, so a
	// single bare request would miss rows past page 1 and duplicate them.
	const rows = await listAllRows(baseUrl, token, 'mro_item_model', 'id,name_en');
	const found = rows.find((r) => r.name_en === name);
	if (found) return found;
	return api('/api/entities/mro_item_model', {
		method: 'POST',
		body: JSON.stringify({ ...modelNames(name), tracking, ...extra }),
	});
}

const mmt = (offsetDays = 0) => {
	const t = Date.now() + 6.5 * 3600_000 + offsetDays * 86_400_000;
	return new Date(t).toISOString().slice(0, 10);
};

function dateToday() {
	return new Date().toISOString().slice(0, 10);
}
const suffix = () => Math.random().toString(36).slice(2, 7).toUpperCase();

// Spare parts (standard tracking) — distributed across stores below.
const PARTS = [
	'Ball Bearing 6204',
	'Ball Bearing 6208',
	'V-Belt A-38',
	'V-Belt B-52',
	'Timing Belt 108 teeth',
	'Fuel Filter',
	'Air Filter (panel)',
	'Hydraulic Oil Filter',
	'Grease Pump Tube',
	'Lithium Grease 2kg',
	'Brake Fluid DOT-4 1L',
	'Antifreeze 50/50 5L',
	'Windscreen Wiper 600mm',
	'Radiator Hose 38mm',
	'Power Steering Hose',
	'Brake Pad Set (front)',
	'Clutch Disc 240mm',
	'Headlight Bulb H4',
	'Indicator Bulb 12V',
	'Fuse 10A (box of 10)',
	'Fuse 20A (box of 10)',
	'Cylinder Head Gasket',
	'Valve Cover Gasket',
	'Rear Axle Seal',
	'Wheel Hub Nut M22',
	'Fan Belt 11A',
	'Shock Absorber (rear)',
	'Starter Motor 12V',
	'Alternator 100A',
	'Spark Plug NGK BKR6E',
	'Battery Terminal Clamp',
	'Tie Rod End',
	'U-Joint Cross 27-73',
	'Filter Wrench (metal)',
];

// Batch consumables + how many days until their test lot expires (relative to
// today). Negative = already expired. Spread across stores in the same order.
const BATCH_LOTS = [
	['Engine Coolant 50/50', 5],
	['Gear Oil 80W-90 20L', 8],
	['Hydraulic Oil AW46 20L', 11],
	['Diesel Engine Oil 15W-40', 14],
	['Transmission Fluid ATF-D2', 18],
	['Chain Grease 400g', 22],
	['Cutting Fluid 5L', 26],
];

async function main() {
	const suppliers = await api('/api/entities/mro_suppliers?per_page=50');
	const supplier = (Array.isArray(suppliers) ? suppliers : []).find((s) => !s.deleted_at);
	if (!supplier) throw new Error('no supplier found');

	// ── A. Reorder (standard) across stores ────────────────────────────────
	title('1. Demote main_store rows from the earlier single-store run');
	// Any of the catalogue parts sitting in main_store below reorder get demoted
	// so the full list doesn't pile up on the default store.
	{
		const main = (await api('/api/mro/stock/onhand')).rows.filter(
			(r) => r.location === 'main_store' && r.below_reorder && PARTS.includes(r.model_name),
		);
		for (const r of main) {
			await api(`/api/entities/mro_inventory/${r.id}`, {
				method: 'PUT',
				body: JSON.stringify({ reorder_level: 0 }),
			});
		}
		log(`  demoted ${main.length} main_store catalogue rows (reorder_level 0)`);
	}

	// Distribute the parts round-robin so each store owns ~7 reorder crosses (each
	// with a qty 1..5 and a reorder_level just above it so every row reads below).
	title('2. Receive reorder stock into each store');
	const created = { reorder: 0, expiry: 0 };
	const modelCache = {};
	const perStoreLines = STORES.map(() => []);
	for (let i = 0; i < PARTS.length; i++) {
		const storeIdx = i % STORES.length;
		const name = PARTS[i];
		const qty = (i % 5) + 1; // 1..5
		const model = modelCache[name] ?? (modelCache[name] = await findOrCreateModel(name, 'standard', {}));
		perStoreLines[storeIdx].push({ item_model: model.id, name, qty });
	}

	// Receive each store's parts via a confirmed inbound, then clamp reorder.
	for (let s = 0; s < STORES.length; s++) {
		const store = STORES[s];
		const linesGroup = perStoreLines[s];
		for (let chunk = 0; chunk < linesGroup.length; chunk += 5) {
			const chunkLines = linesGroup.slice(chunk, chunk + 5);
			const doc = await api('/api/entities/mro_inbounds', {
				method: 'POST',
				body: JSON.stringify({
					supplier: supplier.id,
					purchase_date: dateToday(),
					type: 'purchase',
					location: store,
					lines: chunkLines.map((l) => ({ item_model: l.item_model, qty: l.qty, unit_price: 800 + l.qty * 50 })),
				}),
			});
			await api(`/api/mro/inbounds/${doc.id}/confirm`, { method: 'POST', body: JSON.stringify({}) });

			const rows = (await api('/api/mro/stock/onhand')).rows;
			for (const l of chunkLines) {
				const inv = rows.find((r) => r.location === store && r.model === l.item_model);
				if (!inv) throw new Error(`no inventory row for ${l.name} at ${store}`);
				await api(`/api/entities/mro_inventory/${inv.id}`, {
					method: 'PUT',
					body: JSON.stringify({ reorder_level: l.qty + 15 }),
				});
				created.reorder += 1;
				log(`  [reorder] ${store} · ${l.name} qty ${l.qty} → reorder ${l.qty + 15}`);
			}
		}
	}

	// ── B. Expiry (batch) lots across stores ───────────────────────────────
	title('3. Receive expiring batch lots into each store');
	// Distribute the 7 lots round-robin (i % stores): main_store and admin_store
	// get 2 lots each, the other three get 1 each — every store sees expiry rows.
	const perStoreBatch = STORES.map((_, s) =>
		BATCH_LOTS.map((_, i) => i)
			.filter((i) => i % STORES.length === s)
			.map((i) => ({ name: BATCH_LOTS[i][0], days: BATCH_LOTS[i][1], location: STORES[s] })),
	);
	for (let s = 0; s < STORES.length; s++) {
		const location = STORES[s];
		for (const { name, days } of perStoreBatch[s]) {
			const model = await findOrCreateModel(name, 'batch', { expiry_alert_days: 60 });
			const qty = 4 + (Math.abs(days) % 5);
			const batchNo = `${(name.match(/[A-Za-z]/g) || []).slice(0, 3).join('') || 'LOT'}-${location.slice(0, 4).toUpperCase()}-${suffix()}`;
			const expiryDate = mmt(days);
			const doc = await api('/api/entities/mro_inbounds', {
				method: 'POST',
				body: JSON.stringify({
					supplier: supplier.id,
					purchase_date: dateToday(),
					type: 'purchase',
					location,
					lines: [{ item_model: model.id, qty, unit_price: 4000, batch_no: batchNo, expiry_date: expiryDate }],
				}),
			});
			await api(`/api/mro/inbounds/${doc.id}/confirm`, { method: 'POST', body: JSON.stringify({}) });
			// A reorder shelf on the arriving lot makes the reorder cross span Batch too
			// (available ≤ shelf — the same rule the standard catalogue rides on).
			const onhand0 = await api('/api/mro/stock/onhand');
			const batchInv = onhand0.rows.find((r) => r.location === location && r.model === model.id);
			if (batchInv) {
				await api(`/api/entities/mro_inventory/${batchInv.id}`, {
					method: 'PUT',
					body: JSON.stringify({ reorder_level: batchInv.qty_on_hand + 2 }),
				});
			}
			created.expiry += 1;
			log(`  [expiry] ${location} · ${name} ${qty} units · lot ${batchNo} expires ${expiryDate} (${days}d)`);
		}
	}

	// ── C. Serial units across stores ───────────────────────────────────────────
	title('4. Receive serialised units into each store');
	// A serialised model round-robin: receive 1..2 units per store and clamp a shelf
	// just above them so the ပြန်မှာရန် list carries a Serial badge in every store.
	const SERIAL_UNIT = { name: 'Laser Collimator Kit', tracking: 'serial' };
	const serialModel = await findOrCreateModel(SERIAL_UNIT.name, SERIAL_UNIT.tracking, {});
	for (let s = 0; s < STORES.length; s++) {
		const location = STORES[s];
		const count = 1 + (s % 2); // 1..2 units per store
		const serials = Array.from({ length: count }, (_, j) => `LCK-26-${String(100 + s * 10 + j).padStart(4, '0')}`);
		const doc = await api('/api/entities/mro_inbounds', {
			method: 'POST',
			body: JSON.stringify({
				supplier: supplier.id,
				purchase_date: dateToday(),
				type: 'purchase',
				location,
				lines: [{ item_model: serialModel.id, qty: serials.length, unit_price: 90000, serials }],
			}),
		});
		await api(`/api/mro/inbounds/${doc.id}/confirm`, { method: 'POST', body: JSON.stringify({}) });
		const onhand1 = await api('/api/mro/stock/onhand');
		const inv = onhand1.rows.find((r) => r.location === location && r.tracking === 'serial' && r.model === serialModel.id);
		if (inv) {
			await api(`/api/entities/mro_inventory/${inv.id}`, {
				method: 'PUT',
				body: JSON.stringify({ reorder_level: count + 2 }),
			});
		}
		log(`  [serial] ${location} · ${SERIAL_UNIT.name} ${serials.join(', ')}`);
	}

	// ── Verify ─────────────────────────────────────────────────────────────
	title('Verify across stores');
	const onhand = (await api('/api/mro/stock/onhand')).rows;
	const exp = await api('/api/mro/stock/expiring?days=120');
	for (const store of STORES) {
		const below = onhand.filter((r) => r.location === store && r.below_reorder).length;
		const expiring = [...exp.expired, ...exp.expiring].filter((r) => r.location === store).length;
		log(`  ${store.padEnd(15)} reorder rows ${String(below).padEnd(2)} · expiry rows ${expiring}`);
	}
	log(`\n  created: ${created.reorder} reorder crosses · ${created.expiry} expiring lots`);
	return created;
}

main()
	.then(() => log(`\nDone — seeded across stores.`))
	.catch((err) => {
		console.error('SEED FAILED:', err.message);
		process.exitCode = 1;
	});
