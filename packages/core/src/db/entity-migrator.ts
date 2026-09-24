/**
 * Entity Migrator — Schema diffing & DDL generation
 *
 * When a collection schema (schema_json) is updated via
 * PUT /api/collections/:slug, this module diffs the old
 * and new field definitions and generates ALTER TABLE statements
 * to keep the physical D1 table in sync.
 *
 * Operations supported:
 *   - ADD COLUMN (new fields)
 *   - CREATE INDEX (newly indexed fields)
 *   - CREATE UNIQUE INDEX (newly unique fields)
 *   - CREATE COMPOSITE INDEX (new/changed multi-column indexes)
 *   - DROP INDEX / DROP COMPOSITE INDEX (index flag removed, composite removed)
 *   - DROP COLUMN (fields removed from the schema)
 *   - REBUILD TABLE (type/nullability changes — SQLite has no
 *     ALTER COLUMN, so the table is recreated with the new shape and the
 *     surviving columns' data is copied over)
 *
 * Older SQLite versions could not drop/rename columns; workerd/D1 embed a
 * modern SQLite (≥3.35) that supports ALTER TABLE DROP COLUMN, so removed
 * fields now really disappear from the physical table instead of lingering.
 */

import type { FieldDefinition } from '@mmbix/types';
import type { D1Client } from '../db/d1-client';
import { SchemaBuilder } from '../db/schema-builder';
import { applyFieldDefinitions, physicalColumnNames } from '../entity/field-utils';
import { sanitizeIdentifier } from '@mmbix/utils';

// ─── Types ─────────────────────────────────────────────

export interface EntityMigration {
	version: number;
	tableName: string;
	operations: EntityMigrationOp[];
}

export type EntityMigrationOp =
	| { type: 'add_column'; name: string; sqlType: string; nullable: boolean; defaultValue?: string }
	| { type: 'create_index'; name: string; column: string }
	| { type: 'create_composite_index'; name: string; columns: string[] }
	| { type: 'create_unique_index'; name: string; column: string }
	| { type: 'drop_index'; name: string }
	| { type: 'drop_column'; name: string }
	/**
	 * SQLite cannot alter an existing column's type/nullability in place, and a
	 * column created with an inline UNIQUE constraint cannot be dropped either.
	 * Both cases rebuild the table from the FULL new field list (data for
	 * surviving columns is copied; columns absent from the new schema are gone).
	 */
	| { type: 'rebuild_table'; fields: FieldDefinition[]; compositeIndexes: { columns: string[] }[] };

export interface MigrationResult {
	applied: number; // Number of ops applied
	skipped: number; // Number of ops skipped (e.g. column/index already gone)
	errors: string[];
}

// ─── Type Mapping ──────────────────────────────────────

/**
 * Map a FieldType to its SQL column type.
 * Mirrors the type mapping in field-utils.ts FIELD_TYPE_MAP.
 */
function fieldTypeToSQL(type: string): string {
	switch (type) {
		case 'integer':
		case 'boolean':
		case 'bigint':
			return 'INTEGER';
		case 'number':
		case 'real':
		case 'currency':
		case 'percent':
		case 'rating':
			return 'REAL';
		case 'duration':
		case 'progress':
			return 'INTEGER';
		case 'json':
		case 'csv':
		case 'location':
		case 'date':
		case 'time':
		default:
			// text, slug, m2o, file, select, color, password, longtext, uuid, timestamp, …
			return 'TEXT';
	}
}

/** SQL column type for a field — stored formulas resolve via result_type. */
function fieldSqlType(field: FieldDefinition): string {
	if (field.type === 'formula') {
		// Only STORED formulas reach DDL (virtual ones are filtered by isVirtual).
		const rt = field.result_type;
		if (rt === 'boolean') return 'INTEGER';
		if (rt === 'string' || rt === 'json') return 'TEXT';
		return 'REAL'; // default 'number'
	}
	return fieldTypeToSQL(field.type);
}

// ─── Entity Migrator ───────────────────────────────────

export class EntityMigrator {
	/** True when the field occupies no column on the parent table. Stored
	 *  computed fields (formula + store:true) ARE physical columns. */
	private static isVirtual(f: FieldDefinition): boolean {
		return f.type === 'o2m' || f.type === 'm2m' || f.type === 'table' || (f.type === 'formula' && !f.store);
	}

