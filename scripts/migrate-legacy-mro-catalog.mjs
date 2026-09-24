#!/usr/bin/env node
/**
 * MIGRATE the legacy Directus MRO catalog → remote D1 (three masters only):
 *
 *   consumable_category  → (folded into) cms_mro_item_categories
 *   consumable_item      → cms_mro_item_name          (+ tracking / assets policy)
 *   consumable_item_model→ cms_mro_item_model         (SKU, keeps its legacy UUID)
 *
 * SOURCE (legacy Directus, one collection per master):
 *   /admin/content/consumable_item        → what the part IS (+ category, is_asset)
 *   /admin/content/consumable_item_model  → the SKU (name, parent item, images)
 *
 * WHY A SCRIPT: the legacy taxonomy is messy (duplicate groups, casing, zero-width
 * chars, orphaned SKUs) and the D1 engine cannot be cross-queried. This talks to
 * both APIs directly — same CF-token resolver and retry shape as the other D1 ops
 * scripts (`seed-mro-catalog-items.mjs`, `migrate-legacy-veh-docs.mjs`).
 *
 * RECONCILIATION (agreed policy — "fold into canonical, add only what is new"):
 *   - Legacy `consumable_category` (12) is NOT imported as rows: every group maps
 *     onto the canonical EIGHT categories already live in D1 (see ITEM_TARGET).
 *   - Legacy `consumable_item` (73) folds onto the canonical 57 part groups where
 *     it is the same part (`Coolant`→`Engine Coolant`, `AB Glue`/`GLUE 502`/
 *     `SILICONE CAULK`→`Glue`, `WHEEL HUB`/`Wheel hub`→`Wheel Hub`, …). Groups with
 *     no canonical home are created from NEW_ITEMS (5: Impact Gun, Pliers, Toolbox,
 *     Pipe Clip, Grass Root).
 *   - Legacy SKUs are re-parented onto the folded group and de-duplicated within
 *     it (a spec — `8`, `default` — belongs to one SKU).
 *   - `is_asset = true` mirrors onto `assets = 1`; because the new engine requires
 *     `assets ⇒ tracking = serial`, every asset group gets `tracking = serial`
 *     (Tyre was serial already; Wrench/Screwdriver/Hydraulic Bottle Jack/Horn and
 *     the two new tool groups flip to serial).
 *
 * IDENTITY / IDEMPOTENCY:
 *   - `mro_item_model.id` = the legacy UUID (already v4), so a re-run is an
 *     `INSERT OR IGNORE` no-op and the image pass can attach by the same id.
 *   - `mro_item_name.id` = the existing D1 row's id when the group already exists
 *     (live or soft-deleted — a soft-deleted canonical row is RESTORED), else the
 *     deterministic `detUuid('mro_item_name:<name_en>')` the seeder uses.
 *   - Blank name_mm/tracking/category/assets are backfilled; an existing value is
 *     never clobbered (a re-run converges).
 *
 * ⚠️ IMAGES ARE A SEPARATE PASS — `scripts/migrate-legacy-mro-images.mjs` downloads
 * the legacy files and fills `mro_item_model.image` + `_media` + `_media_refs`.
 *
 * Credentials (env, never committed): LEGACY_DIRECTUS_EMAIL / _PASSWORD (and
 * optionally LEGACY_DIRECTUS_URL). D1 target from `infra/env.prod` (CLOUDFLARE_
 * ACCOUNT_ID / D1_ID overridable).
 *
 * Usage:
 *   node scripts/migrate-legacy-mro-catalog.mjs            (dry-run report)
 *   node scripts/migrate-legacy-mro-catalog.mjs --apply
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from './gen-wrangler.mjs';
import { loadCfToken } from './lib/cf-token.mjs';

const APPLY = process.argv.includes('--apply');
/** Offline replay: read the raw Directus JSON dumps (`<dir>/item.json`,
 *  `model.json`, `category.json`, `junction.json`) instead of the live origin —
 *  the legacy server is behind a Cloudflare origin that goes 530 from time to
 *  time, and a migration must be re-runnable from a captured snapshot. */
const FROM_CACHE = process.argv.includes('--from-cache') ? process.argv[process.argv.indexOf('--from-cache') + 1] : null;

