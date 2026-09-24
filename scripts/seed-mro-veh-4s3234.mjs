#!/usr/bin/env node
/**
 * SEED one vehicle's tyre + equipment register into a D1 (local OR remote):
 * plate `4S-3234` — a 6-wheel `tractor_unit` that currently holds nothing.
 *
 *   node scripts/seed-mro-veh-4s3234.mjs              (dry run — prints the plan)
 *   node scripts/seed-mro-veh-4s3234.mjs --apply
 *
 * Target: the D1 database named in `infra/env.prod` (CLOUDFLARE_ACCOUNT_ID / D1_ID
 * overridable). It talks to the Cloudflare HTTP API — the same transport the other
 * D1 ops scripts use — so there is no separate local mode here.
 *
 * What it adds (all `status = 'issued'`, i.e. HELD by the truck — never store stock):
 *   tyres      6 × `11R22.5`, one per wheel seat of the truck plan
 *              (steer-l/r + drv1-lo/li/ri/ro), tread spread across the three
 *              bands (Good ≥5mm · Warning 3–5 · Replace <3) so the rig tiles and
 *              the wear KPIs show every tone;
 *   equipment  3 asset units — Hydraulic Bottle Jack `20 T`, Wrench `14`,
 *              Screwdriver `small` — seated on the truck (no wheel slot), each
 *              with a `good` condition.
 *
 * It ALSO sets `mro_item_model.reference_tread_mm = 20` on `11R22.5` when unset —
 * the wear % needs a new-tread baseline (`remaining = tread_mm / reference`), and
 * until this exists the fitment board honestly shows NO reading.
 *
 * WHY RAW SQL (this is the documented exception, not a habit): the three MRO
 * stock tables are `writes.mode = 'service'` / `append_only`, so the generic
 * entity API refuses them by design. Seeding mirrors `seed-mro-tyres-demo.sql`:
 *   - every row is `issued` (never `in_stock`), so the MRO reconcile's serial
 *     derivation never counts them and `cms_mro_inventory` is untouched
 *     (`balance_drift` / `orphan_stock` stay empty);
 *   - each serial's `updated_at` is kept at/after its newest event, so
 *     `snapshot_stale` stays empty;
 *   - ids are DETERMINISTIC (`serial_no` / `serial_no:event`) + `INSERT OR IGNORE`,
 *     and the baseline UPDATE only fires when NULL — so a re-run is a no-op.
 *
 * Undo: delete `TYR-4S3234-%` / `EQP-4S3234-%` serials and their events
 * (`DELETE FROM cms_mro_serial_events WHERE serial IN (...)`).
 */
import crypto from 'node:crypto';
import { loadEnvFile } from './gen-wrangler.mjs';
import { loadCfToken } from './lib/cf-token.mjs';

const APPLY = process.argv.includes('--apply');

const INFRA = loadEnvFile('prod');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || INFRA.CF_ACCOUNT_ID;
const DB_ID = process.env.D1_ID || INFRA.D1_ID;
const BASE = 'https://api.cloudflare.com/client/v4';

const PLATE = '4S-3234';
const TYRE_SKU = '11R22.5';
const REFERENCE_TREAD_MM = 20;

/** Wheel seats for a cabbed 6-wheel tractor unit — mirrors `wheelSlotsFor`. */
const SEATS = ['steer-l', 'steer-r', 'drv1-lo', 'drv1-li', 'drv1-ri', 'drv1-ro'];
/** tread spread so every band is represented (Good/Warning/Replace). */
const TYRE_TREADS = [12.9, 11.5, 8.0, 4.5, 2.5, 3.5];
const TYRE_PSI = [120, 118, 110, 108, 112, 115];

/** Equipment held by the truck: [item group, model name, serial suffix]. */
const EQUIPMENT = [
	['Hydraulic Bottle Jack', '20 T', 'JACK'],
	['Wrench', '14', 'WRENCH'],
	['Screwdriver', 'small', 'SCREWDRIVER'],
];

