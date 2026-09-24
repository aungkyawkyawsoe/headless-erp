/**
 * SchemaService — entity schema lifecycle (collections + their physical tables).
 *
 * Extracted from CollectionService (enterprise decomposition): owns
 * _entity_schemas reads/writes, table DDL (create/drop), the (deleted_at, id)
 * index backfill, schema_json parsing, and the schema cache. Item reads and
 * writes go through the cached getCollection()/getCollections() here — the
 * single source of truth for what a collection looks like.
 */
import { D1Client } from '@mmbix/core';
import { EntityMigrator } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import { Repository } from '@mmbix/core';
import { SchemaBuilder } from '@mmbix/core';
import { MigrationRunner } from '@mmbix/core';
import { cache } from '@mmbix/core';
import { applyFieldDefinitions, applySystemColumns } from '@mmbix/core';
import {
	FORMULA_RESULT_TYPES,
	FORMULA_ROUNDING_MODES,
	validateExpressionComplexity,
	validateFormulaReferences,
	buildSystemColumnsList,
} from '@mmbix/core';
import { NamingService } from '@/lib/services/naming.service';
import { validators } from '@mmbix/utils';
import { sanitizeIdentifier } from '@mmbix/utils';
import { NotFoundError, ConflictError, ValidationError } from '@mmbix/utils';
import { collectionTable } from '@/lib/utils/table-name';
import type { AuthContext } from '@/lib/services/auth.service';
import type { EntitySchema, FieldDefinition, SystemFieldOptions } from '@mmbix/types';
import { DEFAULT_SYSTEM_FIELDS } from '@mmbix/types';
import { SYSTEM_FIELD_NAMES, VALID_FIELD_TYPES, type CollectionInfo, type CollectionPolicy } from '@/lib/services/collection.shared';

// Per-isolate guard: an m2m-declaring collection's junction tables are
// provisioned once per isolate the first time its schema is materialized (see
// SchemaService.ensureDeclaredJunctions). Kept on globalThis because SchemaService
// is constructed per request — the guard must survive across requests (mirrors
// the PluginMigrationService once-per-isolate pattern).
const JUNCTION_GUARD_KEY = '__schema_junctions_ensured__';
function junctionEnsuredSet(): Set<string> {
	const g = globalThis as unknown as Record<string, Set<string> | undefined>;
	return (g[JUNCTION_GUARD_KEY] ??= new Set<string>());
}

export interface CreateCollectionInput {
	name: string;
	slug?: string;
	description?: string;
	fields?: FieldDefinition[];
	naming_series?: string;
	is_singleton?: boolean;
	icon?: string;
	color?: string;
	hidden?: boolean;
	/** Directus-style: write _audit_log rows for this collection (default OFF). */
	audit_enabled?: boolean;
	/** Audit snapshot strategy: 'full' (default) | 'delta' (zero-waste) | 'none'. */
	snapshot_mode?: 'full' | 'delta' | 'none';
	sort_field?: string;
	show_in_dropdown?: boolean;
	system_field_options?: SystemFieldOptions;
	/** Composite (multi-column) DB indexes — e.g. [{ columns: ['status', 'manager_id'] }]. */
	composite_indexes?: { name?: string; columns: string[] }[];
	/** Declarative status machine — e.g. { field: 'status', transitions: { pending: ['approved','rejected'] } }. */
	status_machine?: { field: string; transitions: Record<string, string[]> };
	/** Runtime feature policies (enable/configure/dispose per collection). */
	policies?: CollectionPolicy;
}

export class SchemaService {
	private db: D1Client;
	private runner: MigrationRunner;
	private getAuth: () => AuthContext | null;

	constructor(db: D1Client, getAuth: () => AuthContext | null) {
		this.db = db;
		this.runner = new MigrationRunner(db);
		this.getAuth = getAuth;
	}

	// Cache: delegates to centralized CacheLayer for cross-layer invalidation (FIX #7A, #7B, #7C)
	static invalidateCache(slug?: string): void {
		if (slug) {
			cache.invalidateCollection(slug);
		} else {
			cache.invalidatePattern('schema:*');
			cache.invalidatePattern('perm:*');
		}
	}

	async ensureMigrations(): Promise<void> {
		// runPending() fast-paths to a single tiny sqlite_master probe once
		// migrations are applied (per-isolate), and the index backfill is
		// TTL-cached — so steady-state requests pay ~0 reads/DDL here instead
		// of 2 reads + N CREATE INDEX statements.
		await this.runner.runPending();
		await this.backfillDeletedAtIndexes();
	}

	async getCollections(): Promise<EntitySchema[]> {
		const cached = cache.get<EntitySchema[]>('schemas:all');
		if (cached) return cached;
		const result = await this.db.all<EntitySchema>(QueryBuilder.from('_entity_schemas').select('*').orderBy('name', 'asc').toSelect());
		cache.set('schemas:all', result);
		return result;
	}

