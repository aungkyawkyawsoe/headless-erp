/**
 * Repository Unit Tests
 *
 * The audit found NO unit tests for Repository. These cover:
 *   - keyset pagination windows (dir: 'after' / 'before') incl. has_more
 *   - keyset pagination respecting a caller-supplied orderBy column
 *   - findOne with null values (IS NULL)
 *   - update() on tables without an `updated_at` column (no error-string sniffing)
 *   - findAll() ceiling / explicit limit override
 *
 * A tiny in-memory SQL evaluator stands in for D1 (the same pattern the
 * relation-resolver tests use) so windows are exercised end-to-end through
 * QueryBuilder → D1Client → fake database.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { D1Client } from '../d1-client';
import { Repository } from '../repository';

// ─── Tiny in-memory D1 stand-in ───────────────────────────

type Row = Record<string, unknown>;

function placeholders(sql: string, bindings: unknown[]): unknown[] {
	return (sql.match(/\?(\d+)/g) ?? []).map((p) => bindings[Number(p.slice(1)) - 1]);
}

function evalWhere(whereSql: string, bindings: unknown[]): (row: Row) => boolean {
	const segments = whereSql.split(/\s+AND\s+/i).map((s) => s.trim());
	return (row) => segments.every((seg) => evalSegment(seg, bindings, row));
}

function evalSegment(seg: string, bindings: unknown[], row: Row): boolean {
	if (seg === '1 = 1') return true;
	if (seg === '1 = 0') return false;
	let m = seg.match(/^([A-Za-z_][A-Za-z0-9_.]*) IS NULL$/i);
	if (m) return row[m[1]] === null || row[m[1]] === undefined;
	m = seg.match(/^([A-Za-z_][A-Za-z0-9_.]*) IS NOT NULL$/i);
	if (m) return row[m[1]] !== null && row[m[1]] !== undefined;
	m = seg.match(/^([A-Za-z_][A-Za-z0-9_.]*) IN \(([^)]+)\)$/i);
	if (m) {
		const values = placeholders(m[2], bindings);
		return values.includes(row[m[1]]);
	}
	m = seg.match(/^([A-Za-z_][A-Za-z0-9_.]*) (!=|>=|<=|=|>|<) \?(\d+)$/i);
	if (m) {
		const col = m[1];
		const op = m[2];
		const val = bindings[Number(m[3]) - 1];
		const rv = row[col];
		switch (op) {
			case '=':
				return rv === val;
			case '!=':
				return rv !== val;
			case '>':
				return (rv as never) > (val as never);
			case '<':
				return (rv as never) < (val as never);
			case '>=':
				return (rv as never) >= (val as never);
			case '<=':
				return (rv as never) <= (val as never);
		}
	}
	return true; // unparseable segment — assume it matches (test data is simple)
}

class FakeD1 {
	tables: Record<string, Row[]> = {};

	constructor(tables: Record<string, Row[]> = {}) {
		for (const [k, v] of Object.entries(tables)) this.tables[k] = v.map((r) => ({ ...r }));
	}

	private _select(sql: string, bindings: unknown[]): Row[] {
		if (/^PRAGMA table_info/i.test(sql)) {
			const table = (sql.match(/table_info\("?([^"]+)"?\)/) ?? [])[1] ?? '';
			const cols = this.tables[table] ? Object.keys(this.tables[table][0] ?? {}) : [];
			return cols.map((name) => ({ name, type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 }));
		}
		const tableMatch = sql.match(/FROM\s+([A-Za-z_][A-Za-z0-9_.]*)/i);
		if (!tableMatch) return [];
		let rows = [...(this.tables[tableMatch[1]] ?? [])];

		// COUNT(*) — Repository.count()
		if (/SELECT\s+COUNT\(\*\)/i.test(sql)) {
			const whereMatch = sql.match(/WHERE\s+(.+?)(?=\s+(ORDER BY|GROUP BY|LIMIT|OFFSET|HAVING|WINDOW)\b|$)/i);
			if (whereMatch) rows = rows.filter(evalWhere(whereMatch[1], bindings));
			return [{ count: rows.length }];
		}

		const whereMatch = sql.match(/WHERE\s+(.+?)(?=\s+(ORDER BY|GROUP BY|LIMIT|OFFSET|HAVING|WINDOW)\b|$)/i);
		if (whereMatch) rows = rows.filter(evalWhere(whereMatch[1], bindings));

		const orderMatch = sql.match(/ORDER BY\s+([A-Za-z_][A-Za-z0-9_.]*)\s+(ASC|DESC)/i);
		if (orderMatch) {
			const [col, dir] = [orderMatch[1], orderMatch[2].toUpperCase()];
			rows.sort((a, b) => {
				const av = a[col] as never;
				const bv = b[col] as never;
				if (av === bv) return 0;
				const cmp = av > bv ? 1 : -1;
				return dir === 'ASC' ? cmp : -cmp;
			});
		}

		const offsetMatch = sql.match(/OFFSET \?(\d+)/i);
		if (offsetMatch) rows = rows.slice(Number(bindings[Number(offsetMatch[1]) - 1]));
		const limitMatch = sql.match(/LIMIT \?(\d+)/i);
		if (limitMatch) rows = rows.slice(0, Number(bindings[Number(limitMatch[1]) - 1]));

		return rows;
	}

	private _execute(sql: string, bindings: unknown[]): { rows: Row[] } {
		// UPDATE ... SET ... [WHERE ...] [RETURNING *]
		const updateMatch = sql.match(/^UPDATE\s+([A-Za-z_][A-Za-z0-9_.]*)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+?))?(?:\s+RETURNING|\s*$)/is);
		if (updateMatch) {
			const table = updateMatch[1];
			const assignments: Array<[string, unknown]> = updateMatch[2].split(',').map((p) => {
				const m = p.trim().match(/^([A-Za-z_][A-Za-z0-9_.]*) = \?(\d+)$/i);
				return [m![1], bindings[Number(m![2]) - 1]];
			});
			const predicate = updateMatch[3] ? evalWhere(updateMatch[3], bindings) : () => true;
			const updated: Row[] = [];
			for (const r of this.tables[table] ?? []) {
				if (predicate(r)) {
					for (const [col, val] of assignments) r[col] = val;
					updated.push(r);
				}
			}
			return { rows: updated };
		}

		// INSERT INTO ... (cols) VALUES (...)[, (...)] [ON CONFLICT ...] [RETURNING *]
		const insertMatch = sql.match(
			/^INSERT INTO\s+([A-Za-z_][A-Za-z0-9_.]*)\s*\(([^)]+)\)\s*VALUES\s+(.+?)(?:\s+ON CONFLICT.*)?(?:\s+RETURNING\s+\*)?\s*$/is,
		);
		if (insertMatch) {
			const table = insertMatch[1];
			const cols = insertMatch[2].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
			const inserted: Row[] = [];
			for (const tuple of insertMatch[3].split(/\),\s*\(/)) {
				const placeholders = tuple
					.replace(/^\(|\)$/g, '')
					.split(',')
					.map((p) => p.trim());
				const row: Row = {};
				cols.forEach((c, i) => {
					const m = placeholders[i]?.match(/^\?(\d+)$/);
					row[c] = m ? bindings[Number(m[1]) - 1] : null;
				});
				inserted.push(row);
			}
			(this.tables[table] ??= []).push(...inserted);
			return { rows: inserted };
		}

		// DELETE FROM ... [WHERE ...] [RETURNING *]
		const deleteMatch = sql.match(/^DELETE FROM\s+([A-Za-z_][A-Za-z0-9_.]*)(?:\s+WHERE\s+(.+?))?(?:\s+RETURNING|\s*$)/is);
		if (deleteMatch) {
			const table = deleteMatch[1];
			const predicate = deleteMatch[2] ? evalWhere(deleteMatch[2], bindings) : () => true;
			const deleted: Row[] = [];
			this.tables[table] = (this.tables[table] ?? []).filter((r) => {
				if (predicate(r)) {
					deleted.push(r);
					return false;
				}
				return true;
			});
			return { rows: deleted };
		}

		return { rows: [] };
	}

	prepare(sql: string) {
		return {
			bind: (...bindings: unknown[]) => ({
				all: async <T>(): Promise<{ results: T[]; success: boolean }> => {
					const rows = /^(SELECT|PRAGMA)/i.test(sql) ? this._select(sql, bindings) : this._execute(sql, bindings).rows;
					return { results: rows as T[], success: true };
				},
				first: async <T>(): Promise<T | null> => {
					if (/^(SELECT|PRAGMA)/i.test(sql)) return (this._select(sql, bindings)[0] ?? null) as T | null;
					return (this._execute(sql, bindings).rows[0] ?? null) as T | null;
				},
				run: async (): Promise<unknown> => {
					this._execute(sql, bindings);
					return { success: true, meta: { duration: 0, changes: 1 } };
				},
			}),
		};
	}

	batch(stmts: Array<{ sql: string; bindings: unknown[] }>): Promise<unknown[]> {
		const results = stmts.map((s) => {
			if (/^SELECT/i.test(s.sql)) return { success: true, results: this._select(s.sql, s.bindings), meta: {} };
			this._execute(s.sql, s.bindings);
			return { success: true, results: [], meta: {} };
		});
		return Promise.resolve(results);
	}

	exec(_sql: string): Promise<unknown> {
		return Promise.resolve({ count: 0, duration: 0 });
	}
}

function makeDb(tables: Record<string, Row[]>): D1Client {
	return new D1Client(new FakeD1(tables) as unknown as D1Database);
}

// ─── Fixtures ─────────────────────────────────────────────

function idRows(count: number): Row[] {
	// Zero-padded so lexicographic (string) comparison matches numeric order.
	return Array.from({ length: count }, (_, i) => ({ id: String(i + 1).padStart(2, '0'), title: `item ${i + 1}` }));
}

/** Rows with a numeric `seq` column (for orderBy tests) */
function seqRows(count: number): Row[] {
	return Array.from({ length: count }, (_, i) => ({ id: `a${i + 1}`, seq: i + 1, title: `row ${i + 1}` }));
}

