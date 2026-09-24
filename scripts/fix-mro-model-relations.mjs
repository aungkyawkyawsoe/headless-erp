#!/usr/bin/env node
/**
 * Repair `mro_item_model` ROWS whose relations are dangling on a REMOTE D1.
 *
 * Symptom: the Studio's `mro_item_model` table shows rows whose `item_name` is
 * blank and unusable. Cause: the SKUs were seeded against part-group ids that do
 * not exist (an older demo catalogue was hard-deleted), so `item_name` points at
 * nothing — the relation resolves to NULL everywhere (catalog cards, pickers,
 * the confirmation engine's tracking-policy lookup).
 *
 * This script is the DATA half of the repair:
 *   1. ensures the part groups the SKUs belong to exist (idempotent, name-keyed),
 *   2. repoints every dangling `item_name` to its correct group,
 *   3. backfills the plainly-derivable blank `name_mm` labels.
 * It never invents a relation it cannot infer: an unmapped model is reported and
 * left alone.
 *
 * The SCHEMA is NOT touched: `mro_item_model`'s declared fields + relations come
 * from `apps/api/src/domain-modules/mro/schema-defs.json` and already match the
 * live table (a `_entity_schemas` ↔ schema-defs diff comes back clean).
 *
 * Usage:
 *   node scripts/fix-mro-model-relations.mjs --dry-run
 *   node scripts/fix-mro-model-relations.mjs --apply
 *
 * Env overrides: CLOUDFLARE_ACCOUNT_ID, D1_ID (target).
 */
import crypto from 'node:crypto';
import { loadEnvFile } from './gen-wrangler.mjs';
import { loadCfToken } from './lib/cf-token.mjs';

const INFRA = loadEnvFile('prod');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || INFRA.CF_ACCOUNT_ID;
const DB_ID = process.env.D1_ID || INFRA.D1_ID;
const BASE = 'https://api.cloudflare.com/client/v4';
const APPLY = process.argv.includes('--apply');
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The groups the orphaned SKUs belong to (name → its category). `Filter` already
 * exists in the canonical set; the other two are the missing houses for hardware
 * and rigging, filed under the closest canonical category.
 */
const GROUPS = [
	{ name_en: 'Filter', name_mm: 'စစ်စကာ / အနည်စစ်', category: 'Filter & Cleaning' },
	{ name_en: 'Bolt', name_mm: 'ဘော့လ်', category: 'Tools' },
	{ name_en: 'Tow Chain', name_mm: 'ဆွဲကြိုးကွင်း', category: 'Tools' },
];

/** model `name_en` → the part group it belongs to (+ its derivable MM label). */
const MODEL_GROUP = {
	'M8 × 30': { group: 'Bolt', name_mm: 'ဘော့လ် M8 × 30' },
	'M12 × 40': { group: 'Bolt', name_mm: 'ဘော့လ် M12 × 40' },
	'M16 × 60': { group: 'Bolt', name_mm: 'ဘော့လ် M16 × 60' },
	'M20 × 80': { group: 'Bolt', name_mm: 'ဘော့လ် M20 × 80' },
	'M24 × 100': { group: 'Bolt', name_mm: 'ဘော့လ် M24 × 100' },
	'AF-3003': { group: 'Filter', name_mm: 'လေစစ်ဇကာ AF-3003' },
	'AF-4004': { group: 'Filter', name_mm: 'လေစစ်ဇကာ AF-4004' },
	'Tow Chain 10m': { group: 'Tow Chain', name_mm: 'ဆွဲကြိုးကွင်း ၁၀ မီတာ' },
};

/** Deterministic v4-shaped id (the engine's `validators.uuid` accepts v4 only). */
function detUuid(key) {
	const h = crypto.createHash('sha1').update(key).digest();
	const b = Buffer.from(h.subarray(0, 16));
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const hex = b.toString('hex');
	const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	if (!UUID_V4_RE.test(id)) throw new Error(`detUuid produced a non-v4 id: ${id}`);
	return id;
}

function sqlQuote(value) {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
	return `'${String(value).replace(/'/g, "''")}'`;
}

