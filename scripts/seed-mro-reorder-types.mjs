/**
 * Spread below-reorder rows across ALL tracking policies — so the /app/stocks
 * ပြန်မှာရန် tab shows Standard AND Batch AND Serial badges, not just Standard.
 *
 * Why this exists: `seed-mro-all-stores.mjs` seeded reorder crosses only for the
 * standard spare-parts catalogue, and received its batch/expiry lots + the demo's
 * serial tyres WITHOUT a reorder_level (0). The reorder flag reads real policy —
 * `below_reorder = reorder_level > 0 && available <= reorder_level` where
 * `available` is the derived lot/serial total — so those tracked models never
 * surfaced under Standard's data.
 *
 * This finalizer works on the EXISTING stock (no big re-dump):
 *
 *   1. Batch reorder — every batch model already in stock (one+ active lot per
 *      store) gets a reorder_level just above its lot total → Batch rows.
 *   2. Serial reorder — the two stores with no serial unit yet (safety + vehicle)
 *      receive a small serialized lot of the existing tyre model, then every
 *      serial model in stock gets a reorder_level above its serial count → the
 *      Serial badge appears in every store.
 *
 * Not needed for standard — the catalogue already reads below_reorder everywhere.
 *
 *   node scripts/seed-mro-reorder-types.mjs [baseUrl] [bearerToken]
 */
const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const H = (init) => ({ ...init, headers: { ...headers, ...(init?.headers ?? {}) } });

const log = (...a) => console.log(...a);
const title = (s) => log(`\n── ${s}`);

const STORES = ['main_store', 'admin_store', 'mandalay_store', 'safety_store', 'vehicle_store'];

/** How far above the current on-hand the reorder shelf sits — enough cushion that
 *  `available <= reorder_level` holds without sitting exactly on the edge. */
const CUSHION = 2;

async function api(path, init = {}) {
	const res = await fetch(`${baseUrl}${path}`, H(init));
	const body = await res.json().catch(() => null);
	if (!res.ok && !(body && body.success)) {
		throw new Error(`${init.method ?? 'GET'} ${path} → HTTP ${res.status}: ${body?.error ?? JSON.stringify(body)}`);
	}
	return body.data;
}

async function setReorderLevel(model, location, current) {
	const rows = await api('/api/mro/stock/onhand');
	const inv = rows.rows.find((r) => r.model === model && r.location === location);
	if (!inv) throw new Error(`no inventory row for ${location}`);
	const level = Math.max(current, 1) + CUSHION;
	await api(`/api/entities/mro_inventory/${inv.id}`, {
		method: 'PUT',
		body: JSON.stringify({ reorder_level: level }),
	});
	log(`  [reorder] ${location} · ${inv.model_name} (${inv.tracking}) on-hand ${inv.qty_on_hand} → reorder ${level}`);
	return 1;
}

async function main() {
	// Could reuse an existing supplier for the safety/vehicle serial top-up.
	const suppliers = await api('/api/entities/mro_suppliers?per_page=50');
	const supplier = (Array.isArray(suppliers) ? suppliers : []).find((s) => !s.deleted_at);
	if (!supplier) throw new Error('no supplier found');
	// Model id for the serial tyre — read from onhand (the engine resolves it; the
	// entity list route may not surface this seeded model, so don't trust that).
	const onhand0 = (await api('/api/mro/stock/onhand')).rows;
	const serialSample = onhand0.find((r) => r.tracking === 'serial');
	if (!serialSample?.model) throw new Error('no serial model in stock to reference');
	const tyreId = serialSample.model;
	const today = new Date().toISOString().slice(0, 10);

	let batch = 0;
	let serial = 0;

	// ── 1. Serial top-up into stores that had NO serialised unit at all ──
	title('Top-up: serial units into safety_store + vehicle_store');
	const need = async () => {
		const rows = (await api('/api/mro/stock/onhand')).rows;
		const missing = STORES.filter((s) => !rows.some((r) => r.location === s && r.tracking === 'serial' && r.qty_on_hand > 0));
		const indexByStore = Object.fromEntries(STORES.map((s, i) => [s, i]));
		return missing.map((store) => ({ store, i: indexByStore[store] }));
	};
	for (const { store, i } of await need()) {
		const serials = [`TY-2026-7${i}01`, `TY-2026-7${i}02`];
		const doc = await api('/api/entities/mro_inbounds', {
			method: 'POST',
			body: JSON.stringify({
				supplier: supplier.id,
				purchase_date: today,
				type: 'purchase',
				location: store,
				lines: [{ item_model: tyreId, qty: serials.length, unit_price: 340000, serials }],
			}),
		});
		await api(`/api/mro/inbounds/${doc.id}/confirm`, { method: 'POST', body: JSON.stringify({}) });
		log(`  [serial stock] ${store} received ${serials.join(', ')}`);
	}

	// ── 2. Clamp reorder on every batch + serial row already in stock ──────
	const onhand = (await api('/api/mro/stock/onhand')).rows;
	const tracked = onhand.filter(
		(r) => (r.tracking === 'batch' || r.tracking === 'serial') && (r.qty_on_hand ?? 0) > 0 && r.id,
	);
	for (const r of tracked) {
		// Only touch rows without a configured shelf — the seeded 0s are the gap;
		// anything already set is a real policy and stays.
		if ((r.reorder_level ?? 0) > 0) continue;
		const ok = await setReorderLevel(r.model, r.location, r.qty_on_hand);
		if (r.tracking === 'batch') batch += ok;
		else serial += ok;
	}

	// ── Verify ─────────────────────────────────────────────────────────────
	title('Verify across stores (reorder crosses by tracking)');
	const now = (await api('/api/mro/stock/onhand')).rows;
	for (const store of STORES) {
		const cross = now.filter((r) => r.location === store && r.below_reorder);
		const byType = Object.fromEntries(['standard', 'batch', 'serial'].map((t) => [t, cross.filter((r) => r.tracking === t).length]));
		log(`  ${store.padEnd(15)} standard ${byType.standard} · batch ${byType.batch} · serial ${byType.serial}`);
	}
	log(`\n  reorder_levels set: ${batch + serial}`);
	return { batch, serial };
}

main()
	.then(() => log('\nDone — reorder now spans standard + batch + serial.'))
	.catch((err) => {
		console.error('SEED FAILED:', err.message);
		process.exitCode = 1;
	});
