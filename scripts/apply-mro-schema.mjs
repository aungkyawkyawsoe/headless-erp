#!/usr/bin/env node
/**
 * Apply the MRO schema (v1, development) through the VALIDATED engine API.
 *
 *   node scripts/apply-mro-schema.mjs [baseUrl] [bearerToken]
 *
 * Defaults: baseUrl http://localhost:8788 · token `dev-token` (IS_DEV local).
 * For production point it at the deployed API with a real admin JWT:
 *   node scripts/apply-mro-schema.mjs https://<your-worker> <admin-token>
 *
 * Idempotent — safe to run twice:
 *   0. `removeCollections` — dead/legacy collections (the misspelled empty
 *      `mro_requesations`) dropped ONLY when empty; else FAIL loudly.
 *   0b. `baseCollections` — catalog masters + stock-trace collections
 *      (`mro_suppliers`, `mro_item_name`, `mro_item_model`,
 *      `mro_inventory`, `mro_stock_lots`, `mro_stock_serials`,
 *      `mro_outbound_lots`, `mro_outbound_serials`) created when missing, so
 *      a FRESH environment bootstraps in one run.
 *   0c. `baseCollections` field sync — base collections that ALREADY exist
 *      get any newly declared fields via PUT /api/collections/:slug
 *      (diff by name), AND each existing field's declared `required` /
 *      `unique` / `options` / `display_template` is reconciled (a nullability
 *      change rebuilds the table, an in-place CREATE UNIQUE INDEX handles
 *      uniqueness), so a master's identity key + nullability stay single-sourced
 *      here. The catalog masters (`mro_item_name`)
 *      are listed before `mro_item_model` in `baseCollections`, so they are
 *      created before the m2o fields that point at them; synced fields are
 *      nullable (`required:false`) so a populated live table migrates safely
 *      and rows are backfilled per item afterwards. This step only ADDs
 *      columns — a field REMOVED from `schema-defs.json` (e.g. the retired
 *      `mro_item_model.name`/`model`) is dropped + its rows backfilled by the
 *      paired one-off script `scripts/migrate-mro-model-names.mjs`.
 *   1. `recreateCollections` — multi-line movement headers (`mro_inbounds` /
 *      `mro_outbounds`). Legacy single-line headers carried one-model-per-doc
 *      columns (`item_model`, `qty`, `total_price`, …) that multi-line
 *      documents no longer use. When a header exists WITHOUT the `lines`
 *      child-table field it is dropped + recreated fresh — but only while its
 *      table is EMPTY; if it holds rows the script FAILS loudly (you must
 *      migrate the data first). Headers that already carry `lines` are left
 *      untouched.
 *   2. `newCollections` + `moreCollections` — movement line collections and
 *      the transfer/stocktake/requisition collections
 *      (`mro_requisitions`/`mro_requisition_lines`) are created when missing;
 *      headers that should number their documents but were created WITHOUT a
 *      `naming_series` are rebuilt while empty (fail loudly when they hold
 *      rows).
 *
 * Never touches raw SQL: DDL + schema-cache invalidation stay server-side.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defsPath = join(__dirname, '..', 'apps', 'api', 'src', 'domain-modules', 'mro', 'schema-defs.json');
const defs = JSON.parse(await readFile(defsPath, 'utf8'));
// Merge the two "create when missing" lists — movement lines (`newCollections`)
// plus transfer/stocktake/requisition (`moreCollections`) — into one pass.
const defsCollections = [...(defs.newCollections ?? []), ...(defs.moreCollections ?? [])];

const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

/** Find a collection def by slug across every defs list (headers live in recreate/more). */
function defBySlug(slug) {
	for (const list of [defs.baseCollections, defs.recreateCollections, defs.newCollections, defs.moreCollections] ?? []) {
		const hit = (list ?? []).find((c) => c.slug === slug);
		if (hit) return hit;
	}
	return undefined;
}

