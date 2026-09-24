#!/usr/bin/env node
/**
 * Amend the MRO category taxonomy to the canonical EIGHT, and re-file every
 * `mro_item_name` group under its new category — on a REMOTE D1.
 *
 *   Engine & Gear Box · Body and Paint · Electric & Lighting · Oil & Grease ·
 *   Suspension & Steering · Filter & Cleaning · Tyre & Alloy · Tools
 *
 * The old taxonomy both OVERLAPPED (`Body & Lighting` vs `Peripherals &
 * Electrical` vs `Consumable Items`) and had no home for paint/cleaning work,
 * so groups were split across houses that meant the same thing. This script:
 *
 *   1. find-or-creates the eight canonical categories (name_en is the identity),
 *   2. re-files all 55 part groups (explicit map below — no guessing),
 *   3. HARD-deletes the now-empty legacy categories (an unused category with a
 *      unique `name_en` is pure drift; nothing references them once step 2 ran).
 *
 * Idempotent: a category that exists is reused, a group already in its target is
 * left `ok`, and a legacy category that still holds a group is NEVER deleted
 * (it is reported instead). Re-running converges to the same state.
 *
 * Usage:
 *   node scripts/amend-mro-categories.mjs --dry-run
 *   node scripts/amend-mro-categories.mjs --apply
 *
 * Env overrides: CLOUDFLARE_ACCOUNT_ID, D1_ID (target).
 */
import crypto from 'node:crypto';
import { loadEnvFile } from './gen-wrangler.mjs';
import { loadCfToken } from './lib/cf-token.mjs';

const INFRA = loadEnvFile('prod');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || INFRA.CF_ACCOUNT_ID;
const DB_ID = process.env.D1_ID || INFRA.D1_ID;
const BASE = 'https://api.cloudflare.com/v4'.replace('/v4', '/client/v4');
const APPLY = process.argv.includes('--apply');

/** The canonical eight (EN is the key; MM is the operator-facing label). */
const CATEGORIES = [
	{ name_en: 'Engine & Gear Box', name_mm: 'အင်ဂျင်နှင့် ဂီယာဘောက်စ်' },
	{ name_en: 'Body and Paint', name_mm: 'ကိုယ်ထည်နှင့် ဆေးပြင်ခြင်း' },
	{ name_en: 'Electric & Lighting', name_mm: 'လျှပ်စစ်နှင့် မီးချောင်း' },
	{ name_en: 'Oil & Grease', name_mm: 'ဆီနှင့် အမဲဆီ' },
	{ name_en: 'Suspension & Steering', name_mm: 'ကိုင်းစနစ်နှင့် စတီယာရင်' },
	{ name_en: 'Filter & Cleaning', name_mm: 'စစ်ထုတ်ခြင်းနှင့် သန့်ရှင်းရေး' },
	{ name_en: 'Tyre & Alloy', name_mm: 'တာယာနှင့် Alloy ဂွေ' },
	{ name_en: 'Tools', name_mm: 'ကိရိယာ' },
];

/**
 * Every part group → its canonical category. Explicit (not derived): the split
 * of the retired `Body & Lighting` (mirrors/sheets → Paint, lamps/wiring →
 * Electric) and the redistribution of `Consumable Items` (glue/tape/paint →
 * Body and Paint, cleaners → Filter & Cleaning, kit/PPE → Tools) is a business
 * decision, so it is written down here instead of inferred.
 */
