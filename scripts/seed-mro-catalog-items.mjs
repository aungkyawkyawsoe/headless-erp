#!/usr/bin/env node
/**
 * Seed the MRO catalog CLASSIFICATION masters on a REMOTE D1:
 *
 *   `mro_item_categories`  — the top-level groups (already provisioned; the
 *                            script creates any missing one, name_en-keyed).
 *   `mro_item_name`        — the 65 bilingual part groups (name_en + name_mm),
 *                            each carrying its REQUIRED `tracking` policy and its
 *                            parent `category` (the m2o the catalog filters by).
 *
 * Why a script (not the API): the mini-app/tgapp has no admin bearer token for
 * production, and D1 cannot be cross-queried. It talks to the two databases
 * through the Cloudflare HTTP API exactly like the D1 ops scripts
 * (`push-local-d1`, `d1-export-via-api`, `migrate-legacy-hr`) — same token
 * resolver, same one-statement-per-request contract, same retry policy.
 *
 * IDEMPOTENT: rows are matched by `name_en` (their identity) and only CREATED
 * when missing; a pre-existing row keeps its name_mm/tracking/category unless
 * the field is BLANK (a backfill, never a clobber). The id is DERIVED from the
 * name (uuid v5-style) so a re-run converges instead of duplicating.
 *
 * The category taxonomy is the SAME list as `seed-mro-categories.mjs` (the
 * local, API-based seeder) — one vocabulary, two transports.
 *
 * Usage:
 *   node scripts/seed-mro-catalog-items.mjs --dry-run
 *   node scripts/seed-mro-catalog-items.mjs --apply
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

const CONCURRENCY = 3;
const MAX_SQL_LEN = 60_000;
const RETRYABLE = /account is not valid|not authorized|too many requests|error 429|5\d\d|fetch failed|ECONN|ETIMEDOUT|socket/i;

/**
 * The canonical top-level categories (`seed-mro-categories.mjs` owns the same
 * list for the local seeder). Created only when missing — the live DB already
 * carries them, so this is a no-op there.
 */
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
 * The part groups (55 after the variant fold — see `merge-mro-item-names.mjs`:
 * Glue/Bulb/Wrench/Grease/Grease Nipple/Valve/Nut absorb their spec
 * variants, which live on the SKU, not the group). `tracking` is REQUIRED and
 * set-once (every SKU under the name inherits it), so it is chosen deliberately:
 *   - `serial` — individual units the workshop tracks by serial (tyres: the
 *     tyre module's whole lifecycle is built on serial stock).
 *   - `batch`  — bulk lubricants/fluids whose drums carry a lot number and an
 *     expiry (the FEFO path).
 *   - `standard` — parts/tools/consumables tracked by plain quantity (no
 *     operator value in lot or serial granularity at this volume).
 */
const S = 'standard';
const B = 'batch';
const SERIAL = 'serial';
const ITEMS = [
	['Glue', 'ကော်', S, 'Body and Paint'],
	['Airbag', 'လေအိတ်', S, 'Suspension & Steering'],
	['Air Cleaner', 'လေစစ်ဘူး', S, 'Engine & Gear Box'],
	['Air Dryer', 'ဒရိုင်ယာဘူး', S, 'Suspension & Steering'],
	['Air Pipe', 'လေပိုက်', S, 'Suspension & Steering'],
	['Alloy Wheels', 'Alloy ဂွေ', S, 'Tyre & Alloy'],
	['Ball Joint', 'ဂီယာလင့်သီး / ဘောဂျိုင့်', S, 'Suspension & Steering'],
	['Battery', 'ဘက်ထရီအိုး', S, 'Electric & Lighting'],
	['Bearing', 'ဘောစေ့ / ဟတ်ဘော', S, 'Tyre & Alloy'],
	['Belt', 'ပန်ကာကြိုး', S, 'Engine & Gear Box'],
	['Bolt', 'ဘော့လ်', S, 'Tools'],
	['Brake Oil', 'ဘရိတ်ဆီ', B, 'Oil & Grease'],
	['Bulb', 'မီးသီး', S, 'Electric & Lighting'],
	['Cable Tie', 'ကေဘယ်တိုင်း (ဂျပန်နှီး)', S, 'Body and Paint'],
	['Brake Chamber', 'ချန်ပါရွက်', S, 'Suspension & Steering'],
	['Wheel Chock', 'ဂျမ်းတုံး', S, 'Tyre & Alloy'],
	['Clutch Disc', 'ကလပ်ပြား', S, 'Engine & Gear Box'],
	['Engine Coolant', 'အင်ဂျင်ကူးလန့်', B, 'Oil & Grease'],
	['Grease', 'အမဲဆီ', B, 'Oil & Grease'],
	['Tie Rod End Assembly', 'အန်းလော့ခေါင်း', S, 'Suspension & Steering'],
	['Engine Oil', 'အင်ဂျင်ဝိုင်', B, 'Oil & Grease'],
	['Filter', 'စစ်စကာ / အနည်စစ်', S, 'Engine & Gear Box'],
	['Gear Oil', 'ဂီယာဝိုင်', B, 'Oil & Grease'],
	['Glass Cleaner', 'မှန်ကြည်ဆေး', S, 'Body and Paint'],
	['Grease Nipple', 'အမဲဆီထိုးခေါင်း', S, 'Tools'],
	['Horn', 'ဟွန်း', S, 'Electric & Lighting'],
	['Hammer', 'တူ', S, 'Tools'],
	['Hydraulic Bottle Jack', 'ကားဂျိုက်', S, 'Tools'],
	['Impact Socket', 'ဘီးဖြုတ်အသီး / Socket အသီး', S, 'Tools'],
	['Repair Kit', 'ကစ်ဘူး', S, 'Body and Paint'],
	['Clutch Pressure Plate', 'ကလပ်ဖင်းကား', S, 'Engine & Gear Box'],
	['Drag Link', 'အန်းလော့ချောင်း', S, 'Suspension & Steering'],
	['Common Rail Injector', 'နော်ဇယ် (Common Rail Injector)', S, 'Engine & Gear Box'],
	['Mirror', 'မှန် / မှန်ဘီလူး', S, 'Electric & Lighting'],
	['Nut', 'နတ်တိုင် / နတ်သီး', S, 'Tyre & Alloy'],
	['Oil Seal', 'ဝိုင်ဆီးလ်', S, 'Engine & Gear Box'],
	['Old Liner', 'လိုင်နာအဟောင်း', S, 'Engine & Gear Box'],
	['Old Piston Ring', 'ပစ္စတို ရင်းဂ် အဟောင်း (ကျွတ်အဟောင်း)', S, 'Engine & Gear Box'],
	['Plain Sheet', 'သံပြား', S, 'Electric & Lighting'],
	['Power Steering Fluid', 'ပါဝါဆီ', B, 'Oil & Grease'],
	['Radiator Water / Distilled Water', 'မိုးရေ (ဘက်ထရီ/ရေဒီယိုတာဖြည့်ရေ)', S, 'Oil & Grease'],
	['Safety Gear', 'ဘေးအန္တရာယ်ကင်းရှင်းရေးပစ္စည်း', S, 'Body and Paint'],
	['Square Safety Reflector', 'ရောင်ပြန် (လေးထောင့်)', S, 'Electric & Lighting'],
	['Screwdriver', 'ဝက်အူလှည့်', S, 'Tools'],
	['Side Light', 'ဘေးမီး', S, 'Electric & Lighting'],
	['Soap Dish', 'ဆပ်ပြာပုံး', S, 'Body and Paint'],
	['Tape', 'တိတ် / ကော်တေပ်', S, 'Body and Paint'],
	['Tire Paint', 'တာယာဆေးရည်', S, 'Body and Paint'],
	['Wrench', 'ဂွ', S, 'Tools'],
	['Trailer Door Latch', 'နောက်တွဲတံခါးဂျိတ်', S, 'Electric & Lighting'],
	['Tow Chain', 'ဆွဲကြိုးကွင်း', S, 'Tools'],
	['Truck Cargo Lashing Belt', 'ကားဘော်ဒီပတ်ကြိုး', S, 'Body and Paint'],
	['Tyre', 'တာယာ', SERIAL, 'Tyre & Alloy'],
	['Valve', 'မက်ဆီဘား', S, 'Tyre & Alloy'],
	['Wheel Hub', 'ဘီးနတ်တိုင် / ဟတ်', S, 'Tyre & Alloy'],
	['Wire', 'မီးကြိုးခွေ', S, 'Electric & Lighting'],
	['Wire Cover Pipe (Corrugated Conduit)', 'ဘာဂျာဝါယာကာဗာပိုက်', S, 'Electric & Lighting'],
];

/**
 * Deterministic id for a natural key — idempotent inserts.
 *
 * VERSION 4 SHAPE IS MANDATORY: the engine's `validators.uuid` (and therefore
 * every entity write, Studio included) accepts ONLY `UUID_V4_RE` — a v5-shaped
 * id seeds fine but then fails `PUT /api/entities/.../:id` with
 * `id must be a valid UUID v4`. So the hash is shaped to v4 (version nibble 4,
 * variant 8) while staying deterministic from the key.
 */
function detUuid(key) {
	const h = crypto.createHash('sha1').update(key).digest();
	const b = Buffer.from(h.subarray(0, 16));
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
	if (typeof value === 'boolean') return value ? '1' : '0';
	return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlIdent(name) {
	return `"${name.replace(/"/g, '""')}"`;
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

/** One statement per request, gentle pool + backoff (same as push-local-d1). */
async function runStatements(statements, label) {
	if (statements.length === 0) {
		console.log(`  ${label}: nothing to write`);
		return;
	}
	if (!APPLY) {
		console.log(`  ${label}: ${statements.length} statement(s) (dry-run — not executed)`);
		return;
	}
	console.log(`  ${label}: ${statements.length} statement(s)`);
	let next = 0;
	let failed = null;
	let done = 0;
	const workers = Array.from({ length: Math.min(CONCURRENCY, statements.length) }, async () => {
		for (;;) {
			if (failed) return;
			const i = next++;
			if (i >= statements.length) return;
			for (let attempt = 0; ; attempt++) {
				try {
					await d1(statements[i]);
					break;
				} catch (err) {
					if (failed) return;
					const retryable = RETRYABLE.test(err.message) && !/SQLITE_ERROR/.test(err.message);
					if (!retryable || attempt >= 8) {
						failed = err;
						return;
					}
					await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt)));
				}
			}
			if (++done === statements.length) console.log(`  ${label}: done`);
		}
	});
	await Promise.all(workers);
	if (failed) throw failed;
}

