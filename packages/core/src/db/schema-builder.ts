/**
 * Lightweight Schema Builder for Cloudflare D1
 *
 * Generates SQL DDL (Data Definition Language) statements
 * for creating and altering tables, similar to Knex's schema API.
 *
 * All identifiers are sanitized before being interpolated.
 */

import type { SqlStatement } from '@mmbix/types';
import { sanitizeIdentifier } from '@mmbix/utils';

// ─── Column Definition ─────────────────────────────────

interface ColumnDef {
	name: string;
	type: string;
	nullable: boolean;
	primaryKey: boolean;
	autoIncrement: boolean;
	unique: boolean;
	indexed: boolean;
	defaultValue: string | null;
}

// ─── Table Builder ──────────────────────────────────────

/**
 * Fluent builder for defining table columns inside `createTable()`.
 */
export class TableBuilder {
	private _columns: ColumnDef[] = [];

	/** INTEGER PRIMARY KEY AUTOINCREMENT */
	increments(name: string): this {
		this._columns.push({
			name: sanitizeIdentifier(name, 'TableBuilder.increments'),
			type: 'INTEGER',
			nullable: false,
			primaryKey: true,
			autoIncrement: true,
			unique: false,
			indexed: false,
			defaultValue: null,
		});
		return this;
	}

	/** TEXT PRIMARY KEY (UUID) */
	uuid(name: string): this {
		this._columns.push({
			name: sanitizeIdentifier(name, 'TableBuilder.uuid'),
			type: 'TEXT',
			nullable: false,
			primaryKey: true,
			autoIncrement: false,
			unique: false,
			indexed: false,
			defaultValue: null,
		});
		return this;
	}

	/** TEXT NOT NULL */
	text(name: string): this {
		return this._addColumn(name, 'TEXT', 'text');
	}

	/** INTEGER NOT NULL */
	integer(name: string): this {
		return this._addColumn(name, 'INTEGER', 'integer');
	}

	/** REAL NOT NULL (floating point) */
	real(name: string): this {
		return this._addColumn(name, 'REAL', 'real');
	}

	/** INTEGER NOT NULL (stored as 0/1) */
	boolean(name: string): this {
		return this._addColumn(name, 'INTEGER', 'boolean');
	}

	/** TEXT NOT NULL (ISO 8601 string) */
	timestamp(name: string): this {
		return this._addColumn(name, 'TEXT', 'timestamp');
	}

	/** TEXT NOT NULL (stored as JSON string) */
	json(name: string): this {
		return this._addColumn(name, 'TEXT', 'json');
	}

	/** REAL (floating point with precision) — alias for real() */
	decimal(name: string): this {
		return this.real(name);
	}

	/** TEXT (ISO 8601 date only, no time) */
	date(name: string): this {
		return this._addColumn(name, 'TEXT', 'date');
	}

	/** TEXT (HH:MM:SS format) */
	time(name: string): this {
		return this._addColumn(name, 'TEXT', 'time');
	}

	// ── Constraints ─────────────────────────────────────

	private _addColumn(name: string, type: string, context: string): this {
		this._columns.push({
			name: sanitizeIdentifier(name, `TableBuilder.${context}`),
			type,
			nullable: false,
			primaryKey: false,
			autoIncrement: false,
			unique: false,
			indexed: false,
			defaultValue: null,
		});
		return this;
	}

	/** Make the most recently added column nullable */
	nullable(): this {
		const last = this._columns[this._columns.length - 1];
		if (last) last.nullable = true;
		return this;
	}

	/** Add UNIQUE constraint to the most recently added column */
	unique(): this {
		const last = this._columns[this._columns.length - 1];
		if (last) last.unique = true;
		return this;
	}

	/** Add INDEX to the most recently added column */
	index(): this {
		const last = this._columns[this._columns.length - 1];
		if (last) last.indexed = true;
		return this;
	}

	/** Add DEFAULT value to the most recently added column */
	default(value: string | number): this {
		const last = this._columns[this._columns.length - 1];
		if (last) {
			last.defaultValue = typeof value === 'number' ? String(value) : `'${value.replace(/'/g, "''")}'`;
		}
		return this;
	}

	/**
	 * Add DEFAULT value without quoting (for SQL keywords/functions).
	 * Example: .defaultRaw("CURRENT_TIMESTAMP") → DEFAULT CURRENT_TIMESTAMP
	 */
	defaultRaw(value: string): this {
		const last = this._columns[this._columns.length - 1];
		if (last) {
			last.defaultValue = value;
		}
		return this;
	}

	/** Get the compiled list of columns */
	get columns(): ColumnDef[] {
		return [...this._columns];
	}
}

// ─── Schema Builder ─────────────────────────────────────

