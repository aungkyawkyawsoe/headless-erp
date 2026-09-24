#!/usr/bin/env node
/**
 * Make `mro_item_name.tracking` NOT NULL — the tracking policy is never absent.
 *
 *   node scripts/migrate-mro-item-name-tracking-required.mjs [baseUrl] [token]          # dry run
 *   node scripts/migrate-mro-item-name-tracking-required.mjs [baseUrl] [token] --apply  # write
 *
 * Defaults: baseUrl http://localhost:8788 · token `dev-token` (IS_DEV local).
 *
 * WHY a one-off: `schema-defs.json` declares `tracking` REQUIRED (with
 * `"default": "standard"`) — matching the "the policy is set once on the name,
 * never absent" rule — but the apply script's field sync (step 0c) only ADDs; it
 * never rewrites an existing field's constraints. A FRESH environment therefore
 * creates the column `TEXT NOT NULL DEFAULT 'standard'` from step 0b outright and
 * this script is a no-op there; an instance that created it while nullable needs
 * this one write.
 *
 * The `default` is what keeps the wire contract UNCHANGED: the engine treats a
 * field with a default as NOT required from the client (collection-mutation
 * `required` check skips `field.default !== undefined`), so `tracking` stays
 * optional in a create body while the column becomes NOT NULL. A name can never
 * be saved with NO policy — it is `standard` unless deliberately reclassified.
 *
 * PRECONDITION (checked here, fails loudly): no `mro_item_name` row — INCLUDING
 * soft-deleted ones, because the engine rebuilds NOT NULL via
 * CREATE→COPY→DROP→RENAME — may hold a NULL/empty `tracking`, or the rebuild
 * fails. Purge or backfill them first (purge is a hard delete, admin only):
 *
 *   curl -s "$API/api/entities/mro_item_name?trashed=true" -H "Authorization: Bearer $TOKEN"
 *   curl -s -X DELETE "$API/api/entities/mro_item_name/<id>/force" -H "Authorization: Bearer $TOKEN"
 *
 * SCOPE GUARD: PUT /api/collections/:slug replaces the WHOLE field list, and the
 * merge refreshes every declared field from the def. Before writing, this script
 * verifies the ONLY field that changes is `tracking` — any other live↔declared
 * drift aborts loudly instead of being silently applied. That keeps this a
 * single-purpose migration, not a back door for schema changes.
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

/** Key-order-independent serialization — compares shape + values, not JSON ordering. */
function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

const def = (defs.baseCollections ?? []).find((c) => c.slug === 'mro_item_name');
if (!def) throw new Error('schema-defs.json has no mro_item_name definition');
const declaredTracking = (def.fields ?? []).find((f) => f.name === 'tracking');
if (declaredTracking?.required !== true) {
	throw new Error('schema-defs.json does not declare mro_item_name.tracking required — nothing to apply');
}
if (declaredTracking?.default === undefined) {
	// Without a default the column would be NOT NULL with an empty-string
	// fallback, AND the client would suddenly have to send it — a wire break.
	throw new Error('mro_item_name.tracking must declare a default (standard) to keep it optional on the wire');
}

// ── Precondition — every row (live + trashed) already carries a policy ────────
title(`Precondition — no NULL/empty tracking${apply ? '' : '  [dry-run]'}`);
const liveRows = await listAllRows(baseUrl, token, 'mro_item_name', 'id,name_en,tracking,deleted_at', 100);
const trashedRows = await listAllRows(baseUrl, token, 'mro_item_name', 'id,name_en,tracking,deleted_at', 100, {
	trashed: 'true',
});
const rows = [...liveRows, ...trashedRows];
const offenders = rows.filter((r) => !String(r.tracking ?? '').trim());
log(`rows (live)          : ${liveRows.length}`);
log(`rows (trashed)       : ${trashedRows.length}`);
log(`NULL/empty tracking  : ${offenders.length}`);
if (offenders.length) {
	for (const r of offenders) log(`  ${r.id}  ${r.deleted_at ? 'TRASHED' : 'live'}  ${r.name_en ?? '(unnamed)'}`);
	throw new Error('backfill or purge every row above (see this script’s header), then re-run');
}

// ── Field list — merge the def, then prove ONLY `tracking` changed ────────────
title(`Scope guard — only tracking may change${apply ? '' : '  [dry-run]'}`);
const collection = await api('/api/collections/mro_item_name');
const live = collection.schema_json?.fields ?? [];
const before = live.find((f) => f?.name === 'tracking');
log(`live fields : ${live.map((f) => f?.name).join(', ')}`);
log(`tracking    : required=${before?.required === true ? 'true' : 'false'}`);
if (before?.required === true) {
	log('already required — nothing to write');
	title('Summary');
	log(`done — ${baseUrl} (no change)`);
	process.exit(0);
}

const { merged, added, dropped } = mergeFields(live, def);
if (added.length || dropped.length) {
	throw new Error(
		`field set drift — merge would add [${added.join(', ')}] / drop [${dropped.join(', ')}]; ` +
			'run node scripts/apply-mro-schema.mjs first so this migration stays single-purpose',
	);
}
const renamedOrChanged = live
	.filter((f) => f?.name !== 'tracking')
	.filter((f) => {
		const after = merged.find((m) => m?.name === f?.name);
		return canonical(f) !== canonical(after);
	})
	.map((f) => f?.name);
if (renamedOrChanged.length) {
	throw new Error(
		`live↔declared drift outside tracking: ${renamedOrChanged.join(', ')} — ` +
			'reconcile those fields first (apply-mro-schema.mjs), then re-run',
	);
}
log('scope       : only `tracking` differs ✔');

title(`mro_item_name.tracking → required${apply ? '' : '  [dry-run]'}`);
if (apply) {
	await api('/api/collections/mro_item_name', { method: 'PUT', body: JSON.stringify({ fields: merged }) });
	const after = (await api('/api/collections/mro_item_name')).schema_json?.fields?.find((f) => f?.name === 'tracking');
	if (after?.required !== true) throw new Error('tracking is still nullable after the PUT — aborting');
	log('applied : PUT /api/collections/mro_item_name (tracking required)');
} else {
	log('would apply : PUT /api/collections/mro_item_name (tracking required)');
}

title('Summary');
log(`tracking required : ${apply ? 'true' : 'false (dry-run)'}`);
if (!apply) log('(dry-run — nothing written. Re-run with --apply to write.)');
else log(`done — ${baseUrl}`);
