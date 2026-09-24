/**
 * Generic Repository Pattern
 *
 * Provides typed CRUD operations for CMS collections.
 * Wraps QueryBuilder + D1Client into a clean, type-safe API.
 *
 * This is the recommended way to interact with D1 tables.
 * Direct QueryBuilder usage is also available for advanced cases.
 *
 * @example
 *   const repo = new Repository<Article>(db, 'cms_articles')
 *   const articles = await repo.findMany({ where: { status: 'published' }, limit: 10 })
 *   const article = await repo.findById('uuid-123')
 *   const created = await repo.create({ title: 'Hello', status: 'published' })
 *   const updated = await repo.update('uuid-123', { title: 'Updated' })
 *   await repo.delete('uuid-123')
 */

import { D1Client } from './d1-client';
import { QueryBuilder } from './query-builder';
import type { SqlStatement } from '@mmbix/types';
import { NotFoundError, InternalError, ValidationError, DEFAULT_PAGE_SIZE } from '@mmbix/utils';
import { sanitizeIdentifier } from '@mmbix/utils';

// ─── Query Options ─────────────────────────────────────

export interface FindManyOptions {
	fields?: string[];
	where?: Record<string, unknown>;
	orderBy?: Record<string, 'asc' | 'desc'>;
	limit?: number;
	offset?: number;
	/** Keyset cursor — the sort-column value of the boundary item (see dir). */
	cursor?: string;
	/**
	 * 'after' (default): items continuing the sort order after the cursor.
	 * 'before': items strictly before (older than) the cursor, returned in
	 * ascending sort order so the page reads oldest→newest up to the cursor.
	 */
	dir?: 'after' | 'before';
	/** Safety cap for findAll() — max rows a single call may return. Default: 1000. */
	maxLimit?: number;
}

export interface PaginatedResult<T> {
	data: T[];
	meta: {
		limit: number;
		has_more: boolean;
		next_cursor?: string;
		prev_cursor?: string;
	};
}

// ─── updated_at column detection ───────────────────────
// Checked once per table per isolate via PRAGMA and cached — no error-string
// sniffing and no re-executed UPDATE on tables without `updated_at`.
const tablesWithUpdatedAt = new Set<string>();
const tablesWithoutUpdatedAt = new Set<string>();

// ─── Constraint error parsing ──────────────────────────

/**
 * Classify a SQLite/D1 constraint-violation message into a field-level
 * ValidationError, or null when the message is not a known constraint.
 *
 * SINGLE SOURCE OF TRUTH: Repository writes map through it, and so does the
 * global error handler — a raw D1 constraint error can still escape a batched
 * write (e.g. a race past the engine's soft-delete-aware uniqueness pre-check),
 * and it must surface as a 400 ValidationError, never a 502 Database error.
 */
export function constraintViolation(msg: string): ValidationError | null {
	// UNIQUE constraint failed: table.column
	const uniqueMatch = msg.match(/UNIQUE constraint failed: \w+\.(\w+)/);
	if (uniqueMatch) {
		return new ValidationError(`"${uniqueMatch[1]}" already exists`, { [uniqueMatch[1]]: 'already exists' }, uniqueMatch[1]);
	}
	// NOT NULL constraint failed: table.column
	const notNullMatch = msg.match(/NOT NULL constraint failed: \w+\.(\w+)/);
	if (notNullMatch) {
		return new ValidationError(`"${notNullMatch[1]}" is required`, { [notNullMatch[1]]: 'is required' }, notNullMatch[1]);
	}
	// CHECK constraint
	const checkMatch = msg.match(/CHECK constraint failed: (\w+)/);
	if (checkMatch) {
		return new ValidationError(`Constraint violated: ${checkMatch[1]}`);
	}
	return null;
}

/** Map a D1 constraint-violation message to a field-level ValidationError
 *  (falls back to a generic ValidationError for unrecognised messages). */
function mapConstraintError(msg: string): ValidationError {
	return constraintViolation(msg) ?? new ValidationError(msg);
}

