/**
 * QueryBuilder Unit Tests — data-integrity audit fixes
 *
 *   - whereGroup: per-clause AND/OR types, column sanitization, op whitelist
 *   - whereNotIn([]) semantics (1 = 1)
 *   - toInsertMany onConflict support
 *   - CTE (WITH) rendering for INSERT/UPDATE/DELETE
 *   - orderBy direction + limit/offset validation
 *   - returning() default (disabled)
 */
import { describe, it, expect } from 'vitest';
import { QueryBuilder } from '../query-builder';

describe('QueryBuilder.whereGroup', () => {
	it('combines clauses with their OWN types: AND (a OR b)', () => {
		const stmt = QueryBuilder.from('posts')
			.where('status', 'published')
			.whereGroup(
				[
					{ column: 'type', op: '=', value: 'blog', type: 'or' },
					{ column: 'type', op: '=', value: 'news', type: 'or' },
				],
				'and',
			)
			.toSelect();
		expect(stmt.sql).toBe('SELECT * FROM posts WHERE status = ?1 AND (type = ?2 OR type = ?3)');
		expect(stmt.bindings).toEqual(['published', 'blog', 'news']);
	});

	it('supports mixed per-clause types: AND (a AND (b OR c))', () => {
		const stmt = QueryBuilder.from('t')
			.whereGroup(
				[
					{ column: 'a', op: '=', value: 1, type: 'and' },
					{ column: 'b', op: '=', value: 2, type: 'or' },
					{ column: 'c', op: '=', value: 3, type: 'or' },
				],
				'and',
			)
			.toSelect();
		expect(stmt.sql).toBe('SELECT * FROM t WHERE (a = ?1 OR b = ?2 OR c = ?3)');
	});

	it('defaults missing clause types to the group type (backward compatible)', () => {
		const stmt = QueryBuilder.from('posts')
			.where('status', 'draft')
			.orCond([
				{ column: 'type', op: '=', value: 'blog' },
				{ column: 'type', op: '=', value: 'news' },
			])
			.toSelect();
		expect(stmt.sql).toBe('SELECT * FROM posts WHERE status = ?1 OR (type = ?2 OR type = ?3)');
	});

	it('supports AND-joined groups via andCond', () => {
		const stmt = QueryBuilder.from('posts')
			.where('status', 'draft')
			.andCond([
				{ column: 'a', op: '=', value: 1 },
				{ column: 'b', op: '=', value: 2 },
			])
			.toSelect();
		expect(stmt.sql).toBe('SELECT * FROM posts WHERE status = ?1 AND (a = ?2 AND b = ?3)');
	});

	it('rejects unsanitized column names', () => {
		expect(() =>
			QueryBuilder.from('t')
				.whereGroup([{ column: 'title; DROP TABLE posts', op: '=', value: 'x' }])
				.toSelect(),
		).toThrow(/Invalid column/);
		expect(() =>
			QueryBuilder.from('t')
				.whereGroup([{ column: 'a.b', op: '=', value: 1 }])
				.toSelect(),
		).not.toThrow(); // qualified ok
	});

	it('rejects unknown operators', () => {
		expect(() =>
			QueryBuilder.from('t')
				.whereGroup([{ column: 'a', op: 'CONTAINS', value: 1 }])
				.toSelect(),
		).toThrow(/Invalid WHERE operator/);
	});
});

describe('QueryBuilder.whereNotIn / orWhereNotIn empty list', () => {
	it('whereNotIn([]) renders 1 = 1 (matches everything)', () => {
		const stmt = QueryBuilder.from('t').whereNotIn('id', []).toSelect();
		expect(stmt.sql).toContain('1 = 1');
		expect(stmt.bindings).toEqual([]);
	});

	it('orWhereNotIn([]) renders OR 1 = 1', () => {
		const stmt = QueryBuilder.from('t').where('status', 'x').orWhereNotIn('id', []).toSelect();
		expect(stmt.sql).toBe('SELECT * FROM t WHERE status = ?1 OR 1 = 1');
	});

	it('whereIn([]) still renders 1 = 0 (matches nothing)', () => {
		const stmt = QueryBuilder.from('t').whereIn('id', []).toSelect();
		expect(stmt.sql).toContain('1 = 0');
	});
});

describe('QueryBuilder.toInsertMany + onConflict', () => {
	it('ignores onConflict when none set', () => {
		const stmt = QueryBuilder.from('t').toInsertMany([
			{ id: '1', name: 'a' },
			{ id: '2', name: 'b' },
		]);
		expect(stmt.sql).toBe('INSERT INTO t ("id", "name") VALUES (?1, ?2), (?3, ?4)');
		expect(stmt.bindings).toEqual(['1', 'a', '2', 'b']);
	});

	it('honors onConflict(..., nothing)', () => {
		const stmt = QueryBuilder.from('t')
			.onConflict(['id'], 'nothing')
			.toInsertMany([{ id: '1', name: 'a' }]);
		expect(stmt.sql).toBe('INSERT INTO t ("id", "name") VALUES (?1, ?2) ON CONFLICT(id) DO NOTHING');
	});

	it('honors onConflict(..., update)', () => {
		const stmt = QueryBuilder.from('t')
			.onConflict(['id'], 'update')
			.toInsertMany([{ id: '1', name: 'a' }]);
		expect(stmt.sql).toBe(
			'INSERT INTO t ("id", "name") VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET "id" = excluded."id", "name" = excluded."name"',
		);
	});

	it('quotes reserved-keyword column names (e.g. `in`) so inserts/upserts work', () => {
		const stmt = QueryBuilder.from('hr_shifts').onConflict(['id'], 'update').toInsert({ in: '08:00:00', name: 'Shift' });
		expect(stmt.sql).toBe(
			'INSERT INTO hr_shifts ("in", "name") VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET "in" = excluded."in", "name" = excluded."name"',
		);
	});
});