describe('Repository — keyset pagination (default id DESC)', () => {
	let db: D1Client;
	let repo: Repository<Row>;

	beforeEach(() => {
		db = makeDb({ cms_items: idRows(10) });
		repo = new Repository<Row>(db, 'cms_items');
	});

	it('first page: newest-first with has_more + next_cursor', async () => {
		const page = await repo.findMany({ limit: 4 });
		expect(page.data.map((r) => r.id)).toEqual(['10', '09', '08', '07']);
		expect(page.meta.has_more).toBe(true);
		expect(page.meta.next_cursor).toBe('07');
		expect(page.meta.prev_cursor).toBeUndefined();
	});

	it('after cursor: continues the sort window (id < cursor, DESC)', async () => {
		const page = await repo.findMany({ limit: 4, cursor: '07', dir: 'after' });
		expect(page.data.map((r) => r.id)).toEqual(['06', '05', '04', '03']);
		expect(page.meta.has_more).toBe(true);
		expect(page.meta.next_cursor).toBe('03');
		expect(page.meta.prev_cursor).toBe('06');
	});

	it('before cursor: older window (id < cursor, DESC fetch, reversed ascending)', async () => {
		const page = await repo.findMany({ limit: 4, cursor: '07', dir: 'before' });
		// Strictly older than 07 → [06,05,04,03], returned oldest→newest.
		expect(page.data.map((r) => r.id)).toEqual(['03', '04', '05', '06']);
		expect(page.meta.has_more).toBe(true); // '02' and '01' exist → older items remain
		expect(page.meta.next_cursor).toBe('06');
		expect(page.meta.prev_cursor).toBe('03');
	});

	it('before cursor at the oldest boundary: no has_more', async () => {
		const page = await repo.findMany({ limit: 4, cursor: '02', dir: 'before' });
		expect(page.data.map((r) => r.id)).toEqual(['01']);
		expect(page.meta.has_more).toBe(false);
	});

	it('has_more is false when exactly one page fits', async () => {
		const page = await repo.findMany({ limit: 10 });
		expect(page.data).toHaveLength(10);
		expect(page.meta.has_more).toBe(false);
	});
});

