#!/usr/bin/env node
/**
 * Move the MRO stock TRACKING POLICY from the SKU (`mro_item_model.tracking`)
 * onto the item-name master (`mro_item_name.tracking`), and retire
 * `mro_item_name.name`.
 *
 *   node scripts/migrate-mro-item-name-tracking.mjs [baseUrl] [token]          # dry run
 *   node scripts/migrate-mro-item-name-tracking.mjs [baseUrl] [token] --apply  # write
 *
 * Defaults: baseUrl http://localhost:8788 · token `dev-token` (IS_DEV local).
 * Prereq: `node scripts/apply-mro-schema.mjs` has run (step 0b creates a missing
 * `mro_item_name` from the new def outright).
 *
 * WHY: the policy is defined ONCE per item name ("Tyre is serial, always") and
 * every SKU under that name inherits it — a SKU can never carry a policy the
 * master does not. The engine + every picker resolve it through
 * `mro_item_model.item_name`, so the SKU needs no policy column at all.
 *
 * Steps (ordered so every source column survives long enough to read; idempotent —
 * a re-run writes nothing the second time):
 *   1. Field list — merge the `mro_item_name` definition from `schema-defs.json`
 *      into the LIVE field list and PUT it, ADDING `tracking` (the retired `name`
 *      is kept for ONE more step so step 2 can read it).
 *   2. Backfill — each item name takes its EXISTING models' policy (a name with
 *      no model, or only `standard` models, stays `standard`), and its `name_en`
 *      is filled from the legacy `name` when blank (so no name is lost before the
 *      drop). Both are plain entity writes on the validated engine API.
 *   3. Field list — merge again, DROPPING the retired `name`.
 *   4. Field list — `mro_item_model`: DROP `tracking`, make `item_name` REQUIRED
 *      and display `{{name_en}}`. A NOT NULL rebuild fails if any live SKU is
 *      unclassified, so that is checked here and fails loudly BEFORE the DDL.
 *
 * Re-run safety: once step 4 has dropped `mro_item_model.tracking` (or an
 * environment was created from the current definition), step 2 derives NO policy
 * — it leaves each master's own `tracking` in place — so a second run writes
 * nothing instead of downgrading every serial/batch master to `standard`.
 *
 * Reads/writes stay on the validated engine API — never raw SQL — so the schema
 * cache is invalidated server-side.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { listAllRows } from './lib/list-all-rows.mjs';
import { mergeFields } from './lib/schema-fields.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const baseUrl = (args[0] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = args[1] ?? 'dev-token';
const apply = process.argv.includes('--apply');

const __dirname = dirname(fileURLToPath(import.meta.url));
const defs = JSON.parse(
	await readFile(join(__dirname, '..', 'apps', 'api', 'src', 'domain-modules', 'mro', 'schema-defs.json'), 'utf8'),
);
const baseDef = (slug) => {
	const def = (defs.baseCollections ?? []).find((c) => c.slug === slug);
	if (!def) throw new Error(`schema-defs.json has no ${slug} definition`);
	return def;
};
const groupDef = baseDef('mro_item_name');
const modelDef = baseDef('mro_item_model');

const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const log = (...a) => console.log(...a);
const title = (s) => log(`\n── ${s} ─${'─'.repeat(Math.max(0, 64 - s.length))}`);

async function api(path, init = {}) {
	const res = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
	const body = await res.json().catch(() => null);
	if (!res.ok && !body?.success)
		throw new Error(`${init.method ?? 'GET'} ${path} → HTTP ${res.status}: ${body?.error ?? JSON.stringify(body)}`);
	return body.data;
}

const listAll = (slug, fields) => listAllRows(baseUrl, token, slug, fields);
const nameOf = (value) => (typeof value === 'string' ? value : (value?.id ?? null));

/**
 * Read the live field list of a collection (PUT replaces it wholesale).
 */
async function liveFields(slug) {
	const collection = await api(`/api/collections/${slug}`).catch(() => null);
	if (!collection) throw new Error(`${slug} not found — run node scripts/apply-mro-schema.mjs first`);
	return collection.schema_json?.fields ?? [];
}

// `mergeFields` (declared fields are authoritative for the fields we already have)
// lives in scripts/lib/schema-fields.mjs — shared with the other schema one-offs.

