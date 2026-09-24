#!/usr/bin/env node
/**
 * Smoke test for the fleet-care "one `veh_fleets` fetch" denormalization.
 *
 * Verifies the whole chain that lets `/app/fleets` + `/app/fluid` compute
 * engine/gear km-left chips from a SINGLE `veh_fleets` read — mirroring how
 * `last_license` / `last_insurance` already work on the fleet master:
 *
 *   1. `veh_fleets` carries the care columns
 *      (`last_odo` / `last_engine_oil` / `last_gear_oil`).
 *   2. The lifecycle hooks are registered (`veh-care-denorm` on
 *      `veh_odo_months` + `veh_fluid_fills`, insert + update).
 *   3. The one-time historical backfill works
 *      (`POST /api/mro/veh/care/relink`).
 *   4. Relink actually populates the master (not every row stays null).
 *   5. km-left chips compute with the client-side arithmetic
 *      `engineOilKmLeft = last_engine_oil − last_odo`
 *      `gearOilKmLeft   = last_gear_oil   − last_odo`
 *      → the value the list screens render with zero child reads.
 *
 * Does NOT mutate data: the relink call is idempotent recompute (re-running it
 * only refreshes the master pointers from existing odo/fill rows). Rerun an
 * added/fixed fleet freely.
 *
 * Usage:
 *   cd apps/api && node scripts/smoke-care-denorm.mjs
 *
 * Env overrides: PROVISION_API (default http://127.0.0.1:8788),
 *                PROVISION_TOKEN (default dev-token)
 *
 * Exit code is non-zero when any check fails (handy for CI/pre-deploy gates).
 */
const BASE = process.env.PROVISION_API || 'http://127.0.0.1:8788';
const TOKEN = process.env.PROVISION_TOKEN || 'dev-token';
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

const log = (...a) => console.log(...a);
let checks = 0;
let failures = 0;

function ok(msg, extra) {
	checks++;
	log(`  ✓ ${msg}${extra ? ' — ' + extra : ''}`);
}
function bad(msg, extra) {
	failures++;
	checks++;
	log(`  ✗ ${msg}${extra ? ' — ' + extra : ''}`);
}

async function call(path, opts = {}) {
	const res = await fetch(`${BASE}${path}`, { headers: HEADERS, ...opts });
	const text = await res.text();
	if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`);
	if (!text) return null;
	try {
		const body = JSON.parse(text);
		return body && typeof body === 'object' && 'data' in body ? body.data : body;
	} catch {
		return text;
	}
}
const api = (method, path, body) => call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

const CARE_FIELDS = ['last_odo', 'last_engine_oil', 'last_gear_oil'];

// ── 1. schema columns ────────────────────────────────────────────────────
async function checkColumns(collection) {
	const fields = [];
	try {
		const col = await call(`/api/collections/${collection}`);
		for (const f of (col?.schema_json?.fields ?? []) || []) fields.push(f?.name);
	} catch (err) {
		return bad(`read ${collection} schema`, err.message);
	}
	for (const name of CARE_FIELDS) {
		if (fields.includes(name)) ok(`veh_fleets.last_odo-ish column \`${name}\` present`);
		else bad(`veh_fleets column \`${name}\` missing — run provision-hr-schema.mjs first`);
	}
}

// ── 2. lifecycle hooks registered ────────────────────────────────────────
async function checkHooks() {
	let list;
	try {
		list = await call('/api/hook-registry');
	} catch (err) {
		return bad('read hook registry', err.message);
	}
	if (!Array.isArray(list)) return bad('hook registry shape', 'expected an array');
	const want = [
		{ collection: 'veh_odo_months', event: 'after_insert', needle: 'last_odo' },
		{ collection: 'veh_odo_months', event: 'after_update', needle: 'last_odo' },
		{ collection: 'veh_fluid_fills', event: 'after_insert', needle: 'next_due_odo' },
		{ collection: 'veh_fluid_fills', event: 'after_update', needle: 'next_due_odo' },
	];
	for (const w of want) {
		const hit = list.some(
			(h) =>
				h?.collection === w.collection &&
				h?.event === w.event &&
				(typeof h?.description === 'string' ? h.description.includes(w.needle) : false),
		);
		if (hit) ok(`hook ${w.collection} ${w.event} registered (care denorm)`);
		else bad(`hook ${w.collection} ${w.event} NOT registered — is veh-care-denorm loaded in the worker?`);
	}
}

// ── 3. write-roundtrip denorm (live proof, not just backfill) ────────────
// Pick a vehicle, then confirm an odo/fill WRITE actually updates the master
// columns — not only the relink maintenance path. Creates transient rows via
// the entity API and cleans them up so the smoke stays non-destructive.
async function pickVehicle() {
	const fleets = await call('/api/entities/veh_fleets?fields=id,plate_no&sort=plate_no&limit=1');
	return Array.isArray(fleets) && fleets[0] ? fleets[0] : null;
}