async function d1(sql) {
	for (let attempt = 0; ; attempt++) {
		try {
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
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (!/not authorized|too many requests|429|5\d\d|fetch failed|ECONN|socket|Unexpected end of JSON/i.test(message) || attempt >= 5) throw err;
			await new Promise((r) => setTimeout(r, Math.min(15_000, 800 * 2 ** attempt)));
		}
	}
}

async function main() {
	await loadCfToken();
	console.log(`\nRepair mro_item_model relations → ${DB_ID}${APPLY ? '' : '  [DRY-RUN]'}\n`);

	const categories = new Map((await d1('SELECT id, name_en FROM cms_mro_item_categories WHERE deleted_at IS NULL')).map((r) => [String(r.name_en), String(r.id)]));
	const existingGroups = new Map((await d1('SELECT id, name_en FROM cms_mro_item_name WHERE deleted_at IS NULL')).map((r) => [String(r.name_en), String(r.id)]));
	const now = new Date().toISOString();
	const statements = [];

	// ── 1. Ensure the target groups exist ────────────────────────────────────
	for (const group of GROUPS) {
		if (existingGroups.has(group.name_en)) {
			console.log(`group ok    ${group.name_en}`);
			continue;
		}
		const categoryId = categories.get(group.category);
		if (!categoryId) {
			console.warn(`  ⚠ category "${group.category}" missing — ${group.name_en} skipped`);
			continue;
		}
		const id = detUuid(`mro_item_name:${group.name_en}`);
		existingGroups.set(group.name_en, id);
		statements.push(
			`INSERT INTO cms_mro_item_name (id, name_en, name_mm, tracking, category, doc_status, created_at, updated_at) VALUES (${[
				sqlQuote(id),
				sqlQuote(group.name_en),
				sqlQuote(group.name_mm),
				sqlQuote('standard'),
				sqlQuote(categoryId),
				sqlQuote('draft'),
				sqlQuote(now),
				sqlQuote(now),
			].join(', ')})`,
		);
		console.log(`group create ${group.name_en} → ${group.category}`);
	}

	// ── 2. Repoint the dangling SKUs + backfill their blank MM label ─────────
	const models = await d1(
		`SELECT m.id, m.name_en, m.name_mm, m.item_name FROM cms_mro_item_model m WHERE m.deleted_at IS NULL AND (m.item_name IS NULL OR m.item_name NOT IN (SELECT id FROM cms_mro_item_name))`,
	);
	console.log(`\ndangling SKUs: ${models.length}`);
	const unmapped = [];
	for (const model of models) {
		const spec = MODEL_GROUP[String(model.name_en)];
		if (!spec) {
			unmapped.push(String(model.name_en));
			continue;
		}
		const groupId = existingGroups.get(spec.group);
		if (!groupId) {
			unmapped.push(`${model.name_en} (target group missing)`);
			continue;
		}
		const patch = [`item_name = ${sqlQuote(groupId)}`, `updated_at = ${sqlQuote(now)}`];
		if (!model.name_mm) patch.push(`name_mm = ${sqlQuote(spec.name_mm)}`);
		statements.push(`UPDATE cms_mro_item_model SET ${patch.join(', ')} WHERE id = ${sqlQuote(model.id)}`);
		console.log(`link ${model.name_en} → ${spec.group}${!model.name_mm ? ` (+ mm "${spec.name_mm}")` : ''}`);
	}
	if (unmapped.length > 0) console.log(`  ⚠ unmapped (left alone): ${unmapped.join(', ')}`);

	console.log(`\nstatements: ${statements.length}`);
	if (!APPLY) {
		console.log('Dry-run — re-run with --apply.\n');
		return;
	}
	for (const sql of statements) await d1(sql);

	const after = await d1(
		`SELECT COUNT(*) n FROM cms_mro_item_model m WHERE m.deleted_at IS NULL AND m.item_name IS NOT NULL AND m.item_name NOT IN (SELECT id FROM cms_mro_item_name)`,
	);
	console.log(`\nRepair complete — dangling SKUs now: ${after[0]?.n ?? '?'}\n`);
}

main().catch((err) => {
	console.error(`\nREPAIR FAILED: ${err.message}\n`);
	process.exit(1);
});