const INFRA = loadEnvFile('prod');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || INFRA.CF_ACCOUNT_ID;
const DB_ID = process.env.D1_ID || INFRA.D1_ID;
const BASE = 'https://api.cloudflare.com/client/v4';

const DIRECTUS = (process.env.LEGACY_DIRECTUS_URL ?? 'https://mex-svr.mfflogistics.com').replace(/\/$/, '');
const EMAIL = process.env.LEGACY_DIRECTUS_EMAIL;
const PASSWORD = process.env.LEGACY_DIRECTUS_PASSWORD;

const CONCURRENCY = 3;
const MAX_SQL_LEN = 60_000;
const RETRYABLE = /account is not valid|not authorized|too many requests|error 429|5\d\d|fetch failed|ECONN|ETIMEDOUT|socket/i;

/**
 * Legacy `consumable_item.id` → canonical/new `mro_item_name.name_en`.
 * Explicit (not fuzzy): a business decision once, reviewable forever. Every value
 * MUST be either one of the live canonical 55 non-{Bolt,Tow Chain} groups or a
 * NEW_ITEMS key — the script fails loudly otherwise (Poka-Yoke).
 */
const ITEM_TARGET = {
	3: 'Engine Oil',
	4: 'Engine Coolant', // legacy "Coolant"
	5: 'Tyre',
	6: 'Glass Cleaner',
	7: 'Repair Kit', // legacy "Kit"
	8: 'Tape',
	9: 'Bulb', // "24V Filament Bulb" → Bulb
	11: 'Bulb', // "Small Bulb" → Bulb
	12: 'Wire Cover Pipe (Corrugated Conduit)',
	14: 'Wrench', // "Tire Nut Spanner"
	15: 'Glue', // "AB Glue"
	17: 'Bearing',
	25: 'Oil Seal',
	26: 'Impact Gun', // NEW
	27: 'Pliers', // NEW
	28: 'Wrench', // "Adjustable"
	29: 'Screwdriver', // "Screw Driver"
	30: 'Cable Tie',
	31: 'Brake Chamber', // "Chamber"
	32: 'Filter',
	34: 'Air Cleaner',
	35: 'Side Light',
	36: 'Truck Cargo Lashing Belt', // "Truck Loading Belt"
	37: 'Hydraulic Bottle Jack',
	38: 'Wrench', // "Spanner GI Pipe"
	39: 'Toolbox', // NEW — "Tools Box Set"
	40: 'Wire',
	41: 'Pipe Clip', // NEW — "Pipe Clips Stainless Steel"
	42: 'Grease Nipple', // "Grease Gun Head"
	43: 'Old Liner',
	44: 'Old Piston Ring',
	45: 'Air Dryer',
	46: 'Valve', // "Valve Cap (Gold)"
	47: 'Tire Paint',
	48: 'Grass Root', // NEW — unclear legacy part ("ကော်ပတ်"), kept verbatim
	49: 'Grease', // "Crown Grease"
	50: 'Radiator Water / Distilled Water', // "Rain Water"
	51: 'Grease', // "Soft Grease"
	52: 'Grease', // "Traine Grease"
	53: 'Brake Oil', // legacy "Break Oil" (typo)
	54: 'Power Steering Fluid', // "Power Fuel"
	57: 'Bulb',
	58: 'Wrench', // "Tool" (ဂွ)
	59: 'Plain Sheet', // "Plane Sheet"
	60: 'Grease Nipple', // "Grease Head"
	61: 'Wheel Hub', // "Wheel hub"
	62: 'Air Pipe', // "Air pipe"
	63: 'Clutch Disc',
	64: 'Tie Rod End Assembly', // "END ASSY TIE ROD"
	65: 'Common Rail Injector', // "LU INJECTORF COMMOM RAIL"
	67: 'Clutch Pressure Plate', // "LU CLUTCH PRESSURE PLATE"
	68: 'Drag Link', // "LU DRAGLINK"
	69: 'Valve', // "VALVE ASSY"
	70: 'Wheel Hub', // "WHEEL HUB"
	73: 'Wheel Chock', // "Chock"
	74: 'Soap Dish',
	75: 'Belt',
	76: 'Ball Joint',
	77: 'Gear Oil',
	78: 'Nut',
	79: 'Glue', // "SILICONE CAULK"
	80: 'Hammer', // "HUMMER"
	81: 'Glue', // "GLUE 502"
	82: 'Trailer Door Latch',
	83: 'Square Safety Reflector', // "Safety Reflector Square"
	85: 'Nut', // "NUT FWD PP WHEEL HUB"
	86: 'Alloy Wheels',
	88: 'Impact Socket',
	89: 'Battery',
	90: 'Safety Gear', // "Safety"
	92: 'Mirror',
	93: 'Horn',
	94: 'Airbag', // "AIR BAG"
};

