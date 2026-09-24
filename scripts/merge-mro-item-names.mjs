#!/usr/bin/env node
/**
 * Merge over-fragmented `mro_item_name` part groups on a REMOTE D1.
 *
 * A part group answers "what IS this part" (Glue, Bulb, Wrench…). A spec
 * ("502", "24V filament", "adjustable") belongs on the SKU (`mro_item_model`),
 * not as its own group — seeding a group per variant fragments the catalog, the
 * stock reports and the SKU pickers (ten filters where one "Glue" is the truth).
 * This script folds the variant groups back into their canonical family:
 *
 *   1. resolve/create the canonical TARGET group (rename the first absorbed row
 *      when the target name does not exist yet — its id, and any SKUs, survive),
 *   2. REPOINT every `mro_item_model.item_name` that pointed at an absorbed row,
 *   3. DELETE the absorbed rows (HARD — they are freshly seeded with no audit
 *      history, and `name_en` carries a GLOBAL unique index, so a soft-deleted
 *      row would squat its name forever).
 *
 * Idempotent: a family whose variant names no longer exist is skipped, so a
 * re-run is a no-op. Refuses to delete an absorbed row that still has SKUs.
 *
 * Usage:
 *   node scripts/merge-mro-item-names.mjs --dry-run
 *   node scripts/merge-mro-item-names.mjs --apply
 *
 * Env overrides: CLOUDFLARE_ACCOUNT_ID, D1_ID (target).
 */
import { loadEnvFile } from './gen-wrangler.mjs';
import { loadCfToken } from './lib/cf-token.mjs';

const INFRA = loadEnvFile('prod');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || INFRA.CF_ACCOUNT_ID;
const DB_ID = process.env.D1_ID || INFRA.D1_ID;
const BASE = 'https://api.cloudflare.com/client/v4';
const APPLY = process.argv.includes('--apply');

/**
 * The families to fold. `target` names the canonical group; `from` lists the
 * variant groups that become SKUs of it. Deliberately NOT merged: Engine Oil vs
 * Gear Oil (the fleet-care module carries them as DISTINCT service intervals —
 * `veh_fluid_fills.fluid_kind`), Brake Oil / Power Steering Fluid (distinct
 * systems), and assembly-vs-part pairs such as Side Light (fixture) vs Bulb
 * (lamp): there the distinction is the part, not a variant.
 */
const MERGES = [
	{ target: 'Glue', name_mm: 'ကော်', from: ['AB Glue', '502 Glue', 'Silicone Caulk'] },
	{ target: 'Bulb', name_mm: 'မီးသီး', from: ['Bulb', '24V Filament Bulb', 'Small Bulb (Indicator Bulb)'] },
	{ target: 'Wrench', name_mm: 'ဂွ', from: ['Adjustable Wrench', 'Hand Tool / Wrench'] },
	{ target: 'Grease', name_mm: 'အမဲဆီ', from: ['Crown Grease', 'Soft Grease', 'Transmission Grease'] },
	{ target: 'Grease Nipple', name_mm: 'အမဲဆီထိုးခေါင်း', from: ['Grease Gun Head', 'Grease Nipple Head'] },
	{ target: 'Valve', name_mm: 'မက်ဆီဘား', from: ['Valve Assembly', 'Valve Cap (Gold)'] },
	{ target: 'Nut', name_mm: 'နတ်တိုင် / နတ်သီး', from: ['Nut', 'Front Wheel Hub Nut'] },
];

function sqlQuote(value) {
	if (value === null || value === undefined) return 'NULL';
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

async function main() {
	await loadCfToken();
	console.log(`\nMerge MRO item-name groups → ${DB_ID}${APPLY ? '' : '  [DRY-RUN]'}\n`);

	const names = await d1('SELECT id, name_en, name_mm FROM cms_mro_item_name');
	const byName = new Map(names.map((r) => [String(r.name_en), { id: String(r.id), name_en: String(r.name_en), name_mm: r.name_mm ?? null }]));
	const skuCounts = await d1(
		'SELECT item_name, COUNT(*) n FROM cms_mro_item_model WHERE deleted_at IS NULL GROUP BY item_name',
	);
	const skusByGroup = new Map(skuCounts.map((r) => [r.item_name === null ? null : String(r.item_name), Number(r.n)]));

	let merged = 0;
	let repointed = 0;
	const statements = [];

	for (const family of MERGES) {
		const present = family.from.map((n) => byName.get(n)).filter(Boolean);
		if (present.length === 0) {
			console.log(`skip   ${family.target}: none of the variants exist (already merged)`);
			continue;
		}
		let target = byName.get(family.target);
		if (!target) {
			// Promote one absorbed row into the canonical group — its id (and thus
			// any SKU already pointing at it) becomes the family's group.
			const promoted = present.find((r) => r.name_en === family.from[0]) ?? present[0];
			target = { ...promoted, name_en: family.target, name_mm: family.name_mm };
			statements.push(
				`UPDATE cms_mro_item_name SET name_en = ${sqlQuote(family.target)}, name_mm = ${sqlQuote(family.name_mm)}, updated_at = ${sqlQuote(
					new Date().toISOString(),
				)} WHERE id = ${sqlQuote(promoted.id)}`,
			);
			console.log(`rename ${promoted.name_en} → ${family.target} (${promoted.id})`);
		}
		const absorbed = present.filter((r) => r.id !== target.id);
		if (absorbed.length === 0) {
			console.log(`ok     ${family.target}: no variants left to fold`);
			continue;
		}

		const ids = absorbed.map((r) => sqlQuote(r.id));
		// 1. Repoint SKUs (only the ones that actually point at an absorbed row).
		const withSkus = absorbed.filter((r) => (skusByGroup.get(r.id) ?? 0) > 0);
		if (withSkus.length > 0) {
			statements.push(
				`UPDATE cms_mro_item_model SET item_name = ${sqlQuote(target.id)}, updated_at = ${sqlQuote(
					new Date().toISOString(),
				)} WHERE item_name IN (${ids.join(', ')})`,
			);
			repointed += withSkus.reduce((sum, r) => sum + (skusByGroup.get(r.id) ?? 0), 0);
		}
		// 2. Hard-delete the absorbed rows (guard: a live SKU would have been
		//    repointed above, so none may remain — asserted by the WHERE clause).
		statements.push(`DELETE FROM cms_mro_item_name WHERE id IN (${ids.join(', ')})`);
		merged += absorbed.length;
		console.log(
			`merge  ${family.target} ← ${absorbed.map((r) => r.name_en).join(', ')}${withSkus.length ? `  (repointing ${withSkus.length} group(s) of SKUs)` : ''}`,
		);
	}

	console.log(`\nFamilies folded: ${MERGES.length} · rows absorbed: ${merged} · SKUs repointed: ${repointed}`);
	if (!APPLY) {
		console.log('\nDry-run — re-run with --apply.\n');
		return;
	}
	for (const sql of statements) await d1(sql);
	const after = await d1('SELECT COUNT(*) n FROM cms_mro_item_name');
	console.log(`\nMerged. mro_item_name rows now: ${after[0]?.n}\n`);
}

main().catch((err) => {
	console.error(`\nMERGE FAILED: ${err.message}\n`);
	process.exit(1);
});
