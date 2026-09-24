/**
 * MRO stock populate seed — give the /app/stocks dashboard real volume.
 *
 *   node scripts/seed-mro-stock-populate.mjs [baseUrl] [bearerToken] [howMany]
 *
 * Defaults: http://localhost:8788 · `dev-token` · 30 models.
 *
 * What it does (the engine's OWN confirmed path — nothing bypassed):
 *   1. Create `howMany` NEW standard `mro_item_model` rows from the realistic
 *      spare-parts list below (find-or-create by `name_en`, so re-runs reuse
 *      rather than duplicate masters).
 *   2. Receive each into `main_store` through a purchase inbound (small qty), in
 *      batches of 5 lines per document, then confirm — real stock lands.
 *   3. For each model set its `mro_inventory.reorder_level` ABOVE the on-hand
 *      qty so the balance reads `below_reorder` → the dashboard's ပြန်မှာရန်
 * dashboard's ပြန်မှာရန်
 *      tab lists it.
 *
 * You can safely re-run: a part already in stock gets more stock and its reorder
 * level is re-clamped above the new qty, so it stays a reorder item (stock grows
 * across runs — fine for a demo).
 */

import { modelNames } from './mro-model-names.mjs';
import { listAllRows } from './lib/list-all-rows.mjs';
import { refuseIfSuperseded } from './lib/superseded-seed.mjs';

refuseIfSuperseded({
	script: 'seed-mro-stock-populate.mjs',
	replacement: [
		'node scripts/seed-mro-catalog.mjs --apply   (item names + their policies + SKUs)',
		'node scripts/reset-mro-stock.mjs --apply    (blank the stock screens)',
	],
});

const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';
const howMany = Number(process.argv[4] ?? 30);
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const H = (init) => ({ ...init, headers: { ...headers, ...(init?.headers ?? {}) } });

const log = (...a) => console.log(...a);
const title = (s) => log(`\n── ${s}`);

async function api(path, init = {}) {
	const res = await fetch(`${baseUrl}${path}`, H(init));
	const body = await res.json().catch(() => null);
	if (!res.ok && !(body && body.success)) {
		throw new Error(`${init.method ?? 'GET'} ${path} → HTTP ${res.status}: ${body?.error ?? JSON.stringify(body)}`);
	}
	return body.data;
}

const PART_NAMES = [
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
].map((n) => n);

async function findOrCreateModel(name) {
	// Whole-collection read — the list route paginates at 25 by default, so a
	// single bare request would miss rows past page 1 and duplicate them.
	const rows = await listAllRows(baseUrl, token, 'mro_item_model', 'id,name_en');
	const found = rows.find((r) => r.name_en === name);
	if (found) return found;
	return api('/api/entities/mro_item_model', { method: 'POST', body: JSON.stringify(modelNames(name)) });
}

async function main() {
	const count = Math.min(howMany, PART_NAMES.length);
	title(`Targeting ${count} reorder items in main_store`);
	const names = PART_NAMES.slice(0, count);

	// Supplier for the purchase doc(s) — reuse the first existing supplier.
	const suppliers = await api('/api/entities/mro_suppliers?per_page=50');
	const supplier = (Array.isArray(suppliers) ? suppliers : []).find((s) => !s.deleted_at);
	if (!supplier) throw new Error('no supplier found');

	// 1. Models.
	title('Create item models (standard tracking)');
	const models = [];
	for (const name of names) {
		const m = await findOrCreateModel(name);
		models.push({ id: m.id, name });
	}
	log(`  ${models.length} models ready`);

	// 2. Receive + reorder-clamp per model, 5 lines per purchase document.
	title('Receive into main_store + set reorder above qty');
	const qtyOf = (modelId) => models.find((m) => m.id === modelId)?.name ?? modelId;
	let drafted = [];
	let created = 0;
	const clampBatch = async () => {
		// One fetch tells us every on-hand row changed by the just-confirmed doc.
		const rows = await api('/api/mro/stock/onhand');
		for (const line of drafted) {
			const inv = rows.rows.find((r) => r.location === 'main_store' && r.model === line.item_model);
			if (!inv) throw new Error(`no inventory row for ${qtyOf(line.item_model)}`);
			await api(`/api/entities/mro_inventory/${inv.id}`, {
				method: 'PUT',
				body: JSON.stringify({ reorder_level: line.qty + 20 }),
			});
			created += 1;
			log(`  [${created}] ${qtyOf(line.item_model).padEnd(32)} qty ${line.qty} → reorder ${line.qty + 20} (below ✓)`);
		}
		drafted = [];
	};

	for (let i = 0; i < models.length; i++) {
		drafted.push({ item_model: models[i].id, qty: (i % 6) + 2, unit_price: 1000 + i * 100 });
		if (drafted.length === 5 || i === models.length - 1) {
			const doc = await api('/api/entities/mro_inbounds', {
				method: 'POST',
				body: JSON.stringify({
					supplier: supplier.id,
					purchase_date: new Date().toISOString().slice(0, 10),
					type: 'purchase',
					location: 'main_store',
					lines: drafted,
				}),
			});
			await api(`/api/mro/inbounds/${doc.id}/confirm`, { method: 'POST', body: JSON.stringify({}) });
			await clampBatch();
		}
	}

	title('Verify');
	const onhand = await api('/api/mro/stock/onhand');
	const below = onhand.rows.filter((r) => r.location === 'main_store' && r.below_reorder);
	log(`  main_store below_reorder rows: ${below.length}`);
	return below.length;
}

try {
	const n = await main();
	log(`\nDone — ${n} reorder items ready in main_store.`);
} catch (err) {
	console.error('SEED FAILED:', err.message);
	process.exitCode = 1;
}
