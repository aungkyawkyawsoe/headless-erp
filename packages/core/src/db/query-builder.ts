/**
 * Lightweight Knex-style SQL Query Builder for Cloudflare D1
 *
 * Generates parameterized SQL statements as { sql, bindings }
 * for safe execution via D1Database.prepare().bind().run().
 *
 * This is NOT an ORM — it only generates SQL strings.
 * No drivers, no connection pooling, no CLI — just query building.
 */

import type { SqlStatement } from '@mmbix/types';
import { sanitizeIdentifier } from '@mmbix/utils';

// ─── Types ──────────────────────────────────────────────

type WhereOp =
	| '='
	| '!='
	| '>'
	| '<'
	| '>='
	| '<='
	| 'LIKE'
	| 'NOT LIKE'
	| 'IN'
	| 'NOT IN'
	| 'IS NULL'
	| 'IS NOT NULL'
	| 'BETWEEN'
	| '__GROUP__'
	| '__EXISTS__'
	| 'RAW';

interface WhereClause {
	column: string;
	op: WhereOp;
	value: unknown;
	type: 'and' | 'or';
	not?: boolean; // For __EXISTS__ → NOT EXISTS
}

interface OrderByClause {
	column: string;
	direction: 'ASC' | 'DESC';
}

interface JoinClause {
	type: 'INNER' | 'LEFT';
	table: string;
	on: string;
	bindings: unknown[];
}

// ─── Query Builder ──────────────────────────────────────

export class QueryBuilder {
	private _table: string;
	private _columns: string[] = ['*'];
	private _wheres: WhereClause[] = [];
	private _orderBy: OrderByClause[] = [];
	private _groupBy: string[] = [];
	private _havings: { column: string; op: string; value: unknown }[] = [];
	private _limit?: number;
	private _offset?: number;
	private _distinct = false;
	private _returning = false;
	private _joins: JoinClause[] = [];
	private _rawSelects: string[] = [];
	/** Bindings for expressions added via selectRawWith / selectFn */
	private _rawBindings: unknown[] = [];
	private _conflictColumns?: string[];
	private _conflictAction?: 'nothing' | 'update';
	/** CTE definitions: { name, recursive, query (SqlStatement) } */
	private _ctes: { name: string; recursive: boolean; query: SqlStatement }[] = [];
	/** Named window definitions for window functions */
	private _windows: { name: string; definition: string }[] = [];

	private constructor(table: string) {
		this._table = sanitizeIdentifier(table, 'QueryBuilder.table');
	}

	/**
	 * Start building a query against the given table.
	 * Table name is sanitized immediately.
	 */
	static from(table: string): QueryBuilder {
		return new QueryBuilder(table);
	}

	/**
	 * Create a raw SQL statement with parameterized bindings.
	 * Use sparingly — only for DDL or SQLite system queries
	 * that can't be expressed with the QueryBuilder API.
	 *
	 * Example:
	 *   QueryBuilder.raw("SELECT name FROM sqlite_master WHERE type = 'table'")
	 *   QueryBuilder.raw("DELETE FROM posts WHERE id = ?", [id])
	 */
	static raw(sql: string, bindings: unknown[] = []): SqlStatement {
		return { sql, bindings };
	}

	/**
	 * Kysely-style SQL template literal tag.
	 * Auto-collects bindings from interpolated values.
	 * Subqueries (SqlStatement objects) are inlined with their bindings.
	 *
	 *   QueryBuilder.sql`SELECT * FROM posts WHERE status = ${'published'} AND author_id IN (${subquery})`
	 */
	static sql(strings: TemplateStringsArray, ...values: unknown[]): SqlStatement {
		let query = '';
		const bindings: unknown[] = [];
		for (let i = 0; i < strings.length; i++) {
			query += strings[i];
			if (i < values.length) {
				const val = values[i];
				// Inline subqueries (SqlStatement) without breaking parameter order
				if (
					typeof val === 'object' &&
					val !== null &&
					'sql' in (val as Record<string, unknown>) &&
					'bindings' in (val as Record<string, unknown>)
				) {
					const sub = val as SqlStatement;
					bindings.push(...sub.bindings);
					query += sub.sql;
				} else {
					bindings.push(val);
					query += '?';
				}
			}
		}
		return { sql: query, bindings };
	}

	// ── CTE (Common Table Expressions) ──────────────────

	/**
	 * Sanitize a column reference that may be qualified (`table.column` /
	 * `table.*`). Each dot-separated segment is validated; a trailing `*` is
	 * allowed only when `allowStar` (SELECT projections).
	 */
	private _sanitizeColumn(id: string, ctx: string, allowStar = false): string {
		const parts = id.split('.');
		const last = parts.length - 1;
		return parts.map((part, i) => (allowStar && i === last && part === '*' ? '*' : sanitizeIdentifier(part, ctx))).join('.');
	}

	/**
	 * Add a CTE (WITH clause).
	 *
	 *   const cte = QueryBuilder.from('posts').select('id', 'author_id').where('status', 'published');
	 *   const main = QueryBuilder.from('users')
	 *     .with('pub_posts', cte)
	 *     .join('pub_posts', 'pub_posts.author_id', 'users.id')
	 *     .select('users.name')
	 *     .toSelect();
	 */
	with(name: string, qb: QueryBuilder): this {
		this._ctes.push({ name: sanitizeIdentifier(name, 'QueryBuilder.with'), recursive: false, query: qb.toSelect() });
		return this;
	}

	/**
	 * Add a recursive CTE (WITH RECURSIVE).
	 * Useful for tree/hierarchy queries (M2A nested comments, org charts).
	 */
	withRecursive(name: string, qb: QueryBuilder): this {
		this._ctes.push({ name: sanitizeIdentifier(name, 'QueryBuilder.withRecursive'), recursive: true, query: qb.toSelect() });
		return this;
	}