/** Movement headers, their LINES + veh care tables get newly-declared columns
 *  via PUT-merge when populated (the line collections live in
 *  `newCollections`, which step 0c never field-syncs — a line can gain a column
 *  long after it was created). `defs.removeFields[slug]` also RETIRES a field
 *  here (dropped from the merged list ⇒ the migrator drops the physical column),
 *  so a line collection's retirement is single-sourced too. */
const syncFieldCollections = [
	'mro_inbounds',
	'mro_inbound_lines',
	'mro_outbounds',
	'mro_transfers',
	'mro_adjustments',
	'mro_requisitions',
	'mro_serial_events',
	// Create-if-missing collections whose declarations are NOT frozen at creation:
	// a field added to schema-defs.json after the table already EXISTS must still
	// reach it, or the service writes a column the database does not have (the
	// failing shape: a read naming the missing column 500s, and EVERY decide route
	// on the table 500s with it).
	'mro_asset_requests',
	'mro_inbound_payments',
	'veh_fluid_fills',
	'veh_permits',
	'veh_incidents',
	'veh_issue_types',
	'veh_maintenance_logs',
];

async function api(path, init) {
	const res = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
	const body = await res.json().catch(() => null);
	return { status: res.status, body };
}

/** Option token → real options array, so schema-defs.json stays machine-readable. */
const OPTION_TOKENS = {
	LOCATION_OPTIONS: defs.locationOptions,
	REQUISITION_STATUS_OPTIONS: defs.requisitionStatusOptions,
	CLOSE_REASON_OPTIONS: defs.closeReasonOptions,
};

/** Replace option placeholder tokens embedded in a field list with real options arrays. */
function materialize(fields) {
	return fields.map((f) => (typeof f.options === 'string' && OPTION_TOKENS[f.options] ? { ...f, options: OPTION_TOKENS[f.options] } : f));
}

const log = [];

/** True when a declared field's post-DDL METADATA differs from the stored one —
 *  the `required` flag (nullability — the migrator REBUILDS the table for it),
 *  the `unique` flag (an in-place CREATE UNIQUE INDEX), a select's `options`
 *  (a schema_json-only update, no DDL), a relation's `display_template` (also
 *  schema_json-only — heals a stale template like `{{name}}` left pointing at a
 *  renamed column), or a COMPUTED field's shape
 *  (type/formula/store/result_type/precision/rounding). The last promotes a plain
 *  column to a stored formula from schema-defs.json alone — e.g. total_cost
 *  (number) → formula parts_cost + labor_cost — which the add-only field put and
 *  the unique/options reconcile would otherwise leave as a plain number. Lets the
 *  defs file stay the sole source of a field's identity + choices.
 *
 *  `required` follows the engine's rule: ONLY an explicit `false` means nullable,
 *  anything else (true/absent) means NOT NULL — so a swap in either direction is
 *  detected from the declaration alone (e.g. `mro_inbounds.supplier` becoming
 *  optional, which is what lets a supplier-less return/opening doc through). */
function metaDiffers(stored, declared) {
	if (!declared) return false;
	if (Boolean(declared.required !== false) !== Boolean(stored.required !== false)) return true;
	if (typeof declared.unique === 'boolean' && Boolean(declared.unique) !== Boolean(stored.unique)) return true;
	if (Array.isArray(declared.options) && JSON.stringify(declared.options) !== JSON.stringify(stored.options ?? [])) return true;
	if (
		['m2o', 'm2m', 'o2m'].includes(declared.type) &&
		typeof declared.display_template === 'string' &&
		declared.display_template !== stored.display_template
	)
		return true;
	if (declared.type === 'formula') {
		for (const key of ['type', 'formula', 'store', 'result_type', 'precision', 'rounding']) {
			if (JSON.stringify(declared[key] ?? null) !== JSON.stringify(stored[key] ?? null)) return true;
		}
	}
	return false;
}