	/**
	 * Diff old vs new field definitions and generate a migration.
	 *
	 * @param tableName - The D1 table name (e.g. "cms_invoices")
	 * @param oldFields - Current field definitions (before update)
	 * @param newFields - New field definitions (after update)
	 * @param oldComposites - Current composite indexes (before update)
	 * @param newComposites - New composite indexes (after update)
	 * @returns An EntityMigration with ADD COLUMN, CREATE INDEX, DROP COLUMN,
	 *   DROP INDEX, CREATE/DROP UNIQUE INDEX, CREATE COMPOSITE INDEX ops — or a
	 *   single REBUILD TABLE op when a change needs SQLite's table-rebuild
	 *   recipe (type/nullability changes, dropping unique-constrained columns).
	 */
	static diff(
		tableName: string,
		oldFields: FieldDefinition[],
		newFields: FieldDefinition[],
		oldComposites: { columns: string[] }[] = [],
		newComposites: { columns: string[] }[] = [],
	): EntityMigration {
		const safeTable = sanitizeIdentifier(tableName, 'EntityMigrator.diff.table');

		// Physical (column-owning) field sets — keyed by the sanitized column name.
		const oldPhys = new Map<string, FieldDefinition>();
		for (const f of oldFields) {
			if (this.isVirtual(f)) continue;
			oldPhys.set(sanitizeIdentifier(f.name, 'EntityMigrator.diff.old'), f);
		}
		const newPhys = new Map<string, FieldDefinition>();
		for (const f of newFields) {
			if (this.isVirtual(f)) continue;
			newPhys.set(sanitizeIdentifier(f.name, 'EntityMigrator.diff.new'), f);
		}
		const oldNames = new Set(oldPhys.keys());
		const newNames = new Set(newPhys.keys());
		const removedNames = new Set([...oldNames].filter((n) => !newNames.has(n)));

		// ── REBUILD trigger: changes SQLite cannot apply in place ──
		//   1. column type changed (field type / stored-formula result_type)
		//   2. nullability changed (required toggled) — incl. stored formulas
		//      (always nullable) ↔ physical columns
		//   3. a removed field carries unique:true — a LEGACY table may express that
		//      as an inline UNIQUE constraint (a constraint-owned auto-index that
		//      blocks DROP COLUMN and cannot be dropped in place); a rebuild drops the
		//      constraint with the table and recreates the canonical partial index.
		//      New/upgraded tables express it as an explicit `uidx_` index, but the
		//      diff compares schemas, not physical reality — the rebuild is the one
		//      path that is correct for both, so it stays the universal answer.
		let needsRebuild = false;
		for (const [name, oldField] of oldPhys) {
			const newField = newPhys.get(name);
			if (!newField) {
				// Removed field — inline UNIQUE can't be dropped in place.
				if (oldField.unique) needsRebuild = true;
				continue;
			}
			if (fieldSqlType(oldField) !== fieldSqlType(newField)) needsRebuild = true;
			const oldNullable = oldField.required === false || oldField.type === 'formula';
			const newNullable = newField.required === false || newField.type === 'formula';
			if (oldNullable !== newNullable) needsRebuild = true;
		}

		if (needsRebuild) {
			// Composite indexes referencing a column that no longer exists must not
			// be recreated on the rebuilt table.
			const keptComposites = newComposites
				.filter((ci) => ci && Array.isArray(ci.columns) && ci.columns.length >= 2)
				.map((ci) => ({ columns: ci.columns.filter((x): x is string => typeof x === 'string') }))
				.filter((ci) => !ci.columns.some((c) => removedNames.has(sanitizeIdentifier(c, 'EntityMigrator.diff.rebuildComp'))));
			return {
				version: Date.now(),
				tableName,
				operations: [
					{
						type: 'rebuild_table',
						fields: newFields.map((f) => ({ ...f })),
						compositeIndexes: keptComposites,
					},
				],
			};
		}

		// ── In-place ops (no rebuild needed) ──
		const operations: EntityMigrationOp[] = [];

		// Fields removed from the schema (physically present before, gone now).
		const removed: FieldDefinition[] = [];
		for (const [name, oldField] of oldPhys) {
			if (!newPhys.has(name)) removed.push(oldField);
		}
		// Fields added to the schema (no physical column before).
		const added: FieldDefinition[] = [];
		for (const [name, newField] of newPhys) {
			if (!oldPhys.has(name)) added.push(newField);
		}

		// 1. DROP INDEX phase — indexes that must go BEFORE any column drop:
		//    - single-column indexes for fields that lost index:true
		//    - removed composite indexes (or composites referencing a removed column)
		const oldIndexed = new Set(
			oldFields.filter((f) => f.index && !this.isVirtual(f)).map((f) => sanitizeIdentifier(f.name, 'EntityMigrator.diff.oldIndex')),
		);
		const newIndexed = new Set(
			newFields.filter((f) => f.index && !this.isVirtual(f)).map((f) => sanitizeIdentifier(f.name, 'EntityMigrator.diff.newIndex')),
		);
		for (const name of oldIndexed) {
			if (!newIndexed.has(name) && newNames.has(name)) {
				operations.push({ type: 'drop_index', name: `idx_${safeTable}_${name}` });
			}
		}
		const oldUnique = new Set(
			oldFields.filter((f) => f.unique && !this.isVirtual(f)).map((f) => sanitizeIdentifier(f.name, 'EntityMigrator.diff.oldUnique')),
		);
		const newUnique = new Set(
			newFields.filter((f) => f.unique && !this.isVirtual(f)).map((f) => sanitizeIdentifier(f.name, 'EntityMigrator.diff.newUnique')),
		);
		for (const name of oldUnique) {
			if (!newUnique.has(name)) {
				operations.push({ type: 'drop_index', name: `uidx_${safeTable}_${name}` });
			}
		}
		// Removed composites — deterministic name from the sorted column list.
		const oldCompositeKeys = new Set(
			oldComposites
				.filter((ci) => ci && Array.isArray(ci.columns) && ci.columns.length >= 2)
				.map((ci) =>
					ci.columns
						.filter((x): x is string => typeof x === 'string')
						.map((c) => sanitizeIdentifier(c, 'EntityMigrator.diff.oldComp'))
						.join('|'),
				),
		);
		const newCompositeKeys = new Set(
			newComposites
				.filter((ci) => ci && Array.isArray(ci.columns) && ci.columns.length >= 2)
				.map((ci) =>
					ci.columns
						.filter((x): x is string => typeof x === 'string')
						.map((c) => sanitizeIdentifier(c, 'EntityMigrator.diff.newComp'))
						.join('|'),
				),
		);
		for (const ci of oldComposites) {
			if (!ci.columns || ci.columns.length < 2) continue;
			const cols = ci.columns
				.filter((x): x is string => typeof x === 'string')
				.map((c) => sanitizeIdentifier(c, 'EntityMigrator.diff.oldCompCol'));
			const key = cols.join('|');
			// Dropped, changed, or referencing a removed column → old index goes.
			const referencesRemoved = cols.some((c) => oldNames.has(c) && !newNames.has(c));
			if (!newCompositeKeys.has(key) || referencesRemoved) {
				operations.push({ type: 'drop_index', name: `idx_${safeTable}_${cols.join('_')}` });
			}
		}

		// 2. DROP COLUMN phase — after their indexes are gone.
		for (const field of removed) {
			const safeName = sanitizeIdentifier(field.name, 'EntityMigrator.diff.drop');
			if (field.type === 'm2a') {
				operations.push({ type: 'drop_column', name: sanitizeIdentifier(`${field.name}_type`, 'EntityMigrator.diff.dropM2aT') });
				operations.push({ type: 'drop_column', name: sanitizeIdentifier(`${field.name}_id`, 'EntityMigrator.diff.dropM2aId') });
			} else {
				operations.push({ type: 'drop_column', name: safeName });
			}
		}

		// 3. ADD COLUMN phase.
		for (const field of added) {
			if (field.type === 'm2a') {
				// M2A creates TWO columns: {name}_type and {name}_id
				operations.push({
					type: 'add_column',
					name: sanitizeIdentifier(`${field.name}_type`, 'EntityMigrator.diff.m2a_type'),
					sqlType: 'TEXT',
					nullable: true,
				});
				operations.push({
					type: 'add_column',
					name: sanitizeIdentifier(`${field.name}_id`, 'EntityMigrator.diff.m2a_id'),
					sqlType: 'TEXT',
					nullable: true,
				});
			} else {
				const colName = sanitizeIdentifier(field.name, 'EntityMigrator.diff.col');
				const sqlType = fieldSqlType(field);
				// Stored computed columns are always nullable (engine-owned — old
				// rows carry NULL until their next write; NOT NULL would require a
				// backfill default).
				const nullable = field.required === false || field.type === 'formula';
				const defaultVal = field.default !== undefined ? String(field.default) : undefined;

				operations.push({
					type: 'add_column',
					name: colName,
					sqlType,
					nullable,
					defaultValue: defaultVal,
				});
			}
		}

		// 4. CREATE INDEX phase — index/unique/composite adds (after columns exist).
		for (const name of newIndexed) {
			if (!oldIndexed.has(name)) {
				operations.push({ type: 'create_index', name: `idx_${safeTable}_${name}`, column: name });
			}
		}
		for (const name of newUnique) {
			if (!oldUnique.has(name)) {
				operations.push({ type: 'create_unique_index', name: `uidx_${safeTable}_${name}`, column: name });
			}
		}
		for (const ci of newComposites) {
			if (!ci.columns || ci.columns.length < 2) continue;
			const cols = ci.columns
				.filter((x): x is string => typeof x === 'string')
				.map((c) => sanitizeIdentifier(c, 'EntityMigrator.diff.compCol'));
			// Never create an index over a column that was just removed.
			if (cols.some((c) => removedNames.has(c))) continue;
			const key = cols.join('|');
			if (oldCompositeKeys.has(key)) continue; // unchanged — skip
			operations.push({ type: 'create_composite_index', name: `idx_${safeTable}_${cols.join('_')}`, columns: cols });
		}

		return {
			version: Date.now(),
			tableName,
			operations,
		};
	}