/**
 * Groups with NO canonical home — created on demand. `category` is a canonical
 * category name (looked up live), `tracking`/`assets` follow the same asset rule.
 */
const NEW_ITEMS = {
	'Impact Gun': { name_mm: 'ဘီဖြုတ်ကလော်တံ', category: 'Tools', tracking: 'serial', assets: 1 },
	Pliers: { name_mm: 'ပလာယာ', category: 'Tools', tracking: 'serial', assets: 1 },
	Toolbox: { name_mm: 'ကားပြင်ပစ္စည်းအစုံပါသေတ္တာ', category: 'Tools', tracking: 'standard', assets: 0 },
	'Pipe Clip': { name_mm: "ပိုက်ကြပ်ကွင်း", category: 'Body and Paint', tracking: 'standard', assets: 0 },
	'Grass Root': { name_mm: 'ကော်ပတ်', category: 'Body and Paint', tracking: 'standard', assets: 0 },
};

/**
 * Canonical groups that legacy marks `is_asset = true`. Forced to
 * `assets = 1` + `tracking = serial` (the engine's hard rule).
 */
const ASSET_TARGETS = new Set(['Tyre', 'Wrench', 'Screwdriver', 'Hydraulic Bottle Jack', 'Horn', 'Impact Gun', 'Pliers']);

// ─── text sanitising ────────────────────────────────────────────────────────

/** Strip zero-width controls, collapse runs of whitespace, trim → null when empty. */
function clean(value) {
	if (value == null) return null;
	const out = String(value)
		.replace(/[\u200b-\u200f\ufeff]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	return out.length > 0 ? out : null;
}

/** Deterministic UUID v4-shaped id from a natural key (matches the seeder). */
function detUuid(key) {
	const h = crypto.createHash('sha1').update(key).digest();
	const b = Buffer.from(h.subarray(0, 16));
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const hex = b.toString('hex');
	const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
		throw new Error(`detUuid produced a non-v4 id: ${id}`);
	}
	return id;
}

const sqlQuote = (value) => {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
	if (typeof value === 'boolean') return value ? '1' : '0';
	return `'${String(value).replace(/'/g, "''")}'`;
};
const sqlIdent = (name) => `"${name.replace(/"/g, '""')}"`;

// ─── transports ─────────────────────────────────────────────────────────────

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

function buildInserts(table, columns, rows) {
	const out = [];
	if (rows.length === 0) return out;
	const prefix = `INSERT OR IGNORE INTO ${sqlIdent(table)} (${columns.map(sqlIdent).join(', ')}) VALUES `;
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

// ─── Directus ───────────────────────────────────────────────────────────────

let directusToken = null;

/** fetch + parse with backoff — the legacy origin intermittently answers 5xx/530. */
async function fetchJson(url, options, attempts = 6) {
	let lastErr;
	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			const res = await fetch(url, { ...options, headers: { Accept: 'application/json', ...(options.headers ?? {}) } });
			const text = await res.text();
			if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
			return { res, json: JSON.parse(text) };
		} catch (err) {
			lastErr = err;
			if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt)));
		}
	}
	throw new Error(`legacy request failed after ${attempts} attempts: ${lastErr?.message}`);
}