const ITEM_CATEGORY = {
	// Engine & Gear Box — the drivetrain + engine internals that stay put.
	Belt: 'Engine & Gear Box',
	'Clutch Disc': 'Engine & Gear Box',
	'Clutch Pressure Plate': 'Engine & Gear Box',
	'Common Rail Injector': 'Engine & Gear Box',
	'Oil Seal': 'Engine & Gear Box',
	'Old Liner': 'Engine & Gear Box',
	'Old Piston Ring': 'Engine & Gear Box',
	// Body and Paint — panels, mirror, trim/reflectors + the repair materials.
	Mirror: 'Body and Paint',
	'Plain Sheet': 'Body and Paint',
	'Square Safety Reflector': 'Body and Paint',
	'Trailer Door Latch': 'Body and Paint',
	Glue: 'Body and Paint',
	Tape: 'Body and Paint',
	'Tire Paint': 'Body and Paint',
	// Electric & Lighting — lamps, wiring, battery, horns.
	Bulb: 'Electric & Lighting',
	'Side Light': 'Electric & Lighting',
	Battery: 'Electric & Lighting',
	Horn: 'Electric & Lighting',
	Wire: 'Electric & Lighting',
	'Wire Cover Pipe (Corrugated Conduit)': 'Electric & Lighting',
	'Cable Tie': 'Electric & Lighting',
	// Oil & Grease — every lubricant/fluid (the fleet-care intervals read SKUs).
	'Brake Oil': 'Oil & Grease',
	'Engine Coolant': 'Oil & Grease',
	'Engine Oil': 'Oil & Grease',
	'Gear Oil': 'Oil & Grease',
	Grease: 'Oil & Grease',
	'Power Steering Fluid': 'Oil & Grease',
	'Radiator Water / Distilled Water': 'Oil & Grease',
	// Suspension & Steering — chassis, brake air, steering.
	Airbag: 'Suspension & Steering',
	'Air Pipe': 'Suspension & Steering',
	'Ball Joint': 'Suspension & Steering',
	'Brake Chamber': 'Suspension & Steering',
	'Drag Link': 'Suspension & Steering',
	'Tie Rod End Assembly': 'Suspension & Steering',
	// Filter & Cleaning — what is filtered or used to clean.
	'Air Cleaner': 'Filter & Cleaning',
	Filter: 'Filter & Cleaning',
	'Air Dryer': 'Filter & Cleaning',
	'Glass Cleaner': 'Filter & Cleaning',
	'Soap Dish': 'Filter & Cleaning',
	// Tyre & Alloy — wheels, hubs, valves, wheel fasteners.
	'Alloy Wheels': 'Tyre & Alloy',
	Bearing: 'Tyre & Alloy',
	Nut: 'Tyre & Alloy',
	Tyre: 'Tyre & Alloy',
	Valve: 'Tyre & Alloy',
	'Wheel Chock': 'Tyre & Alloy',
	'Wheel Hub': 'Tyre & Alloy',
	// Tools — hand tools, jacks, kits, load/PPE equipment.
	'Grease Nipple': 'Tools',
	Hammer: 'Tools',
	'Hydraulic Bottle Jack': 'Tools',
	'Impact Socket': 'Tools',
	Screwdriver: 'Tools',
	Wrench: 'Tools',
	'Repair Kit': 'Tools',
	'Safety Gear': 'Tools',
	'Truck Cargo Lashing Belt': 'Tools',
};

/** Deterministic UUID (v5-shaped) — idempotent creates. */
function detUuid(key) {
	const h = crypto.createHash('sha1').update(key).digest();
	const b = Buffer.from(h.subarray(0, 16));
	// v4-shaped (the engine's validators.uuid accepts ONLY version 4).
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const hex = b.toString('hex');
	const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	// Self-check (Poka-Yoke): the engine's validators.uuid accepts ONLY v4, so a
	// future edit that changes the version nibble fails HERE, at author time,
	// instead of after a seed when the Studio refuses to update the row.
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
		throw new Error(`detUuid produced a non-v4 id: ${id}`);
	}
	return id;
}

function sqlQuote(value) {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
	return `'${String(value).replace(/'/g, "''")}'`;
}

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

/** One statement per request, sequential (this is a small, ordered migration). */
async function run(statements) {
	if (!APPLY) {
		console.log(`  statements: ${statements.length} (dry-run — not executed)`);
		return;
	}
	for (const sql of statements) await d1(sql);
	console.log(`  statements: ${statements.length} · done`);
}

