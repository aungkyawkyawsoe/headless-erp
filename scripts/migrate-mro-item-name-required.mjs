#!/usr/bin/env node
/**
 * Make `mro_item_name.name_en` NOT NULL — the master's identity is REQUIRED.
 *
 *   node scripts/migrate-mro-item-name-required.mjs [baseUrl] [token]          # dry run
 *   node scripts/migrate-mro-item-name-required.mjs [baseUrl] [token] --apply  # write
 *
 * Defaults: baseUrl http://localhost:8788 · token `dev-token` (IS_DEV local).
 *
 * WHY a one-off: `schema-defs.json` declares the field REQUIRED — matching the
 * masters-hub form's mandatory name input, the SKU picker's quick-add, and the
 * test mirror in `apps/api/test/mro-inventory.spec.ts` — but the apply script's
 * field sync (step 0c) only ADDs; it never rewrites an existing field. A FRESH
 * environment therefore creates the column NOT NULL from step 0b outright, and
 * this script is a no-op there; an instance that created it while nullable needs
 * this one write.
 *
 * PRECONDITION (checked here, fails loudly): no `mro_item_name` row — INCLUDING
 * soft-deleted ones, because the engine rebuilds the table CREATE→COPY→DROP→RENAME
 * — may hold a NULL/empty name_en, or the NOT NULL rebuild fails. Purge or backfill
 * them first (purge is a hard delete, admin only):
 *
 *   curl -s "$API/api/entities/mro_item_name?trashed=true&filter[name_en][_null]=true" -H "Authorization: Bearer $TOKEN"
 *   curl -s -X DELETE "$API/api/entities/mro_item_name/<id>/force" -H "Authorization: Bearer $TOKEN"
 *
 * Idempotent: already required → reports current state and writes nothing.
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

const log = (...a) => console.log(...a);
const title = (s) => log(`\n── ${s} ─${'─'.repeat(Math.max(0, 64 - s.length))}`);

const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
async function api(path, init = {}) {
	const res = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
	const body = await res.json().catch(() => null);
	if (!res.ok && !body?.success)
		throw new Error(`${init.method ?? 'GET'} ${path} → HTTP ${res.status}: ${body?.error ?? JSON.stringify(body)}`);
	return body.data;
}

const def = (defs.baseCollections ?? []).find((c) => c.slug === 'mro_item_name');
if (!def) throw new Error('schema-defs.json has no mro_item_name definition');
if ((def.fields ?? []).find((f) => f.name === 'name_en')?.required !== true) {
	throw new Error('schema-defs.json does not declare mro_item_name.name_en required — nothing to apply');
}

title(`Precondition — no NULL/empty name_en${apply ? '' : '  [dry-run]'}`);
const rows = await listAllRows(baseUrl, token, 'mro_item_name', 'id,name_en,deleted_at', 100, { trashed: 'true' });
const offenders = rows.filter((r) => !String(r.name_en ?? '').trim());
log(`rows (incl. trashed) : ${rows.length}`);
log(`NULL/empty name_en   : ${offenders.length}`);
if (offenders.length) {
	for (const r of offenders) log(`  ${r.id}  deleted_at=${r.deleted_at ?? '—'}`);
	throw new Error('backfill or purge every row above (see this script’s header), then re-run');
}

title(`mro_item_name.name_en → required${apply ? '' : '  [dry-run]'}`);
const collection = await api('/api/collections/mro_item_name');
const live = collection.schema_json?.fields ?? [];
const before = live.find((f) => f?.name === 'name_en');
log(`live fields : ${live.map((f) => f?.name).join(', ')}`);
log(`name_en     : required=${before?.required === true ? 'true' : 'false'}`);

if (before?.required === true) {
	log('already required — nothing to write');
	title('Summary');
	log(`done — ${baseUrl} (no change)`);
	process.exit(0);
}

const { merged } = mergeFields(live, def);
if (apply) {
	await api('/api/collections/mro_item_name', { method: 'PUT', body: JSON.stringify({ fields: merged }) });
	const after = (await api('/api/collections/mro_item_name')).schema_json?.fields?.find((f) => f?.name === 'name_en');
	if (after?.required !== true) throw new Error('name_en is still nullable after the PUT — aborting');
	log('applied : PUT /api/collections/mro_item_name (name_en required)');
} else {
	log('would apply : PUT /api/collections/mro_item_name (name_en required)');
}

title('Summary');
log(`name_en required : ${apply ? 'true' : 'false (dry-run)'}`);
if (!apply) log('(dry-run — nothing written. Re-run with --apply to write.)');
else log(`done — ${baseUrl}`);
