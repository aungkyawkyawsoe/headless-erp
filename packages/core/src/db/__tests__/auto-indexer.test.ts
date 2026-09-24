import { describe, it, expect, vi } from 'vitest';
import { SelfTuningIndexAdvisor } from '../auto-indexer';
import type { D1Client } from '../d1-client';

/** Build a stub D1Client whose `all` returns a fake EXPLAIN plan and `run`
 *  records issued statements. PLAN quirk controlled per call. `first` answers the
 *  per-table existence probe (`SELECT 1 FROM <table> LIMIT 1`) — the registered
 *  tables resolve, anything else raises "no such table". */
function stubDb(opts: { scan: boolean }): D1Client {
	const all = vi.fn(async (_stmt: { sql: string }) => (opts.scan ? [{ detail: 'SCAN t' }] : [{ detail: 'SEARCH t USING INDEX idx_x' }]));
	const REGISTERED = new Set(['t', 't2', 't3', 't4', 't5', 'orders', 'vehicles', 'vehicles2']);
	const first = vi.fn(async (stmt: { sql: string }) => {
		const name = /FROM\s+"?([A-Za-z0-9_]+)"?/i.exec(stmt.sql)?.[1] ?? '';
		if (!REGISTERED.has(name)) throw new Error(`no such table: ${name}`);
		return { n: 1 };
	});
	const run = vi.fn(async () => ({}) as unknown as D1Result);
	return { all, first, run } as unknown as D1Client;
}

describe('SelfTuningIndexAdvisor', () => {
	it('records multi-column filter signatures and reports the journal', () => {
		const a = new SelfTuningIndexAdvisor();
		a.record('requests', { filters: ['status', 'manager_id'], sort: 'created_at' }, []);
		a.record('requests', { filters: ['status', 'manager_id'], sort: 'created_at' }, []);
		expect(a.snapshot()).toEqual([]); // nothing created without a tune
	});

	it('never learns a signature the collection already declares', () => {
		const a = new SelfTuningIndexAdvisor();
		a.record('t', { filters: ['status', 'owner'], sort: '' }, [{ columns: ['status', 'owner'] }]);
		// The declared composite wins — the advisor must not duplicate it.
		expect(a.snapshot()).toEqual([]);
		// Tuning with a scan plan still must not create it (already declared).
		const db = stubDb({ scan: true });
		a.record('t', { filters: ['status', 'owner'], sort: '' }, [{ columns: ['status', 'owner'] }]);
		return a.tune(db).then((j) => expect(j).toEqual([]));
	});

	it('creates an index only when the planner scans, and journals it once', async () => {
		const a = new SelfTuningIndexAdvisor();
		const db = stubDb({ scan: true });
		// clear the MIN_OBSERVATIONS bar so a small number of repeats triggers tuning
		for (let i = 0; i < 10; i++) a.record('orders', { filters: ['assignee_tg_id', 'status', 'due_date'], sort: 'created_at' }, []);
		const j = await a.tune(db);
		expect(j.length).toBe(1);
		expect(j[0].table).toBe('orders');
		// The sort column is TRAILING — it turns the temp B-tree sort into an
		// ordered index scan instead of being dropped from the shape.
		expect(j[0].columns).toEqual(['assignee_tg_id', 'status', 'due_date', 'created_at']);
		// run must have issued a CREATE INDEX
		expect(db.run).toHaveBeenCalled();

		// Second tune within the rate-limit returns the journal unchanged (no re-DDL).
		const before = (db.run as ReturnType<typeof vi.fn>).mock.calls.length;
		const j2 = await a.tune(db);
		expect(j2).toEqual(j);
		expect((db.run as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
	});

	it('indexes a sort-only shape (deleted_at + sort) so sorted lists avoid a temp B-tree', async () => {
		const a = new SelfTuningIndexAdvisor();
		const db = stubDb({ scan: true });
		// The `?sort=plate_no&filter[_or]…` fleet read: no FLAT filters, one sort.
		for (let i = 0; i < 10; i++) a.record('vehicles', { filters: ['deleted_at'], sort: 'plate_no' }, []);
		const j = await a.tune(db);
		expect(j.length).toBe(1);
		expect(j[0].columns).toEqual(['deleted_at', 'plate_no']);
		expect(db.run).toHaveBeenCalled();
	});

	it('never recreates a sort index the collection already declares', async () => {
		const a = new SelfTuningIndexAdvisor();
		const db = stubDb({ scan: true });
		for (let i = 0; i < 10; i++)
			a.record('vehicles2', { filters: ['deleted_at'], sort: 'plate_no' }, [{ columns: ['deleted_at', 'plate_no'] }]);
		const j = await a.tune(db);
		expect(j).toEqual([]);
		expect(db.run).not.toHaveBeenCalled();
	});

	it('does NOT create an index when the planner already uses an index (SEARCH)', async () => {
		const a = new SelfTuningIndexAdvisor();
		const db = stubDb({ scan: false });
		for (let i = 0; i < 10; i++) a.record('t2', { filters: ['a', 'b'], sort: '' }, []);
		await a.tune(db);
		expect(a.snapshot()).toEqual([]);
		expect(db.run).not.toHaveBeenCalled();
	});

	it('respects the per-collection auto-index budget', async () => {
		const a = new SelfTuningIndexAdvisor();
		const db = stubDb({ scan: true });
		// Train several hot signatures on the same table.
		for (let i = 0; i < 10; i++) {
			a.record('t3', { filters: ['a', 'b'], sort: '' }, []);
			a.record('t3', { filters: ['c', 'd'], sort: '' }, []);
			a.record('t3', { filters: ['e', 'f'], sort: '' }, []);
			a.record('t3', { filters: ['g', 'h'], sort: '' }, []);
			a.record('t3', { filters: ['i', 'j'], sort: '' }, []);
			a.record('t3', { filters: ['k', 'l'], sort: '' }, []);
		}
		await a.tune(db);
		// Budget capped at MAX_AUTO_INDEXES_PER_COLLECTION (4).
		expect(a.snapshot().length).toBeLessThanOrEqual(4);
	});

	it('fails closed (no DDL) when EXPLAIN errors', async () => {
		const a = new SelfTuningIndexAdvisor();
		const db = {
			all: vi.fn(async () => Promise.reject(new Error('boom'))),
			// Existence probe resolves first, so the failure under test IS the EXPLAIN.
			first: vi.fn(async () => ({ n: 1 })),
			run: vi.fn(async () => ({})),
		} as unknown as D1Client;
		for (let i = 0; i < 10; i++) a.record('t4', { filters: ['a', 'b'], sort: '' }, []);
		await a.tune(db);
		expect(a.snapshot()).toEqual([]);
		expect(db.run).not.toHaveBeenCalled();
	});

	it('propose-only mode recommends without issuing DDL', async () => {
		const a = new SelfTuningIndexAdvisor();
		const db = stubDb({ scan: true });
		for (let i = 0; i < 10; i++) a.record('t5', { filters: ['a', 'b'], sort: '' }, []);
		await a.tune(db, true); // propose=true for this pass
		// Journal records the recommendation…
		expect(a.snapshot().length).toBe(1);
		// …but NO DDL was issued.
		expect(db.run).not.toHaveBeenCalled();
		expect(a.report().mode).toBe('propose_only');
	});

	it('reset clears state', () => {
		const a = new SelfTuningIndexAdvisor();
		a.record('t', { filters: ['a', 'b'], sort: '' }, []);
		a.reset();
		expect(a.snapshot()).toEqual([]);
	});
});