// ─── Repository ────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class Repository<T = any> {
	private _table: string;

	constructor(
		private db: D1Client,
		table: string,
	) {
		this._table = sanitizeIdentifier(table, 'Repository.table');
	}

	/** Get the sanitized table name */
	get table(): string {
		return this._table;
	}

	// ── Read Operations ────────────────────────────────

	/**
	 * Find all items with filtering, sorting, and cursor pagination.
	 */
	async findMany(options: FindManyOptions = {}): Promise<PaginatedResult<T>> {
		const qb = QueryBuilder.from(this._table);
		const limit = options.limit ?? DEFAULT_PAGE_SIZE;
		const fetchLimit = limit + 1;

		// Fields
		if (options.fields && options.fields.length > 0) {
			qb.select(...options.fields);
		}

		// WHERE conditions
		if (options.where) {
			for (const [key, value] of Object.entries(options.where)) {
				if (value === null) {
					qb.whereNull(key as string);
				} else if (Array.isArray(value)) {
					qb.whereIn(key as string, value);
				} else {
					qb.where(key as string, value as string);
				}
			}
		}

		// Keyset sort column: the first orderBy entry wins; default is id DESC.
		const orderEntries = options.orderBy ? Object.entries(options.orderBy) : [];
		const sortCol = orderEntries.length > 0 ? orderEntries[0][0] : 'id';
		const sortDir: 'asc' | 'desc' = orderEntries.length > 0 ? orderEntries[0][1] : 'desc';

		// ORDER BY
		if (orderEntries.length > 0) {
			for (const [key, dir] of orderEntries) {
				qb.orderBy(key, dir);
			}
		} else {
			qb.orderBy('id', 'desc');
		}

		// Cursor pagination (keyset). The cursor is the sort-column value of the
		// boundary item; dir selects which side of it to fetch.
		if (options.cursor) {
			if (options.dir === 'before') {
				// Window strictly before the cursor (older items). Fetch the
				// limit+1 NEWEST of those (desc), drop the extra oldest one (its
				// presence proves has_more), then reverse to ascending page order.
				qb.clearOrderBy();
				qb.where(sortCol, '<', options.cursor);
				qb.orderBy(sortCol, 'desc');
			} else {
				// Continue after the cursor in the caller's sort direction — the
				// comparison uses the orderBy column, not always id.
				if (sortDir === 'asc') {
					qb.where(sortCol, '>', options.cursor);
				} else {
					qb.where(sortCol, '<', options.cursor);
				}
			}
		}

		qb.limit(fetchLimit);

		// Offset pagination
		if (options.offset && !options.cursor) {
			qb.offset(options.offset);
		}

		const items = await this.db.all<T>(qb.toSelect());

		// has_more: the extra fetched row proves another page exists in the
		// direction we were walking (older items for `before`, the sort
		// direction for `after`).
		const hasMore = items.length > limit;
		if (hasMore) items.pop();

		if (options.dir === 'before') {
			items.reverse();
		}

		const cursorOf = (row: Record<string, unknown>): string | undefined => {
			const v = row[sortCol];
			return v === undefined || v === null ? undefined : String(v);
		};
		const lastItem = items.length > 0 ? (items[items.length - 1] as Record<string, unknown>) : undefined;
		const firstItem = items.length > 0 ? (items[0] as Record<string, unknown>) : undefined;

		return {
			data: items,
			meta: {
				limit,
				has_more: hasMore,
				...(hasMore && lastItem ? { next_cursor: cursorOf(lastItem) } : {}),
				...(options.cursor && firstItem ? { prev_cursor: cursorOf(firstItem) } : {}),
			},
		};
	}

	/**
	 * Find all items without pagination metadata.
	 *
	 * Hard-capped at 1000 rows by default to protect against accidental
	 * full-table reads. Pass an explicit `limit` to override the ceiling, or
	 * `maxLimit` to change the default ceiling itself.
	 */
	async findAll(options: Omit<FindManyOptions, 'cursor' | 'dir'> = {}): Promise<T[]> {
		const limit = options.limit ?? options.maxLimit ?? 1000;
		const result = await this.findMany({ ...options, limit });
		return result.data;
	}

	/**
	 * Find a single item by ID.
	 * Throws NotFoundError if not found.
	 */
	async findById(id: string, fields?: string[]): Promise<T> {
		const qb = QueryBuilder.from(this._table);
		if (fields && fields.length > 0) {
			qb.select(...fields);
		}
		qb.where('id', id as string);

		const item = await this.db.first<T>(qb.toSelect());
		if (!item) {
			throw new NotFoundError('Item', id);
		}
		return item;
	}

	/**
	 * Find a single item by any field.
	 * Returns null if not found (no throw).
	 */
	async findOne(where: Record<string, unknown>, fields?: string[]): Promise<T | null> {
		const qb = QueryBuilder.from(this._table);
		if (fields && fields.length > 0) {
			qb.select(...fields);
		}
		for (const [key, value] of Object.entries(where)) {
			if (value === null) {
				qb.whereNull(key);
			} else {
				qb.where(key, value as string);
			}
		}
		return this.db.first<T>(qb.toSelect());
	}

	/**
	 * Count items matching conditions.
	 */
	async count(where?: Record<string, unknown>): Promise<number> {
		const qb = QueryBuilder.from(this._table);
		if (where) {
			for (const [key, value] of Object.entries(where)) {
				if (value === null) {
					qb.whereNull(key);
				} else {
					qb.where(key, value as string);
				}
			}
		}
		const result = await this.db.first<{ count: number }>(qb.toCount());
		return result?.count ?? 0;
	}

	// ── Write Operations ────────────────────────────────

	/**
	 * Create a new item.
	 * Auto-generates UUID and timestamps.
	 */
	async create(data: Partial<T>): Promise<T> {
		const now = new Date().toISOString();
		const insertData = {
			id: crypto.randomUUID(),
			...data,
			created_at: now,
			updated_at: now,
		} as Record<string, unknown>;

		const stmt = QueryBuilder.from(this._table).returning(true).toInsert(insertData);

		try {
			const item = await this.db.runFirst<T>(stmt);
			if (!item) {
				throw new InternalError('Failed to create item: no row returned');
			}
			return item;
		} catch (err) {
			if (err instanceof InternalError && err.message.includes('Failed to create')) throw err;
			const msg = err instanceof Error ? err.message : 'Unknown error';
			if (msg.includes('UNIQUE constraint') || msg.includes('NOT NULL') || msg.includes('CHECK constraint')) {
				throw mapConstraintError(msg);
			}
			throw new InternalError('Create failed: ' + msg);
		}
	}

	/**
	 * Update an existing item by ID.
	 * Throws NotFoundError if not found.
	 * Maps constraint violations (UNIQUE, NOT NULL, CHECK) to field-level ValidationError.
	 */
	async update(id: string, data: Partial<T>): Promise<T> {
		const updateData = { ...data } as Record<string, unknown>;
		// Tables without an `updated_at` column (e.g. _audit_log) get the column
		// omitted instead of failing the UPDATE and re-running it (checked once
		// per table per isolate — see _tableHasUpdatedAt).
		if (await this._tableHasUpdatedAt()) {
			updateData.updated_at = new Date().toISOString();
		}
		const stmt = QueryBuilder.from(this._table)
			.returning(true)
			.where('id', id as string)
			.toUpdate(updateData);
		try {
			const item = await this.db.runFirst<T>(stmt);
			if (!item) throw new NotFoundError('Item', id);
			return item;
		} catch (err) {
			if (err instanceof NotFoundError) throw err;
			const msg = err instanceof Error ? err.message : 'Unknown error';
			if (msg.includes('UNIQUE constraint') || msg.includes('NOT NULL') || msg.includes('CHECK constraint')) {
				throw mapConstraintError(msg);
			}
			throw new InternalError('Update failed: ' + msg);
		}
	}

	/** True when the table has an `updated_at` column (PRAGMA-checked once, cached). */
	private async _tableHasUpdatedAt(): Promise<boolean> {
		if (tablesWithUpdatedAt.has(this._table)) return true;
		if (tablesWithoutUpdatedAt.has(this._table)) return false;
		const cols = await this.db.all<{ name: string }>({
			sql: `PRAGMA table_info("${this._table}")`,
			bindings: [],
		});
		const has = cols.some((c) => c.name === 'updated_at');
		(has ? tablesWithUpdatedAt : tablesWithoutUpdatedAt).add(this._table);
		return has;
	}

	/**
	 * Delete an item by ID.
	 * Throws NotFoundError if not found.
	 */
	async delete(id: string): Promise<void> {
		const stmt = QueryBuilder.from(this._table)
			.returning(true)
			.where('id', id as string)
			.toDelete();
		const result = await this.db.runFirst(stmt);
		if (!result) throw new NotFoundError('Item', id);
	}

	// ── Batch Operations ────────────────────────────────

	/**
	 * Execute multiple statements in a batch transaction.
	 */
	async batch(statements: SqlStatement[]): Promise<void> {
		await this.db.batch(statements);
	}

	/**
	 * Create multiple items in a single INSERT statement.
	 * Auto-generates UUID and timestamps for each row.
	 *
	 * @throws if row count exceeds D1's 100-bound-param limit (e.g., >33 rows with 3 fields).
	 */
	async createMany(dataArr: Partial<T>[]): Promise<T[]> {
		if (dataArr.length === 0) return [];
		const now = new Date().toISOString();
		const rows = dataArr.map(
			(data) =>
				({
					id: crypto.randomUUID(),
					...data,
					created_at: now,
					updated_at: now,
				}) as Record<string, unknown>,
		);

		const stmt = QueryBuilder.from(this._table).returning(true).toInsertMany(rows);
		try {
			return await this.db.all<T>(stmt);
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Unknown error';
			if (msg.includes('UNIQUE constraint') || msg.includes('NOT NULL') || msg.includes('CHECK constraint')) {
				throw mapConstraintError(msg);
			}
			throw new InternalError('Batch create failed: ' + msg);
		}
	}
}
