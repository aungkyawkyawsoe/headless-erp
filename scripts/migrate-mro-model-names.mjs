#!/usr/bin/env node
/**
 * Bilingual name migration for the MRO SKU catalog (`mro_item_model`).
 *
 *   node scripts/migrate-mro-model-names.mjs [baseUrl] [token]          # dry run
 *   node scripts/migrate-mro-model-names.mjs [baseUrl] [token] --apply  # write
 *
 * Defaults: baseUrl http://localhost:8788 · token `dev-token` (IS_DEV local).
 * Prereq: `node scripts/apply-mro-schema.mjs` has run — its step 0c ADDs the
 * declared `name_en` (indexed) + `name_mm` pair to the live table (it can only
 * ADD fields, never DROP).
 *
 * WHY a one-off script: the schema now owns the bilingual pair as the ONLY name
 * columns. `apply-mro-schema.mjs` can add them but can never DROP the retired
 * free-text `name` (the composed label) or `model` (spec/size: H4, 11R22.5,
 * 10W-40) — that DDL, plus the per-row backfill, lives here.
 *
 * Steps (ordered so the source column survives long enough to read; idempotent —
 * re-running writes nothing the second time):
 *   1. Backfill — every row gets `name_en` (from `name` while it still exists,
 *      else its own `name_en`) and `name_mm` from the shared BEST-EFFORT map in
 *      `scripts/mro-model-names.mjs` (a name absent from the map leaves `name_mm`
 *      null; edit it in the Studio afterwards). Must run BEFORE the drop.
 *   2. Field list — merge the `mro_item_model` definition from `schema-defs.json`
 *      into the LIVE field list (which includes the system columns) and PUT it:
 *      this DROPs the retired `name` and `model`. Reads/writes stay on the
 *      validated engine API — never raw SQL — so the schema cache is invalidated
 *      server-side.
 *
 * `model` is not folded into the new names: it was null on nearly every row and
 * carried junk elsewhere, so the English display name was already `name`.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { NAME_MM } from './mro-model-names.mjs';
import { listAllRows } from './lib/list-all-rows.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const baseUrl = (args[0] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = args[1] ?? 'dev-token';
const apply = process.argv.includes('--apply');

const __dirname = dirname(fileURLToPath(import.meta.url));
const defs = JSON.parse(await readFile(join(__dirname, '..', 'apps', 'api', 'src', 'domain-modules', 'mro', 'schema-defs.json'), 'utf8'));
const def = (defs.baseCollections ?? []).find((c) => c.slug === 'mro_item_model');
if (!def) throw new Error('schema-defs.json has no mro_item_model definition');

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

/** Every row of a collection (real `limit` + cursor pagination). */
const listAll = (slug, fields) => listAllRows(baseUrl, token, slug, fields);

/** Read the live field list of mro_item_model (PUT replaces it wholesale). */
async function readLiveFields() {
	const collection = await api('/api/collections/mro_item_model').catch(() => null);
	if (!collection) throw new Error('mro_item_model not found — run node scripts/apply-mro-schema.mjs first');
	return collection.schema_json?.fields ?? [];
}

async function main() {
	let liveFields = await readLiveFields();
	let live = new Set(liveFields.map((f) => f?.name).filter(Boolean));
	if (!live.has('name_en')) throw new Error('name_en missing — run node scripts/apply-mro-schema.mjs first (step 0c adds it)');

	// ── 1. Backfill names (before `name` is dropped) ─────────────────────────
	title(`Step 1 — backfill name_en (indexed) + name_mm (Burmese)${apply ? '' : '  [dry-run]'}`);
	// `name` still exists on the first run; on a re-run it is already gone.
	const readFields = ['id', 'name_en', 'name_mm', ...(live.has('name') ? ['name'] : [])].join(',');
	const rows = await listAll('mro_item_model', readFields);
	let touched = 0;
	let unmapped = 0;
	for (const row of rows) {
		// English is authoritative from `name_en`; fall back to the legacy `name`
		// only while it is still around (first run over a pre-migration table).
		const source = String(row.name_en ?? '').trim() || String(row.name ?? '').trim();
		const wantEn = source || null;
		const wantMm = NAME_MM[source] ?? (row.name_mm ?? null);
		if (!wantMm) unmapped += 1;
		const sameEn = (row.name_en ?? null) === wantEn;
		const sameMm = (row.name_mm ?? null) === wantMm;
		if (sameEn && sameMm) continue;
		touched += 1;
		if (apply) {
			await api(`/api/entities/mro_item_model/${row.id}`, {
				method: 'PUT',
				body: JSON.stringify({ name_en: wantEn, name_mm: wantMm }),
			});
		}
		log(`  ${apply ? 'set' : 'would set'}  ${source || '(unnamed)'}  →  name_mm: ${wantMm ?? '—'}`);
	}

	// ── 2. Field list — drop the retired `name` + `model` ────────────────────
	title(`Step 2 — mro_item_model fields${apply ? '' : '  [dry-run]'}`);
	liveFields = await readLiveFields();
	live = new Set(liveFields.map((f) => f?.name).filter(Boolean));
	const added = (def.fields ?? []).filter((f) => !live.has(f.name));
	const retired = ['name', 'model'].filter((n) => live.has(n));
	// The PUT body must carry the WHOLE field list — the engine diffs it, so a list
	// missing the system fields would try to DROP `id` (and be rolled back). Merge:
	// live fields minus the retired columns, plus every declared field we lack.
	const merged = [...liveFields.filter((f) => !retired.includes(f?.name)), ...added];
	log(`live fields : ${[...live].join(', ')}`);
	log(`added       : ${added.length ? added.map((f) => f.name).join(', ') : '— (already present)'}`);
	log(`dropped     : ${retired.length ? retired.join(', ') : '— (already gone)'}`);

	if (apply && (added.length || retired.length)) {
		await api('/api/collections/mro_item_model', { method: 'PUT', body: JSON.stringify({ fields: merged }) });
		log('applied     : PUT /api/collections/mro_item_model');
	}

	title('Summary');
	log(`rows            : ${rows.length}`);
	log(`${apply ? 'updated' : 'to update'}         : ${touched}`);
	log(`name_mm missing : ${unmapped}  (add them to scripts/mro-model-names.mjs, then re-run)`);
	if (!apply) log('(dry-run — nothing written. Re-run with --apply to write.)');
	else log(`done — base ${baseUrl}`);
}

main().catch((err) => {
	console.error(`\nFAIL ${err.message}`);
	process.exit(1);
});