export class SchemaBuilder {
	/**
	 * Generate a CREATE TABLE statement.
	 *
	 *   CREATE TABLE IF NOT EXISTS "table_name" (
	 *     id INTEGER PRIMARY KEY AUTOINCREMENT,
	 *     title TEXT NOT NULL,
	 *     status TEXT NOT NULL DEFAULT 'draft',
	 *     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	 *   )
	 */
	createTable(tableName: string, callback: (t: TableBuilder) => void, composites?: { columns: string[] }[]): SqlStatement[] {
		const tableNameClean = sanitizeIdentifier(tableName, 'SchemaBuilder.createTable');
		const builder = new TableBuilder();
		callback(builder);

		const columns = builder.columns;
		if (columns.length === 0) {
			throw new Error(`Cannot create table "${tableName}": no columns defined`);
		}

		// Uniqueness is SOFT-DELETE-AWARE on a soft-deletable table. An inline
		// column `UNIQUE` constraint is enforced on ALL rows — including soft-deleted
		// ones — so a deleted record would squat its value forever even though every
		// read (and the engine's uniqueness pre-check) treats deleted rows as gone.
		// Emit a PARTIAL unique index instead, mirroring the singleton guard: the
		// same shape the migrator + backfill emit, so all three agree on one name
		// (`uidx_<table>_<column>`) and one rule. Tables without `deleted_at` (core
		// system tables, m2m junctions) keep the plain constraint.
		const softDeletable = columns.some((c) => c.name === 'deleted_at');

		const columnDefs = columns.map((col) => {
			// Quote column names so SQLite reserved keywords (e.g. `in`) are usable
			const parts: string[] = [`"${sanitizeIdentifier(col.name, 'SchemaBuilder.createTable')}"`, col.type];

			if (!col.nullable) parts.push('NOT NULL');
			if (col.primaryKey && col.autoIncrement) {
				parts.push('PRIMARY KEY AUTOINCREMENT');
			} else if (col.primaryKey) {
				parts.push('PRIMARY KEY');
			}
			if (col.unique && !softDeletable) parts.push('UNIQUE');
			if (col.defaultValue !== null) parts.push(`DEFAULT ${col.defaultValue}`);

			return parts.join(' ');
		});

		const statements: SqlStatement[] = [{ sql: `CREATE TABLE IF NOT EXISTS ${tableNameClean} (${columnDefs.join(', ')})`, bindings: [] }];

		for (const col of columns) {
			if (col.indexed) {
				const indexName = `idx_${tableNameClean}_${col.name}`;
				statements.push({
					sql: `CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableNameClean} (${col.name})`,
					bindings: [],
				});
			}
			if (col.unique && softDeletable) {
				statements.push({
					sql: `CREATE UNIQUE INDEX IF NOT EXISTS "uidx_${tableNameClean}_${col.name}" ON "${tableNameClean}" ("${col.name}") WHERE "deleted_at" IS NULL`,
					bindings: [],
				});
			}
		}

		// Composite (multi-column) indexes — declared in the collection's schema so
		// hot multi-column filters use an index instead of scanning.*/
		for (const comp of composites ?? []) {
			if (!comp.columns || comp.columns.length < 2) continue;
			const cols = comp.columns.map((c) => sanitizeIdentifier(c, 'SchemaBuilder.composite.col')).join(', ');
			const idxName = `idx_${tableNameClean}_${comp.columns.map((c) => sanitizeIdentifier(c, 'SchemaBuilder.composite.col')).join('_')}`;
			statements.push({
				sql: `CREATE INDEX IF NOT EXISTS ${idxName} ON ${tableNameClean} (${cols})`,
				bindings: [],
			});
		}

		return statements;
	}

	/**
	 * Generate CREATE TABLE + indexes for an M2M junction table.
	 * Returns the junction table name and its DDL statements.
	 */
	createJunctionTable(sourceTable: string, targetTable: string): { table: string; statements: SqlStatement[] } {
		const source = sanitizeIdentifier(sourceTable, 'SchemaBuilder.junction.source');
		const target = sanitizeIdentifier(targetTable, 'SchemaBuilder.junction.target');
		const jtName = `_jt_${source}_${target}`;
		const createStatements = this.createTable(jtName, (t) => {
			t.uuid('id');
			t.text('source_id');
			t.text('target_id');
			t.timestamp('created_at').defaultRaw('CURRENT_TIMESTAMP');
		});
		return {
			table: jtName,
			statements: [
				...createStatements,
				{ sql: `CREATE INDEX IF NOT EXISTS idx_${jtName}_source ON ${jtName} (source_id)`, bindings: [] },
				{ sql: `CREATE INDEX IF NOT EXISTS idx_${jtName}_target ON ${jtName} (target_id)`, bindings: [] },
				{ sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_${jtName}_pair ON ${jtName} (source_id, target_id)`, bindings: [] },
			],
		};
	}
}