describe('QueryBuilder CTE rendering for writes', () => {
	it('renders WITH before INSERT (toInsert)', () => {
		const cte = QueryBuilder.from('drafts').select('id', 'title').where('status', 'pending');
		const stmt = QueryBuilder.from('posts').with('d', cte).returning(true).toInsert({ id: '1', title: 'x' });
		expect(stmt.sql).toMatch(
			/^WITH d AS \(SELECT id, title FROM drafts WHERE status = \?1\) INSERT INTO posts \("id", "title"\) VALUES \(\?2, \?3\) RETURNING \*/,
		);
		expect(stmt.bindings).toEqual(['pending', '1', 'x']);
	});

	it('renders WITH before UPDATE (toUpdate)', () => {
		const cte = QueryBuilder.from('t2').select('id').where('flag', 1);
		const stmt = QueryBuilder.from('t').with('c', cte).returning(true).where('id', 'x').toUpdate({ name: 'y' });
		expect(stmt.sql).toMatch(/^WITH c AS \(SELECT id FROM t2 WHERE flag = \?1\) UPDATE t SET name = \?2 WHERE id = \?3 RETURNING \*/);
		expect(stmt.bindings).toEqual([1, 'y', 'x']);
	});

	it('renders WITH before DELETE (toDelete)', () => {
		const cte = QueryBuilder.from('t2').select('id').where('flag', 1);
		const stmt = QueryBuilder.from('t').with('c', cte).returning(true).where('id', 'x').toDelete();
		expect(stmt.sql).toMatch(/^WITH c AS \(SELECT id FROM t2 WHERE flag = \?1\) DELETE FROM t WHERE id = \?2 RETURNING \*/);
		expect(stmt.bindings).toEqual([1, 'x']);
	});

	it('keeps existing toSelect CTE behavior intact', () => {
		const cte = QueryBuilder.from('drafts').select('id').where('status', 'pending');
		const stmt = QueryBuilder.from('posts').with('d', cte).select('title').toSelect();
		expect(stmt.sql).toBe('WITH d AS (SELECT id FROM drafts WHERE status = ?1) SELECT title FROM posts');
	});
});

describe('QueryBuilder JOINs', () => {
	it('renders INNER JOIN with qualified identifiers', () => {
		const stmt = QueryBuilder.from('orders')
			.select('orders.id', 'customers.country')
			.join('customers', 'orders.customer_id', 'customers.id')
			.where('customers.country', 'MM')
			.groupBy('customers.country')
			.orderBy('customers.country', 'asc')
			.toSelect();
		expect(stmt.sql).toBe(
			'SELECT orders.id, customers.country FROM orders INNER JOIN customers ON orders.customer_id = customers.id WHERE customers.country = ?1 GROUP BY customers.country ORDER BY customers.country ASC',
		);
		expect(stmt.bindings).toEqual(['MM']);
	});

	it('renders LEFT JOIN via leftJoin()', () => {
		const stmt = QueryBuilder.from('orders').leftJoin('customers', 'orders.customer_id', 'customers.id').select('orders.*').toSelect();
		expect(stmt.sql).toBe('SELECT orders.* FROM orders LEFT JOIN customers ON orders.customer_id = customers.id');
	});

	it('sanitizes table and qualified identifiers', () => {
		expect(() => QueryBuilder.from('orders').join('customers; DROP', 'orders.id', 'customers.id')).toThrow(/Invalid SQL identifier/);
		expect(() => QueryBuilder.from('orders').select('customers.id; DROP')).toThrow(/Invalid SQL identifier/);
	});

	it('includes JOINs in toCount()', () => {
		const stmt = QueryBuilder.from('orders')
			.leftJoin('customers', 'orders.customer_id', 'customers.id')
			.where('customers.country', 'MM')
			.toCount();
		expect(stmt.sql).toContain('LEFT JOIN customers ON orders.customer_id = customers.id');
		expect(stmt.sql).toContain('WHERE customers.country = ?1');
	});
});

describe('QueryBuilder validation', () => {
	it('rejects invalid orderBy directions', () => {
		expect(() => QueryBuilder.from('t').orderBy('id', 'up' as 'asc')).toThrow(/Invalid ORDER BY direction/);
		expect(() => QueryBuilder.from('t').orderByRaw('count(*)', 'sideways' as 'asc')).toThrow(/Invalid ORDER BY direction/);
		expect(() => QueryBuilder.from('t').orderBy('id', 'desc')).not.toThrow();
	});

	it('rejects non-integer / negative limit and offset', () => {
		expect(() => QueryBuilder.from('t').limit(1.5)).toThrow(/non-negative integer/);
		expect(() => QueryBuilder.from('t').limit(-1)).toThrow(/non-negative integer/);
		expect(() => QueryBuilder.from('t').offset(2.5)).toThrow(/non-negative integer/);
		expect(() => QueryBuilder.from('t').offset(-1)).toThrow(/non-negative integer/);
		expect(() => QueryBuilder.from('t').limit(10).offset(5)).not.toThrow();
	});

	it('returning() is disabled by default and opt-in', () => {
		expect(QueryBuilder.from('t').toInsert({ a: 1 }).sql).not.toContain('RETURNING');
		expect(QueryBuilder.from('t').returning(true).toInsert({ a: 1 }).sql).toContain('RETURNING *');
	});
});