async function directusLogin() {
	if (!EMAIL || !PASSWORD) {
		throw new Error('LEGACY_DIRECTUS_EMAIL / LEGACY_DIRECTUS_PASSWORD are required (never commit them)');
	}
	const { json } = await fetchJson(`${DIRECTUS}/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
	});
	if (!json?.data?.access_token) {
		throw new Error(`Directus login failed: ${JSON.stringify(json).slice(0, 200)}`);
	}
	directusToken = json.data.access_token;
}

async function directusItems(collection, params = 'limit=-1&sort=id') {
	const { json } = await fetchJson(`${DIRECTUS}/items/${collection}?${params}`, {
		headers: { Authorization: `Bearer ${directusToken}` },
	});
	if (!json?.data) {
		throw new Error(`Directus ${collection} returned no data: ${JSON.stringify(json).slice(0, 200)}`);
	}
	return json.data;
}

/** Read a cached Directus dump (`{ data: [...] }`), or fetch it when live. */
function readDump(dir, name) {
	const file = path.join(dir, `${name}.json`);
	if (!fs.existsSync(file)) throw new Error(`--from-cache: missing ${file}`);
	return JSON.parse(fs.readFileSync(file, 'utf8')).data;
}

/**
 * Load the legacy masters + the model↔file junction and normalise each SKU's
 * `images` (junction ids or expanded objects) into `__fileIds` (Directus file
 * UUIDs) — the one shape the catalog and image passes both consume.
 */
async function loadLegacy() {
	let items;
	let models;
	let categories;
	let junction;
	if (FROM_CACHE) {
		items = readDump(FROM_CACHE, 'item');
		models = readDump(FROM_CACHE, 'model');
		categories = readDump(FROM_CACHE, 'category');
		junction = readDump(FROM_CACHE, 'junction');
	} else {
		await directusLogin();
		[items, models, categories, junction] = await Promise.all([
			directusItems('consumable_item'),
			directusItems('consumable_item_model', 'limit=-1&sort=date_created'),
			directusItems('consumable_category'),
			directusItems('consumable_item_model_files'),
		]);
	}

	const fileByJunction = new Map(junction.map((r) => [Number(r.id), r.directus_files_id]).filter(([, f]) => f));
	for (const m of models) {
		m.__fileIds = (Array.isArray(m.images) ? m.images : [])
			.map((v) => (v && typeof v === 'object' ? v.directus_files_id : fileByJunction.get(Number(v))))
			.filter(Boolean);
	}
	return { items, models, categories };
}

// ─── plan ───────────────────────────────────────────────────────────────────

/**
 * Fold the legacy catalog onto the canonical taxonomy and produce the ordered
 * statements. Pure planning + report — the caller applies.
 */
function plan({ legacyItems, legacyModels, dbCategories, dbItemNames, dbModels }) {
	const warnings = [];

	const catIdByName = new Map(dbCategories.filter((r) => !r.deleted_at).map((r) => [String(r.name_en), String(r.id)]));
	for (const category of ['Engine & Gear Box', 'Body and Paint', 'Electric & Lighting', 'Oil & Grease', 'Suspension & Steering', 'Filter & Cleaning', 'Tyre & Alloy', 'Tools']) {
		if (!catIdByName.has(category)) warnings.push(`canonical category missing in D1: ${category}`);
	}

	// Existing item names: prefer the LIVE row, fall back to a soft-deleted one
	// (a canonical group that was reset — restore it rather than duplicate it).
	const itemByName = new Map();
	for (const row of dbItemNames) {
		const key = String(row.name_en);
		const existing = itemByName.get(key);
		if (!existing || (existing.deleted_at && !row.deleted_at)) itemByName.set(key, row);
	}

	const legacyItemById = new Map(legacyItems.map((r) => [Number(r.id), r]));
	const itemCountByLegacyId = new Map();
	for (const m of legacyModels) itemCountByLegacyId.set(m.mro_item_id, (itemCountByLegacyId.get(m.mro_item_id) ?? 0) + 1);

	// Legacy item name (cleaned, lowercased) → legacy id — re-attaches orphan SKUs.
	const legacyIdByCleanName = new Map();
	for (const it of legacyItems) {
		const n = clean(it.name_en);
		if (n) legacyIdByCleanName.set(n.toLowerCase(), Number(it.id));
	}

	/** Final target group → plan entry. */
	const groups = new Map();
	const groupStatements = [];
	const ensureGroup = (name) => {
		if (groups.has(name)) return groups.get(name);
		const canonical = itemByName.get(name);
		if (canonical) {
			const entry = {
				name,
				id: String(canonical.id),
				status: canonical.deleted_at ? 'restore' : 'existing',
				row: canonical,
			};
			groups.set(name, entry);
			return entry;
		}
		if (!NEW_ITEMS[name]) throw new Error(`unmapped new group "${name}" — add it to NEW_ITEMS`);
		const def = NEW_ITEMS[name];
		const categoryId = catIdByName.get(def.category) ?? null;
		if (!categoryId) throw new Error(`new group "${name}" has unknown category "${def.category}"`);
		const entry = { name, id: detUuid(`mro_item_name:${name}`), status: 'new', def, categoryId };
		groups.set(name, entry);
		return entry;
	};

	// Every legacy item must map, and every target must resolve.
	const unmappedItems = [];
	for (const it of legacyItems) {
		const target = ITEM_TARGET[Number(it.id)];
		if (!target) {
			unmappedItems.push(`${it.id} ${clean(it.name_en)}`);
			continue;
		}
		if (!groups.has(target) && !itemByName.has(target) && !NEW_ITEMS[target]) {
			throw new Error(`target "${target}" for legacy item ${it.id} is neither a live canonical group nor in NEW_ITEMS`);
		}
		ensureGroup(target);
	}
	if (unmappedItems.length > 0) warnings.push(`legacy items with no mapping (skipped): ${unmappedItems.join('; ')}`);

	// Asset policy from legacy is_asset.
	const legacyAssetIdSet = new Set(legacyItems.filter((r) => r.is_asset === true).map((r) => Number(r.id)));
	for (const [legacyId, it] of legacyItemById) {
		if (!legacyAssetIdSet.has(legacyId)) continue;
		const target = ITEM_TARGET[legacyId];
		if (target) ASSET_TARGETS.add(target);
	}

	// Build item-name statements.
	const now = new Date().toISOString();
	const touched = [];
	const assetFlips = [];
	for (const entry of groups.values()) {
		if (entry.status === 'new') {
			const def = entry.def;
			const isAsset = ASSET_TARGETS.has(entry.name) ? 1 : def.assets ?? 0;
			const tracking = isAsset ? 'serial' : def.tracking ?? 'standard';
			entry.finalTracking = tracking;
			entry.finalAssets = isAsset;
			entry.insert = {
				id: entry.id,
				name_en: entry.name,
				name_mm: def.name_mm,
				tracking,
				category: entry.categoryId,
				assets: isAsset,
				doc_status: 'draft',
				created_at: now,
				updated_at: now,
			};
			touched.push(entry);
			continue;
		}
		// Existing / restored row — backfill blanks, never clobber.
		const row = entry.row;
		const patch = {};
		if (!clean(row.name_mm)) {
			const mm = NEW_ITEMS[entry.name]?.name_mm;
			if (mm) patch.name_mm = mm;
		}
		if (!row.tracking) patch.tracking = ASSET_TARGETS.has(entry.name) ? 'serial' : 'standard';
		if (!row.category) {
			const cat = NEW_ITEMS[entry.name]?.category;
			const categoryId = cat ? catIdByName.get(cat) : null;
			if (categoryId) patch.category = categoryId;
		}
		if (ASSET_TARGETS.has(entry.name)) {
			patch.assets = 1;
			patch.tracking = 'serial';
		}
		if ((entry.row.tracking && entry.row.tracking !== (patch.tracking ?? entry.row.tracking)) || (Number(entry.row.assets ?? 0) !== Number(patch.assets ?? entry.row.assets ?? 0))) {
			assetFlips.push(`${entry.name}: tracking ${entry.row.tracking ?? '(null)'}→${patch.tracking ?? entry.row.tracking}, assets ${entry.row.assets ?? '(null)'}→${patch.assets ?? entry.row.assets ?? 0}`);
		}
		if (entry.status === 'restore') {
			patch.deleted_at = null;
			patch.deleted_by = null;
		}
		entry.patch = patch;
		entry.finalTracking = patch.tracking ?? row.tracking;
		entry.finalAssets = patch.assets ?? row.assets;
		if (Object.keys(patch).length > 0) touched.push(entry);
	}

	for (const entry of touched) {
		entry.statements = [];
	}
	for (const entry of touched) {
		if (entry.status === 'new') continue;
		const sets = Object.entries(entry.patch).map(([col, value]) => `${sqlIdent(col)} = ${sqlQuote(value)}`);
		sets.push(`${sqlIdent('updated_at')} = ${sqlQuote(now)}`);
		groupStatements.push(`UPDATE ${sqlIdent('cms_mro_item_name')} SET ${sets.join(', ')} WHERE ${sqlIdent('id')} = ${sqlQuote(entry.id)}`);
	}
	const groupInserts = buildInserts(
		'cms_mro_item_name',
		['id', 'name_en', 'name_mm', 'tracking', 'category', 'assets', 'doc_status', 'created_at', 'updated_at'],
		[...groups.values()].filter((g) => g.status === 'new').map((g) => g.insert),
	);

	// ── SKUs ────────────────────────────────────────────────────────────────
	const seen = new Set(dbModels.map((r) => `${r.item_name}::${String(r.name_en).toLowerCase()}`));
	const modelById = new Map();
	const reattachedNames = [];
	const droppedNames = [];
	const unresolved = [];

	for (const m of legacyModels) {
		let legacyItemId = m.mro_item_id == null ? null : Number(m.mro_item_id);
		let reattached = false;
		if (legacyItemId == null) {
			const n = clean(m.item_name_en);
			const resolved = n ? legacyIdByCleanName.get(n.toLowerCase()) : undefined;
			if (resolved == null) {
				unresolved.push(`${m.id} ${clean(m.name)} (item_name_en=${JSON.stringify(clean(m.item_name_en))})`);
				continue;
			}
			legacyItemId = resolved;
			reattached = true;
		}
		const target = ITEM_TARGET[legacyItemId];
		if (!target) {
			unresolved.push(`${m.id} ${clean(m.name)} (legacy item ${legacyItemId})`);
			continue;
		}
		const group = groups.get(target);
		const nameEn = clean(m.name) ?? 'default';
		const key = `${group.id}::${nameEn.toLowerCase()}`;
		const candidate = {
			legacyId: String(m.id),
			name_en: nameEn,
			item_name: group.id,
			hasImage: Array.isArray(m.__fileIds) && m.__fileIds.length > 0,
			createdAt: m.date_created ?? null,
		};
		const prior = modelById.get(key);
		if (seen.has(key)) {
			droppedNames.push(`${target} / ${nameEn} (already live)`);
			continue;
		}
		if (prior) {
			// Keep the image-bearing / earliest row, drop the rest.
			const better =
				(candidate.hasImage && !prior.hasImage) ||
				(candidate.hasImage === prior.hasImage && String(candidate.createdAt ?? '') < String(prior.createdAt ?? ''));
			if (better) modelById.set(key, candidate);
			droppedNames.push(`${target} / ${nameEn}`);
			continue;
		}
		modelById.set(key, candidate);
		if (reattached) reattachedNames.push(`${target} / ${nameEn}`);
	}

	const modelRows = [...modelById.values()].map((c) => {
		const created = c.createdAt ?? now;
		return {
			id: c.legacyId,
			name_en: c.name_en,
			name_mm: null,
			item_name: c.item_name,
			expiry_alert_days: 30,
			doc_status: 'draft',
			created_at: created,
			updated_at: created,
		};
	});
	const modelInserts = buildInserts(
		'cms_mro_item_model',
		['id', 'name_en', 'name_mm', 'item_name', 'expiry_alert_days', 'doc_status', 'created_at', 'updated_at'],
		modelRows,
	);

	// SKUs per target group — the reviewer's map of where stock lands.
	const perGroup = new Map();
	for (const row of modelRows) perGroup.set(row.item_name, (perGroup.get(row.item_name) ?? 0) + 1);
	const countByGroup = new Map();
	for (const g of groups.values()) countByGroup.set(g.id, { name: g.name, status: g.status, skus: perGroup.get(g.id) ?? 0 });

	return {
		warnings,
		groups: [...groups.values()],
		groupStatements,
		groupInserts,
		modelRows,
		modelInserts,
		stats: {
			legacyItems: legacyItems.length,
			legacyModels: legacyModels.length,
			folded: [...groups.values()].filter((g) => g.status === 'existing').length,
			created: [...groups.values()].filter((g) => g.status === 'new').map((g) => g.name),
			restored: [...groups.values()].filter((g) => g.status === 'restore').length,
			assets: [...groups.values()].filter((g) => ASSET_TARGETS.has(g.name)).map((g) => g.name),
			assetFlips,
			modelsToInsert: modelRows.length,
			orphanReattached: reattachedNames,
			orphanUnresolved: unresolved.length,
			duplicatesDropped: droppedNames,
			unresolved,
			perGroup: [...countByGroup.values()].sort((a, b) => a.name.localeCompare(b.name)),
		},
	};
}

async function main() {
	await loadCfToken();
	console.log(`\nMigrate legacy MRO catalog → ${DB_ID}${APPLY ? '' : '  [DRY-RUN]'}${FROM_CACHE ? `  [cache ${FROM_CACHE}]` : ''}`);

	const { items: legacyItems, models: legacyModels, categories: legacyCategories } = await loadLegacy();
	console.log(`Legacy: ${legacyCategories.length} categories · ${legacyItems.length} items · ${legacyModels.length} SKUs`);

	const [dbCategories, dbItemNames, dbModels] = await Promise.all([
		d1('SELECT id, name_en, deleted_at FROM cms_mro_item_categories'),
		d1('SELECT id, name_en, name_mm, tracking, category, assets, deleted_at FROM cms_mro_item_name'),
		d1('SELECT id, item_name, name_en FROM cms_mro_item_model WHERE deleted_at IS NULL'),
	]);
	console.log(`D1 now: ${dbCategories.length} categories · ${dbItemNames.length} item names · ${dbModels.length} live SKUs`);

	const result = plan({ legacyItems, legacyModels, dbCategories, dbItemNames, dbModels });

	console.log('\n── Plan ─────────────────────────────────────────────────');
	console.log(`  item groups: existing ${result.stats.folded} · restored ${result.stats.restored} · created ${result.stats.created.length} (${result.stats.created.join(', ')})`);
	console.log(`  assets (assets=1, tracking=serial): ${result.stats.assets.join(', ')}`);
	if (result.stats.assetFlips.length > 0) {
		console.log('  policy flips on existing groups:');
		for (const f of result.stats.assetFlips) console.log(`    - ${f}`);
	}
	console.log(`  SKUs: ${result.stats.modelsToInsert} to insert (legacy ${result.stats.legacyModels}, orphans reattached ${result.stats.orphanReattached.length}, duplicates dropped ${result.stats.duplicatesDropped.length}, unresolved ${result.stats.orphanUnresolved})`);
	if (result.stats.orphanReattached.length > 0) console.log(`    reattached: ${result.stats.orphanReattached.join(' · ')}`);
	if (result.stats.duplicatesDropped.length > 0) console.log(`    dropped:    ${result.stats.duplicatesDropped.join(' · ')}`);
	if (result.stats.unresolved.length > 0) {
		console.log('  unresolved SKUs (skipped):');
		for (const u of result.stats.unresolved) console.log(`    - ${u}`);
	}
	for (const w of result.warnings) console.log(`  ⚠ ${w}`);

	console.log('\n── SKUs per group ───────────────────────────────────────');
	for (const g of result.stats.perGroup) {
		console.log(`  ${g.skus.toString().padStart(3)}  ${g.name}${g.status === 'new' ? '  (new)' : g.status === 'restore' ? '  (restored)' : ''}`);
	}

	console.log('\n── Writes ───────────────────────────────────────────────');
	await runStatements(result.groupStatements, 'item-name updates (restore/backfill)');
	await runStatements(result.groupInserts, 'item-name inserts (new groups)');
	await runStatements(result.modelInserts, 'SKU inserts');

	console.log(APPLY ? '\nMigration complete. Run scripts/migrate-legacy-mro-images.mjs next.\n' : '\nDry-run complete — re-run with --apply.\n');
}

main().catch((err) => {
	console.error(`\nMIGRATION FAILED: ${err.message}\n`);
	process.exit(1);
});