async function main() {
	// ── 1. mro_item_name — ADD tracking (keep `name` for the backfill) ────────
	title(`Step 1 — mro_item_name: add tracking${apply ? '' : '  [dry-run]'}`);
	let groupLive = await liveFields('mro_item_name');
	const step1 = mergeFields(groupLive, groupDef, []);
	log(`live fields : ${groupLive.map((f) => f?.name).join(', ')}`);
	log(`added       : ${step1.added.length ? step1.added.join(', ') : '— (already present)'}`);
	if (apply) {
		await api('/api/collections/mro_item_name', { method: 'PUT', body: JSON.stringify({ fields: step1.merged }) });
		groupLive = await liveFields('mro_item_name');
		if (!groupLive.some((f) => f?.name === 'tracking')) {
			throw new Error('tracking did not land on mro_item_name — aborting before the backfill');
		}
		log('applied     : PUT /api/collections/mro_item_name');
	}

	// ── 2. Backfill name_en (legacy `name`) + tracking (from the live models) ──
	title(`Step 2 — backfill name_en + tracking${apply ? '' : '  [dry-run]'}`);
	const groupRead = ['id', 'name_en', 'tracking', ...(groupLive.some((f) => f?.name === 'name') ? ['name'] : [])].join(',');
	const groups = await listAll('mro_item_name', groupRead);

	// The migration OWNS the tracking backfill only while the SKU still carries the
	// legacy column. Once `mro_item_model.tracking` is dropped (this script's own
	// earlier run, or a fresh env built from the current def) `mro_item_name` is the
	// authoritative policy and there is nothing to derive — and reading a column that
	// no longer exists would give `undefined` for EVERY model, silently DOWNGRADING
	// a serial/batch master to `standard`. Guarding on the live schema is what makes
	// a re-run the true no-op this script claims to be.
	const modelLive = await liveFields('mro_item_model');
	const modelsHaveTracking = modelLive.some((f) => f?.name === 'tracking');
	log(
		`model tracking column : ${modelsHaveTracking ? 'present — derive each policy from its live SKUs' : 'absent — mro_item_name already owns the policy (no backfill)'}`,
	);

	// The policy each item name's live models already carried. A decisive
	// (serial/batch) policy wins over `standard` — that is the one the engine was
	// actually enforcing on that name's stock.
	const models = await listAll(
		'mro_item_model',
		['item_name', ...(modelsHaveTracking ? ['tracking'] : [])].join(','),
	);
	const policies = new Map();
	for (const m of models) {
		const groupId = nameOf(m.item_name);
		if (!groupId) continue;
		const list = policies.get(groupId) ?? new Set();
		list.add(m.tracking === 'serial' || m.tracking === 'batch' ? m.tracking : 'standard');
		policies.set(groupId, list);
	}
	const decisive = (set) => (set?.has('serial') ? 'serial' : set?.has('batch') ? 'batch' : 'standard');

	let touched = 0;
	for (const g of groups) {
		const source = String(g.name_en ?? '').trim() || String(g.name ?? '').trim();
		const wantEn = source || null;
		// Without the legacy column the master's OWN policy stands — never the
		// (now meaningless) `policies` map, which would read as all-`standard`.
		const wantTracking = modelsHaveTracking
			? (decisive(policies.get(g.id)) ?? (g.tracking || 'standard'))
			: g.tracking || 'standard';
		if ((g.name_en ?? null) === wantEn && (g.tracking ?? 'standard') === wantTracking) continue;
		touched += 1;
		if (apply) {
			await api(`/api/entities/mro_item_name/${g.id}`, {
				method: 'PUT',
				body: JSON.stringify({ name_en: wantEn, tracking: wantTracking }),
			});
		}
		log(`  ${apply ? 'set' : 'would set'}  ${source || '(unnamed)'}  →  tracking: ${wantTracking}`);
	}

	// ── 3. mro_item_name — DROP the retired `name` ───────────────────────────
	title(`Step 3 — mro_item_name: drop name${apply ? '' : '  [dry-run]'}`);
	groupLive = await liveFields('mro_item_name');
	const step3 = mergeFields(groupLive, groupDef, ['name']);
	log(`live fields : ${groupLive.map((f) => f?.name).join(', ')}`);
	log(`dropped     : ${step3.dropped.length ? step3.dropped.join(', ') : '— (already gone)'}`);
	if (apply && step3.dropped.length) {
		await api('/api/collections/mro_item_name', { method: 'PUT', body: JSON.stringify({ fields: step3.merged }) });
		log('applied     : PUT /api/collections/mro_item_name');
	}

	// ── 4. mro_item_model — DROP tracking, REQUIRE item_name ─────────────────
	title(`Step 4 — mro_item_model: drop tracking + require item_name${apply ? '' : '  [dry-run]'}`);
	const unclassified = models.filter((m) => !nameOf(m.item_name));
	log(`live models       : ${models.length}`);
	log(`without item_name : ${unclassified.length}${unclassified.length ? '  ← classify them before item_name can be NOT NULL' : ''}`);
	if (unclassified.length) throw new Error('classify every mro_item_model row (item_name) before re-running');

	// `modelLive` was read before step 2 and mro_item_model is untouched since
	// (step 3 edits mro_item_name only), so it is still current.
	const step4 = mergeFields(modelLive, modelDef, ['tracking']);
	log(`live fields       : ${modelLive.map((f) => f?.name).join(', ')}`);
	log(`refreshed/added   : ${[...step4.added, 'item_name'].join(', ')}`);
	log(`dropped           : ${step4.dropped.length ? step4.dropped.join(', ') : '— (already gone)'}`);
	if (apply) {
		await api('/api/collections/mro_item_model', { method: 'PUT', body: JSON.stringify({ fields: step4.merged }) });
		log('applied           : PUT /api/collections/mro_item_model');
	}

	title('Summary');
	log(`item names        : ${groups.length}`);
	log(`${apply ? 'updated' : 'to update'}         : ${touched}`);
	log(`models            : ${models.length}`);
	if (!apply) log('(dry-run — nothing written. Re-run with --apply to write.)');
	else log(`done — base ${baseUrl}`);
}

main().catch((err) => {
	console.error(`\nFAIL ${err.message}`);
	process.exit(1);
});
