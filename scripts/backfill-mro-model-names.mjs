#!/usr/bin/env node
/**
 * Backfill a blank `mro_item_model.name_mm` from its part group's Myanmar label —
 * the label pattern the catalogue already uses (`လေစစ်ဇကာ AF-4004`,
 * `ဘော့လ် M8 × 30`).
 *
 * Why: a row without `name_mm` is not wrong, but it renders a shorter card than
 * its neighbours (the app reserves the line, so the CARD is uniform — this makes
 * the DATA uniform too, so every row shows its Burmese name like the rest).
 *
 * Only the plainly-derivable rows are touched: the model's part group must have a
 * known MM prefix AND the row's `name_mm` must be blank. Anything else is
 * reported and left alone — the script never invents a translation.
 *
 * Usage:
 *   node scripts/backfill-mro-model-names.mjs [baseUrl] [token]            # dry run
 *   node scripts/backfill-mro-model-names.mjs [baseUrl] [token] --apply    # write
 *
 * Defaults: baseUrl http://localhost:8788 · token `dev-token` (IS_DEV local).
 */
import { listAllRows } from './lib/list-all-rows.mjs';

const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';
const apply = process.argv.includes('--apply');
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

/** Part group (EN) → the Burmese prefix its SKUs' labels use. */
const GROUP_MM_PREFIX = {
	'Air Filter': 'လေစစ်ဇကာ',
	Filter: 'လေစစ်ဇကာ',
	Bolt: 'ဘော့လ်',
	'Engine Oil': 'အင်ဂျင်ဆီ',
	'Gear Oil': 'ဂီယာဆီ',
	Tyre: 'တာယာ',
	'Tow Chain': 'ဆွဲကြိုးကွင်း',
};

async function api(path, init = {}) {
	const res = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
	const body = await res.json().catch(() => null);
	if (!res.ok && !body?.success) throw new Error(`${init.method ?? 'GET'} ${path} → HTTP ${res.status}: ${body?.error ?? ''}`);
	return body?.data;
}

const relName = (value) => (value && typeof value === 'object' ? (value.name_en ?? null) : null);

async function main() {
	console.log(`\nBackfill mro_item_model.name_mm → ${baseUrl}${apply ? '' : '  [DRY-RUN]'}\n`);
	const models = await listAllRows(baseUrl, token, 'mro_item_model', 'id,name_en,name_mm,item_name.name_en');
	const blank = models.filter((row) => !String(row.name_mm ?? '').trim());
	console.log(`SKUs: ${models.length} · blank name_mm: ${blank.length}`);

	let filled = 0;
	const skipped = [];
	for (const row of blank) {
		const group = relName(row.item_name);
		const prefix = group ? GROUP_MM_PREFIX[group] : null;
		const model = String(row.name_en ?? '').trim();
		if (!prefix || !model) {
			skipped.push(`${model || row.id} (group: ${group ?? '—'})`);
			continue;
		}
		const nameMm = `${prefix} ${model}`;
		if (!apply) {
			console.log(`fill  ${model.padEnd(14)} → "${nameMm}"`);
			filled += 1;
			continue;
		}
		await api(`/api/entities/mro_item_model/${row.id}`, { method: 'PUT', body: JSON.stringify({ name_mm: nameMm }) });
		console.log(`fill  ${model.padEnd(14)} → "${nameMm}"`);
		filled += 1;
	}
	if (skipped.length > 0) console.log(`\nskipped (no derivable label): ${skipped.join(', ')}`);
	console.log(`\n${apply ? 'Backfilled' : 'Would backfill'}: ${filled}`);
	console.log(apply ? 'Done.\n' : 'Dry-run — re-run with --apply.\n');
}

main().catch((err) => {
	console.error(`\nBACKFILL FAILED: ${err.message}\n`);
	process.exit(1);
});