	/** Render CTE prefix for SELECT/COUNT statements.
	 * Renumbers CTE bindings to not collide with main query bindings. */
	private _renderCTE(parts: string[], bindings: unknown[]): number {
		if (this._ctes.length === 0) return 0;
		const isRecursive = this._ctes.some((c) => c.recursive);
		let counter = 1;
		const cteDefs: string[] = [];
		for (const cte of this._ctes) {
			// Renumber CTE SQL placeholders to sequential global numbering
			const renumbered = cte.query.sql.replace(/\?\d+/g, () => `?${counter++}`);
			bindings.push(...cte.query.bindings);
			cteDefs.push(`${cte.name} AS (${renumbered})`);
		}
		parts.push(isRecursive ? `WITH RECURSIVE ${cteDefs.join(', ')}` : `WITH ${cteDefs.join(', ')}`);
		return counter;
	}

	// ── SELECT columns ──────────────────────────────────

	/**
	 * Specify columns to select. Defaults to ["*"].
	 * Column names are sanitized.
	 */
	select(...columns: string[]): this {
		this._columns = columns.map((c) => this._sanitizeColumn(c, 'QueryBuilder.select', true));
		return this;
	}

	/**
	 * Alias for .select(...) — same semantics as Knex.
	 */
	columns(...columns: string[]): this {
		return this.select(...columns);
	}

	/**
	 * Add a raw SELECT expression (e.g. a SQL function or arithmetic).
	 *
	 *   .selectRaw("COUNT(*) as total")
	 *   .selectRaw("qty * rate", "line_total")
	 */
	selectRaw(expression: string, alias?: string): this {
		if (alias) {
			this._rawSelects.push(`${expression} as ${alias}`);
		} else {
			this._rawSelects.push(expression);
		}
		return this;
	}

	/**
	 * Convenience alias for selectRaw that requires an alias.
	 * Useful for formula/computed columns where the alias is mandatory.
	 *
	 *   .selectExpr("qty * rate", "line_total")
	 *   .selectExpr("SUM(amount)", "total_amount")
	 */
	selectExpr(expression: string, alias: string): this {
		return this.selectRaw(expression, alias);
	}

	/**
	 * Add a raw SELECT expression with parameterized bindings.
	 * Bindings are collected and prepended to the query bindings in toSelect().
	 *
	 *   .selectRawWith("json_extract(meta, ?)", ['$.title'], "meta_title")
	 *   .selectRawWith("SUM(amount)", [], "total")
	 */
	selectRawWith(expression: string, bindings: unknown[], alias?: string): this {
		if (alias) {
			this._rawSelects.push(`${expression} as ${alias}`);
		} else {
			this._rawSelects.push(expression);
		}
		this._rawBindings.push(...bindings);
		return this;
	}

	/**
	 * Convenience: add a SQL function expression to SELECT with parameterized args.
	 *
	 *   .selectFn('json_extract', 'meta', '$.title')     → json_extract(?, ?)
	 *   .selectFn('COUNT', '*')                          → COUNT(*)
	 */
	selectFn(name: string, ...args: unknown[]): this {
		const bindings: unknown[] = [];
		const parts: string[] = [];
		for (const arg of args) {
			if (typeof arg === 'string' && arg === '*') {
				parts.push('*');
			} else {
				bindings.push(arg);
				parts.push('?');
			}
		}
		this._rawSelects.push(`${name}(${parts.join(', ')})`);
		this._rawBindings.push(...bindings);
		return this;
	}

	// ── WHERE clauses ───────────────────────────────────

	/**
	 * Add a WHERE clause.
	 *
	 * Two signatures:
	 *   .where("status", "published")          → WHERE status = ?
	 *   .where("views", ">", 100)              → WHERE views > ?
	 *   .where("status", "IN", ["a","b"])      → WHERE status IN (?, ?)
	 */
	where(column: string, opOrValue: WhereOp | unknown, maybeValue?: unknown): this {
		const col = this._sanitizeColumn(column, 'QueryBuilder.where');

		let op: WhereOp;
		let value: unknown;

		if (maybeValue !== undefined) {
			op = opOrValue as WhereOp;
			value = maybeValue;
		} else {
			op = '=';
			value = opOrValue;
		}

		this._validateOp(op);

		this._wheres.push({ column: col, op, value, type: 'and' });
		return this;
	}

	/**
	 * Add a WHERE ... OR ... clause.
	 */
	orWhere(column: string, opOrValue: WhereOp | unknown, maybeValue?: unknown): this {
		const col = this._sanitizeColumn(column, 'QueryBuilder.orWhere');
		let op: WhereOp;
		let value: unknown;
		if (maybeValue !== undefined) {
			op = opOrValue as WhereOp;
			value = maybeValue;
		} else {
			op = '=';
			value = opOrValue;
		}
		this._validateOp(op);
		this._wheres.push({ column: col, op, value, type: 'or' });
		return this;
	}

	/**
	 * Add a WHERE ... IN (...) clause.
	 *
	 * For lists > 50 values, uses json_each() to avoid D1's 100-bound-param limit.
	 * Complexity: O(1) bindings instead of O(n).
	 */
	whereIn(column: string, values: unknown[]): this {
		const col = this._sanitizeColumn(column, 'QueryBuilder.whereIn');
		if (values.length === 0) return this.whereRaw('1 = 0');
		// D1 limit: 100 bound params per query. Use json_each for large IN lists.
		if (values.length > 50) {
			return this.whereRaw(`${col} IN (SELECT value FROM json_each(?))`, [JSON.stringify(values)]);
		}
		this._wheres.push({ column: col, op: 'IN', value: values, type: 'and' });
		return this;
	}

