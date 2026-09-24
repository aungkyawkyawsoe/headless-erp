/**
 * Collection Routes — the SCHEMA plane (Directus-style separation).
 *
 * The schema plane is split onto its own top-level namespace so it can NEVER
 * collide with a user-named collection slug on the data plane
 * (`/api/entities/:collection…`). A collection may be named `detail`,
 * `field-types`, `import`, etc. — schema routes here live under `/api/collections`
 * and `/api/field-types`, so no route shadows a real collection:
 *
 *   GET    /api/collections            → List collections (admin)
 *   POST   /api/collections            → Create collection (admin)
 *   GET    /api/collections/:slug      → Get collection + full schema (auth)
 *   PUT    /api/collections/:slug      → Update collection schema (admin)
 *   DELETE /api/collections/:slug      → Delete collection (admin)
 *   GET    /api/field-types            → Field-type catalog (auth)
 */

import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import { SmartCollectionService } from '@/lib/services/smart-collection.service';
import { EntityMigrator } from '@mmbix/core';
import { physicalColumnNames } from '@mmbix/core';
import { cache } from '@mmbix/core';
import { requireAuth } from './auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';
import { validators, sanitizeIdentifier } from '@mmbix/utils';
import FIELD_TYPE_DEFS from '@/lib/data/field-types';
import { validateFormulaField } from '@/lib/services/collection-schema.service';
import { NamingService } from '@/lib/services/naming.service';
import { systemFieldsLast } from '@/lib/services/collection.shared';
import type { FieldDefinition } from '@mmbix/types';

type CmsBindings = {
	Bindings: { DB: D1Database; BUCKET: R2Bucket; ADMIN_PASSWORD: string; IS_DEV?: string };
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
};
const app = new Hono<CmsBindings>();
app.use('*', requireAuth);

function getService(c: Context): SmartCollectionService {
	const auth = c.get('auth');
	return new SmartCollectionService(new D1Client(c.env.DB), auth);
}

/**
 * Deterministic JSON string (object keys sorted recursively). Lets the schema PUT
 * recognize a re-sent-but-identical payload as a no-op — the Studio auto-saves
 * field edits and clients retry writes, and neither should churn `_schema_version`
 * or invalidate caches when nothing actually changed.
 */
function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	const obj = value as Record<string, unknown>;
	return `{${Object.keys(obj)
		.sort()
		.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
		.join(',')}}`;
}

// ─── Field-Type catalog (own top-level namespace — no :slug sibling) ───
// Field types live at /api/field-types so a user collection literally named
// `field-types` is never shadowed by a static route on the schema plane.
const app2 = new Hono<CmsBindings>();
app2.use('*', requireAuth);
app2.get('/', requireAuth, async (c) => {
	const groups: Record<string, typeof FIELD_TYPE_DEFS> = {};
	for (const def of FIELD_TYPE_DEFS) {
		if (!groups[def.group]) groups[def.group] = [];
		groups[def.group].push(def);
	}
	return success(c, { types: FIELD_TYPE_DEFS, groups });
});

// Collection listing — admin only. Lean projection: the route returns every
// column EXCEPT schema_json / system_field_options, so it reads (and caches)
// exactly those columns instead of `SELECT *` + strip-in-JS — which used to pull
// every collection's schema JSON blob on every Studio mount / create / delete.
app.get('/', requireAdmin, async (c) => {
	const svc = getService(c);
	await svc.ensureMigrations();
	return success(c, await svc.getCollectionSummaries());
});

// Single collection detail — returns full schema_json
// Readable by ANY authenticated user (the form UI needs the field list to
// render; hidden field VALUES are still stripped by RBAC).
//
// Opt-in `?with=relation_schemas` also returns every m2o TARGET's schema, keyed by
// slug (`related_schemas`). The Studio needs them to resolve each relation column's
// display leaf (what `filter[department.name][_icontains]=…` targets and what types
// the column's filter UI). Without this the client issues ONE request per relation
// just to read a few bytes of metadata; here they ride the focused read in a single
// batched query — and the response is the canonical schema row, so the client can
// cache each one under its own key and every existing invalidation keeps working.
app.get('/:slug', requireAuth, async (c) => {
	const svc = getService(c);
	await svc.ensureMigrations();
	const slug = c.req.param('slug');
	// Existence check + junction heal. Cached, and it shares the raw-row cache
	// with the read below — so a warm schema fetch costs ZERO D1 reads instead
	// of the guaranteed extra `SELECT *` this route used to run for itself.
	await svc.getCollection(slug);
	const full = await svc.getCollectionRow(slug);
	const collection = normalizeSchemaRow(full as unknown as Record<string, unknown>);

	if (wantsRelationSchemas(c)) {
		const related = await loadRelationSchemas(svc, collection, slug);
		if (Object.keys(related).length > 0) collection.related_schemas = related;
	}
	return success(c, collection);
});

