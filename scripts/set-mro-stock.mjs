#!/usr/bin/env node
/**
 * Set ONE standard SKU's on-hand balance in a D1 (the `mro_inventory` balance row
 * the stock screens read). Idempotent — a re-run updates the same row in place.
 *
 *   node scripts/set-mro-stock.mjs --model "FUSO 12T LHD" --qty 5
 *   node scripts/set-mro-stock.mjs --model "FUSO 12T LHD" --qty 5 --location main_store --reorder 2 --apply
 *
 * Target: the D1 database named in `infra/env.prod` (Cloudflare HTTP API).
 *
 * WHY RAW SQL: `mro_inventory` is a service-owned MRO table (the confirm engine is
 * its writer), so the generic entity API refuses it. This is the documented seeding
 * exception. It is LEDGER-CLEAN by construction:
 *   - `balance_drift` is checked only for batch/serial models (whose real total is
 *     derived from lots/serials) — a STANDARD model's balance IS the truth, so
 *     there is nothing to disagree with;
 *   - `orphan_stock` only flags lot/serial stock with no balance row.
 * A batch/serial model is therefore REFUSED here (Poka-Yoke): its stock must come
 * from real lots/serials, not a balance edit.
 */
import crypto from 'node:crypto';
import { loadEnvFile } from './gen-wrangler.mjs';
import { loadCfToken } from './lib/cf-token.mjs';

const arg = (name, fallback = null) => {
	const i = process.argv.indexOf(`--${name}`);
	return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const APPLY = process.argv.includes('--apply');
const MODEL = arg('model');
const QTY = Number(arg('qty'));
const LOCATION = arg('location', 'main_store');
const REORDER = arg('reorder') == null ? null : Number(arg('reorder'));

const INFRA = loadEnvFile('prod');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || INFRA.CF_ACCOUNT_ID;
const DB_ID = process.env.D1_ID || INFRA.D1_ID;
const BASE = 'https://api.cloudflare.com/client/v4';

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
	if (!MODEL || !Number.isFinite(QTY)) throw new Error('usage: --model "<name_en>" --qty <n> [--location main_store] [--reorder n] [--apply]');
	await loadCfToken();
	console.log(`\nSet stock → ${DB_ID}${APPLY ? '' : '  [DRY-RUN]'}`);

	const rows = await d1(
		`SELECT m.id AS id, m.name_en AS model, g.name_en AS grp, g.tracking AS tracking ` +
			`FROM cms_mro_item_model m JOIN cms_mro_item_name g ON g.id = m.item_name AND g.deleted_at IS NULL ` +
			`WHERE m.name_en = ${q(MODEL)} AND m.deleted_at IS NULL`,
	);
	if (rows.length === 0) throw new Error(`no live SKU named "${MODEL}"`);
	if (rows.length > 1) {
		throw new Error(`"${MODEL}" matches ${rows.length} SKUs (${rows.map((r) => r.grp).join(', ')}) — rename or disambiguate`);
	}
	const { id: modelId, grp, tracking } = rows[0];
	if (tracking !== 'standard') {
		throw new Error(`"${MODEL}" is a ${tracking}-tracked ${grp} — its stock is DERIVED from lots/serials, not a balance row. Record it through an inbound/receipt instead.`);
	}

	const id = uuid(`mro_inventory:${modelId}:${LOCATION}`);
	const now = new Date().toISOString();
	const sql =
		`INSERT INTO cms_mro_inventory (id, model, location, qty_on_hand, reorder_level, _meta, created_at, updated_at) VALUES (` +
		`${q(id)}, ${q(modelId)}, ${q(LOCATION)}, ${q(QTY)}, ${q(REORDER)}, '{}', ${q(now)}, ${q(now)}) ` +
		`ON CONFLICT(id) DO UPDATE SET qty_on_hand = excluded.qty_on_hand, reorder_level = excluded.reorder_level, deleted_at = NULL, updated_at = excluded.updated_at`;

	console.log(`  ${grp} · ${MODEL}  →  ${QTY} @ ${LOCATION}${REORDER == null ? '' : ` (reorder ${REORDER})`}`);
	if (!APPLY) {
		console.log('\nDry-run complete — re-run with --apply.\n');
		return;
	}
	await d1(sql);
	const after = await d1(`SELECT qty_on_hand, reorder_level FROM cms_mro_inventory WHERE id = ${q(id)}`);
	console.log(`\nApplied ✅  now ${JSON.stringify(after[0])}\n`);
}

main().catch((err) => {
	console.error(`\nFAILED: ${err.message}\n`);
	process.exit(1);
});