	/** WHERE ... IN ... OR */
	orWhereIn(column: string, values: unknown[]): this {
		const col = sanitizeIdentifier(column, 'QueryBuilder.orWhereIn');
		if (values.length === 0) return this;
		if (values.length > 50) {
			return this._pushRaw(`${col} IN (SELECT value FROM json_each(?))`, [JSON.stringify(values)], 'or');
		}
		this._wheres.push({ column: col, op: 'IN', value: values, type: 'or' });
		return this;
	}

	/** Internal helper: push a raw RAW clause with explicit AND/OR type */
	private _pushRaw(sql: string, bindings: unknown[], type: 'and' | 'or'): this {
		this._wheres.push({ column: 'RAW', op: 'RAW', value: { sql, bindings }, type });
		return this;
	}

	/**
	 * Add a WHERE ... NOT IN (...) clause.
	 */
	whereNotIn(column: string, values: unknown[]): this {
		const col = sanitizeIdentifier(column, 'QueryBuilder.whereNotIn');
		// NOT IN () is vacuously true — matches everything (mirror of whereIn([]) → 1 = 0).
		if (values.length === 0) return this.whereRaw('1 = 1');
		if (values.length > 50) {
			return this.whereRaw(`${col} NOT IN (SELECT value FROM json_each(?))`, [JSON.stringify(values)]);
		}
		this._wheres.push({ column: col, op: 'NOT IN', value: values, type: 'and' });
		return this;
	}

	/** WHERE ... NOT IN ... OR */
	orWhereNotIn(column: string, values: unknown[]): this {
		const col = sanitizeIdentifier(column, 'QueryBuilder.orWhereNotIn');
		// NOT IN () is vacuously true — OR 1 = 1 matches everything.
		if (values.length === 0) return this._pushRaw('1 = 1', [], 'or');
		if (values.length > 50) {
			return this._pushRaw(`${col} NOT IN (SELECT value FROM json_each(?))`, [JSON.stringify(values)], 'or');
		}
		this._wheres.push({ column: col, op: 'NOT IN', value: values, type: 'or' });
		return this;
	}

	/**
	 * Add a WHERE column IS NULL clause.
	 */
	whereNull(column: string): this {
		this._wheres.push({
			column: this._sanitizeColumn(column, 'QueryBuilder.whereNull'),
			op: 'IS NULL',
			value: null,
			type: 'and',
		});
		return this;
	}

	/** WHERE column IS NULL ... OR */
	orWhereNull(column: string): this {
		this._wheres.push({
			column: sanitizeIdentifier(column, 'QueryBuilder.orWhereNull'),
			op: 'IS NULL',
			value: null,
			type: 'or',
		});
		return this;
	}

	/**
	 * Add a WHERE column IS NOT NULL clause.
	 */
	whereNotNull(column: string): this {
		this._wheres.push({
			column: sanitizeIdentifier(column, 'QueryBuilder.whereNotNull'),
			op: 'IS NOT NULL',
			value: null,
			type: 'and',
		});
		return this;
	}

	/** WHERE column IS NOT NULL ... OR */
	orWhereNotNull(column: string): this {
		this._wheres.push({
			column: sanitizeIdentifier(column, 'QueryBuilder.orWhereNotNull'),
			op: 'IS NOT NULL',
			value: null,
			type: 'or',
		});
		return this;
	}

	/** WHERE column BETWEEN low AND high */
	whereBetween(column: string, low: unknown, high: unknown): this {
		const col = sanitizeIdentifier(column, 'QueryBuilder.whereBetween');
		this._wheres.push({ column: col, op: 'BETWEEN', value: [low, high], type: 'and' });
		return this;
	}

	/** WHERE column NOT BETWEEN low AND high */
	whereNotBetween(column: string, low: unknown, high: unknown): this {
		return this.whereRaw(`${sanitizeIdentifier(column, 'QueryBuilder.whereNotBetween')} NOT BETWEEN ? AND ?`, [low, high]);
	}

	/**
	 * Add a parenthesized WHERE group.
	 *
	 * Each clause joins the others with its own `type` ('or' | 'and'),
	 * defaulting to the group's type when unspecified; the whole group joins
	 * the rest of the query with `groupType`.
	 *
	 *   .where('status', 'published')
	 *    .whereGroup([
	 *      { column: 'type', op: '=', value: 'blog', type: 'or' },
	 *      { column: 'type', op: '=', value: 'news', type: 'or' },
	 *    ], 'and')
	 *   // WHERE status = ?1 AND (type = ?2 OR type = ?3)
	 */
	whereGroup(clauses: { column: string; op: string; value: unknown; type?: 'and' | 'or' }[], groupType: 'and' | 'or' = 'and'): this {
		if (clauses.length === 0) return this;
		this._wheres.push({
			column: '__GROUP__',
			op: '__GROUP__',
			value: clauses.map((c) => {
				this._validateOp(c.op);
				return {
					column: c.column,
					op: c.op,
					value: c.value,
					// Per-clause type — defaults to the group type so legacy callers
					// that pass no `type` keep their exact previous behavior.
					type: c.type ?? groupType,
				};
			}),
			type: groupType,
		});
		return this;
	}

	// ── JOINS ──────────────────────────────────────────

	/**
	 * Add a JOIN clause.
	 *
	 *   .join("posts", "posts.user_id", "users.id")             → INNER JOIN posts ON posts.user_id = users.id
	 *   .join("posts", "posts.user_id", "users.id", "LEFT")     → LEFT JOIN posts ON posts.user_id = users.id
	 *
	 * Qualified identifiers (table.column) are sanitized per segment. `alias`
	 * renders `table AS alias` — needed when the same related table is joined
	 * multiple times (e.g. two m2o fields pointing at one collection).
	 */
	join(table: string, first: string, second: string, type: 'INNER' | 'LEFT' = 'INNER', alias?: string): this {
		const safeTable = alias
			? `${sanitizeIdentifier(table, 'QueryBuilder.join')} AS ${sanitizeIdentifier(alias, 'QueryBuilder.join.alias')}`
			: sanitizeIdentifier(table, 'QueryBuilder.join');
		const safeFirst = this._sanitizeQualified(first, 'QueryBuilder.join.on');
		const safeSecond = this._sanitizeQualified(second, 'QueryBuilder.join.on');
		this._joins.push({
			type,
			table: safeTable,
			on: `${safeFirst} = ${safeSecond}`,
			bindings: [],
		});
		return this;
	}

