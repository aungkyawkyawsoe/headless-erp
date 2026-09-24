#!/usr/bin/env node
/**
 * Add `veh_fleets.wheel_slots` (engine JSON column) so each truck can declare
 * its ordered wheel-seat list — the tyre fitment board keys every block + the
 * fit/rotate slot vocabulary to it (single source of truth; number-only `wheel`
 * can't label variable axles).
 *
 * Mirror of the reconcile() we use in provision-hr-schema.mjs, but TARGETED to
 * this one field on veh_fleets only (never touches the HR collections), and
 * idempotent (no-op when the field already exists).
 *
 *   node scripts/apply-veh-wheel-slots.mjs [baseUrl] [bearerToken]
 */
const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const H = (init = {}) => ({ ...init, headers: { ...headers, ...(init.headers ?? {}) } });

const FIELD = {
	name: 'wheel_slots',
	label: 'Wheel Slots',
	type: 'json',
	required: false,
	description: "Ordered wheel seats (array of { id, label }) this vehicle wears — the fitment board's blocks + the fit/rotate slot vocabulary.",
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
	const exists = fields.some((f) => f.name === 'wheel_slots');
	if (exists) {
		console.log('veh_fleets.wheel_slots already exists — no-op ✅');
		return;
	}
	fields.push(FIELD);
	await call(`/api/collections/veh_fleets`, { method: 'PUT', body: JSON.stringify({ fields }) });
	console.log('veh_fleets.wheel_slots added ✅');
};

run().catch((err) => {
	console.error('ABORTED:', err);
	process.exit(1);
});