/** Apply the declared metadata onto a stored field, preserving the live column's other keys. */
function metaMerge(stored, declared) {
	if (!declared) return stored;
	const next = { ...stored };
	// Nullability — the ONLY engine-meaningful value is explicit `false` (nullable);
	// a required field is declared `required: true` so the stored JSON matches it.
	next.required = declared.required !== false;
	if (typeof declared.unique === 'boolean') next.unique = declared.unique;
	if (Array.isArray(declared.options)) next.options = declared.options;
	if (['m2o', 'm2m', 'o2m'].includes(declared.type) && typeof declared.display_template === 'string')
		next.display_template = declared.display_template;
	if (declared.type === 'formula') {
		for (const key of ['type', 'formula', 'store', 'result_type', 'precision', 'rounding']) {
			if (declared[key] !== undefined) next[key] = declared[key];
			else delete next[key];
		}
		// A stored formula is engine-owned + always nullable — drop any stale
		// `required` carried from the plain column it replaced.
		delete next.required;
	}
	return next;
}

/** True when the collection already carries the `lines` child-table field (multi-line header). */
function hasLinesField(schemaJson) {
	return Array.isArray(schemaJson?.fields) && schemaJson.fields.some((f) => f.type === 'table' && f.name === 'lines');
}

// ── 0. Remove dead/legacy collections (empty only — else FAIL loudly) ────
for (const slug of defs.removeCollections ?? []) {
	const existing = await api(`/api/collections/${slug}`, { method: 'GET' });
	if (existing.status === 404) {
		log.push(`skip  remove ${slug} (already gone)`);
		continue;
	}
	if (existing.status !== 200) {
		log.push(`FAIL  remove ${slug}: HTTP ${existing.status}`);
		continue;
	}
	const list = await api(`/api/entities/${slug}?per_page=1`, { method: 'GET' });
	const total = Number(list.body?.data?.total ?? list.body?.data?.items?.length ?? 0);
	if (total > 0) {
		log.push(`FAIL  remove ${slug}: table has ${total} row(s) — migrate data first, then re-run`);
		continue;
	}
	const removed = await api(`/api/collections/${slug}`, { method: 'DELETE' });
	log.push(removed.status === 200 ? `remove ${slug} (empty legacy collection)` : `FAIL  remove ${slug}: HTTP ${removed.status}`);
}

// ── 0b. Base collections — catalog + stock trace, created when missing ───────
for (const collection of defs.baseCollections ?? []) {
	const existing = await api(`/api/collections/${collection.slug}`, { method: 'GET' });
	if (existing.status === 200) {
		log.push(`skip  base ${collection.slug} (already exists)`);
		continue;
	}
	const created = await api('/api/collections', {
		method: 'POST',
		body: JSON.stringify({
			name: collection.name,
			slug: collection.slug,
			description: collection.description ?? null,
			fields: materialize(collection.fields),
			naming_series: collection.naming_series ?? undefined,
			...(collection.policies ? { policies: collection.policies } : {}),
		}),
	});
	log.push(
		created.status === 201 ? `create ${collection.slug} (${collection.name})` : `FAIL  create ${collection.slug}: HTTP ${created.status}`,
	);
}

