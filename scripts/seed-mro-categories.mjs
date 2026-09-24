#!/usr/bin/env node
/**
 * Category master + part-group classification for the MRO catalog.
 *
 *   node scripts/seed-mro-categories.mjs [baseUrl] [token]          # dry run
 *   node scripts/seed-mro-categories.mjs [baseUrl] [token] --apply  # write
 *
 * Defaults: baseUrl http://localhost:8788 · token `dev-token` (IS_DEV local).
 * Prereq: `node scripts/apply-mro-schema.mjs` has run (schema declares
 * `mro_item_categories` with `name_en`/`name_mm`, and `mro_item_name.category`
 * m2o → `mro_item_categories`).
 *
 * Steps:
 *   1. Find-or-create the top-level CATEGORIES (the 9 given) in
 *      `mro_item_categories` — matched by `name_en`, createdAt only when missing,
 *      so re-runs never duplicate.
 *   2. CLASSIFY existing `mro_item_name` part-groups into those categories via
 *      their new `category` m2o (a group like "Engine Oil" → "Grease & Fluids").
 *      By default (no --apply) the script DRY-RUNS: it lists every part-group
 *      with its resolved category target and writes nothing. With --apply it
 *      backfills `category` on the classified part-groups — the same
 *      find-or-create / idempotent pattern `seed-mro-demo.mjs` uses.
 *
 * Re-running is safe: categories that exist are reused, part-groups that are
 * already categorized are left `ok`, and nothing is ever deleted.
 */
import { listAllRows } from './lib/list-all-rows.mjs';
const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';
const apply = process.argv.includes('--apply');
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const H = (init) => ({ ...init, headers: { ...headers, ...(init?.headers ?? {}) } });

const log = (...a) => console.log(...a);
const title = (s) => log(`\n── ${s} ─${'─'.repeat(Math.max(0, 64 - s.length))}`);

async function api(path, init = {}) {
	const res = await fetch(`${baseUrl}${path}`, H(init));
	const body = await res.json().catch(() => null);
	if (!res.ok && !body?.success)
		throw new Error(`${init.method ?? 'GET'} ${path} → HTTP ${res.status}: ${body?.error ?? JSON.stringify(body)}`);
	return body.data;
}

/** Fetch every row of a collection (real `limit` + cursor pagination). */
const listAll = (slug, fields) => listAllRows(baseUrl, token, slug, fields);

// ── The top-level categories (name_en → name_mm). EN is the canonical key;
//   MM is a best-effort transliteration — edit freely in the Studio.
const CATEGORIES = [
	{ name_en: 'Engine & Gear Box', name_mm: 'အင်ဂျင်နှင့် ဂီယာဘောက်စ်' },
	{ name_en: 'Electric & Lighting', name_mm: 'ကိုယ်ထည်နှင့် မီးချောင်း' },
	{ name_en: 'Tyre & Alloy', name_mm: 'တာယာနှင့် ဘီးများ' },
	{ name_en: 'Suspension & Steering', name_mm: 'ကိုင်းစနစ်နှင့် စတီယာရင်' },
	{ name_en: 'Oil & Grease', name_mm: 'ချောဆီနှင့် အရည်' },
	{ name_en: 'Electric & Lighting', name_mm: 'ပြင်ပပစ္စည်းနှင့် လျှပ်စစ်' },
	{ name_en: 'Tools', name_mm: 'ကိရိယာနှင့် ပစ္စည်း' },
	{ name_en: 'Body and Paint', name_mm: 'စားသုံးကုန်ပစ္စည်းများ' },
	{ name_en: 'Tools', name_mm: 'အထွေထွေ' },
];

// Part-group (mro_item_name.name_en) → category name_en. This is the backfill
// the seed performs; extend it as real part groups become cataloged. A part
// group absent from this map is left unclassified (never auto-created). The
// live part-group identity is its EN name (`name_en`) — the retired `name`
// column no longer exists — so we match on `name_en`.
const MAPPING = {
	'Engine Oil': 'Oil & Grease',
	Tyre: 'Tyre & Alloy',
	Bolt: 'Tools',
	'Air Filter': 'Engine & Gear Box',
};