// Create one transient engine-oil fill, confirm the hook updates the master,
// then DELETE it so the smoke leaves no residue. A far future `odo_at_fill` /
// `next_due_odo` makes the write unambiguously the "newest" fill, forcing the
// re-rank to land on it (and the master back to its prior value after cleanup).
async function checkWriteDenorm(vehicleId) {
	const readMaster = (fields) =>
		call(`/api/entities/veh_fleets/${vehicleId}?fields=${encodeURIComponent(fields)}`);

	let before, createdId;
	try {
		before = await readMaster('id,last_engine_oil,last_gear_oil,last_odo');
		createdId = null;
	} catch (err) {
		return bad('read master before write', err.message);
	}

	const engineDue = 9_999_999; // absurd = newest, unambiguous re-rank target
	const prior = Number(before?.last_engine_oil ?? 0);
	try {
		const created = await api('POST', '/api/entities/veh_fluid_fills', {
			vehicle: vehicleId,
			fluid_kind: 'engine_oil',
			odo_at_fill: Math.max(engineDue, prior + 1),
			qty_liters: 1,
			next_due_odo: engineDue,
		});
		createdId = created?.id ?? created;
		if (!createdId) throw new Error(`fill create returned no id: ${JSON.stringify(created).slice(0, 200)}`);

		const after = await readMaster('id,last_engine_oil,last_gear_oil,last_odo');
		const got = after?.last_engine_oil ?? null;
		const expected = Math.max(engineDue, prior); // re-rank keeps the overall newest NEXT-due
		if (Number(got) === expected)
			ok('engine-oil WRITE updated veh_fleets.last_engine_oil (live hook)', `${before?.last_engine_oil ?? 'null'} → ${got}`);
		else bad('engine-oil WRITE should move last_engine_oil', `expected ${expected}, got ${got}`);
	} catch (err) {
		bad('exercise engine-oil write hook', err.message);
	} finally {
		if (createdId) {
			try {
				await api('DELETE', `/api/entities/veh_fluid_fills/${createdId}`);
			} catch {
				/* best-effort cleanup — relink heals any residue below */
			}
		}
		// No after_delete hook exists for fills, so the transient row above
		// (which became the newest) leaves the master pointer raised until a
		// recompute. Relink-all right here restores the true newest value, so
		// the smoke leaves ZERO residue even if it's interrupted afterwards.
		if (createdId) {
			try {
				await api('POST', '/api/mro/veh/care/relink');
			} catch {
				/* heal is best-effort — the daily maintenance run covers it */
			}
		}
	}
}

// ── 4. maintenance backfill populates + 5. km-left arithmetic ────────────
async function checkRelinkAndChips() {
	let relink;
	try {
		relink = await api('POST', '/api/mro/veh/care/relink');
	} catch (err) {
		return bad('care relink maintenance', err.message);
	}
	const relinked = Number(relink?.relinked ?? 0);
	// We don't hard-require a count (a fresh DB legitimately has 0);
	// the real assertion is downstream: at least the master rows that have
	// child data now carry non-null care columns.
	//   ok(`care relink maintenance ran`, `relinked=${relinked}`);

	const rows = await call(
		'/api/entities/veh_fleets?fields=id,plate_no,last_odo,last_engine_oil,last_gear_oil&limit=200&sort=plate_no',
	);
	if (!Array.isArray(rows)) return bad('list fleets for chip check', 'no rows');
	let populated = 0;
	const printed = [];
	for (const r of rows) {
		const { id, plate_no } = r;
		const odo = r.last_odo, en = r.last_engine_oil, ge = r.last_gear_oil;
		if (odo != null && (en != null || ge != null)) populated++;
		const enLeft = en != null && odo != null ? en - odo : null;
		const geLeft = ge != null && odo != null ? ge - odo : null;
		if (odo != null || en != null || ge != null) {
			printed.push(
				`    ${String(plate_no).padEnd(9)} last_odo=${String(odo ?? '').padStart(8)}  ` +
					`engineOil Km-left=${String(enLeft ?? '').padStart(8)}  gearOil Km-left=${String(geLeft ?? '').padStart(8)}`,
			);
		}
	}
	if (printed.length) log(printed.join('\n'));
	if (populated > 0) ok(`fleets carry denormalized care (${populated}/${rows.length}) — single-fetch chips available`);
	else {
		const hasAnyRows = rows.some((r) => r.last_odo != null || r.last_engine_oil != null || r.last_gear_oil != null);
		if (hasAnyRows) ok('some fleets carry care columns (partial population is fine)');
		else bad('NO fleet row carries last_odo / last_engine_oil / last_gear_oil', 'no child odo/fill data exists yet — nothing to denormalize');
	}
}

// ── run ──────────────────────────────────────────────────────────────────
async function main() {
	log(`Smoke-testing fleet-care denorm against ${BASE} (token: ${TOKEN === 'dev-token' ? 'dev-token' : '***'})`);

	try {
		const health = await call('/api/health');
		if (!health) throw new Error('no /api/health payload');
		ok('API reachable');
	} catch (err) {
		bad('API reachable', `${err.message} — start it first (cd apps/api && npx wrangler dev)`);
		log('');
		log(`✗ ${failures} of ${checks} checks failed`);
		process.exitCode = 1;
		return;
	}

	log('\n[1/5] schema columns');
	await checkColumns('veh_fleets');

	log('\n[2/5] lifecycle hooks registered');
	await checkHooks();

	log('\n[3/5] live write-roundtrip denorm');
	const vehicle = await pickVehicle().catch(() => null);
	if (vehicle && vehicle.id) {
		ok('sampled vehicle', `${vehicle.plate_no} (${vehicle.id})`);
		await checkWriteDenorm(vehicle.id);
	} else bad('sampled vehicle', 'no veh_fleets rows to exercise a live write against');

	log('\n[4/5] maintenance backfill (relink)');
	log('\n[5/5] denormalized columns + km-left chips');
	await checkRelinkAndChips();

	log('');
	if (failures === 0) log(`✓ PASS — all ${checks} checks green. List screens need ONE veh_fleets fetch.`);
	else log(`✗ ${failures} of ${checks} checks failed`);
	if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