	/**
	 * Lean registry rows for the collections LIST endpoint — every column that
	 * endpoint returns EXCEPT `schema_json` / `system_field_options`.
	 *
	 * `getCollections()` selects `*` and so reads (and caches) the whole schema
	 * JSON blob of every collection just for the route to destructure it away in
	 * JS. The registry list is read on every Studio mount and after every
	 * create/delete, so that was pure D1 byte + Worker-memory waste that grows
	 * with the number of collections. This projection is what the list actually
	 * serializes. Cached with the same lifecycle as `schemas:all` (both dropped by
	 * `invalidateCollection`).
	 */
	async getCollectionSummaries(): Promise<Array<Record<string, unknown>>> {
		const cached = cache.get<Array<Record<string, unknown>>>('schemas:summaries');
		if (cached) return cached;
		const result = await this.db.all<Record<string, unknown>>(
			QueryBuilder.from('_entity_schemas')
				.select(
					'id',
					'name',
					'slug',
					'table_name',
					'description',
					'naming_series',
					'is_singleton',
					'icon',
					'color',
					'hidden',
					'sort_field',
					'created_by',
					'updated_by',
					'created_at',
					'updated_at',
					'_schema_version',
				)
				.orderBy('name', 'asc')
				.toSelect(),
		);
		// Normalize the D1 0/1 + string-typed columns HERE, once, at the cache
		// boundary. The route used to mutate the shared cached array in place, so
		// any future non-idempotent rule would silently corrupt the cache.
		const rows = result.map((e) => ({
			...e,
			is_singleton: !!e.is_singleton,
			hidden: !!e.hidden,
			_schema_version: Number(e._schema_version),
		}));
		cache.set('schemas:summaries', rows);
		return rows;
	}

	async getCollection(slug: string): Promise<CollectionInfo> {
		const cacheKey = `schema:${slug}`;
		const cached = cache.get<CollectionInfo>(cacheKey);
		if (cached) {
			await this.ensureDeclaredJunctions(cached);
			return cached;
		}
		// The parsed info is a DERIVED view of the raw row — build it from the same
		// cached row the schema plane serializes (getCollectionRow), so one
		// collection read is at most ONE D1 hit. The detail route used to fetch the
		// identical row again with its own uncached `SELECT *` right after this.
		const info = this.parseCollection(await this.getCollectionRow(slug));
		cache.set(cacheKey, info);
		await this.ensureDeclaredJunctions(info);
		return info;
	}

	/**
	 * The RAW `_entity_schemas` row for a slug — the `SELECT *` shape (TEXT
	 * `schema_json` / `system_field_options`, 0/1 flags), i.e. exactly what the
	 * schema-plane routes serialize after `normalizeSchemaRow()`.
	 *
	 * Cached under `schema:<slug>:raw`, inside the same `schema:*` invalidation
	 * family as the parsed `CollectionInfo` (`schema:<slug>`), so any collection
	 * mutation drops both together. `schemas:all` is consulted first — it already
	 * holds every full row — so a schema read that follows any relation-touching
	 * query costs ZERO D1 reads.
	 */
	async getCollectionRow(slug: string): Promise<EntitySchema> {
		const row = (await this.getCollectionRows([slug])).get(slug);
		if (!row) throw new NotFoundError('Collection', slug);
		return row;
	}

	/**
	 * Batched `getCollectionRow`: resolves the requested slugs from the per-slug
	 * raw-row cache, then from `schemas:all`, and queries D1 only for the
	 * remainder in ONE `WHERE slug IN (…)`. Every fetched row is seeded into the
	 * per-slug cache, so the relation-schema bundle is itself cache-warming — a
	 * later direct GET of a bundled target is free. Unknown slugs are simply
	 * absent from the returned map (callers decide if that is fatal).
	 */
	async getCollectionRows(slugs: string[]): Promise<Map<string, EntitySchema>> {
		const out = new Map<string, EntitySchema>();
		const unresolved: string[] = [];
		for (const slug of slugs) {
			if (out.has(slug)) continue;
			const cached = cache.get<EntitySchema>(`schema:${slug}:raw`);
			if (cached) out.set(slug, cached);
			else unresolved.push(slug);
		}
		if (unresolved.length === 0) return out;

		// `schemas:all` is a superset of every raw row — resolve from it before D1.
		const all = cache.get<EntitySchema[]>('schemas:all');
		let missing = unresolved;
		if (all) {
			const bySlug = new Map(all.map((c) => [c.slug, c]));
			missing = [];
			for (const slug of unresolved) {
				const row = bySlug.get(slug);
				if (row) {
					cache.set(`schema:${slug}:raw`, row);
					out.set(slug, row);
				} else missing.push(slug);
			}
		}
		if (missing.length === 0) return out;

		const rows = await this.db.all<EntitySchema>(QueryBuilder.from('_entity_schemas').select('*').whereIn('slug', missing).toSelect());
		for (const row of rows) {
			cache.set(`schema:${row.slug}:raw`, row);
			out.set(row.slug, row);
		}
		return out;
	}