// ── 0c. Base collections — sync newly declared fields onto existing ones ──
// Also reconciles each declared field's `unique` flag: adding uniqueness to an
// existing column is an IN-PLACE `CREATE UNIQUE INDEX` (the migrator never
// rebuilds for a unique add), so a master's identity key stays single-sourced in
// schema-defs.json instead of drifting from the live table. If the table already
// holds duplicates the engine's batch fails and schema_json is left untouched.
// `defs.removeFields[slug]` RETIRES fields: they are dropped from the merged list
// (the migrator then drops the physical column), so the declaration set — not the
// live table — stays the single source of truth.
for (const collection of defs.baseCollections ?? []) {
	const existing = await api(`/api/collections/${collection.slug}`, { method: 'GET' });
	if (existing.status !== 200) continue; // created (or failed) in 0b — nothing to sync
	const sj = existing.body?.data?.schema_json ?? { fields: [] };
	const retire = new Set(defs.removeFields?.[collection.slug] ?? []);
	const current = (sj.fields ?? []).filter((f) => !retire.has(f?.name));
	const retired = (sj.fields ?? []).filter((f) => retire.has(f?.name));
	const have = new Set(current.map((f) => f?.name).filter(Boolean));
	const declared = materialize(collection.fields ?? []);
	const missing = declared.filter((f) => !have.has(f.name));
	// Existing fields whose declared `unique` boolean differs from the stored one.
	const declaredByName = new Map(declared.map((f) => [f.name, f]));
	const changed = current.filter((f) => metaDiffers(f, declaredByName.get(f?.name)));
	if (missing.length === 0 && changed.length === 0 && retired.length === 0) {
		log.push(`sync  base ${collection.slug} (fields current)`);
		continue;
	}
	const merged = current.map((f) => metaMerge(f, declaredByName.get(f?.name)));
	merged.push(...missing);
	const updated = await api(`/api/collections/${collection.slug}`, {
		method: 'PUT',
		body: JSON.stringify({ fields: merged }),
	});
	const parts = [];
	if (missing.length) parts.push(`+${missing.map((f) => f.name).join(', ')}`);
	if (retired.length) parts.push(`-${retired.map((f) => f.name).join(', ')} (dropped)`);
	if (changed.length) parts.push(`meta: ${changed.map((f) => f.name).join(', ')}`);
	log.push(
		updated.status === 200
			? `sync  base ${collection.slug}: ${parts.join(' · ')}`
			: `FAIL  sync base ${collection.slug}: HTTP ${updated.status} ${updated.body?.error ?? ''}`.trim(),
	);
}

// ── 0d. Existing populated collections — sync newly declared columns ──────
// The requisition/outbound headers are NOT in `baseCollections`, and
// `veh_fluid_fills` lives in `moreCollections` (create-if-missing only), so
// step 0c never field-syncs them. Existing (possibly populated) tables need
// the new actor m2o + status/select/date columns added by PUT-merge
// (nullable so live rows migrate) without recreating a table that holds
// rows. `defs.removeFields[slug]` is honored here too (a retired field is
// dropped from the merged list, so the migrator drops the physical column) —
// a line collection's retirement is single-sourced like a base one's.
// Nothing forces rows; 0-change = already current, which is success,
// matching 0c.
for (const slug of syncFieldCollections) {
	const def = defBySlug(slug);
	if (!def) {
		log.push(`FAIL  sync field ${slug}: no schema definition found`);
		continue;
	}
	const existing = await api(`/api/collections/${slug}`, { method: 'GET' });
	if (existing.status === 404) {
		log.push(`skip  sync field ${slug} (not yet created — created in step ${slug === 'mro_outbounds' ? '1' : '2'})`);
		continue;
	}
	if (existing.status !== 200) {
		log.push(`FAIL  sync field ${slug}: HTTP ${existing.status}`);
		continue;
	}
	const sj = existing.body?.data?.schema_json ?? { fields: [] };
	const retire = new Set(defs.removeFields?.[slug] ?? []);
	const current = (sj.fields ?? []).filter((f) => !retire.has(f?.name));
	const retired = (sj.fields ?? []).filter((f) => retire.has(f?.name));
	const have = new Set(current.map((f) => f?.name).filter(Boolean));
	const declared = materialize(def.fields ?? []);
	const declaredByName = new Map(declared.map((f) => [f.name, f]));
	const missing = declared.filter((f) => !have.has(f.name));
	const changed = current.filter((f) => metaDiffers(f, declaredByName.get(f?.name)));
	if (missing.length === 0 && changed.length === 0 && retired.length === 0) {
		log.push(`sync  field ${slug} (fields current)`);
		continue;
	}
	const merged = [...current.map((f) => metaMerge(f, declaredByName.get(f?.name))), ...missing];
	const updated = await api(`/api/collections/${slug}`, {
		method: 'PUT',
		body: JSON.stringify({ fields: merged }),
	});
	const parts = [];
	if (missing.length) parts.push(`+${missing.map((f) => f.name).join(', ')}`);
	if (retired.length) parts.push(`-${retired.map((f) => f.name).join(', ')} (dropped)`);
	if (changed.length) parts.push(`meta: ${changed.map((f) => f.name).join(', ')}`);
	log.push(
		updated.status === 200
			? `sync  field ${slug}: ${parts.join(' · ')}`
			: `FAIL  sync field ${slug}: HTTP ${updated.status} ${updated.body?.error ?? ''}`.trim(),
	);
}