async function main() {
	await loadCfToken();
	console.log(`\nAmend MRO categories → ${DB_ID}${APPLY ? '' : '  [DRY-RUN]'}\n`);

	const liveCategories = await d1('SELECT id, name_en FROM cms_mro_item_categories WHERE deleted_at IS NULL');
	const catIdByName = new Map(liveCategories.map((r) => [String(r.name_en), String(r.id)]));
	const now = new Date().toISOString();
	const statements = [];

	// ── 1. Create the canonical categories that are missing ─────────────────
	const created = [];
	for (const category of CATEGORIES) {
		if (catIdByName.has(category.name_en)) continue;
		const id = detUuid(`mro_item_categories:${category.name_en}`);
		catIdByName.set(category.name_en, id);
		created.push(category.name_en);
		statements.push(
			`INSERT INTO cms_mro_item_categories (id, name_en, name_mm, doc_status, created_at, updated_at) VALUES (${[
				sqlQuote(id),
				sqlQuote(category.name_en),
				sqlQuote(category.name_mm),
				sqlQuote('draft'),
				sqlQuote(now),
				sqlQuote(now),
			].join(', ')})`,
		);
	}
	console.log(`Categories: ${liveCategories.length} live · create ${created.length}${created.length ? ` (${created.join(', ')})` : ''}`);

	// ── 2. Re-file every part group ─────────────────────────────────────────
	const groups = await d1('SELECT id, name_en, category FROM cms_mro_item_name WHERE deleted_at IS NULL');
	const moved = [];
	const unmapped = [];
	for (const group of groups) {
		const name = String(group.name_en);
		const targetName = ITEM_CATEGORY[name];
		if (!targetName) {
			unmapped.push(name);
			continue;
		}
		const targetId = catIdByName.get(targetName);
		if (!targetId) {
			unmapped.push(`${name} → ${targetName}`);
			continue;
		}
		if (String(group.category ?? '') === targetId) continue;
		moved.push(`${name} → ${targetName}`);
		statements.push(
			`UPDATE cms_mro_item_name SET category = ${sqlQuote(targetId)}, updated_at = ${sqlQuote(now)} WHERE id = ${sqlQuote(group.id)}`,
		);
	}
	console.log(`Part groups: ${groups.length} live · re-file ${moved.length}`);
	if (unmapped.length > 0) console.log(`  ⚠ unmapped (left untouched): ${unmapped.join(', ')}`);

	// ── 3. Drop the legacy categories the re-file EMPTIES ───────────────────
	// Usage is judged on the PROJECTED state (each group's post-move category),
	// not the pre-move counts — every legacy house here loses its whole contents
	// to the canonical eight, so all of them become empty and droppable. A legacy
	// category still holding an unmapped group is kept and reported instead.
	const finalCounts = new Map();
	for (const group of groups) {
		const targetName = ITEM_CATEGORY[String(group.name_en)];
		const finalId = targetName ? catIdByName.get(targetName) : (group.category == null ? null : String(group.category));
		if (!finalId) continue;
		finalCounts.set(finalId, (finalCounts.get(finalId) ?? 0) + 1);
	}
	const canonical = new Set(CATEGORIES.map((c) => c.name_en));
	const legacy = liveCategories.filter((c) => !canonical.has(String(c.name_en)));
	const droppable = [];
	const kept = [];
	for (const category of legacy) {
		if ((finalCounts.get(String(category.id)) ?? 0) > 0) kept.push(String(category.name_en));
		else droppable.push(category);
	}
	console.log(`Legacy categories: ${legacy.length} · drop ${droppable.length}${droppable.length ? ` (${droppable.map((c) => c.name_en).join(', ')})` : ''}`);
	if (kept.length > 0) console.log(`  ⚠ kept (still referenced): ${kept.join(', ')}`);
	for (const category of droppable) statements.push(`DELETE FROM cms_mro_item_categories WHERE id = ${sqlQuote(category.id)}`);

	await run(statements);

	if (APPLY) {
		const after = await d1(
			'SELECT C.name_en, COUNT(G.id) n FROM cms_mro_item_categories C LEFT JOIN cms_mro_item_name G ON G.category = C.id AND G.deleted_at IS NULL GROUP BY C.id ORDER BY n DESC, C.name_en',
		);
		console.log('\nCategories after:');
		for (const row of after) console.log(`  ${String(row.name_en).padEnd(24)} ${row.n}`);
	}
	console.log(APPLY ? '\nAmend complete.\n' : '\nDry-run — re-run with --apply.\n');
}

main().catch((err) => {
	console.error(`\nAMEND FAILED: ${err.message}\n`);
	process.exit(1);
});