	/**
	 * Junction tables an m2m-bearing field list declares — ONE per (source table →
	 * related table) pair, named `_jt_{sourceTable}_{targetTable}` (the
	 * SchemaBuilder.createJunctionTable contract). Pure computation: callers use it
	 * to know which `_jt_*` tables a schema owns without re-deriving the naming rule.
	 */
	declaredJunctionTables(tableName: string, fields: FieldDefinition[]): string[] {
		const sb = new SchemaBuilder();
		const seen = new Set<string>();
		const tables: string[] = [];
		for (const f of fields) {
			if (f.type !== 'm2m' || !f.related_collection) continue;
			const { table } = sb.createJunctionTable(tableName, collectionTable(f.related_collection));
			if (seen.has(table)) continue;
			seen.add(table);
			tables.push(table);
		}
		return tables;
	}

	/**
	 * Provision every junction table `fields` declares (CREATE … IF NOT EXISTS +
	 * indexes — idempotent). No-op for field lists without m2m fields. Used by
	 * createCollection, the schema-update route and the read-path heal below.
	 */
	async provisionJunctionTables(tableName: string, fields: FieldDefinition[]): Promise<void> {
		const sb = new SchemaBuilder();
		const seen = new Set<string>();
		for (const f of fields) {
			if (f.type !== 'm2m' || !f.related_collection) continue;
			const jt = sb.createJunctionTable(tableName, collectionTable(f.related_collection));
			if (seen.has(jt.table)) continue;
			seen.add(jt.table);
			for (const stmt of jt.statements) {
				await this.db.run(stmt);
			}
		}
	}

	/**
	 * Reconcile a schema change's junction surface: provision junctions the NEW
	 * field list declares and DROP junctions the OLD list declared but the new one
	 * no longer does (mirrors how removing a regular field drops its column).
	 * Idempotent — also heals collections whose schema drifted from their DDL.
	 */
	async reconcileJunctionTables(
		tableName: string,
		oldFields: FieldDefinition[],
		newFields: FieldDefinition[],
	): Promise<{ provisioned: string[]; dropped: string[] }> {
		await this.provisionJunctionTables(tableName, newFields);
		const kept = new Set(this.declaredJunctionTables(tableName, newFields));
		const dropped: string[] = [];
		for (const jt of this.declaredJunctionTables(tableName, oldFields)) {
			if (kept.has(jt)) continue;
			await this.db.run({ sql: `DROP TABLE IF EXISTS ${jt}`, bindings: [] });
			dropped.push(jt);
		}
		return { provisioned: [...kept], dropped };
	}

	/**
	 * Read-path heal — junction tables are PHYSICAL siblings of the collection's
	 * data table, but EntityMigrator deliberately skips virtual m2m fields, so a
	 * schema can (legacy drift, pre-guard create, partial restore) declare m2m
	 * fields whose `_jt_*` table was never provisioned. Reads that expand such a
	 * field then die with an opaque D1_ERROR (502). Materializing a schema here is
	 * the single funnel every junction-touching read/write already passes through,
	 * so provisioning once per isolate per collection guarantees the tables exist
	 * before any code touches them — with zero steady-state overhead (Set lookup
	 * only). The DDL is idempotent, so concurrent first requests are safe.
	 */
	private async ensureDeclaredJunctions(info: CollectionInfo): Promise<void> {
		if (!info.schemaFields.some((f) => f.type === 'm2m' && f.related_collection)) return;
		const ensured = junctionEnsuredSet();
		if (ensured.has(info.table_name)) return;
		await this.provisionJunctionTables(info.table_name, info.schemaFields);
		ensured.add(info.table_name);
	}

	async deleteCollection(slug: string): Promise<void> {
		const info = await this.getCollection(slug);
		const { table_name: tableName, schemaFields } = info;

		// Drop the m2m junction tables the collection owns BEFORE the data table —
		// otherwise every deleted m2m collection strands its `_jt_*` tables forever
		// (orphaned debris no schema owns).
		for (const jt of this.declaredJunctionTables(tableName, schemaFields)) {
			await this.db.run({ sql: `DROP TABLE IF EXISTS ${jt}`, bindings: [] });
		}

		// Drop the data table
		await this.db.run({ sql: `DROP TABLE IF EXISTS "${tableName}"`, bindings: [] });

		// Remove from _entity_schemas
		await this.db.run(QueryBuilder.from('_entity_schemas').where('slug', slug).toDelete());

		// Invalidate cache
		SchemaService.invalidateCache(slug);
	}

	async createCollection(input: CreateCollectionInput): Promise<EntitySchema> {
		if (!input.name || typeof input.name !== 'string' || input.name.trim().length === 0) {
			throw new ValidationError('Collection name is required');
		}
		const name = input.name.trim();

		const rawSlug =
			input.slug?.trim() ??
			name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '_')
				.replace(/^_|_$/g, '');
		const slugValidation = validators.slug(rawSlug, 'slug');
		if (!slugValidation.valid) throw new ValidationError(slugValidation.error);
		const slug = slugValidation.value;

		// Validate naming series if provided
		const namingSeries = input.naming_series || null;
		if (namingSeries) {
			const nsCheck = NamingService.validateSeries(namingSeries);
			if (!nsCheck.valid) throw new ValidationError(nsCheck.error!);
		}

		const fields = input.fields ?? [];
		this.validateFields(fields);

		// Check for duplicates
		await this.checkNoConflict(slug, name);

		// Get or create table name
		const tableName = collectionTable(slug);

