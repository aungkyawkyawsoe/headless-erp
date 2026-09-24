#!/usr/bin/env node
/**
 * Live read-check for the တာယာ (tyres) / serial-unit register (`/app/tyres`).
 *
 * Reports exactly what the tyres LIST screen reads from the running worker:
 *   - mro_stock_serials rows (the serial units) with the register projection;
 *   - how many resolve to a serial-tracked `mro_item_model` (tracking='serial'),
 *     which is the ONLY rows the register card renders.
 *
 * A blank page happens when EVERY serial resolves to a non-serial SKU (all rows
 * filtered by `tyreUnitsOf`), or when the two collections are unreachable.
 *
 *   node scripts/check-tyres-register.mjs [baseUrl] [bearerToken]
 */
const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function walkItemModels() {
	// Mirror fetchTyreModels: cursor-walk mro_item_model (limit capped at 100).
	// The tracking POLICY lives on the item NAME now (`mro_item_name.tracking`) —
	// `mro_item_model` no longer carries the column — so it is requested as a
	// nested expansion and read off the expanded relation below.
	const rows = [];
	let cursor = undefined;
	let guard = 0;
	do {
		const qs = new URLSearchParams({ fields: 'id,name_en,item_name.tracking', limit: '100', ...(cursor ? { cursor } : {}) });
		const res = await fetch(`${baseUrl}/api/entities/mro_item_model?${qs}`, { headers });
		const body = await res.json().catch(() => null);
		if (!res.ok) throw new Error(`mro_item_model: HTTP ${res.status} ${body?.error ?? ''}`);
		rows.push(...(body.data ?? []));
		if (!body.meta?.has_more) break;
		cursor = body.meta?.next_cursor;
		if (!cursor || ++guard > 50) break;
	} while (cursor);
	return rows;
}

/** The SKU's inherited tracking policy — flattened off the expanded item NAME. */
function trackingOf(model) {
	return typeof model.item_name === 'object' && model.item_name ? (model.item_name.tracking ?? null) : null;
}

const run = async () => {
	const models = await walkItemModels();
	const serialModelById = new Map(models.filter((m) => trackingOf(m) === 'serial').map((m) => [m.id, m]));
	console.log(
		`mro_item_model: ${models.length} total · serial-tracked (tyre SKUs): ${serialModelById.size}`,
	);

	const res = await fetch(`${baseUrl}/api/entities/mro_stock_serials?fields=id,serial_no,status,vehicle,slot,location,model&sort=serial_no&limit=100`, {
		headers,
	});
	const body = await res.json().catch(() => null);
	if (!res.ok) {
		console.error(`mro_stock_serials: HTTP ${res.status} ${body?.error ?? ''}`);
		process.exit(1);
	}
	const units = body.data ?? [];
	let renderable = 0;
	const skipped = [];
	for (const u of units) {
		const modelRef = typeof u.model === 'object' ? u.model : serialModelById.get(u.model);
		const isSerial = modelRef?.tracking === 'serial';
		if (isSerial) renderable += 1;
		else skipped.push(`${u.serial_no} (${modelRef?.name_en ?? u.model ?? 'no-model'})`);
	}
	console.log(`mro_stock_serials: ${units.length} total · renderable on the register: ${renderable}`);
	if (skipped.length) console.log(`  skipped (not serial-tracked SKU): ${skipped.join(', ')}`);
	if (renderable === 0) console.log('  ⚠️ register would render EMPTY (blank list).');
	else console.log('  ✅ register has rows to render.');
	process.exit(renderable > 0 ? 0 : 1);
};

run().catch((e) => {
	console.error('CHECK ABORTED:', e.message ?? e);
	process.exit(2);
});