// ── 1. Recreate movement headers (legacy single-line → multi-line) ─────────
for (const collection of defs.recreateCollections) {
	const existing = await api(`/api/collections/${collection.slug}`, { method: 'GET' });
	if (existing.status === 200) {
		if (hasLinesField(existing.body?.data?.schema_json)) {
			log.push(`skip  recreate ${collection.slug} (already multi-line)`);
			continue;
		}
		// Legacy single-line header — recreate only when the table is empty.
		const list = await api(`/api/entities/${collection.slug}?per_page=1`, { method: 'GET' });
		const total = Number(list.body?.data?.total ?? list.body?.data?.items?.length ?? 0);
		if (total > 0) {
			log.push(`FAIL  recreate ${collection.slug}: table has ${total} row(s) — migrate data first, then re-run`);
			continue;
		}
		const removed = await api(`/api/collections/${collection.slug}`, { method: 'DELETE' });
		if (removed.status !== 200) {
			log.push(`FAIL  recreate ${collection.slug}: delete returned HTTP ${removed.status}`);
			continue;
		}
		log.push(`drop  ${collection.slug} (legacy header → recreate)`);
	}
	const created = await api('/api/collections', {
		method: 'POST',
		body: JSON.stringify({
			name: collection.name,
			slug: collection.slug,
			description: collection.description ?? null,
			fields: materialize(collection.fields),
			naming_series: collection.naming_series ?? undefined,
			status_machine: collection.status_machine ?? undefined,
			...(collection.policies ? { policies: collection.policies } : {}),
		}),
	});
	log.push(
		created.status === 201
			? `create ${collection.slug} (multi-line, naming_series=${collection.naming_series ?? 'none'})`
			: `FAIL  create ${collection.slug}: HTTP ${created.status} ${created.body?.error ?? ''}`.trim(),
	);
}

// ── 2. Line + transfer/stocktake/requisition collections — create when missing ──
for (const collection of defsCollections) {
	const existing = await api(`/api/collections/${collection.slug}`, { method: 'GET' });
	if (existing.status === 200) {
		// A header that should number its documents (naming_series) but was created
		// before this script shipped it — rebuild while its table is EMPTY.
		const wantsNaming = Boolean(collection.naming_series);
		const hasNaming = Boolean(existing.body?.data?.naming_series);
		if (!wantsNaming || hasNaming) {
			log.push(`skip  create ${collection.slug} (already exists)`);
			continue;
		}
		const list = await api(`/api/entities/${collection.slug}?per_page=1`, { method: 'GET' });
		const total = Number(list.body?.data?.total ?? list.body?.data?.items?.length ?? 0);
		if (total > 0) {
			log.push(`FAIL  naming ${collection.slug}: table has ${total} row(s) without display_number — migrate or clear them, then re-run`);
			continue;
		}
		const removed = await api(`/api/collections/${collection.slug}`, { method: 'DELETE' });
		if (removed.status !== 200) {
			log.push(`FAIL  naming ${collection.slug}: delete returned HTTP ${removed.status}`);
			continue;
		}
		log.push(`drop  ${collection.slug} (no naming_series → recreate)`);
	}
	const created = await api('/api/collections', {
		method: 'POST',
		body: JSON.stringify({
			name: collection.name,
			slug: collection.slug,
			description: collection.description ?? null,
			fields: materialize(collection.fields),
			naming_series: collection.naming_series ?? undefined,
			...(collection.policies ? { policies: collection.policies } : {}),
		}),
	});
	log.push(
		created.status === 201 ? `create ${collection.slug} (${collection.name})` : `FAIL  create ${collection.slug}: HTTP ${created.status}`,
	);
}