		// Merge system field options
		const sfOpts = input.system_field_options ? { ...DEFAULT_SYSTEM_FIELDS, ...input.system_field_options } : DEFAULT_SYSTEM_FIELDS;

		// Create the D1 table with system columns
		const sb = new SchemaBuilder();
		const composites = (input.composite_indexes ?? [])
			.filter((ci) => ci && Array.isArray(ci.columns) && ci.columns.length >= 2)
			.map((ci) => ({ columns: ci.columns.filter((x): x is string => typeof x === 'string') }));
		const statements = sb.createTable(
			tableName,
			(t) => {
				t.uuid('id');
				if (fields.length > 0) applyFieldDefinitions(t, fields, sfOpts);
				else applySystemColumns(t, sfOpts);
			},
			composites,
		);
		for (const stmt of statements) {
			await this.db.exec(stmt.sql);
		}

		// Cursor-pagination index: WHERE deleted_at IS NULL ORDER BY id DESC
		// O(log n) indexed seek instead of O(n) full table scan on every list query.
		await this.db.exec(`CREATE INDEX IF NOT EXISTS "idx_${tableName}_deleted_id" ON "${tableName}" ("deleted_at", "id")`);

		// Singleton enforcement: partial UNIQUE index guarantees at most one
		// non-deleted row, closing the check-then-insert race at the DB level.
		if (input.is_singleton) {
			await this.db.exec(
				`CREATE UNIQUE INDEX IF NOT EXISTS "idx_${tableName}_singleton" ON "${tableName}" ((1)) WHERE "deleted_at" IS NULL`,
			);
		}

		// Provision M2M junction tables for the declared m2m fields (deduped per
		// source → related pair — one shared `_jt_*` table per pair).
		await this.provisionJunctionTables(tableName, fields);

		// Invalidate cache with specific slug (FIX #7A, #7B)
		SchemaService.invalidateCache(slug);

		// Build full field list for schema_json
		const allFields: FieldDefinition[] = [{ name: 'id', type: 'uuid', label: 'ID', required: true }, ...fields];
		if (sfOpts.doc_status) allFields.push({ name: 'doc_status', type: 'text', label: 'Document Status' });
		if (sfOpts.display_number) allFields.push({ name: 'display_number', type: 'text', label: 'Document Number' });
		if (sfOpts._owner) allFields.push({ name: '_owner', type: 'uuid', label: 'Owner' });
		if (sfOpts.deleted_at) allFields.push({ name: 'deleted_at', type: 'timestamp', label: 'Deleted At' });
		if (sfOpts.deleted_by) allFields.push({ name: 'deleted_by', type: 'uuid', label: 'Deleted By' });
		if (sfOpts.updated_by) allFields.push({ name: 'updated_by', type: 'uuid', label: 'Updated By' });
		allFields.push(
			{ name: 'created_at', type: 'timestamp', label: 'Created At' },
			{ name: 'updated_at', type: 'timestamp', label: 'Updated At' },
		);