	/** Sanitize a possibly qualified identifier (a.b → sanitized(a).sanitized(b)) */
	private _sanitizeQualified(id: string, ctx: string): string {
		return id
			.split('.')
			.map((part) => sanitizeIdentifier(part, ctx))
			.join('.');
	}

	/**
	 * Add a LEFT JOIN clause (convenience method).
	 *
	 *   .leftJoin("posts", "posts.user_id", "users.id")
	 *   .leftJoin("customers", "orders.customer_id", "customers.id", "rj_customer")
	 */
	leftJoin(table: string, first: string, second: string, alias?: string): this {
		return this.join(table, first, second, 'LEFT', alias);
	}

	/**
	 * Add a raw JOIN clause for complex joins.
	 *
	 *   .joinRaw("LEFT JOIN posts ON posts.user_id = users.id AND posts.status = ?", ["published"])
	 *   .joinRaw("CROSS JOIN categories")
	 *
	 * Parameter placeholders (?) in the clause will be renumbered
	 * to match their position in the merged bindings array.
	 */
	joinRaw(joinClause: string, bindings: unknown[] = []): this {
		this._joins.push({
			type: 'INNER',
			table: '',
			on: joinClause,
			bindings,
		});
		return this;
	}

	// ── DISTINCT ──────────────────────────────────────

	/** Add DISTINCT to SELECT */
	distinct(): this {
		this._distinct = true;
		return this;
	}

	// ── GROUP BY ──────────────────────────────────────

	groupBy(...cols: string[]): this {
		this._groupBy = cols.map((c) => this._sanitizeColumn(c, 'QueryBuilder.groupBy'));
		return this;
	}

	// ── HAVING ────────────────────────────────────────

	private static readonly _HAVING_OPS = new Set<string>([
		'=',
		'!=',
		'>',
		'<',
		'>=',
		'<=',
		'LIKE',
		'IN',
		'NOT IN',
		'IS NULL',
		'IS NOT NULL',
		'BETWEEN',
	]);

	having(col: string, op: string, val: unknown): this {
		if (!QueryBuilder._HAVING_OPS.has(op.toUpperCase())) {
			throw new Error(`Invalid HAVING operator: "${op}". Valid: ${[...QueryBuilder._HAVING_OPS].join(', ')}`);
		}
		this._havings.push({ column: this._sanitizeColumn(col, 'QueryBuilder.having'), op, value: val });
		return this;
	}

	// ── WINDOW ─────────────────────────────────────────

	/**
	 * Add a named WINDOW clause for window functions.
	 *
	 *   .window('w', 'PARTITION BY dept ORDER BY salary DESC')
	 */
	window(name: string, definition: string): this {
		this._windows.push({ name: sanitizeIdentifier(name, 'QueryBuilder.window'), definition });
		return this;
	}

	// ── Shortcuts ──────────────────────────────────────

	/** Shorthand for `whereGroup(clauses, 'or')` — parenthesized OR group */
	orCond(clauses: { column: string; op: string; value: unknown }[]): this {
		return this.whereGroup(clauses, 'or');
	}

	/** Shorthand for `whereGroup(clauses, 'and')` — parenthesized AND group */
	andCond(clauses: { column: string; op: string; value: unknown }[]): this {
		return this.whereGroup(clauses, 'and');
	}

	// ── Static expression helpers ──────────────────────

	/**
	 * Build a SQL function expression string (no bindings).
	 * For use with selectRaw/whereRaw — args are interpolated directly.
	 * Only use with trusted (non-user-input) values.
	 *
	 *   QueryBuilder.fn('COUNT', '*')              // "COUNT(*)"
	 *   QueryBuilder.fn('json_extract', 'meta', "'$.title'")  // "json_extract(meta, '$.title')"
	 */
	static fn(name: string, ...args: string[]): string {
		return `${name}(${args.join(', ')})`;
	}

	/**
	 * Build a CASE expression string for use with selectRaw().
	 *
	 *   QueryBuilder.case("status = 'active'", "'yes'", "'no'")  // CASE WHEN status = 'active' THEN 'yes' ELSE 'no' END
	 */
	static caseWhen(whenClause: string, thenValue: string, elseValue?: string): string {
		const base = `CASE WHEN ${whenClause} THEN ${thenValue}`;
		return elseValue !== undefined ? `${base} ELSE ${elseValue} END` : `${base} END`;
	}

	// ── ORDER BY ───────────────────────────────────────

	orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): this {
		const dir = direction.toLowerCase();
		if (dir !== 'asc' && dir !== 'desc') {
			throw new Error(`Invalid ORDER BY direction: "${direction}". Valid: asc, desc`);
		}
		this._orderBy.push({
			column: this._sanitizeColumn(column, 'QueryBuilder.orderBy'),
			direction: dir.toUpperCase() as 'ASC' | 'DESC',
		});
		return this;
	}

	/**
	 * Remove all ORDER BY clauses.
	 * Used when rebuilding the ordering for reverse (dir=before) keyset pagination.
	 */
	clearOrderBy(): this {
		this._orderBy = [];
		return this;
	}

	/**
	 * Add a raw ORDER BY clause without sanitizing the column expression.
	 * Useful for qualified column names like "cms_categories.name".
	 *
	 *   .orderByRaw("cms_categories.name", "asc")
	 */
	orderByRaw(expression: string, direction: 'asc' | 'desc' = 'asc'): this {
		const dir = direction.toLowerCase();
		if (dir !== 'asc' && dir !== 'desc') {
			throw new Error(`Invalid ORDER BY direction: "${direction}". Valid: asc, desc`);
		}
		this._orderBy.push({
			column: expression,
			direction: dir.toUpperCase() as 'ASC' | 'DESC',
		});
		return this;
	}

	// ── LIMIT / OFFSET ─────────────────────────────────

	limit(n: number): this {
		if (!Number.isInteger(n) || n < 0) throw new Error('LIMIT must be a non-negative integer');
		this._limit = n;
		return this;
	}

	offset(n: number): this {
		if (!Number.isInteger(n) || n < 0) throw new Error('OFFSET must be a non-negative integer');
		this._offset = n;
		return this;
	}

	/**
	 * Include RETURNING * at the end of INSERT/UPDATE/DELETE.
	 * DISABLED by default — call .returning(true) explicitly (the Repository
	 * does). Use .withoutReturning() to disable after enabling.
	 */
	returning(enabled = true): this {
		this._returning = enabled;
		return this;
	}

	withoutReturning(): this {
		this._returning = false;
		return this;
	}

	// ── SQL Generation ─────────────────────────────────

	/**
	 * Generate a SELECT statement.
	 *
	 *   SELECT col1, col2 FROM table WHERE col = ?1 ORDER BY col ASC LIMIT ?2 OFFSET ?3
	 */
	toSelect(): SqlStatement {
		const parts: string[] = [];
		const bindings: unknown[] = [];

		// CTE prefix (WITH / WITH RECURSIVE) — must come before SELECT
		let paramIndex = this._renderCTE(parts, bindings);
		if (paramIndex === 0) paramIndex = 1;

		// Raw expression bindings (from selectRawWith / selectFn) — before WHERE
		if (this._rawBindings.length > 0) {
			bindings.push(...this._rawBindings);
			paramIndex = bindings.length + 1;
		}

		// SELECT columns — include raw selects after regular columns
		const allColumns = [...this._columns];
		if (this._rawSelects.length > 0) {
			allColumns.push(...this._rawSelects);
		}
		parts.push(`SELECT ${this._distinct ? 'DISTINCT ' : ''}${allColumns.join(', ')}`);
		parts.push(`FROM ${this._table}`);

		// JOINs (after FROM, before WHERE)
		paramIndex = this._buildJoins(parts, bindings, paramIndex);

		// WHERE
		this._buildWhere(parts, bindings, paramIndex);
		paramIndex = bindings.length + 1;

		// GROUP BY
		if (this._groupBy.length > 0) {
			parts.push(`GROUP BY ${this._groupBy.join(', ')}`);
		}

		// HAVING
		if (this._havings.length > 0) {
			const havingClauses = this._havings.map((h) => {
				bindings.push(h.value);
				return `${h.column} ${h.op} ?${paramIndex++}`;
			});
			parts.push(`HAVING ${havingClauses.join(' AND ')}`);
		}

		// WINDOW (after HAVING, before ORDER BY)
		if (this._windows.length > 0) {
			const winDefs = this._windows.map((w) => `${w.name} AS (${w.definition})`);
			parts.push(`WINDOW ${winDefs.join(', ')}`);
		}

		// ORDER BY
		if (this._orderBy.length > 0) {
			const clauses = this._orderBy.map((o) => `${o.column} ${o.direction}`);
			parts.push(`ORDER BY ${clauses.join(', ')}`);
		}

		// LIMIT
		if (this._limit !== undefined) {
			parts.push(`LIMIT ?${paramIndex}`);
			bindings.push(this._limit);
			paramIndex++;
		}

		// OFFSET
		if (this._offset !== undefined) {
			parts.push(`OFFSET ?${paramIndex}`);
			bindings.push(this._offset);
			paramIndex++;
		}

		return { sql: parts.join(' '), bindings };
	}

	/**
	 * Enable ON CONFLICT handling for the next INSERT.
	 *
	 *   .onConflict(['id'], 'nothing')  → ON CONFLICT(id) DO NOTHING
	 *   .onConflict(['id'], 'update')  → ON CONFLICT(id) DO UPDATE SET col = excluded.col
	 */
	onConflict(columns: string[], action: 'nothing' | 'update' = 'nothing'): this {
		this._conflictColumns = columns.map((c) => sanitizeIdentifier(c, 'QueryBuilder.onConflict'));
		this._conflictAction = action;
		return this;
	}

	/**
	 * Generate an INSERT statement.
	 *
	 *   INSERT INTO table (col1, col2) VALUES (?1, ?2) RETURNING *
	 *
	 * When .onConflict() was called, appends ON CONFLICT clause.
	 */
	toInsert(data: Record<string, unknown>): SqlStatement {
		const entries = Object.entries(data);
		if (entries.length === 0) {
			throw new Error('Cannot insert: no data provided');
		}

		const parts: string[] = [];
		const bindings: unknown[] = [];

		// CTE prefix (WITH / WITH RECURSIVE) — must come before INSERT
		let paramIndex = this._renderCTE(parts, bindings);
		if (paramIndex === 0) paramIndex = 1;

		// Quote identifiers so SQLite reserved keywords (e.g. `in`, `order`) work as column names.
		// Safe because sanitizeIdentifier has already validated ^[a-zA-Z_][a-zA-Z0-9_]*$ (no embedded quotes).
		const quote = (col: string) => `"${col}"`;
		const sanitized = entries.map(([col]) => sanitizeIdentifier(col, 'QueryBuilder.toInsert'));
		const columns = sanitized.map(quote);
		const placeholders = columns.map((_, i) => `?${paramIndex + i}`);
		for (const [, val] of entries) bindings.push(val);
		paramIndex += entries.length;

		let sql = `INSERT INTO ${this._table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;

		if (this._conflictColumns && this._conflictColumns.length > 0) {
			const conflictTarget = this._conflictColumns.join(', ');
			if (this._conflictAction === 'nothing') {
				sql += ` ON CONFLICT(${conflictTarget}) DO NOTHING`;
			} else if (this._conflictAction === 'update') {
				const doUpdateSet = sanitized.map((c) => `${quote(c)} = excluded.${quote(c)}`).join(', ');
				sql += ` ON CONFLICT(${conflictTarget}) DO UPDATE SET ${doUpdateSet}`;
			}
		}

		if (this._returning) {
			sql += ' RETURNING *';
		}

		if (parts.length > 0) sql = parts.join(' ') + ' ' + sql;
		return { sql, bindings };
	}

	/**
	 * Generate a multi-row INSERT statement.
	 *
	 *   INSERT INTO table (a, b) VALUES (?1, ?2), (?3, ?4) RETURNING *
	 *
	 * ⚠️ D1 limits bound params to 100 per query.
	 *   For N rows × K columns: ensure N × K ≤ 100.
	 */
	toInsertMany(rows: Record<string, unknown>[]): SqlStatement {
		if (rows.length === 0) throw new Error('Cannot insert: no rows provided');

		const columns = Object.keys(rows[0]);
		if (columns.length === 0) throw new Error('Cannot insert: empty row');

		// Validate all rows have the same keys
		for (let i = 1; i < rows.length; i++) {
			const rowKeys = Object.keys(rows[i]);
			if (rowKeys.length !== columns.length || !columns.every((k) => k in rows[i])) {
				throw new Error(`Row ${i} has different keys from row 0`);
			}
		}

		const parts: string[] = [];
		const bindings: unknown[] = [];

		// CTE prefix (WITH / WITH RECURSIVE) — must come before INSERT
		let paramIndex = this._renderCTE(parts, bindings);
		if (paramIndex === 0) paramIndex = 1;

		// Quote identifiers so SQLite reserved keywords (e.g. `in`) work as column names
		// (safe — sanitizeIdentifier guarantees no embedded quotes).
		const quote = (col: string) => `"${col}"`;
		const safeColumns = columns.map((c) => quote(sanitizeIdentifier(c, 'QueryBuilder.toInsertMany')));
		const valuePlaceholders: string[] = [];

		for (const row of rows) {
			const rowParts = columns.map((col) => {
				bindings.push(row[col]);
				return `?${paramIndex++}`;
			});
			valuePlaceholders.push(`(${rowParts.join(', ')})`);
		}

		let sql = `INSERT INTO ${this._table} (${safeColumns.join(', ')}) VALUES ${valuePlaceholders.join(', ')}`;

		// onConflict — same semantics as toInsert (upsert support for bulk writes)
		if (this._conflictColumns && this._conflictColumns.length > 0) {
			const conflictTarget = this._conflictColumns.join(', ');
			if (this._conflictAction === 'nothing') {
				sql += ` ON CONFLICT(${conflictTarget}) DO NOTHING`;
			} else if (this._conflictAction === 'update') {
				const doUpdateSet = columns.map((c) => `${quote(c)} = excluded.${quote(c)}`).join(', ');
				sql += ` ON CONFLICT(${conflictTarget}) DO UPDATE SET ${doUpdateSet}`;
			}
		}

		if (this._returning) {
			sql += ' RETURNING *';
		}

		if (parts.length > 0) sql = parts.join(' ') + ' ' + sql;
		return { sql, bindings };
	}

	/**
	 * Generate an UPDATE statement.
	 *
	 *   UPDATE table SET col1 = ?1, col2 = ?2 WHERE id = ?3 RETURNING *
	 */
	toUpdate(data: Record<string, unknown>): SqlStatement {
		const entries = Object.entries(data);
		if (entries.length === 0) {
			throw new Error('Cannot update: no data provided');
		}

		const parts: string[] = [];
		const bindings: unknown[] = [];

		// CTE prefix (WITH / WITH RECURSIVE) — must come before UPDATE
		let paramIndex = this._renderCTE(parts, bindings);
		if (paramIndex === 0) paramIndex = 1;

		const setClauses = entries.map(([col]) => {
			const safe = sanitizeIdentifier(col, 'QueryBuilder.toUpdate');
			bindings.push(data[col]);
			return `${safe} = ?${paramIndex++}`;
		});

		let sql = `UPDATE ${this._table} SET ${setClauses.join(', ')}`;

		// WHERE
		const whereParts: string[] = [];
		this._buildWhere(whereParts, bindings, paramIndex);
		if (whereParts.length > 0) {
			sql += ' ' + whereParts.join(' ');
		}

		if (this._returning) {
			sql += ' RETURNING *';
		}

		if (parts.length > 0) sql = parts.join(' ') + ' ' + sql;
		return { sql, bindings };
	}

	/**
	 * Generate a DELETE statement.
	 *
	 *   DELETE FROM table WHERE id = ?1
	 */
	toDelete(): SqlStatement {
		const parts: string[] = [];
		const bindings: unknown[] = [];

		// CTE prefix (WITH / WITH RECURSIVE) — must come before DELETE
		let paramIndex = this._renderCTE(parts, bindings);
		if (paramIndex === 0) paramIndex = 1;

		let sql = `DELETE FROM ${this._table}`;

		// WHERE
		const whereParts: string[] = [];
		this._buildWhere(whereParts, bindings, paramIndex);
		if (whereParts.length > 0) {
			sql += ' ' + whereParts.join(' ');
		}

		if (this._returning) {
			sql += ' RETURNING *';
		}

		if (parts.length > 0) sql = parts.join(' ') + ' ' + sql;
		return { sql, bindings };
	}

	/**
	 * Generate a COUNT(*) query.
	 *
	 *   SELECT COUNT(*) as count FROM table ...
	 */
	toCount(): SqlStatement {
		const parts: string[] = [];
		const bindings: unknown[] = [];

		// CTE prefix
		let cteParamIdx = this._renderCTE(parts, bindings);
		if (cteParamIdx === 0) cteParamIdx = 1;

		parts.push('SELECT COUNT(*) as count');
		parts.push(`FROM ${this._table}`);

		// JOINs (after FROM, before WHERE)
		const paramIndex = this._buildJoins(parts, bindings, cteParamIdx);

		this._buildWhere(parts, bindings, paramIndex);

		return { sql: parts.join(' '), bindings };
	}

	/**
	 * Wrap a SELECT query with EXPLAIN QUERY PLAN for index debugging.
	 *
	 *   const plan = QueryBuilder.from('posts').where('status', 'draft').explain();
	 *   // EXPLAIN QUERY PLAN SELECT * FROM posts WHERE status = ?1
	 */
	explain(): SqlStatement {
		const stmt = this.toSelect();
		return { sql: `EXPLAIN QUERY PLAN ${stmt.sql}`, bindings: stmt.bindings };
	}

	// ── Internal ────────────────────────────────────────

	private _buildWhere(parts: string[], bindings: unknown[], startIndex: number): void {
		if (this._wheres.length === 0) return;

		const segments: string[] = [];
		let idx = startIndex;
		let first = true;

		for (const w of this._wheres) {
			let clause: string;

			if (w.column === '__GROUP__') {
				// Parenthesized group — each clause joins with its OWN type
				// (defaulted to the group type in whereGroup()), so `AND (a OR b)`
				// is expressible. The group itself joins the rest via w.type below.
				const group = w.value as WhereClause[];
				const subItems: string[] = [];
				let firstInGroup = true;
				for (const g of group) {
					const result = this._buildSingleClause(g, bindings, idx);
					const joinOp = firstInGroup ? '' : g.type === 'or' ? ' OR ' : ' AND ';
					subItems.push(joinOp + result.clause);
					idx = result.nextIdx;
					firstInGroup = false;
				}
				clause = '(' + subItems.join('') + ')';
			} else {
				const result = this._buildSingleClause(w, bindings, idx);
				clause = result.clause;
				idx = result.nextIdx;
			}

			if (first) {
				segments.push(clause);
				first = false;
			} else {
				// All clauses (simple and group) use their own type for outer joining
				const joinOp = w.type === 'or' ? 'OR' : 'AND';
				segments.push(joinOp + ' ' + clause);
			}
		}

		parts.push('WHERE ' + segments.join(' '));
	}

	private _buildSingleClause(w: WhereClause, bindings: unknown[], startIdx: number): { clause: string; nextIdx: number } {
		let idx = startIdx;
		if (w.op === 'RAW') {
			const raw = w.value as { sql: string; bindings: unknown[] };
			let counter = startIdx;
			// Replace ? or ?N with sequentially numbered placeholders
			const sql = raw.sql.replace(/\?(\d+)?/g, () => `?${counter++}`);
			bindings.push(...raw.bindings);
			return { clause: sql, nextIdx: counter };
		}
		// Column whitelist — plain or qualified identifiers only. This is the
		// one render path that historically skipped sanitization (whereGroup
		// clauses carry user-influenced names straight through).
		if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(w.column)) {
			throw new Error(`Invalid column in WHERE clause: "${w.column}"`);
		}
		// Op whitelist (defense-in-depth; where()/whereGroup() already validate).
		// __EXISTS__ is an internal marker, not a SQL operator — skip it.
		if (w.op !== '__EXISTS__') this._validateOp(w.op);
		if (w.op === 'IN' || w.op === 'NOT IN') {
			// Subquery support: if value is SqlStatement, render as subquery
			if (typeof w.value === 'object' && w.value !== null && 'sql' in (w.value as Record<string, unknown>)) {
				return this._renderSubqueryClause(w, bindings, idx);
			}
			const arr = w.value as unknown[];
			const placeholders = arr.map(() => '?' + idx++);
			bindings.push(...arr);
			return { clause: w.column + ' ' + w.op + ' (' + placeholders.join(', ') + ')', nextIdx: idx };
		} else if (w.op === '__EXISTS__') {
			return this._renderSubqueryClause(w, bindings, idx);
		} else if (w.op === 'IS NULL' || w.op === 'IS NOT NULL') {
			return { clause: w.column + ' ' + w.op, nextIdx: idx };
		} else if (w.op === 'BETWEEN') {
			const arr = w.value as [unknown, unknown];
			bindings.push(arr[0], arr[1]);
			return { clause: w.column + ' BETWEEN ?' + idx++ + ' AND ?' + idx++, nextIdx: idx };
		} else {
			bindings.push(w.value);
			return { clause: w.column + ' ' + w.op + ' ?' + idx++, nextIdx: idx };
		}
	}

	private _validateOp(op: string): void {
		const validOps: WhereOp[] = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL', 'BETWEEN'];
		if (!validOps.includes(op as WhereOp)) {
			throw new Error(`Invalid WHERE operator: "${op}" on table "${this._table}". Valid: ${validOps.join(', ')}`);
		}
	}

	/** Add a raw SQL WHERE clause (AND type). */
	whereRaw(sql: string, bindings?: unknown[]): this {
		return this._pushRaw(sql, bindings || [], 'and');
	}

	/** Add a raw SQL OR WHERE clause (OR type). */
	orWhereRaw(sql: string, bindings?: unknown[]): this {
		return this._pushRaw(sql, bindings || [], 'or');
	}

	// ── Subquery Support ─────────────────────────────

	/**
	 * WHERE column IN (subquery).
	 * Accepts a QueryBuilder instance as the value.
	 */
	whereInSubquery(column: string, qb: QueryBuilder): this {
		const sub = qb.toSelect();
		const col = sanitizeIdentifier(column, 'QueryBuilder.whereInSubquery');
		this._wheres.push({
			column: col,
			op: 'IN',
			value: sub,
			type: 'and',
		});
		return this;
	}

	/** WHERE column NOT IN (subquery) */
	whereNotInSubquery(column: string, qb: QueryBuilder): this {
		const sub = qb.toSelect();
		const col = sanitizeIdentifier(column, 'QueryBuilder.whereNotInSubquery');
		this._wheres.push({
			column: col,
			op: 'NOT IN',
			value: sub,
			type: 'and',
		});
		return this;
	}

	/** WHERE EXISTS (subquery) */
	whereExists(qb: QueryBuilder): this {
		const sub = qb.toSelect();
		this._wheres.push({
			column: '__EXISTS__',
			op: '__EXISTS__',
			value: sub,
			type: 'and',
		});
		return this;
	}

	/** WHERE NOT EXISTS (subquery) */
	whereNotExists(qb: QueryBuilder): this {
		const sub = qb.toSelect();
		this._wheres.push({
			column: '__EXISTS__',
			op: '__EXISTS__',
			value: sub,
			type: 'and',
			not: true,
		});
		return this;
	}

	/** WHERE EXISTS ... OR (subquery) */
	orWhereExists(qb: QueryBuilder): this {
		const sub = qb.toSelect();
		this._wheres.push({
			column: '__EXISTS__',
			op: '__EXISTS__',
			value: sub,
			type: 'or',
		});
		return this;
	}

	/** WHERE NOT EXISTS ... OR (subquery) */
	orWhereNotExists(qb: QueryBuilder): this {
		const sub = qb.toSelect();
		this._wheres.push({
			column: '__EXISTS__',
			op: '__EXISTS__',
			value: sub,
			type: 'or',
			not: true,
		});
		return this;
	}

	// ── Clone ────────────────────────────────────────

	/** Deep clone this QueryBuilder for safe reuse */
	clone(): QueryBuilder {
		const qb = new QueryBuilder(this._table);
		qb._columns = [...this._columns];
		qb._wheres = this._wheres.map((w) => ({ ...w }));
		qb._orderBy = this._orderBy.map((o) => ({ ...o }));
		qb._groupBy = [...this._groupBy];
		qb._havings = this._havings.map((h) => ({ ...h }));
		qb._limit = this._limit;
		qb._offset = this._offset;
		qb._distinct = this._distinct;
		qb._returning = this._returning;
		qb._joins = this._joins.map((j) => ({ ...j, bindings: [...j.bindings] }));
		qb._rawSelects = [...this._rawSelects];
		qb._rawBindings = [...this._rawBindings];
		qb._conflictColumns = this._conflictColumns ? [...this._conflictColumns] : undefined;
		qb._conflictAction = this._conflictAction;
		qb._ctes = this._ctes.map((c) => ({ ...c, query: { sql: c.query.sql, bindings: [...c.query.bindings] } }));
		qb._windows = this._windows.map((w) => ({ ...w }));
		return qb;
	}

	// ── Static: UNION ────────────────────────────────

	/**
	 * Combine multiple queries with UNION.
	 *
	 *   QueryBuilder.union([q1, q2])    → SELECT ... UNION SELECT ...
	 *   QueryBuilder.unionAll([q1, q2]) → SELECT ... UNION ALL SELECT ...
	 */
	static union(queries: QueryBuilder[], all = false): SqlStatement {
		if (queries.length < 2) throw new Error('UNION requires at least 2 queries');
		const statements = queries.map((q) => q.toSelect());
		const allBindings: unknown[] = [];
		const renumberedSqls = statements.map((stmt) => {
			let counter = allBindings.length + 1;
			const sql = stmt.sql.replace(/\?\d+/g, () => `?${counter++}`);
			allBindings.push(...stmt.bindings);
			return sql;
		});
		return { sql: renumberedSqls.join(all ? ' UNION ALL ' : ' UNION '), bindings: allBindings };
	}

	static unionAll(queries: QueryBuilder[]): SqlStatement {
		return QueryBuilder.union(queries, true);
	}

	// ── Subquery value rendering ─────────────────────

	private _renderSubqueryClause(w: WhereClause, bindings: unknown[], startIdx: number): { clause: string; nextIdx: number } {
		if (w.op === 'IN' || w.op === 'NOT IN') {
			const sub = w.value as SqlStatement;
			// Merge subquery bindings and renumber ALL parameter placeholders at once
			let counter = startIdx;
			const sql = sub.sql.replace(/\?\d+/g, () => `?${counter++}`);
			bindings.push(...sub.bindings);
			return { clause: `${w.column} ${w.op} (${sql})`, nextIdx: counter };
		}
		if (w.column === '__EXISTS__') {
			const sub = w.value as SqlStatement;
			let counter = startIdx;
			const sql = sub.sql.replace(/\?\d+/g, () => `?${counter++}`);
			bindings.push(...sub.bindings);
			const prefix = (w as WhereClause).not ? 'NOT EXISTS' : 'EXISTS';
			return { clause: `${prefix} (${sql})`, nextIdx: counter };
		}
		return { clause: '', nextIdx: startIdx };
	}

	// ── Join rendering ───────────────────────────────

	/**
	 * Render JOIN clauses into `parts` and push any bindings.
	 * Returns the next available parameter index.
	 */
	private _buildJoins(parts: string[], bindings: unknown[], startIndex: number): number {
		let idx = startIndex;
		for (const j of this._joins) {
			if (j.table === '') {
				// joinRaw — clause may contain ? placeholders; renumber them all at once
				let clause = j.on;
				let counter = idx;
				clause = clause.replace(/\?(\d+)?/g, () => `?${counter++}`);
				bindings.push(...j.bindings);
				idx = counter;
				parts.push(clause);
			} else {
				parts.push(`${j.type} JOIN ${j.table} ON ${j.on}`);
			}
		}
		return idx;
	}
}