// ── 3b. Composite indexes — the hot read/filter/join columns ──────────
// Declared per collection as `composite_indexes` in `schema-defs.json`. A
// composite-only PUT is the engine's validated DDL path (EntityMigrator diffs
// the declaration against the table and creates only the MISSING indexes), so
// this is idempotent and works on a freshly created AND a long-populated
// collection. These are what turn the inventory reads from "scan every
// non-deleted row + temp B-tree" into seeks — see the index map in
// docs/backend-api/mro-inventory.md.
for (const list of [defs.baseCollections, defs.recreateCollections, defs.newCollections, defs.moreCollections]) {
	for (const collection of list ?? []) {
		const composites = collection.composite_indexes;
		if (!Array.isArray(composites) || composites.length === 0) continue;
		const existing = await api(`/api/collections/${collection.slug}`, { method: 'GET' });
		if (existing.status !== 200) {
			log.push(`skip  index ${collection.slug} (collection missing)`);
			continue;
		}
		const declared = existing.body?.data?.schema_json?.composite_indexes;
		if (JSON.stringify(declared) === JSON.stringify(composites)) {
			log.push(`skip  index ${collection.slug} (${composites.length} declared)`);
			continue;
		}
		const updated = await api(`/api/collections/${collection.slug}`, {
			method: 'PUT',
			body: JSON.stringify({ composite_indexes: composites }),
		});
		log.push(
			updated.status === 200
				? `index ${collection.slug} (${composites.length} composite)`
				: `FAIL  index ${collection.slug}: HTTP ${updated.status} ${updated.body?.error ?? ''}`.trim(),
		);
	}
}

// ── 3c. Runtime feature policies — per-collection engine behavior ────
// Declared per collection as `policies` in `schema-defs.json` (write locks —
// service-only / append-only / frozen_fields; actor_fields identity binding; the
// `search` mode). A partial-merge PUT is the engine's validated path
// (routes/collections.ts merges policies key-by-key), so this is idempotent and
// lifts a long-populated table into the lock without touching its rows. What the
// write lock buys: the generic entity API can no longer mutate a table whose only
// legitimate writer is a domain service (stock balances, serial units, trace/ledger
// tables), so a REST write can never move live state without the matching ledger
// event. What the search policy buys: a searched collection matches `?search=` by
// an indexed prefix instead of an unindexed `%term%` scan.
for (const list of [defs.baseCollections, defs.recreateCollections, defs.newCollections, defs.moreCollections]) {
	for (const collection of list ?? []) {
		const policies = collection.policies;
		if (!policies || typeof policies !== 'object') continue;
		const existing = await api(`/api/collections/${collection.slug}`, { method: 'GET' });
		if (existing.status !== 200) {
			log.push(`skip  policy ${collection.slug} (collection missing)`);
			continue;
		}
		const declared = existing.body?.data?.schema_json?.policies ?? {};
		const merged = { ...declared, ...policies };
		if (JSON.stringify(declared) === JSON.stringify(merged)) {
			log.push(`skip  policy ${collection.slug} (current)`);
			continue;
		}
		const updated = await api(`/api/collections/${collection.slug}`, {
			method: 'PUT',
			body: JSON.stringify({ policies: merged }),
		});
		log.push(
			updated.status === 200
				? `policy ${collection.slug} (${Object.keys(policies).join(', ')})`
				: `FAIL  policy ${collection.slug}: HTTP ${updated.status} ${updated.body?.error ?? ''}`.trim(),
		);
	}
}

console.log(log.join('\n'));
if (log.some((l) => l.startsWith('FAIL'))) process.exit(1);
console.log(`\nMRO schema v1 (development) OK — base ${baseUrl}`);