		// Register in _entity_schemas
		const now = new Date().toISOString();
		const repo = new Repository<EntitySchema>(this.db, '_entity_schemas');
		return repo.create({
			name,
			slug,
			table_name: tableName,
			description: input.description ?? null,
			naming_series: namingSeries,
			schema_json: JSON.stringify({
				fields: allFields,
				...(input.audit_enabled ? { audit_enabled: true } : {}),
				...(input.snapshot_mode && input.snapshot_mode !== 'full' ? { snapshot_mode: input.snapshot_mode } : {}),
				...(composites.length > 0 ? { composite_indexes: composites } : {}),
				...(input.status_machine ? { status_machine: input.status_machine } : {}),
				...(input.policies ? { policies: input.policies } : {}),
			}),
			is_singleton: input.is_singleton ?? false,
			icon: input.icon ?? null,
			color: input.color ?? null,
			hidden: input.hidden ?? false,
			sort_field: input.sort_field ?? null,
			system_field_options: input.system_field_options ? JSON.stringify(input.system_field_options) : null,
			created_by: this.getAuth()?.user_id ?? null,
			created_at: now,
			updated_at: now,
		} as Partial<EntitySchema>);
	}

	/**
	 * Backfill missing indexes on existing entity tables (TTL-cached, ~1 sweep
	 * per 60s per isolate instead of per-request DDL):
	 *   1. The (deleted_at, id) composite index for pagination + soft-delete.
	 *   2. A UNIQUE index for each unique field on collections created before
	 *      the soft-delete-aware-unique fix — so the app-level uniqueness check hits an
	 *      index (O(log n)) instead of a full table scan, and so the DB enforces the
	 *      SAME rule the engine does (unique among LIVE rows only). A legacy
	 *      full-column unique index — explicit or an inline `UNIQUE` table
	 *      constraint (constraint-owned auto-index) — fires on soft-deleted rows and
	 *      squats the value forever; it is normalized here. An inline constraint can
	 *      only be removed by a table rebuild, which is why this runs once, bounded,
	 *      under the same 24h TTL guard as the rest of the sweep. Skipped per-field
	 *      when live duplicate rows exist (the app-level check still guards writes).
	 */
	private async backfillDeletedAtIndexes(): Promise<void> {
		if (cache.get<boolean>('backfill:checked')) return;

		// The DONE state is PERSISTED in `_maintenance`, not merely held in this
		// isolate's cache: memory does not cross isolates, so a memory-only guard
		// re-ran the WHOLE sweep (all schemas + the schema catalogue) on every cold
		// isolate. The stored value is a SCHEMA FINGERPRINT — the sweep re-runs
		// exactly when the collection set changes (add / remove / rename / field
		// edit bumps `updated_at`), so a settled database pays ONE small read.
		let fingerprint = '';
		try {
			const row = await this.db.first<{ marker: string | null; fingerprint: string }>({
				sql: `SELECT (SELECT value FROM _maintenance WHERE name = 'index_backfill') AS marker, (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') FROM _entity_schemas) AS fingerprint`,
				bindings: [],
			});
			fingerprint = String(row?.fingerprint ?? '');
			if (row?.marker != null && row.marker === fingerprint) {
				cache.set('backfill:checked', true, 24 * 60 * 60 * 1000);
				return;
			}
		} catch {
			// `_maintenance` absent (a database that predates migration 030) — sweep
			// as before; the marker write below is skipped without a fingerprint.
		}

		try {
			const schemas = await this.db.all<EntitySchema>(QueryBuilder.from('_entity_schemas').select('*').toSelect());
			// ONE read of every index that already exists. `CREATE INDEX IF NOT EXISTS`
			// is a no-op when the index is present — but it is still a D1 ROUND TRIP, and
			// this sweep would otherwise issue ONE PER INDEX OF EVERY COLLECTION (289 on
			// the live DB). The guard above is per-ISOLATE, so the whole sweep re-ran on
			// the first request to EVERY cold isolate: ~300 serial round trips, which is
			// the multi-second "first call" latency. With this set, a settled database
			// costs ZERO DDL — one `sqlite_master` read.
			const existing = new Set(
				(await this.db.all<{ name: string }>({ sql: `SELECT name FROM sqlite_master WHERE type = 'index'`, bindings: [] })).map(
					(r) => r.name,
				),
			);
			/** Create an index ONLY when it is actually missing (still idempotent). */
			const ensure = async (name: string, sql: string): Promise<void> => {
				if (existing.has(name)) return;
				try {
					await this.db.run({ sql, bindings: [] });
					existing.add(name);
				} catch {
					/* stale/unsupported column — non-fatal, skip (retried next sweep) */
				}
			};

			for (const c of schemas) {
				const t = c.table_name;
				if (!t) continue;
				await ensure(`idx_${t}_deleted_id`, `CREATE INDEX IF NOT EXISTS "idx_${t}_deleted_id" ON "${t}" ("deleted_at", "id")`);
				// The DEFAULT list read is `WHERE deleted_at IS NULL ORDER BY
				// created_at DESC, id DESC LIMIT n` (collection-query.service), and its
				// keyset cursor compares `(created_at, id)`. `(deleted_at, id)` cannot
				// serve that ordering, so SQLite scanned the table and built a temp
				// B-tree on EVERY list request. This composite makes the scan a seek.
				// `created_at` exists on every collection table (entity-migrator);
				// `ensure` swallows a legacy table that predates it.
				await ensure(
					`idx_${t}_deleted_created_id`,
					`CREATE INDEX IF NOT EXISTS "idx_${t}_deleted_created_id" ON "${t}" ("deleted_at", "created_at", "id")`,
				);
				let fields: FieldDefinition[] = [];
				let composites: { columns: string[] }[] = [];
				try {
					const parsed = JSON.parse(c.schema_json || '{}') as {
						fields?: FieldDefinition[];
						composite_indexes?: { columns?: string[] }[];
					};
					fields = parsed.fields ?? [];
					composites = (parsed.composite_indexes ?? [])
						.filter((ci) => ci && Array.isArray(ci.columns) && ci.columns.length >= 2)
						.map((ci) => ({ columns: (ci.columns as string[]).filter((x): x is string => typeof x === 'string') }));
				} catch {
					continue;
				}
				// FOREIGN-KEY COLUMNS were never indexed unless a field explicitly set
				// `index: true` (field-utils.applyFieldDefinitions:139 — the only path to
				// a single-column index). But every relation load, computed lookup,
				// child-table join and RBAC row filter compiles to `WHERE <fk> IN (…)` or
				// `WHERE <fk> = ?`, which without an index scans the whole child table —
				// O(rows) per relation, per request, growing forever. Auto-index every
				// m2o column here: idempotent, and it reaches EXISTING databases because
				// the sweep reads the deployed `schema_json` (a DDL-only change would
				// only help tables created after the deploy).
				//
				// A field the schema marks `index: true` is swept in the SAME way: its
				// single-column index was previously only ever created at table-CREATE
				// time, so a table that predates the flag scanned the whole table on
				// every lookup — the telegram directory's `etg_id` was doing exactly
				// that (261 rows read per `/auth/me`, i.e. per app load).
				for (const field of fields) {
					if (!field.name) continue;
					if (field.type !== 'm2o' && field.index !== true) continue;
					// Virtual types own no single column (m2a stores {name}_type/_id).
					if (field.type === 'o2m' || field.type === 'm2m' || field.type === 'table' || field.type === 'formula' || field.type === 'm2a')
						continue;
					const col = sanitizeIdentifier(field.name, 'backfill.fk');
					await ensure(`idx_${t}_${col}`, `CREATE INDEX IF NOT EXISTS "idx_${t}_${col}" ON "${t}" ("${col}")`);
				}
				// Composite (multi-column) indexes for hot filters — idempotent, so this
				// sweeps in any composite index declared on existing collections.
				for (const comp of composites) {
					const cols = comp.columns.map((col) => sanitizeIdentifier(col, 'backfill.comp')).join(', ');
					const idx = `idx_${t}_${comp.columns.map((col) => sanitizeIdentifier(col, 'backfill.compIdx')).join('_')}`;
					await ensure(idx, `CREATE INDEX IF NOT EXISTS "${idx}" ON "${t}" (${cols})`);
				}
				// Unique indexes: the canonical partial `uidx_` (soft-delete-aware) plus a
				// one-time normalization of any legacy full-column unique index. Isolated:
				// a failed rebuild must not poison the whole sweep (it would then retry on
				// every request); the app-level check still guards writes meanwhile.
				try {
					await this.syncUniqueIndexes(t, fields, composites, existing);
				} catch {
					/* non-fatal — retried on the next 24h window */
				}
			}
			// Persist the marker LAST — a sweep that threw above leaves it unwritten,
			// so the next isolate retries rather than silently skipping the sweep.
			if (fingerprint) {
				try {
					await this.db.run({
						sql: `INSERT INTO _maintenance (name, value, updated_at) VALUES ('index_backfill', ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
						bindings: [fingerprint, new Date().toISOString()],
					});
				} catch {
					/* marker write failed — the next isolate simply re-sweeps */
				}
			}
			cache.set('backfill:checked', true, 24 * 60 * 60 * 1000); // 24h — not the 60s default
		} catch {
			// Table may not exist yet (fresh deploy). Non-fatal — retry on next request.
		}
	}

	/**
	 * Make a collection's unique indexes match the canonical, soft-delete-aware
	 * shape: a SINGLE partial index per unique column,
	 * `uidx_<table>_<col> ON (<col>) WHERE deleted_at IS NULL`.
	 *
	 * Why partial: the engine's reads and its uniqueness pre-check both treat a
	 * soft-deleted row as gone, so the DB must too — otherwise deleting a master
	 * would permanently squat its identity value. (This is the same partial-index
	 * pattern the singleton guard already uses.)
	 *
	 * Legacy normalization (idempotent, runs at most once per TTL window):
	 *   - an explicit full-column unique index (`uidx_`/`idx_`) is dropped and
	 *     recreated partial — O(1), no rebuild;
	 *   - an inline `UNIQUE` table constraint (origin `u`, a constraint-owned
	 *     auto-index that SQLite cannot drop in place) forces ONE table rebuild,
	 *     which recreates every canonical index atomically.
	 *
	 * Best-effort: a duplicate over live rows leaves the app-level check in charge.
	 */
	private async syncUniqueIndexes(
		t: string,
		fields: FieldDefinition[],
		composites: { columns: string[] }[],
		existing?: Set<string>,
	): Promise<void> {
		const uniqueCols = fields
			// Virtual types own no single column; m2a stores two ({name}_type/_id).
			.filter((f) => f.unique && f.name && !['o2m', 'm2m', 'table', 'formula', 'm2a'].includes(f.type))
			.map((f) => sanitizeIdentifier(f.name, 'backfill.uniqueCol'));
		if (uniqueCols.length === 0) return;
		const softDeletable = fields.some((f) => f.name === 'deleted_at');
		const partial = softDeletable ? ` WHERE "deleted_at" IS NULL` : '';

		// Inspect the physical unique indexes. A legacy full-column unique index on a
		// declared-unique column must go; an inline constraint needs a rebuild.
		let indexes: { name: string; origin: string; unique: number; partial: number }[] = [];
		try {
			indexes = await this.db.all<{ name: string; origin: string; unique: number; partial: number }>({
				sql: `SELECT name, origin, "unique", "partial" FROM pragma_index_list(?)`,
				bindings: [t],
			});
		} catch {
			// pragma unavailable — fall through to the pure upsert below.
		}
		let needsRebuild = false;
		const stale: string[] = [];
		for (const ix of indexes) {
			if (!ix.unique || ix.origin === 'pk') continue;
			const cols = await this.indexColumns(ix.name);
			if (cols.length !== 1 || !uniqueCols.includes(cols[0])) continue;
			const canonical = `uidx_${t}_${cols[0]}`;
			if (ix.name === canonical && Boolean(ix.partial) === softDeletable) continue; // already right
			if (ix.origin === 'u')
				needsRebuild = true; // inline UNIQUE — undeletable in place
			else stale.push(ix.name);
		}

		if (needsRebuild) {
			// One atomic batch: rebuild recreates the canonical partial indexes.
			const res = await EntityMigrator.apply(this.db, {
				version: Date.now(),
				tableName: t,
				operations: [{ type: 'rebuild_table', fields, compositeIndexes: composites }],
			});
			if (res.errors.length > 0) throw new Error(res.errors.join('; '));
			return;
		}

		for (const name of stale) {
			try {
				await this.db.run({ sql: `DROP INDEX IF EXISTS "${sanitizeIdentifier(name, 'backfill.dropUidx')}"`, bindings: [] });
			} catch {
				// non-fatal — the create below just no-ops on the surviving index
			}
		}
		for (const col of uniqueCols) {
			const name = `uidx_${t}_${col}`;
			// Already present (and the pragma above confirmed it is canonical) — skip
			// the no-op statement, which would still cost a D1 round trip.
			if (existing?.has(name)) continue;
			try {
				await this.db.run({
					sql: `CREATE UNIQUE INDEX IF NOT EXISTS "${name}" ON "${t}" ("${col}")${partial}`,
					bindings: [],
				});
				existing?.add(name);
			} catch {
				// Duplicate live values exist — the app-level check still protects writes
			}
		}
	}

	/** Columns covered by a physical index ([] when it vanished or is an expression index). */
	private async indexColumns(name: string): Promise<string[]> {
		try {
			const rows = await this.db.all<{ name: string | null }>({ sql: `SELECT name FROM pragma_index_info(?)`, bindings: [name] });
			return rows.map((r) => r.name).filter((n): n is string => typeof n === 'string');
		} catch {
			return [];
		}
	}

	private parseCollection(c: EntitySchema): CollectionInfo {
		let schemaFields: FieldDefinition[] = [];
		try {
			const p = JSON.parse(c.schema_json);
			if (p.fields && Array.isArray(p.fields))
				schemaFields = p.fields.filter((f: FieldDefinition) => f.name && !SYSTEM_FIELD_NAMES.has(f.name));
		} catch {
			console.warn(`[parseCollection] schema_json parse failed for ${c.slug}`);
		}
		let systemFieldOptions: SystemFieldOptions = DEFAULT_SYSTEM_FIELDS;
		if (c.system_field_options && typeof c.system_field_options === 'string') {
			try {
				systemFieldOptions = { ...DEFAULT_SYSTEM_FIELDS, ...JSON.parse(c.system_field_options) };
			} catch {
				console.warn(`[parseCollection] system_field_options parse failed for ${c.slug}`);
			}
		}
		// Schema-defined preview columns (list_fields) — parsed once here so the
		// list path can project lean payloads without re-parsing schema_json.
		let listFields: string[] | undefined;
		let audit_enabled = false;
		let snapshotMode: CollectionInfo['snapshotMode'] = 'full';
		let compositeIndexes: { columns: string[] }[] | undefined;
		let statusMachine: CollectionInfo['statusMachine'];
		let policies: CollectionPolicy | undefined;
		try {
			const p = JSON.parse(c.schema_json);
			if (Array.isArray(p.list_fields)) listFields = p.list_fields.filter((f: unknown): f is string => typeof f === 'string');
			if (typeof p.audit_enabled === 'boolean') audit_enabled = p.audit_enabled;
			// Zero-waste audit snapshot mode ('full' | 'delta' | 'none') — parsed from
			// schema_json so collections can opt out of full-doc snapshot copies.
			if (p.snapshot_mode === 'delta' || p.snapshot_mode === 'none') snapshotMode = p.snapshot_mode;
			if (Array.isArray(p.composite_indexes)) {
				compositeIndexes = (p.composite_indexes as { columns?: string[] }[])
					.filter((ci) => ci && Array.isArray(ci.columns) && ci.columns.length >= 2)
					.map((ci) => ({ columns: (ci.columns as string[]).filter((x): x is string => typeof x === 'string') }));
			}
			// Declarative status machine — opts ANY collection into server-side state
			// transition enforcement (no plugin, no hardcoded table).
			if (
				p.status_machine &&
				typeof p.status_machine === 'object' &&
				typeof p.status_machine.field === 'string' &&
				p.status_machine.transitions
			) {
				statusMachine = p.status_machine as CollectionInfo['statusMachine'];
			}
			// Runtime feature policies — enable/configure/dispose via REST.
			if (p.policies && typeof p.policies === 'object') policies = p.policies as CollectionPolicy;
		} catch {
			/* no list_fields — fall back to full rows */
		}
		return {
			table_name: c.table_name,
			schemaFields,
			naming_series: c.naming_series,
			is_singleton: !!c.is_singleton,
			systemFieldOptions,
			listFields,
			audit_enabled,
			snapshotMode,
			compositeIndexes,
			statusMachine,
			policies,
		};
	}

	private validateFields(fields: FieldDefinition[]): void {
		const seen = new Set<string>();
		// M2M junction tables are shared per (source collection → related collection)
		// pair — see the createCollection junction loop. Two m2m fields to the same
		// related collection would read/write the same `_jt_*` rows indistinguishably,
		// so reject the shape here (mirrors the same guard on the schema-update route).
		const m2mToCollection = new Map<string, string>();
		for (const f of fields) {
			if (!f.name || typeof f.name !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f.name))
				throw new ValidationError(`Invalid field name: "${f.name}"`);
			const reserved = validators.reservedWord(f.name, 'field name');
			if (!reserved.valid) throw new ValidationError(reserved.error);
			if (seen.has(f.name)) throw new ValidationError(`Duplicate field: "${f.name}"`);
			seen.add(f.name);
			if (!VALID_FIELD_TYPES.has(f.type)) throw new ValidationError(`Invalid field type: "${f.type}"`);
			if (f.type === 'formula') validateFormulaField(f, fields);
			if (
				(f.type === 'm2o' || f.type === 'o2m' || f.type === 'm2m' || f.type === 'table' || f.type === 'm2a') &&
				!f.related_collection &&
				!f.related_collections
			)
				throw new ValidationError(`Field "${f.name}" requires "related_collection" or "related_collections"`);
			if (f.type === 'o2m' && !f.foreign_key) throw new ValidationError(`Field "${f.name}" requires "foreign_key"`);
			if (f.type === 'm2m' && f.related_collection) {
				const first = m2mToCollection.get(f.related_collection);
				if (first !== undefined && first !== f.name)
					throw new ValidationError(
						`m2m field "${f.name}" duplicates "${first}": both relate to "${f.related_collection}". Multiple m2m fields between the same pair of collections share one junction table — use a single m2m field or model the second direction as an o2m field.`,
					);
				m2mToCollection.set(f.related_collection, f.name);
			}
			if (
				[
					'id',
					'_meta',
					'data',
					'doc_status',
					'display_number',
					'deleted_at',
					'deleted_by',
					'created_by',
					'updated_by',
					'_owner',
					'sort',
				].includes(f.name)
			)
				throw new ValidationError(`"${f.name}" is a reserved field name`);
		}
	}

	private async checkNoConflict(slug: string, name?: string): Promise<void> {
		const e = await this.db.first(QueryBuilder.from('_entity_schemas').select('id').where('slug', slug).toSelect());
		if (e) throw new ConflictError(`Collection "${slug}" already exists`);
		if (name) {
			const n = await this.db.first(QueryBuilder.from('_entity_schemas').select('id').where('name', name).toSelect());
			if (n) throw new ConflictError(`Collection with name "${name}" already exists`);
		}
	}
}

/**
 * Formula-field invariants — shared by the create (validateFields) and update
 * (PUT /api/collections/:slug) paths so broken computed fields fail fast at
 * save time instead of silently returning null everywhere.
 *
 * `allFields` (when provided) enables reference validation: every identifier in
 * the expression must be a real field of the collection, a callable function,
 * or a literal — so typos surface at save time, not at read time.
 */
export function validateFormulaField(f: FieldDefinition, allFields?: FieldDefinition[]): void {
	if (f.store && (!f.formula || typeof f.formula !== 'string' || f.formula.trim().length === 0)) {
		throw new ValidationError(`Field "${f.name}": a stored formula requires a "formula" expression`);
	}
	for (const expr of [f.formula, f.inverse_formula]) {
		if (expr && typeof expr === 'string') {
			const complexityError = validateExpressionComplexity(expr);
			if (complexityError) throw new ValidationError(`Field "${f.name}": ${complexityError}`);
			if (allFields) {
				const refError = validateFormulaReferences(expr, allFields, new Set(buildSystemColumnsList()));
				if (refError) throw new ValidationError(`Field "${f.name}": ${refError}`);
			}
		}
	}
	if (f.formula_type === 'sql') {
		throw new ValidationError(
			`Field "${f.name}": formula_type "sql" is not supported — use "expression" (safe evaluator) or "lookup" (relation aggregates)`,
		);
	}
	if (f.store && f.result_type !== undefined && !(FORMULA_RESULT_TYPES as readonly string[]).includes(f.result_type)) {
		throw new ValidationError(`Field "${f.name}": invalid result_type "${String(f.result_type)}" — use number | string | boolean | json`);
	}
	if (f.precision !== undefined) {
		const p = Number(f.precision);
		if (!Number.isInteger(p) || p < 0 || p > 10) {
			throw new ValidationError(`Field "${f.name}": precision must be an integer 0–10`);
		}
	}
	if (f.rounding !== undefined && !(FORMULA_ROUNDING_MODES as readonly string[]).includes(f.rounding)) {
		throw new ValidationError(`Field "${f.name}": invalid rounding "${String(f.rounding)}" — use half_up | half_even | up | down`);
	}
	if (f.inverse_formula && !f.inverse_target) {
		throw new ValidationError(`Field "${f.name}": inverse_formula requires "inverse_target"`);
	}
	if (f.inverse_target) {
		const target = allFields?.find((x) => x.name === f.inverse_target);
		if (!target) throw new ValidationError(`Field "${f.name}": inverse_target "${f.inverse_target}" is not a field of this collection`);
		if (target.type === 'formula' || target.type === 'o2m' || target.type === 'm2m' || target.type === 'table' || target.type === 'm2a') {
			throw new ValidationError(`Field "${f.name}": inverse_target must be a plain (non-formula, non-virtual) field`);
		}
	}
	if ((f as FieldDefinition & { encrypted?: boolean }).encrypted) {
		throw new ValidationError(`Field "${f.name}": formula fields cannot be encrypted — encrypt the source fields instead`);
	}
}