// Model (mro_item_model.name_en) → [part-group name_en, category name_en]. Used by
// Step 3 to classify SKUs so the category filter has data: each model is routed
// to a part-group, creating the group first (under its category) when missing.
const MODEL_GROUP = {
	'Transmission Fluid ATF-D2': ['Transmission Fluid', 'Engine & Gear Box'],
	'Diesel Engine Oil 15W-40': ['Engine Oil', 'Oil & Grease'],
	'Hydraulic Oil AW46 20L': ['Hydraulic Oil', 'Oil & Grease'],
	'Cutting Fluid 5L': ['Cutting Fluid', 'Oil & Grease'],
	'Gear Oil 80W-90 20L': ['Gear Oil', 'Oil & Grease'],
	'Chain Grease 400g': ['Chain Grease', 'Oil & Grease'],
	'Engine Coolant 50/50': ['Engine Coolant', 'Oil & Grease'],
	'Filter Wrench (metal)': ['Filter Wrench', 'Tools'],
	'U-Joint Cross 27-73': ['U-Joint', 'Engine & Gear Box'],
	'Tie Rod End': ['Tie Rod End', 'Suspension & Steering'],
	'Battery Terminal Clamp': ['Battery Terminal', 'Electric & Lighting'],
	'Spark Plug NGK BKR6E': ['Spark Plug', 'Electric & Lighting'],
	'Alternator 100A': ['Alternator', 'Electric & Lighting'],
	'Starter Motor 12V': ['Starter Motor', 'Electric & Lighting'],
	'Shock Absorber (rear)': ['Shock Absorber', 'Suspension & Steering'],
	'Fan Belt 11A': ['Fan Belt', 'Engine & Gear Box'],
	'Wheel Hub Nut M22': ['Wheel Hub Nut', 'Tools'],
	'Rear Axle Seal': ['Rear Axle Seal', 'Engine & Gear Box'],
	'Valve Cover Gasket': ['Valve Cover Gasket', 'Engine & Gear Box'],
	'Cylinder Head Gasket': ['Cylinder Head Gasket', 'Engine & Gear Box'],
	'Fuse 20A (box of 10)': ['Fuse 20A', 'Electric & Lighting'],
	'Fuse 10A (box of 10)': ['Fuse 10A', 'Electric & Lighting'],
	'Indicator Bulb 12V': ['Bulb', 'Electric & Lighting'],
	'Headlight Bulb H4': ['Bulb', 'Electric & Lighting'],
	'Clutch Disc 240mm': ['Clutch Disc', 'Engine & Gear Box'],
};

/** The raw id of a relation field — a requested relation comes back EXPANDED as
 *  `{ id, … }` (not a bare id string), so both shapes resolve here. */
function relId(value) {
	if (typeof value === 'string') return value;
	if (value && typeof value === 'object') return value.id ?? null;
	return null;
}

/** id → display lookup helpers by slug. */
async function masterOf(slug) {
	const rows = await listAll(slug);
	const byEn = new Map();
	const map = new Map(rows.map((r) => [r.id, r]));
	for (const r of rows) if (r.name_en != null) byEn.set(r.name_en, r.id);
	return { byId: map, byEn };
}