// 🔒 Security: Admin-only — creates D1 table (DDL). Schema changes in production
// should go through Infrastructure-as-Code (IaC) pipeline, not runtime API.
app.post('/', requireAdmin, async (c) => {
	const svc = getService(c);
	await svc.ensureMigrations();
	const entity = await svc.createCollection(await c.req.json());
	const result = parseSchemaJson(entity as unknown as Record<string, unknown>);
	if (result.is_singleton !== undefined) result.is_singleton = !!result.is_singleton;
	if (result.hidden !== undefined) result.hidden = !!result.hidden;
	return success(c, result, 201);
});
// Update collection schema (fields)
// 🔒 Security: Admin-only — runs ALTER TABLE (DDL). Field additions/modifications
// should be reviewed and applied with care in production.
app.put('/:slug', requireAdmin, async (c) => {
	const svc = getService(c);
	await svc.ensureMigrations();
	const slug = c.req.param('slug');
	const body = await c.req.json();
	const { fields, actions, ...meta } = body;

	// Fetch existing collection
	const db = new D1Client(c.env.DB);
	const existing = await db.first<Record<string, unknown>>(QueryBuilder.from('_entity_schemas').select('*').where('slug', slug).toSelect());
	if (!existing) return fail(c, 'Collection not found', 404);

	// Parse old and new schema for migration diff
	let oldSchemaJson: { fields?: Array<Record<string, unknown>>; actions?: Record<string, unknown> };
	try {
		oldSchemaJson =
			typeof existing.schema_json === 'string'
				? JSON.parse(existing.schema_json as string)
				: (existing.schema_json as { fields?: Array<Record<string, unknown>>; actions?: Record<string, unknown> });
	} catch {
		oldSchemaJson = { fields: [] };
	}

	// Merge new fields into existing schema_json
	let schemaJson: { fields?: Array<Record<string, unknown>>; actions?: Record<string, unknown> };
	try {
		schemaJson = JSON.parse(JSON.stringify(oldSchemaJson)); // deep clone
	} catch {
		schemaJson = { fields: [] };
	}
	// Set when a real DDL migration runs — a no-op PUT must never have altered the table.
	let ddlApplied = false;

	// Resolve composite (multi-column) index declarations ONCE, before any DDL.
	// The field diff below needs them: a table REBUILD (type/nullability change)
	// must recreate the surviving composite indexes, otherwise the rebuilt table
	// silently loses them while schema_json still advertises the declarations.
	const oldComposites = (
		Array.isArray((oldSchemaJson as Record<string, unknown>).composite_indexes)
			? ((oldSchemaJson as Record<string, unknown>).composite_indexes as { columns?: string[] }[])
			: []
	) as { columns: string[] }[];
	const rawComposites = (body as Record<string, unknown>).composite_indexes;
	// undefined/null/non-array payloads = "don't touch composites" (legacy
	// behavior); an ARRAY (even empty) = replace the declaration wholesale.
	const bodyComposites: { columns: string[] }[] | undefined =
		rawComposites === undefined || rawComposites === null || !Array.isArray(rawComposites)
			? undefined
			: (rawComposites as { name?: string; columns?: string[] }[])
					.filter((ci) => ci && Array.isArray(ci.columns) && ci.columns.length >= 2)
					.map((ci) => ({
						columns: (ci.columns as string[]).filter((x): x is string => typeof x === 'string'),
					}));

	if (fields) {
		// Reserved-keyword guard for field names — reject SQL keywords (`in`,
		// `order`, `group`, …) at save time so DDL/queries never break later.
		for (const f of fields as FieldDefinition[]) {
			if (typeof f?.name === 'string') {
				const reserved = validators.reservedWord(f.name, 'field name');
				if (!reserved.valid) return fail(c, reserved.error, 400);
			}
		}
		// Computed-field invariants — fail fast BEFORE DDL runs (a rejected schema
		// must never leave the physical table half-altered).
		for (const f of fields) {
			if (f.type === 'formula') validateFormulaField(f as FieldDefinition, fields as FieldDefinition[]);
		}

		// Prevent cascade_delete on self-referencing m2o fields
		for (const f of fields) {
			if (f.type === 'm2o' && f.cascade_delete && f.related_collection === slug) {
				return fail(
					c,
					`Cannot enable cascade delete on self-referencing field "${f.name}". The related collection is the same as the current collection.`,
					400,
				);
			}
		}

		// An m2m junction table is shared per (source collection → related
		// collection) pair — two m2m fields to the same related collection would
		// read/write the SAME `_jt_*` rows indistinguishably (both return the same
		// list, and updating either field deletes the other's links). Reject that
		// shape at save time instead of corrupting data later.
		const m2mToCollection = new Map<string, string>();
		for (const f of fields) {
			if (f.type !== 'm2m' || !f.related_collection) continue;
			const first = m2mToCollection.get(f.related_collection);
			if (first !== undefined && first !== f.name) {
				return fail(
					c,
					`Cannot add m2m field "${f.name}": the collection already has m2m field "${first}" to the same related collection "${f.related_collection}". Multiple m2m fields between the same pair of collections would share one junction table — model the second direction with an o2m field instead.`,
					400,
				);
			}
			m2mToCollection.set(f.related_collection, f.name);
		}
		// ---- EntityMigrator — diff & apply ALTER TABLE ----
		const oldFields = (oldSchemaJson.fields || []) as unknown as FieldDefinition[];
		const newFields = fields as unknown as FieldDefinition[];
		const tableName = (existing.table_name as string) || 'cms_' + slug;
		// When the payload omits composite_indexes the declaration is unchanged —
		// pass the old list as both sides so a rebuild recreates the same indexes.
		const effectiveComposites = bodyComposites ?? oldComposites;
		const migration = EntityMigrator.diff(tableName, oldFields, newFields, oldComposites, effectiveComposites);
		if (migration.operations.length > 0) {
			ddlApplied = true;
			const migrated = await EntityMigrator.apply(db, migration);
			// A DDL failure means the physical table does NOT match the new schema —
			// persisting schema_json anyway would silently desync them (the Studio
			// would show fields the database doesn't have). Fail loudly instead.
			if (migrated.errors.length > 0) {
				return fail(
					c,
					`Schema change could not be applied to the database — the collection was NOT updated. ${migrated.errors.join('; ')}`,
					400,
				);
			}
		}

		// M2M junction tables — EntityMigrator deliberately skips virtual m2m
		// fields (they own no column), so an m2m field change produces ZERO
		// migration operations. Reconcile them here instead: provision junctions
		// the new field set declares (CREATE … IF NOT EXISTS — also heals
		// collections that already drifted into a missing-junction state) and drop
		// junctions the old field set declared but the new one no longer does.
		await svc.reconcileJunctionTables(tableName, oldFields, newFields);

		schemaJson.fields = systemFieldsLast(fields as Array<{ name?: string }>);

		// schema_json may only declare composites over columns the NEW field set
		// still owns — prune declarations referencing removed fields so the
		// persisted schema matches what the migration left on the physical table.
		const newPhysCols = new Set(physicalColumnNames(newFields).map((n) => sanitizeIdentifier(n, 'collections.prune.phys')));
		const surviving = effectiveComposites.filter((ci) =>
			ci.columns.every((c) => newPhysCols.has(sanitizeIdentifier(c, 'collections.prune.comp'))),
		);
		if (surviving.length > 0 || bodyComposites !== undefined) {
			(schemaJson as Record<string, unknown>).composite_indexes = surviving;
		} else {
			delete (schemaJson as Record<string, unknown>).composite_indexes;
		}
	} else if (bodyComposites !== undefined) {
		// Composite-only update (fields untouched) — diff & apply the DDL, then
		// persist the new declaration.
		const tableName = (existing.table_name as string) || 'cms_' + slug;
		const migration = EntityMigrator.diff(tableName, [], [], oldComposites, bodyComposites);
		if (migration.operations.length > 0) {
			ddlApplied = true;
			const migrated = await EntityMigrator.apply(db, migration);
			if (migrated.errors.length > 0) {
				return fail(
					c,
					`Schema change could not be applied to the database — the collection was NOT updated. ${migrated.errors.join('; ')}`,
					400,
				);
			}
		}
		(schemaJson as Record<string, unknown>).composite_indexes = bodyComposites;
	}

	// Declarative status machine
	const statusMachine = (body as Record<string, unknown>).status_machine;
	if (statusMachine !== undefined) {
		const sm = statusMachine as { field?: string; transitions?: Record<string, string[]> };
		if (sm && typeof sm.field === 'string' && sm.transitions && typeof sm.transitions === 'object' && !Array.isArray(sm.transitions)) {
			(schemaJson as Record<string, unknown>).status_machine = {
				field: sm.field,
				transitions: sm.transitions,
			};
		} else {
			delete (schemaJson as Record<string, unknown>).status_machine;
		}
	}

	// Runtime feature policies
	const policies = (body as Record<string, unknown>).policies;
	if (policies !== undefined) {
		const json = schemaJson as Record<string, unknown>;
		if (policies === null) {
			delete json.policies;
		} else if (policies && typeof policies === 'object' && !Array.isArray(policies)) {
			json.policies = { ...((json.policies as object) ?? {}), ...(policies as object) };
		} else {
			delete json.policies;
		}
	}
	// v0.7: Update collection actions (custom server-side buttons)
	if (actions !== undefined) {
		schemaJson.actions = actions;
	}

	// UI Studio: persist the form layout tree (groups/tabs/columns)
	const formLayout = (body as Record<string, unknown>).form_layout;
	if (formLayout !== undefined) {
		(schemaJson as Record<string, unknown>).form_layout = formLayout;
	}

	// Lean-list preview columns (schema_json.list_fields)
	const listFields = (body as Record<string, unknown>).list_fields;
	if (listFields !== undefined) {
		(schemaJson as Record<string, unknown>).list_fields = Array.isArray(listFields)
			? listFields.filter((f): f is string => typeof f === 'string')
			: listFields;
	}

	// UI Studio: table-view editor config (schema_json.list_view)
	const listView = (body as Record<string, unknown>).list_view;
	if (listView !== undefined) {
		(schemaJson as Record<string, unknown>).list_view = listView;
	}

	// UI Studio: card-view editor config (schema_json.card_view)
	const cardView = (body as Record<string, unknown>).card_view;
	if (cardView !== undefined) {
		(schemaJson as Record<string, unknown>).card_view = cardView;
	}

	// UI Studio: kanban-view editor config (schema_json.kanban_view)
	const kanbanView = (body as Record<string, unknown>).kanban_view;
	if (kanbanView !== undefined) {
		(schemaJson as Record<string, unknown>).kanban_view = kanbanView;
	}

	// UI Studio: pivot-view report config (schema_json.pivot_view)
	const pivotView = (body as Record<string, unknown>).pivot_view;
	if (pivotView !== undefined) {
		(schemaJson as Record<string, unknown>).pivot_view = pivotView;
	}

	// Directus-style per-collection audit toggle
	const auditEnabled = (body as Record<string, unknown>).audit_enabled;
	if (auditEnabled !== undefined) {
		(schemaJson as Record<string, unknown>).audit_enabled = !!auditEnabled;
	}

	// Zero-waste audit snapshot strategy (full/delta/none)
	const snapshotMode = (body as Record<string, unknown>).snapshot_mode;
	if (snapshotMode !== undefined) {
		if (snapshotMode === null) delete (schemaJson as Record<string, unknown>).snapshot_mode;
		else (schemaJson as Record<string, unknown>).snapshot_mode = snapshotMode;
	}

	// Approval workflow (schema_json.workflow)
	const workflow = (body as Record<string, unknown>).workflow;
	if (workflow !== undefined) {
		if (workflow === null) delete (schemaJson as Record<string, unknown>).workflow;
		else (schemaJson as Record<string, unknown>).workflow = workflow;
	}

	// Build update payload
	const updates: Record<string, unknown> = {
		schema_json: JSON.stringify(schemaJson),
		updated_at: new Date().toISOString(),
	};

	// Allow updating metadata fields
	if (meta.name !== undefined) updates.name = meta.name;
	if (meta.description !== undefined) updates.description = meta.description;
	if (meta.naming_series !== undefined) {
		// Parity with create: same pattern validation; null clears the series.
		if (meta.naming_series === null) {
			updates.naming_series = null;
		} else {
			const nsCheck = NamingService.validateSeries(String(meta.naming_series));
			if (!nsCheck.valid) return fail(c, nsCheck.error!, 400);
			updates.naming_series = String(meta.naming_series);
		}
	}
	if (meta.is_singleton !== undefined) updates.is_singleton = meta.is_singleton;
	if (meta.icon !== undefined) updates.icon = meta.icon;
	if (meta.color !== undefined) updates.color = meta.color;
	if (meta.hidden !== undefined) updates.hidden = meta.hidden;
	if (meta.sort_field !== undefined) updates.sort_field = meta.sort_field;

	// Singleton toggling: maintain the partial UNIQUE index
	if (meta.is_singleton !== undefined) {
		const tbl = (existing.table_name as string) || 'cms_' + slug;
		const wasSingleton = existing.is_singleton === 1 || existing.is_singleton === true || existing.is_singleton === '1';
		if (meta.is_singleton && !wasSingleton) {
			try {
				await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_${tbl}_singleton" ON "${tbl}" ((1)) WHERE "deleted_at" IS NULL`);
			} catch {
				return fail(c, 'Cannot enable singleton: the collection already contains more than one non-deleted record', 400);
			}
		} else if (!meta.is_singleton && wasSingleton) {
			await db.exec(`DROP INDEX IF EXISTS "idx_${tbl}_singleton"`);
		}
	}

	// ── Idempotency: a PUT that changes nothing is a no-op ──
	// Only schema_json is being written (no metadata keys) AND no DDL ran AND the
	// resulting schema is structurally identical to what is stored ⇒ skip the write,
	// the `_schema_version` bump and the cache invalidation. Keeps the version
	// counter a true signal of change under auto-save and client retries.
	const onlySchemaJson = Object.keys(updates).every((k) => k === 'schema_json' || k === 'updated_at');
	if (onlySchemaJson && !ddlApplied && stableStringify(schemaJson) === stableStringify(oldSchemaJson)) {
		if (typeof existing.schema_json === 'string') {
			try {
				existing.schema_json = JSON.parse(existing.schema_json as string);
			} catch {}
		}
		const exf = existing.schema_json as { fields?: Array<{ name?: string }> } | undefined;
		if (exf && Array.isArray(exf.fields)) exf.fields = systemFieldsLast(exf.fields);
		return success(c, existing);
	}

	// Build SET clause dynamically, and advance the schema version counter in the
	// SAME statement — every schema_json/DDL change bumps `_schema_version` so
	// clients + the schema cache can detect staleness. One write, not two.
	const setClauses = Object.entries(updates).map(([k]) => `${k} = ?`);
	const values = Object.values(updates);
	setClauses.push('_schema_version = COALESCE(_schema_version, 1) + 1');
	values.push(slug);

	// ONE statement — the UPDATE returns the new row, so the response is built from
	// the write itself. This used to be an UPDATE followed by a fresh `SELECT *`
	// of the row it had just written.
	const updated = await db.runFirst<Record<string, unknown>>({
		sql: `UPDATE _entity_schemas SET ${setClauses.join(', ')} WHERE slug = ? RETURNING *`,
		bindings: values,
	});

	// Invalidate cache with tag-based invalidation
	cache.invalidateCollection(slug);

	if (!updated) return fail(c, 'Collection not found', 404);
	if (typeof updated.schema_json === 'string') {
		try {
			updated.schema_json = JSON.parse(updated.schema_json as string);
		} catch {}
	}
	const up = updated.schema_json as { fields?: Array<{ name?: string }> } | undefined;
	if (up && Array.isArray(up.fields)) up.fields = systemFieldsLast(up.fields);
	return success(c, updated);
});

