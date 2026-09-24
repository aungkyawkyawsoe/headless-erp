#!/usr/bin/env node
/**
 * Seed the MRO item MASTER catalog — the item names, their tracking policies
 * and the SKUs underneath.
 *
 *   node scripts/seed-mro-catalog.mjs [baseUrl] [token]          # dry run
 *   node scripts/seed-mro-catalog.mjs [baseUrl] [token] --apply  # write
 *
 * Defaults: baseUrl http://localhost:8788 · token `dev-token` (IS_DEV local).
 * Prereq: `node scripts/apply-mro-schema.mjs` then
 * `node scripts/migrate-mro-item-name-tracking.mjs --apply` (the policy must
 * live on `mro_item_name` and `mro_item_model` must no longer carry `tracking`).
 *
 * THE RULE THIS SEED ENCODES: the stock TRACKING POLICY is defined ONCE per item
 * NAME and every SKU under that name inherits it. A SKU never picks a policy, so
 * this script sets `mro_item_name.tracking` and leaves the SKUs alone:
 *
 *   Tyre         serial  — 10 size SKUs (a size is a plain specification)
 *   Equipment    serial  — 3 unit-tracked tool SKUs (jack / toolbox / chain)
 *   Engine Oil   batch   — 3 grade SKUs (fluids carry a lot + expiry)
 *   Air Filter   standard— 2 SKUs (plain balance)
 *   Bolt         standard— 2 SKUs (plain balance)
 *   Transmission Fluid  RETIRED (soft-deleted; it is not part of the catalog)
 *
 * THE ASSET RULE: `assets: true` marks a group whose units are PHYSICAL ASSETS
 * tracked one-by-one (a tyre, a jack), and always implies `tracking: 'serial'`.
 * It is declared ONCE on the item name, exactly like the tracking policy.
 *
 * Idempotent: every row is matched by its name (item names by
 * `name_en`, SKUs by `name_en` + their item name) and only created when missing;
 * an existing row is updated in place when a value differs. Re-running writes
 * nothing the second time.
 */
import { listAllRows } from './lib/list-all-rows.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const baseUrl = (args[0] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = args[1] ?? 'dev-token';
const apply = process.argv.includes('--apply');

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

// ── The catalog definition ────────────────────────────────────────────────

/** A category the catalog needs (find-or-create by `name_en`). */
const NEW_CATEGORIES = [
	{ name_en: 'Tyres & Wheels', name_mm: 'တာယာနှင့် ဘီး' },
	{ name_en: 'Tools & Equipment', name_mm: 'ကိရိယာနှင့် ပစ္စည်း' },
];

/** The masters, WITH the policy every SKU under them inherits. `assets: true`
 *  marks a group whose units are PHYSICAL ASSETS tracked one-by-one (a tyre, a
 *  jack) — the rule is `assets ⇒ tracking: 'serial'`, declared ONCE here. */
const ITEM_NAMES = [
	{ name_en: 'Tyre', name_mm: 'တာယာ', tracking: 'serial', assets: true, category: 'Tyres & Wheels' },
	{ name_en: 'Equipment', name_mm: 'ကိရိယာ', tracking: 'serial', assets: true, category: 'Tools & Equipment' },
	{ name_en: 'Engine Oil', name_mm: 'အင်ဂျင်ဆီ', tracking: 'batch', assets: false, category: 'Grease & Fluids' },
	{ name_en: 'Air Filter', name_mm: 'လေစစ်ဇကာ', tracking: 'standard', assets: false, category: 'Engine & Gear Box' },
	{ name_en: 'Bolt', name_mm: 'နပ်တိုင်', tracking: 'standard', assets: false, category: 'General' },
];

/** Masters to RETIRE — soft-deleted, and only while they hold no live SKU. */
const RETIRED_ITEM_NAMES = ['Transmission Fluid'];

/**
 * The SKUs. `reference_tread_mm` is the new-tread baseline the tyre fitment board
 * uses to derive remaining-tread %; it is only meaningful for serial tyres.
 * `expiry_alert_days` is the alert window read by /api/mro/stock/expiring.
 * The POLICY is not here on purpose — it is the parent item name's.
 */
