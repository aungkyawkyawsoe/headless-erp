#!/usr/bin/env node
/**
 * Add `veh_fleets.image` (engine image column → TEXT `/api/media/<key>`) so each
 * truck can carry its own photo — the fleet card shows it the same way the stock
 * item page shows an SKU photo (full-height left tile, monogram until uploaded).
 *
 * Same targeted, idempotent PUT-merge pattern as apply-veh-wheel-slots.mjs:
 * reads the live schema, appends the field only when it is missing, and lets the
 * collections API run the DDL + cache invalidation.
 *
 *   node scripts/apply-veh-fleets-image.mjs [baseUrl] [bearerToken]
 */
const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const H = (init = {}) => ({ ...init, headers: { ...headers, ...(init.headers ?? {}) } });

const FIELD = {
	name: 'image',
	label: 'Image',
	type: 'image',
	required: false,
	max_size: 1,
};

async function call(path, init = {}) {
	const res = await fetch(`${baseUrl}${path}`, H(init));
	const text = await res.text();
	if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`);
	if (!text) return null;
	try {
		const body = JSON.parse(text);
		return body && typeof body === 'object' && 'data' in body ? body.data : body;
	} catch {
		return text;
	}
}

const run = async () => {
	const col = await call('/api/collections/veh_fleets');
	if (!col || !col.schema_json) throw new Error(`veh_fleets collection not found: ${JSON.stringify(col).slice(0, 200)}`);
	const fields = (col.schema_json.fields ?? []).filter((f) => f && typeof f.name === 'string');
	const exists = fields.some((f) => f.name === 'image');
	if (exists) {
		console.log('veh_fleets.image already exists — no-op ✅');
		return;
	}
	fields.push(FIELD);
	await call(`/api/collections/veh_fleets`, { method: 'PUT', body: JSON.stringify({ fields }) });
	console.log('veh_fleets.image added ✅');
};

run().catch((err) => {
	console.error('ABORTED:', err);
	process.exit(1);
});