// Delete collection
// 🔒 Security: Admin-only — drops D1 table (DDL). Irreversible in production.
app.delete('/:slug', requireAdmin, async (c) => {
	const svc = getService(c);
	await svc.ensureMigrations();
	const slug = c.req.param('slug');
	await svc.deleteCollection(slug);
	return success(c, { deleted: true });
});

function parseSchemaJson(entity: Record<string, unknown>): Record<string, unknown> {
	return normalizeSchemaRow(entity);
}

/**
 * The ONE normalizer for a `_entity_schemas` row on its way out of the API.
 *
 * Applies every read-shape rule the schema plane guarantees, in one place:
 *  - `schema_json` / `system_field_options` arrive as TEXT columns → parsed;
 *  - fields are ordered `id → user fields → system fields` (`systemFieldsLast`),
 *    so legacy schemas stored with system fields first read back normally;
 *  - `is_singleton` / `hidden` are booleans and `_schema_version` a number
 *    (SQLite stores them as 0/1 and may hand back a string).
 *
 * Used by the detail read AND by the relation-schema bundle below, so an m2o
 * target's embedded schema is byte-for-byte the shape a direct GET returns —
 * that is what lets the client cache it under the target's own key.
 */
function normalizeSchemaRow(row: Record<string, unknown>): Record<string, unknown> {
	// Non-mutating: the same row object may be the cached `schemas:all` entry, so
	// callers must never be able to observe a half-normalized row.
	const out: Record<string, unknown> = { ...row };
	const parsed = parseMaybeJson(row.schema_json);
	const sj = parsed as { fields?: Array<{ name?: string }> } | undefined;
	out.schema_json = sj && Array.isArray(sj.fields) ? { ...sj, fields: systemFieldsLast(sj.fields) } : parsed;
	out.system_field_options = parseMaybeJson(row.system_field_options);
	if (out.is_singleton !== undefined) out.is_singleton = !!out.is_singleton;
	if (out.hidden !== undefined) out.hidden = !!out.hidden;
	if (out._schema_version !== undefined) out._schema_version = Number(out._schema_version);
	return out;
}