	/**
	 * Apply a migration to the database.
	 *
	 * ATOMIC: every migration (the single rebuild-table op AND the in-place op
	 * lists) is executed as ONE D1 batch — if any statement fails, SQLite rolls
	 * the whole batch back and the physical table is left exactly as it was.
	 * That matters because schema_json is only persisted AFTER apply succeeds:
	 * a partial application would silently desync the two (the engine would
	 * read/write columns that don't exist, or vice versa) with no later PUT able
	 * to repair it — the field diff compares schemas, not physical reality.
	 *
	 * Idempotency is handled by preflighting the CURRENT physical shape (column
	 * and index names) before building the batch: columns already present are
	 * not re-added, columns already gone are not re-dropped, indexes already
	 * created are skipped — so re-running a migration that partially applied
	 * under an older, non-atomic version converges instead of erroring.
	 *
	 * Genuine failures land in `result.errors` — callers must NOT persist the
	 * schema change when errors are reported (the table is untouched, so
	 * schema_json stays the source of truth and the diff can be retried).
	 *
	 * @returns MigrationResult with counts of applied/skipped operations
	 */
	static async apply(db: D1Client, migration: EntityMigration): Promise<MigrationResult> {
		const result: MigrationResult = { applied: 0, skipped: 0, errors: [] };
		const safeTable = sanitizeIdentifier(migration.tableName, 'EntityMigrator.apply.table');

		// Rebuild op — SQLite cannot alter types/nullability in place; the rebuild
		// itself already runs as a single atomic batch (see rebuildTable).
		const rebuild = migration.operations.find((op) => op.type === 'rebuild_table') as
			Extract<EntityMigrationOp, { type: 'rebuild_table' }> | undefined;
		if (rebuild) {
			const err = await this.rebuildTable(db, migration.tableName, rebuild.fields, rebuild.compositeIndexes);
			if (err) result.errors.push(`rebuild_table "${migration.tableName}": ${err}`);
			else result.applied++;
			return result;
		}

		// Preflight the CURRENT physical shape so the batch only touches what
		// actually changed — no-op statements would otherwise break atomicity on
		// re-runs (e.g. ADD COLUMN on an already-added column is a hard error).
		const existingCols = new Set<string>((await this.tableColumns(db, safeTable)) ?? []);
		const existingIndexes = new Set<string>(await this.tableIndexes(db, safeTable));

		const stmts: { sql: string; bindings: unknown[] }[] = [];
		let planned = 0;
		for (const op of migration.operations) {
			if (op.type === 'add_column') {
				const safeCol = sanitizeIdentifier(op.name, 'EntityMigrator.apply.col');
				if (existingCols.has(safeCol)) {
					result.skipped++;
					continue;
				}
				let sql = `ALTER TABLE "${safeTable}" ADD COLUMN "${safeCol}" ${op.sqlType}`;
				if (!op.nullable) {
					// SQLite requires a default for NOT NULL added columns
					const dflt = op.defaultValue ? `'${op.defaultValue.replace(/'/g, "''")}'` : "''";
					sql += ` NOT NULL DEFAULT ${dflt}`;
				}
				stmts.push({ sql, bindings: [] });
				planned++;
			} else if (op.type === 'create_index' || op.type === 'create_unique_index' || op.type === 'create_composite_index') {
				if (existingIndexes.has(op.name)) {
					result.skipped++;
					continue;
				}
				const safeIdx = sanitizeIdentifier(op.name, 'EntityMigrator.apply.idx');
				if (op.type === 'create_unique_index') {
					const safeCol = sanitizeIdentifier(op.column, 'EntityMigrator.apply.uidxCol');
					// Soft-delete-aware: unique among LIVE rows only (see SchemaBuilder.createTable).
					const partial = existingCols.has('deleted_at') ? ` WHERE "deleted_at" IS NULL` : '';
					stmts.push({ sql: `CREATE UNIQUE INDEX IF NOT EXISTS "${safeIdx}" ON "${safeTable}" ("${safeCol}")${partial}`, bindings: [] });
				} else if (op.type === 'create_composite_index') {
					const safeCols = op.columns.map((c) => sanitizeIdentifier(c, 'EntityMigrator.apply.compCol')).join('", "');
					stmts.push({ sql: `CREATE INDEX IF NOT EXISTS "${safeIdx}" ON "${safeTable}" ("${safeCols}")`, bindings: [] });
				} else {
					const safeCol = sanitizeIdentifier(op.column, 'EntityMigrator.apply.idxCol');
					stmts.push({ sql: `CREATE INDEX IF NOT EXISTS "${safeIdx}" ON "${safeTable}" ("${safeCol}")`, bindings: [] });
				}
				planned++;
			} else if (op.type === 'drop_index') {
				stmts.push({ sql: `DROP INDEX IF EXISTS "${sanitizeIdentifier(op.name, 'EntityMigrator.apply.dropIdx')}"`, bindings: [] });
				planned++;
			} else if (op.type === 'drop_column') {
				const safeCol = sanitizeIdentifier(op.name, 'EntityMigrator.apply.dropCol');
				if (!existingCols.has(safeCol)) {
					result.skipped++;
					continue;
				}
				// SQLite refuses to drop an INDEXED column — drop every explicit index
				// (origin 'c') that references it first, in the same batch. Auto-indexes
				// from UNIQUE/PRIMARY KEY constraints (origin 'u'/'pk') cannot be dropped
				// here; those columns go through the rebuild path instead.
				const blocker = await this.indexesReferencing(db, safeTable, safeCol);
				for (const idx of blocker) {
					if (existingIndexes.has(idx)) stmts.push({ sql: `DROP INDEX IF EXISTS "${idx}"`, bindings: [] });
					else result.skipped++;
				}
				stmts.push({ sql: `ALTER TABLE "${safeTable}" DROP COLUMN "${safeCol}"`, bindings: [] });
				planned++;
			}
		}

		if (stmts.length > 0) {
			try {
				// One batch = one transaction: a failing statement rolls back every
				// DDL op issued so far, leaving the table exactly as it was.
				await db.batch(stmts);
				result.applied += planned;
			} catch (err) {
				const msg = this.message(err);
				// Re-run after an old partial application can still hit "already
				// exists/gone" states the preflight raced with — report them clearly.
				result.errors.push(`apply ${planned} DDL op(s) to "${safeTable}" failed and was rolled back: ${msg}`);
			}
		}

		return result;
	}