/** Chunked multi-row INSERT (one statement per request). */
function buildInserts(table, columns, rows) {
	const out = [];
	if (rows.length === 0) return out;
	const prefix = `INSERT INTO ${sqlIdent(table)} (${columns.map(sqlIdent).join(', ')}) VALUES `;
	let batch = [];
	let len = prefix.length;
	const flush = () => {
		if (!batch.length) return;
		out.push(prefix + batch.join(', '));
		batch = [];
		len = prefix.length;
	};
	for (const row of rows) {
		const tuple = `(${columns.map((c) => sqlQuote(row[c])).join(', ')})`;
		if (batch.length && len + tuple.length + 2 > MAX_SQL_LEN) flush();
		batch.push(tuple);
		len += tuple.length + 2;
	}
	flush();
	return out;
}

async function main() {
	await loadCfToken();
	console.log(`\nSeed MRO catalog masters → ${DB_ID}${APPLY ? '' : '  [DRY-RUN]'}\n`);

	// ── 1. Categories (find-or-create by name_en) ────────────────────────────
	const existingCats = await d1('SELECT id, name_en FROM cms_mro_item_categories WHERE deleted_at IS NULL');
	const catIdByName = new Map(existingCats.map((r) => [String(r.name_en), String(r.id)]));
	const newCats = [];
	for (const category of CATEGORIES) {
		if (catIdByName.has(category.name_en)) continue;
		catIdByName.set(category.name_en, detUuid(`mro_item_categories:${category.name_en}`));
		newCats.push({
			id: catIdByName.get(category.name_en),
			name_en: category.name_en,
			name_mm: category.name_mm,
			doc_status: 'draft',
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		});
	}
	console.log(`Categories: ${existingCats.length} live, ${newCats.length} to create`);

	// ── 2. Item names (find-or-create by name_en; blank fields backfilled) ───
	const existingItems = await d1('SELECT id, name_en, name_mm, tracking, category FROM cms_mro_item_name');
	const byName = new Map(existingItems.map((r) => [String(r.name_en), r]));
	const inserts = [];
	const backfills = [];
	const missingCategory = [];
	const now = new Date().toISOString();

	for (const [nameEn, nameMm, tracking, categoryEn] of ITEMS) {
		const categoryId = catIdByName.get(categoryEn) ?? null;
		if (!categoryId) missingCategory.push(`${nameEn} → ${categoryEn}`);
		const existing = byName.get(nameEn);
		if (existing) {
			// Backfill ONLY blank fields — never overwrite an operator's edit.
			const patch = {};
			if (!existing.name_mm && nameMm) patch.name_mm = nameMm;
			if (!existing.tracking) patch.tracking = tracking;
			if (!existing.category && categoryId) patch.category = categoryId;
			if (Object.keys(patch).length > 0) {
				backfills.push(
					`UPDATE ${sqlIdent('cms_mro_item_name')} SET ${Object.entries(patch)
						.map(([col, value]) => `${sqlIdent(col)} = ${sqlQuote(value)}`)
						.join(', ')}, updated_at = ${sqlQuote(now)} WHERE id = ${sqlQuote(existing.id)}`,
				);
			}
			continue;
		}
		inserts.push({
			id: detUuid(`mro_item_name:${nameEn}`),
			name_en: nameEn,
			name_mm: nameMm,
			// `tracking` is NOT NULL with a DEFAULT, but the policy is set ONCE here
			// and every SKU inherits it — so it is always written explicitly.
			tracking,
			category: categoryId,
			doc_status: 'draft',
			created_at: now,
			updated_at: now,
		});
	}

	const byTracking = {};
	for (const [, , tracking] of ITEMS) byTracking[tracking] = (byTracking[tracking] ?? 0) + 1;
	console.log(`Item names: ${existingItems.length} live, ${ITEMS.length} in the source list`);
	console.log(`  new: ${inserts.length} · backfill: ${backfills.length} · tracking mix: ${JSON.stringify(byTracking)}`);
	if (missingCategory.length > 0) console.log(`  ⚠ unmapped categories: ${missingCategory.join(', ')}`);

	const catSql = buildInserts('cms_mro_item_categories', ['id', 'name_en', 'name_mm', 'doc_status', 'created_at', 'updated_at'], newCats);
	const itemSql = buildInserts(
		'cms_mro_item_name',
		['id', 'name_en', 'name_mm', 'tracking', 'category', 'doc_status', 'created_at', 'updated_at'],
		inserts,
	);

	await runStatements(catSql, 'categories');
	await runStatements(itemSql, 'item names');
	await runStatements(backfills, 'backfills');

	console.log(APPLY ? '\nSeed complete.\n' : '\nDry-run complete — re-run with --apply.\n');
}

main().catch((err) => {
	console.error(`\nSEED FAILED: ${err.message}\n`);
	process.exit(1);
});