/** A TEXT column that may already be an object (D1 test doubles / pre-parsed cache rows). */
function parseMaybeJson(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

/** `?with=a,b` → the requested expansions. Unknown names are simply ignored. */
function wantsRelationSchemas(c: Context): boolean {
	return (c.req.query('with') ?? '')
		.split(',')
		.map((s) => s.trim())
		.includes('relation_schemas');
}

/** D1 caps bound parameters — a schema with more m2o targets than this is
 *  pathological; extra targets keep working, they just fetch individually. */
const MAX_RELATION_TARGETS = 50;

/**
 * Every m2o target's full schema row, in ONE batched, cache-backed read.
 *
 * The targets come from the focused schema's own field list, so this never
 * expands transitively — a page of relations costs one extra query, not one per
 * relation. Rows already in the raw-row / `schemas:all` cache cost no query at
 * all. Missing/deleted targets are skipped rather than failing the read (a
 * dangling relation must not break the table).
 */
async function loadRelationSchemas(
	svc: SmartCollectionService,
	collection: Record<string, unknown>,
	selfSlug: string,
): Promise<Record<string, Record<string, unknown>>> {
	const fields = (collection.schema_json as { fields?: Array<Record<string, unknown>> } | undefined)?.fields ?? [];
	const targets: string[] = [];
	const seen = new Set<string>([selfSlug]);
	for (const f of fields) {
		if (f.type !== 'm2o') continue;
		const target = typeof f.related_collection === 'string' ? f.related_collection : '';
		if (!target || seen.has(target)) continue;
		seen.add(target);
		targets.push(target);
		if (targets.length >= MAX_RELATION_TARGETS) break;
	}
	if (targets.length === 0) return {};

	const rows = await svc.getCollectionRows(targets);
	const out: Record<string, Record<string, unknown>> = {};
	for (const [slug, row] of rows) out[slug] = normalizeSchemaRow(row as unknown as Record<string, unknown>);
	return out;
}

export { app as collectionRoutes, app2 as fieldTypesRoutes };