const uuid = (key) => {
	const h = crypto.createHash('sha1').update(key).digest();
	const b = Buffer.from(h.subarray(0, 16));
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const hex = b.toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const q = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

async function d1(sql) {
	const res = await fetch(`${BASE}/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${await loadCfToken()}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ sql }),
	});
	const json = await res.json();
	if (!json.success) throw new Error(`D1 request failed (HTTP ${res.status}): ${JSON.stringify(json.errors ?? json).slice(0, 300)}`);
	const first = json.result?.[0];
	if (first?.success === false) throw new Error(`D1 statement errored: ${JSON.stringify(first.error ?? first).slice(0, 300)}`);
	return first?.results ?? [];
}

async function main() {
	await loadCfToken();
	console.log(`\nSeed ${PLATE} tyre + equipment register → ${DB_ID}${APPLY ? '' : '  [DRY-RUN]'}`);

	const vehicle = (await d1(`SELECT id FROM cms_veh_fleets WHERE plate_no = ${q(PLATE)} AND deleted_at IS NULL LIMIT 1`))[0];
	if (!vehicle) throw new Error(`vehicle ${PLATE} not found`);
	const vehicleId = String(vehicle.id);

	const tyre = (await d1(
		`SELECT m.id AS id, m.reference_tread_mm AS ref FROM cms_mro_item_model m ` +
			`JOIN cms_mro_item_name g ON g.id = m.item_name AND g.deleted_at IS NULL ` +
			`WHERE g.name_en = 'Tyre' AND m.name_en = ${q(TYRE_SKU)} AND m.deleted_at IS NULL LIMIT 1`,
	))[0];
	if (!tyre) throw new Error(`tyre SKU ${TYRE_SKU} not found`);

	const equipment = [];
	for (const [group, model, suffix] of EQUIPMENT) {
		const row = (await d1(
			`SELECT m.id AS id FROM cms_mro_item_model m ` +
				`JOIN cms_mro_item_name g ON g.id = m.item_name AND g.deleted_at IS NULL ` +
				`WHERE g.name_en = ${q(group)} AND m.name_en = ${q(model)} AND m.deleted_at IS NULL LIMIT 1`,
		))[0];
		if (!row) throw new Error(`equipment SKU ${group} / ${model} not found`);
		equipment.push({ suffix, modelId: String(row.id) });
	}

	console.log(`vehicle   ${vehicleId}`);
	console.log(`tyre SKU  ${TYRE_SKU} (${tyre.id}) · reference_tread_mm ${tyre.ref ?? '(unset → set to ' + REFERENCE_TREAD_MM + ')'}`);
	console.log(`equipment ${EQUIPMENT.map((e) => `${e[0]} ${e[1]}`).join(' · ')}`);

	const now = new Date().toISOString();
	const stmts = [];

	// 1. Tyres — one issued serial per seat, tread/psi measured.
	SEATS.forEach((seat, i) => {
		const serialNo = `TYR-4S3234-0${i + 1}`;
		const id = uuid(`mro_serial:${serialNo}`);
		stmts.push(
			`INSERT OR IGNORE INTO cms_mro_stock_serials ` +
				`(id, model, location, serial_no, status, vehicle, slot, tread_mm, psi, unit_cost, _meta, created_at, updated_at) VALUES (` +
				`${q(id)}, ${q(tyre.id)}, 'vehicle_store', ${q(serialNo)}, 'issued', ${q(vehicleId)}, ${q(seat)}, ` +
				`${q(TYRE_TREADS[i])}, ${q(TYRE_PSI[i])}, 480000, '{}', ${q(now)}, ${q(now)})`,
		);
	});

	// 2. Equipment — issued to the truck (no wheel slot), condition good.
	for (const { suffix, modelId } of equipment) {
		const serialNo = `EQP-4S3234-${suffix}`;
		const id = uuid(`mro_serial:${serialNo}`);
		stmts.push(
			`INSERT OR IGNORE INTO cms_mro_stock_serials ` +
				`(id, model, location, serial_no, status, vehicle, slot, condition, unit_cost, _meta, created_at, updated_at) VALUES (` +
				`${q(id)}, ${q(modelId)}, 'vehicle_store', ${q(serialNo)}, 'issued', ${q(vehicleId)}, NULL, 'good', 250000, '{}', ${q(now)}, ${q(now)})`,
		);
	}

	// 3. Lifecycle: purchased into the vehicle store, fitted to the truck, then a
	//    `checked` inspection (the wear log — tread/psi for a tyre, condition for a
	//    piece of equipment) so the timeline carries a real reading, not just moves.
	const events = [
		...SEATS.map((seat, i) => ({ serialNo: `TYR-4S3234-0${i + 1}`, seat, tread: TYRE_TREADS[i], psi: TYRE_PSI[i], condition: null })),
		...EQUIPMENT.map(([, , suffix]) => ({ serialNo: `EQP-4S3234-${suffix}`, seat: null, tread: null, psi: null, condition: 'good' })),
	];
	for (const { serialNo, seat, tread, psi, condition } of events) {
		const serialId = uuid(`mro_serial:${serialNo}`);
		const purchasedId = uuid(`mro_event:${serialNo}:purchased`);
		const fittedId = uuid(`mro_event:${serialNo}:fitted`);
		const checkedId = uuid(`mro_event:${serialNo}:checked`);
		stmts.push(
			`INSERT OR IGNORE INTO cms_mro_serial_events ` +
				`(id, serial, event, to_location, ref_kind, ref_doc, by_user, _meta, created_at, updated_at) VALUES (` +
				`${q(purchasedId)}, ${q(serialId)}, 'purchased', 'vehicle_store', 'purchase', 'INB-4S3234', NULL, '{}', ${q(now)}, ${q(now)})`,
		);
		stmts.push(
			`INSERT OR IGNORE INTO cms_mro_serial_events ` +
				`(id, serial, event, to_vehicle, to_slot, from_location, ref_kind, ref_doc, by_user, _meta, created_at, updated_at, event_date) VALUES (` +
				`${q(fittedId)}, ${q(serialId)}, 'fitted', ${q(vehicleId)}, ${seat ? q(seat) : 'NULL'}, 'vehicle_store', 'fit', ${q(serialNo)}, NULL, '{}', ${q(now)}, ${q(now)}, date('now'))`,
		);
		stmts.push(
			`INSERT OR IGNORE INTO cms_mro_serial_events ` +
				`(id, serial, event, ref_kind, ref_doc, by_user, _meta, tread_mm, psi, condition, created_at, updated_at, event_date) VALUES (` +
				`${q(checkedId)}, ${q(serialId)}, 'checked', 'check', ${q(serialNo)}, NULL, '{}', ${q(tread)}, ${q(psi)}, ${q(condition)}, ${q(now)}, ${q(now)}, date('now'))`,
		);
	}

	// 4. The new-tread baseline the wear % needs (only when unset).
	stmts.push(
		`UPDATE cms_mro_item_model SET reference_tread_mm = ${REFERENCE_TREAD_MM}, updated_at = ${q(now)} ` +
			`WHERE id = ${q(tyre.id)} AND reference_tread_mm IS NULL`,
	);

	// 5. Keep each serial's live snapshot at/after its newest event (snapshot_stale).
	stmts.push(
		`UPDATE cms_mro_stock_serials SET updated_at = ${q(now)} WHERE (serial_no LIKE 'TYR-4S3234-%' OR serial_no LIKE 'EQP-4S3234-%') AND deleted_at IS NULL`,
	);

	console.log(`\n${stmts.length} statement(s):`);
	console.log(`  6 tyres (${SEATS.join(', ')})`);
	console.log(`  ${equipment.length} equipment (${equipment.map((e) => e.suffix).join(', ')})`);
	console.log(`  ${events.length * 3} lifecycle events (purchased + fitted + checked wear log)`);	console.log(`  baseline reference_tread_mm + snapshot freshness`);

	if (!APPLY) {
		console.log('\nDry-run complete — re-run with --apply.\n');
		return;
	}
	for (const sql of stmts) await d1(sql);
	console.log('\nSeed applied ✅\n');
}

main().catch((err) => {
	console.error(`\nSEED FAILED: ${err.message}\n`);
	process.exit(1);
});