const MODELS = [
	// ── Tyre (serial) — 10 sizes (a size is not maker-specific) ──────────────
	{ item: 'Tyre', name_en: '11R 22.5', name_mm: 'တာယာ 11R 22.5', reference_tread_mm: 15, expiry_alert_days: 90 },
	{ item: 'Tyre', name_en: '12R 22.5', name_mm: 'တာယာ 12R 22.5', reference_tread_mm: 15, expiry_alert_days: 90 },
	{ item: 'Tyre', name_en: '295/80R22.5', name_mm: 'တာယာ 295/80R22.5', reference_tread_mm: 15, expiry_alert_days: 90 },
	{ item: 'Tyre', name_en: '315/80R22.5', name_mm: 'တာယာ 315/80R22.5', reference_tread_mm: 15, expiry_alert_days: 90 },
	{ item: 'Tyre', name_en: '385/65R22.5', name_mm: 'တာယာ 385/65R22.5', reference_tread_mm: 15, expiry_alert_days: 90 },
	{ item: 'Tyre', name_en: '10.00R20', name_mm: 'တာယာ 10.00R20', reference_tread_mm: 14, expiry_alert_days: 90 },
	{ item: 'Tyre', name_en: '9.00R20', name_mm: 'တာယာ 9.00R20', reference_tread_mm: 14, expiry_alert_days: 90 },
	{ item: 'Tyre', name_en: '11.00R20', name_mm: 'တာယာ 11.00R20', reference_tread_mm: 14, expiry_alert_days: 90 },
	{ item: 'Tyre', name_en: '215/75R17.5', name_mm: 'တာယာ 215/75R17.5', reference_tread_mm: 12, expiry_alert_days: 90 },
	{ item: 'Tyre', name_en: '7.50R16', name_mm: 'တာယာ 7.50R16', reference_tread_mm: 12, expiry_alert_days: 90 },

	// ── Engine Oil (batch) — 3 grades ────────────────────────────────────────
	{ item: 'Engine Oil', name_en: '15W-40', name_mm: 'အင်ဂျင်ဆီ 15W-40', expiry_alert_days: 30 },
	{ item: 'Engine Oil', name_en: '10W-30', name_mm: 'အင်ဂျင်ဆီ 10W-30', expiry_alert_days: 30 },
	{ item: 'Engine Oil', name_en: '20W-50', name_mm: 'အင်ဂျင်ဆီ 20W-50', expiry_alert_days: 30 },

	// ── Equipment (serial + assets) — unit-tracked tools, no tread baseline ──
	{ item: 'Equipment', name_en: 'Hydraulic Jack 20T', name_mm: 'ဟိုက်ဒြောလစ် ဂျက် ၂၀တန်' },
	{ item: 'Equipment', name_en: 'Toolbox Steel', name_mm: 'သံမဏိ ကိရိယာသေတ္တာ' },
	{ item: 'Equipment', name_en: 'Tow Chain 10m', name_mm: 'ဆွဲကြိုးကွင်း ၁၀ မီတာ' },

	// ── Air Filter (standard) ────────────────────────────────────────────────
	{ item: 'Air Filter', name_en: 'AF-1001', name_mm: 'လေစစ်ဇကာ AF-1001' },
	{ item: 'Air Filter', name_en: 'AF-2002', name_mm: 'လေစစ်ဇကာ AF-2002' },

	// ── Bolt (standard) ──────────────────────────────────────────────────────
	{ item: 'Bolt', name_en: 'M12 × 40', name_mm: 'ဘော့လ် M12 × 40' },
	{ item: 'Bolt', name_en: 'M16 × 60', name_mm: 'ဘော့လ် M16 × 60' },
];

/** Normalize an m2o value (bare id, expanded `{ id }`, or null) to its id. */
const relId = (value) => (typeof value === 'string' ? value : (value?.id ?? null));