	/**
	 * SQLite table-rebuild recipe for changes ALTER cannot express in place
	 * (column type/nullability changes, dropping a legacy inline-UNIQUE column):
	 *
	 *   1. CREATE TABLE "<table>__migrate" with the target shape (system +
	 *      user columns, defaults — same DDL createCollection uses)
	 *   2. copy surviving columns (old ∩ new) row-for-row
	 *   3. DROP the original table, RENAME the temp to the original name
	 *   4. recreate schema-declared indexes + engine indexes (deleted_id cursor,
	 *      singleton partial index, and the partial `uidx_` for each unique field)
	 *
	 * Runs as ONE D1 batch so a mid-rebuild failure rolls everything back —
	 * the table is never left half-rebuilt. Returns an error message on
	 * failure, or null on success.
	 */
	private static async rebuildTable(
		db: D1Client,
		tableName: string,
		fields: FieldDefinition[],
		composites: { columns: string[] }[],
	): Promise<string | null> {
		const safeTable = sanitizeIdentifier(tableName, 'EntityMigrator.rebuild.table');
		const tempTable = `${safeTable}__migrate`;

		try {
			// Read the ACTUAL old table first: engine system columns (id, doc_status,
			// _meta, created_by, …) are immutable across field PUTs and their physical
			// presence is the source of truth — schema_json omits some of them
			// (created_by, _meta) so it cannot be used to reconstruct the DDL.
			const oldCols = await this.tableColumns(db, safeTable);
			if (oldCols === null) return 'table does not exist';

			const SYSTEM = new Set([
				'id',
				'_meta',
				'created_at',
				'updated_at',
				'doc_status',
				'display_number',
				'created_by',
				'updated_by',
				'_owner',
				'deleted_at',
				'deleted_by',
			]);
			const userFields = fields.filter((f) => f.name && !SYSTEM.has(f.name));
			const sfOpts = {
				doc_status: oldCols.includes('doc_status'),
				display_number: oldCols.includes('display_number'),
				_owner: oldCols.includes('_owner'),
				deleted_at: oldCols.includes('deleted_at'),
				deleted_by: oldCols.includes('deleted_by'),
				created_by: oldCols.includes('created_by'),
				updated_by: oldCols.includes('updated_by'),
			};

			const sb = new SchemaBuilder();
			// Take ONLY the CREATE TABLE statement (indexes are recreated below
			// with final-table names — the temp name must not leak into them).
			const [createStmt] = sb.createTable(tempTable, (t) => {
				t.uuid('id');
				applyFieldDefinitions(t, userFields, sfOpts);
			});
			// createTable throws when no columns are defined; guard for safety.
			if (!createStmt) return 'failed to generate table DDL';

			// Intersect physical columns (old vs new) so data copy never touches a
			// column that doesn't exist on either side. The new column set = user
			// columns from the schema + the engine system columns of the old table.
			const newCols = new Set<string>([...physicalColumnNames(fields), ...oldCols.filter((c) => SYSTEM.has(c))]);
			const shared = oldCols.filter((c) => newCols.has(c));
			const sharedSql = shared.map((c) => `"${sanitizeIdentifier(c, 'EntityMigrator.rebuild.copyCol')}"`).join(', ');

			// Determine engine indexes to preserve (they live outside schema_json).
			const existingIndexes = await this.tableIndexes(db, safeTable);
			const hadSingleton = existingIndexes.some((n) => n === `idx_${safeTable}_singleton`);
			const cursorIndex = `idx_${safeTable}_deleted_id`;

			// The rebuild is executed as one D1 batch: if any step fails, the whole
			// transaction rolls back and the original table stays intact.
			const stmts: { sql: string; bindings: unknown[] }[] = [];
			stmts.push({ sql: `DROP TABLE IF EXISTS "${tempTable}"`, bindings: [] });
			stmts.push({ sql: createStmt.sql, bindings: [] });
			if (shared.length > 0) {
				stmts.push({
					sql: `INSERT INTO "${tempTable}" (${sharedSql}) SELECT ${sharedSql} FROM "${safeTable}"`,
					bindings: [],
				});
			}
			stmts.push({ sql: `DROP TABLE "${safeTable}"`, bindings: [] });
			stmts.push({ sql: `ALTER TABLE "${tempTable}" RENAME TO "${safeTable}"`, bindings: [] });
			// Engine indexes + schema-declared indexes (correct final-table names).
			stmts.push({ sql: `CREATE INDEX IF NOT EXISTS "${cursorIndex}" ON "${safeTable}" ("deleted_at", "id")`, bindings: [] });
			if (hadSingleton) {
				stmts.push({
					sql: `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${safeTable}_singleton" ON "${safeTable}" ((1)) WHERE "deleted_at" IS NULL`,
					bindings: [],
				});
			}
			for (const f of userFields) {
				// m2a stores its payload in {name}_type/_id columns — no index on the
				// virtual `name` column itself; virtual fields own no column at all.
				if (f.type === 'm2a' || f.type === 'o2m' || f.type === 'm2m' || f.type === 'table' || (f.type === 'formula' && !f.store)) continue;
				const safeCol = sanitizeIdentifier(f.name, 'EntityMigrator.rebuild.col');
				if (f.index) {
					stmts.push({ sql: `CREATE INDEX IF NOT EXISTS "idx_${safeTable}_${safeCol}" ON "${safeTable}" ("${safeCol}")`, bindings: [] });
				}
				if (f.unique) {
					// Soft-delete-aware, same shape/name as SchemaBuilder.createTable + the
					// in-place path, so a rebuild converges on one canonical index.
					const partial = sfOpts.deleted_at ? ` WHERE "deleted_at" IS NULL` : '';
					stmts.push({
						sql: `CREATE UNIQUE INDEX IF NOT EXISTS "uidx_${safeTable}_${safeCol}" ON "${safeTable}" ("${safeCol}")${partial}`,
						bindings: [],
					});
				}
			}
			for (const ci of composites) {
				if (!ci.columns || ci.columns.length < 2) continue;
				const cols = ci.columns.map((c) => sanitizeIdentifier(c, 'EntityMigrator.rebuild.compCol')).join('", "');
				const name = ci.columns.map((c) => sanitizeIdentifier(c, 'EntityMigrator.rebuild.compName')).join('_');
				stmts.push({ sql: `CREATE INDEX IF NOT EXISTS "idx_${safeTable}_${name}" ON "${safeTable}" ("${cols}")`, bindings: [] });
			}

			await db.batch(stmts);
			return null;
		} catch (err) {
			return err instanceof Error ? err.message : String(err);
		}
	}