async function main() {
	title(`Step 1 — categories (${CATEGORIES.length})${apply ? '' : '  [dry-run]'}`);
	const cat = await masterOf('mro_item_categories');
	const newCats = [];
	for (const c of CATEGORIES) {
		if (cat.byEn.has(c.name_en)) {
			log(`exists  ${c.name_en}  ->  ${cat.byEn.get(c.name_en)}`);
		} else {
			if (!apply) {
				log(`create  ${c.name_en}  (name_mm: ${c.name_mm || '—'})`);
				continue;
			}
			const made = await api('/api/entities/mro_item_categories', { method: 'POST', body: JSON.stringify(c) });
			cat.byEn.set(c.name_en, made.id);
			cat.byId.set(made.id, { id: made.id, ...c });
			newCats.push(c);
			log(`create  ${c.name_en}  ->  ${made.id}`);
		}
	}

	if (!apply) {
		title('Step 2 — classify part-groups into categories  [dry-run — add --apply to write]');
	} else {
		title(`Step 2 — classify part-groups into categories${newCats.length ? ` (${newCats.length} categories created)` : ''}`);
	}
	const itemNames = await listAll('mro_item_name', 'name_en,category');
	for (const group of itemNames) {
		const groupName = (group.name_en ?? '').trim();
		const target = MAPPING[groupName];
		const currentId = relId(group.category);
		if (!target || !cat.byEn.has(target)) {
			if (currentId == null) log(`skip     "${groupName}"  (no category mapping)`);
			continue;
		}
		const targetId = cat.byEn.get(target);
		if (currentId === targetId) {
			log(`ok       "${groupName}"  ->  ${target}`);
			continue;
		}
		if (!apply) {
			log(`set      "${groupName}"  ->  ${target}  (id ${currentId ?? 'unset'} → ${targetId})`);
			continue;
		}
		await api(`/api/entities/mro_item_name/${group.id}`, { method: 'PUT', body: JSON.stringify({ category: targetId }) });
		log(`set      "${groupName}"  ->  ${target}`);
	}

	// ── Step 3 — classify item MODELS into part-groups (so the filter has data) ──
	if (!apply) {
		title('Step 3 — classify item models into part-groups  [dry-run]');
	} else {
		title('Step 3 — classify item models into part-groups');
	}
	const groupByEn = new Map(await listAll('mro_item_name', 'name_en,category').then((rows) => rows.map((g) => [(g.name_en ?? '').trim(), g])));
	const models = await listAll('mro_item_model', 'name_en,item_name');
	let linkedModels = 0;
	for (const model of models) {
		const spec = MODEL_GROUP[model.name_en];
		if (!spec) continue;
		const [groupLabel, categoryEn] = spec;
		let group = groupByEn.get(groupLabel);
		if (!group) {
			if (!apply) {
				log(`group    create part-group "${groupLabel}" (${categoryEn})`);
				log(`link     ${model.name_en}  ->  "${groupLabel}"`);
				continue;
			}
			const made = await api('/api/entities/mro_item_name', {
				method: 'POST',
				body: JSON.stringify({
					name_en: groupLabel,
					name_mm: groupLabel, // best-effort placeholder until localised in the Studio
					category: cat.byEn.get(categoryEn),
				}),
			});
			group = { id: made.id, name_en: groupLabel };
			groupByEn.set(groupLabel, group);
			log(`group    create part-group "${groupLabel}" ->  ${made.id} (${categoryEn})`);
		}
		const groupId = group?.id;
		const existingId =
			typeof model.item_name === 'string'
				? model.item_name
				: model.item_name && typeof model.item_name === 'object'
					? (model.item_name && model.item_name.id) || null
					: null;
		if (existingId && existingId === groupId) {
			log(`ok       ${model.name_en}  ->  "${groupLabel}"`);
			continue;
		}
		if (!apply) {
			log(`link     ${model.name_en}  ->  "${groupLabel}"`);
			continue;
		}
		await api(`/api/entities/mro_item_model/${model.id}`, { method: 'PUT', body: JSON.stringify({ item_name: groupId }) });
		linkedModels += 1;
		log(`link     ${model.name_en}  ->  "${groupLabel}"`);
	}

	title('Summary');
	log(`categories desired      : ${CATEGORIES.length}`);
	log(`categories found/created: ${cat.byEn.size}${newCats.length ? ` (${newCats.length} created)` : ''}`);
	log(`part-groups seen        : ${itemNames.length} — see the set/ok lines above`);
	if (!apply) log('(dry-run — nothing written. Re-run with --apply to write.)');
	else log(`done — base ${baseUrl}`);
}

main().catch((err) => {
	console.error(`\nFAIL ${err.message}`);
	process.exit(1);
});