async function main() {
	let created = 0;
	let updated = 0;

	// ── 1. Categories ────────────────────────────────────────────────────────
	title(`Step 1 — categories${apply ? '' : '  [dry-run]'}`);
	const categories = await listAll('mro_item_categories', 'id,name_en');
	const catByEn = new Map(categories.map((c) => [(c.name_en ?? '').trim(), c]));
	for (const want of NEW_CATEGORIES) {
		if (catByEn.has(want.name_en)) {
			log(`ok       ${want.name_en}`);
			continue;
		}
		if (!apply) {
			log(`create   ${want.name_en}`);
			// Register a placeholder so the later steps validate against the PLAN, not
			// just the rows that already exist.
			catByEn.set(want.name_en, { id: `(new) ${want.name_en}`, ...want });
			continue;
		}
		const made = await api('/api/entities/mro_item_categories', { method: 'POST', body: JSON.stringify(want) });
		catByEn.set(want.name_en, { id: made.id, ...want });
		created += 1;
		log(`create   ${want.name_en}  ->  ${made.id}`);
	}

	// ── 2. Item names — the masters, each with its OWN tracking policy ───────
	title(`Step 2 — item names + tracking policy${apply ? '' : '  [dry-run]'}`);
	let itemNames = await listAll('mro_item_name', 'id,name_en,name_mm,tracking,assets,category');
	const itemByName = new Map(itemNames.map((g) => [(g.name_en ?? '').trim(), g]));
	for (const want of ITEM_NAMES) {
		const categoryId = catByEn.get(want.category)?.id ?? null;
		if (!categoryId) throw new Error(`category "${want.category}" missing (step 1)`);
		const existing = itemByName.get(want.name_en);
		if (!existing) {
			if (!apply) {
				log(`create   ${want.name_en}  [${want.tracking}${want.assets ? ' · asset' : ''}]  →  ${want.category}`);
				itemByName.set(want.name_en, { id: `(new) ${want.name_en}`, ...want, category: categoryId });
				continue;
			}
			const made = await api('/api/entities/mro_item_name', {
				method: 'POST',
				body: JSON.stringify({
					name_en: want.name_en,
					name_mm: want.name_mm,
					tracking: want.tracking,
					assets: want.assets,
					category: categoryId,
				}),
			});
			itemByName.set(want.name_en, { id: made.id, ...want, category: categoryId });
			created += 1;
			log(`create   ${want.name_en}  [${want.tracking}${want.assets ? ' · asset' : ''}]  →  ${want.category}`);
			continue;
		}
		const patch = {};
		if ((existing.tracking ?? '').trim() !== want.tracking) patch.tracking = want.tracking;
		if ((existing.name_mm ?? '').trim() !== want.name_mm) patch.name_mm = want.name_mm;
		if (Boolean(Number(existing.assets ?? 0)) !== want.assets) patch.assets = want.assets;
		if (relId(existing.category) !== categoryId) patch.category = categoryId;
		if (Object.keys(patch).length === 0) {
			log(`ok       ${want.name_en}  [${want.tracking}${want.assets ? ' · asset' : ''}]`);
			continue;
		}
		if (!apply) {
			log(`update   ${want.name_en}  ${JSON.stringify(patch)}`);
			continue;
		}
		await api(`/api/entities/mro_item_name/${existing.id}`, { method: 'PUT', body: JSON.stringify(patch) });
		Object.assign(existing, patch);
		updated += 1;
		log(`update   ${want.name_en}  ${JSON.stringify(patch)}`);
	}

	// ── 3. SKUs — created under their item name (which owns the policy) ──────
	title(`Step 3 — SKUs${apply ? '' : '  [dry-run]'}`);
	const existingModels = await listAll('mro_item_model', 'id,name_en,item_name');
	const modelKey = (itemId, nameEn) => `${itemId}::${nameEn}`;
	const modelByKey = new Map(existingModels.map((m) => [modelKey(relId(m.item_name), (m.name_en ?? '').trim()), m]));
	for (const want of MODELS) {
		const item = itemByName.get(want.item);
		if (!item) throw new Error(`item name "${want.item}" missing (step 3)`);
		const key = modelKey(item.id, want.name_en);
		if (modelByKey.has(key)) {
			log(`ok       ${want.item} · ${want.name_en}`);
			continue;
		}
		if (!apply) {
			log(`create   ${want.item} · ${want.name_en}`);
			modelByKey.set(key, { id: `(new) ${key}`, name_en: want.name_en });
			continue;
		}
		const made = await api('/api/entities/mro_item_model', {
			method: 'POST',
			body: JSON.stringify({
				name_en: want.name_en,
				name_mm: want.name_mm,
				item_name: item.id,
				...(want.expiry_alert_days != null ? { expiry_alert_days: want.expiry_alert_days } : {}),
				...(want.reference_tread_mm != null ? { reference_tread_mm: want.reference_tread_mm } : {}),
			}),
		});
		modelByKey.set(key, { id: made.id, name_en: want.name_en });
		created += 1;
		log(`create   ${want.item} · ${want.name_en}  ->  ${made.id}`);
	}

	// ── 4. Retire the masters that are not part of the catalog ───────────────
	title(`Step 4 — retire unused item names${apply ? '' : '  [dry-run]'}`);
	const liveModels = await listAll('mro_item_model', 'id,item_name');
	const countByItem = new Map();
	for (const m of liveModels) {
		const id = relId(m.item_name);
		if (id) countByItem.set(id, (countByItem.get(id) ?? 0) + 1);
	}
	for (const name of RETIRED_ITEM_NAMES) {
		const row = itemByName.get(name);
		if (!row) {
			log(`skip     ${name}  (already gone)`);
			continue;
		}
		const skus = countByItem.get(row.id) ?? 0;
		if (skus > 0) {
			log(`FAIL     ${name} still holds ${skus} SKU(s) — re-home or delete them first`);
			continue;
		}
		if (!apply) {
			log(`retire   ${name}  (soft-delete)`);
			continue;
		}
		await api(`/api/entities/mro_item_name/${row.id}`, { method: 'DELETE' });
		itemByName.delete(name);
		updated += 1;
		log(`retire   ${name}  (soft-delete)`);
	}

	title('Summary');
	log(`item names desired : ${ITEM_NAMES.length}${RETIRED_ITEM_NAMES.length ? ` + ${RETIRED_ITEM_NAMES.length} retired` : ''}`);
	log(`SKUs desired       : ${MODELS.length}`);
	log(`created            : ${created}`);
	log(`${apply ? 'updated' : 'to update'}          : ${updated}`);
	if (!apply) log('(dry-run — nothing written. Re-run with --apply to write.)');
	else log(`done — base ${baseUrl}`);
}

main().catch((err) => {
	console.error(`\nFAIL ${err.message}`);
	process.exit(1);
});