	/** Actual physical column names of a table (null when the table is absent).
	 *  Uses the pragma TABLE-VALUED FUNCTIONS via SELECT — D1 allows these
	 *  through prepared statements (plain `PRAGMA x` may not). */
	private static async tableColumns(db: D1Client, table: string): Promise<string[] | null> {
		try {
			const rows = await db.all<{ name: string }>({
				sql: `SELECT name FROM pragma_table_info(?)`,
				bindings: [sanitizeIdentifier(table, 'EntityMigrator.pragma.table')],
			});
			return rows.map((r) => r.name);
		} catch {
			return null;
		}
	}

	/** Index names on a table (explicit + constraint-owned), for rebuild/index probes. */
	private static async tableIndexes(db: D1Client, table: string): Promise<string[]> {
		try {
			const rows = await db.all<{ name: string }>({
				sql: `SELECT name FROM pragma_index_list(?)`,
				bindings: [sanitizeIdentifier(table, 'EntityMigrator.pragma.idxTable')],
			});
			return rows.map((r) => r.name);
		} catch {
			return [];
		}
	}

	/**
	 * Explicit (origin 'c') index names that reference a given column — SQLite
	 * refuses DROP COLUMN on an indexed column, so these must be dropped first.
	 */
	private static async indexesReferencing(db: D1Client, table: string, column: string): Promise<string[]> {
		const rows = await db.all<{ name: string; origin: string }>({
			sql: `SELECT name, origin FROM pragma_index_list(?)`,
			bindings: [sanitizeIdentifier(table, 'EntityMigrator.pragma.idxList')],
		});
		const out: string[] = [];
		for (const row of rows) {
			// Constraint-owned auto-indexes (UNIQUE/PRIMARY KEY) cannot be dropped —
			// such columns go through the rebuild path instead.
			if (row.origin !== 'c') continue;
			if (row.name.startsWith('sqlite_autoindex')) continue;
			try {
				const cols = await db.all<{ name: string }>({
					sql: `SELECT name FROM pragma_index_info(?)`,
					bindings: [row.name],
				});
				if (cols.some((r) => r.name === column)) out.push(row.name);
			} catch {
				// index vanished between reads — ignore
			}
		}
		return out;
	}

	private static message(err: unknown): string {
		return err instanceof Error ? err.message : String(err);
	}
}