describe('Repository — keyset pagination respects orderBy column', () => {
	let db: D1Client;
	let repo: Repository<Row>;

	beforeEach(() => {
		db = makeDb({ cms_items: seqRows(10) });
		repo = new Repository<Row>(db, 'cms_items');
	});

	it('after with orderBy asc compares against the orderBy column', async () => {
		const first = await repo.findMany({ orderBy: { seq: 'asc' }, limit: 3 });
		expect(first.data.map((r) => r.seq)).toEqual([1, 2, 3]);
		expect(first.meta.next_cursor).toBe('3');

		const next = await repo.findMany({ orderBy: { seq: 'asc' }, limit: 3, cursor: '3', dir: 'after' });
		expect(next.data.map((r) => r.seq)).toEqual([4, 5, 6]);
		expect(next.meta.has_more).toBe(true);
		expect(next.meta.next_cursor).toBe('6');
	});

	it('after with orderBy desc compares against the orderBy column', async () => {
		const next = await repo.findMany({ orderBy: { seq: 'desc' }, limit: 3, cursor: '7', dir: 'after' });
		expect(next.data.map((r) => r.seq)).toEqual([6, 5, 4]);
	});
});

describe('Repository — findOne / count with null handling', () => {
	it('findOne renders IS NULL for null values', async () => {
		const db = makeDb({
			cms_items: [
				{ id: '1', deleted_at: null, title: 'alive' },
				{ id: '2', deleted_at: '2026-01-01', title: 'trashed' },
			],
		});
		const repo = new Repository<Row>(db, 'cms_items');
		const found = await repo.findOne({ deleted_at: null });
		expect(found?.id).toBe('1');
	});

	it('count handles null values', async () => {
		const db = makeDb({
			cms_items: [
				{ id: '1', deleted_at: null },
				{ id: '2', deleted_at: null },
				{ id: '3', deleted_at: 'x' },
			],
		});
		const repo = new Repository<Row>(db, 'cms_items');
		expect(await repo.count({ deleted_at: null })).toBe(2);
	});
});

describe('Repository — update without updated_at column', () => {
	it('updates tables lacking updated_at without error (no fallback re-run)', async () => {
		const db = makeDb({ _audit_log: [{ id: '1', action: 'create', note: 'old' }] });
		const repo = new Repository<Row>(db, '_audit_log');

		const updated = await repo.update('1', { action: 'update' });
		expect(updated.action).toBe('update');
		expect(updated.note).toBe('old');
		expect(updated).not.toHaveProperty('updated_at'); // column skipped, not error-sniffed
	});

	it('still stamps updated_at on tables that have it', async () => {
		const db = makeDb({ cms_items: [{ id: '1', title: 'before', updated_at: '2026-01-01' }] });
		const repo = new Repository<Row>(db, 'cms_items');

		const updated = await repo.update('1', { title: 'after' });
		expect(updated.title).toBe('after');
		expect(typeof updated.updated_at).toBe('string');
	});
});

describe('Repository — create / findById / delete / createMany', () => {
	it('create generates id + timestamps and returns the row', async () => {
		const db = makeDb({ cms_items: [] });
		const repo = new Repository<Row>(db, 'cms_items');
		const created = await repo.create({ title: 'new' });
		expect(created.id).toBeTypeOf('string');
		expect(created.title).toBe('new');
		expect(created.created_at).toBeTypeOf('string');
		expect(created.updated_at).toBeTypeOf('string');
	});

	it('findById returns the row or throws', async () => {
		const db = makeDb({ cms_items: idRows(3) });
		const repo = new Repository<Row>(db, 'cms_items');
		expect((await repo.findById('02')).id).toBe('02');
		await expect(repo.findById('nope')).rejects.toThrow(/not found/i);
	});

	it('delete removes the row', async () => {
		const db = makeDb({ cms_items: idRows(3) });
		const repo = new Repository<Row>(db, 'cms_items');
		await repo.delete('02');
		expect(await repo.count()).toBe(2);
	});

	it('createMany inserts multiple rows', async () => {
		const db = makeDb({ cms_items: [] });
		const repo = new Repository<Row>(db, 'cms_items');
		const rows = await repo.createMany([{ title: 'a' }, { title: 'b' }]);
		expect(rows).toHaveLength(2);
		expect(await repo.count()).toBe(2);
	});
});

describe('Repository — findAll ceiling', () => {
	it('caps at 1000 by default (documented) and allows explicit override', async () => {
		const rows = Array.from({ length: 1500 }, (_, i) => ({ id: String(i), title: `r${i}` }));
		const db = makeDb({ cms_big: rows });
		const repo = new Repository<Row>(db, 'cms_big');

		const capped = await repo.findAll();
		expect(capped).toHaveLength(1000);

		const override = await repo.findAll({ limit: 1200 });
		expect(override).toHaveLength(1200); // explicit limit overrides the ceiling

		const tight = await repo.findAll({ maxLimit: 5 });
		expect(tight).toHaveLength(5);
	});
});
