/**
 * D1 Client Wrapper
 *
 * A thin execution layer that takes SqlStatement objects
 * from QueryBuilder/SchemaBuilder and executes them natively
 * via Cloudflare D1's prepare().bind().run()/all()/first().
 *
 * This is the ONLY bridge between our SQL generation layer
 * and D1 — no .raw() escape hatches, no string interpolation.
 *
 * Features: onQuery hook, automatic retry for transient errors.
 *
 * @example
 *   const db = new D1Client(env.DB);
 *   db.onQuery = (info) => console.log(`${info.durationMs}ms`, info.sql);
 *   db.maxRetries = 3;
 */

import type { SqlStatement } from '@mmbix/types';
// D1 types come from @cloudflare/workers-types — imported explicitly (not as
// ambient globals) so any consumer tsconfig (e.g. the CLI's types:["node"]) can
// compile this package without loading workers-types globals.
import type { D1Database, D1ExecResult, D1Result } from '@cloudflare/workers-types';
import { resolveD1Executor } from './d1-executor';

// ─── Types ─────────────────────────────────────────────

/** Query execution metadata emitted by the onQuery hook */
export interface QueryInfo {
	sql: string;
	bindings: unknown[];
	durationMs: number;
	rowsAffected?: number;
	rowsReturned?: number;
	error?: Error;
}

export type QueryHook = (info: QueryInfo) => void;

// ─── Helpers ───────────────────────────────────────────

function noopHook(_info: QueryInfo): void {}

/**
 * Row-count fields D1 reports on write statements. `D1Result.meta` is
 * `D1Meta & Record<string, unknown>` while `D1ExecResult` carries no meta
 * at all, so narrow to just the count fields `getRowsAffected` reads.
 */
interface RowsAffectedMeta {
	changes_written?: number;
	changes?: number;
}

function getRowsAffected(result: D1Result | D1ExecResult): number {
	const m = ('meta' in result ? result.meta : {}) as RowsAffectedMeta;
	return m.changes_written ?? m.changes ?? 0;
}

// ─── D1 Client ─────────────────────────────────────────

export class D1Client {
	/** Fires after every query with timing/row metadata. */
	public onQuery: QueryHook = noopHook;

	/** Max retries for transient D1 errors (overloaded, 503). Set to 0 to disable. */
	public maxRetries = 3;

	/** Base delay (ms) for exponential backoff. Doubles each attempt. */
	public retryDelayMs = 50;

	constructor(private binding: D1Database) {}

	/**
	 * The executor for every call: a request-scoped D1 SESSION when the host
	 * worker established one (read replication — a nearby replica + sequential
	 * consistency), else the binding this client wraps. A GETTER, so every
	 * existing `this.db.*` call transparently uses the session with zero call-site
	 * changes (see `d1-executor.ts`).
	 */
	private get db(): D1Database {
		return resolveD1Executor() ?? this.binding;
	}

	// ── Retry logic ─────────────────────────────────────

	private _isTransient(err: unknown): boolean {
		const msg = err instanceof Error ? err.message : String(err);
		// Only retry genuine overload/queue-full signals — NOT generic "D1_ERROR" (non-transient).
		return /overloaded|ERR_D1_OVERLOADED|service unavailable|502|503/i.test(msg);
	}

	private async _retry<T>(fn: () => Promise<T>): Promise<T> {
		let lastErr: unknown;
		for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
			try {
				return await fn();
			} catch (err) {
				lastErr = err;
				if (attempt < this.maxRetries && this._isTransient(err)) {
					await new Promise((r) => setTimeout(r, this.retryDelayMs * Math.pow(2, attempt)));
				} else {
					throw err;
				}
			}
		}
		throw lastErr;
	}

	// ── Query methods ───────────────────────────────────

	async all<T = Record<string, unknown>>(stmt: SqlStatement): Promise<T[]> {
		const start = performance.now();
		try {
			const rows = await this._retry(async () => {
				const r = await this.db
					.prepare(stmt.sql)
					.bind(...stmt.bindings)
					.all<T>();
				return (r.results ?? []) as T[];
			});
			this.onQuery({
				sql: stmt.sql,
				bindings: stmt.bindings,
				durationMs: Math.round((performance.now() - start) * 100) / 100,
				rowsReturned: rows.length,
			});
			return rows;
		} catch (err) {
			this.onQuery({
				sql: stmt.sql,
				bindings: stmt.bindings,
				durationMs: Math.round((performance.now() - start) * 100) / 100,
				error: err instanceof Error ? err : new Error(String(err)),
			});
			throw err;
		}
	}

	async first<T = Record<string, unknown>>(stmt: SqlStatement): Promise<T | null> {
		const start = performance.now();
		try {
			const row = await this._retry(async () => {
				const r = await this.db
					.prepare(stmt.sql)
					.bind(...stmt.bindings)
					.first<T>();
				return (r ?? null) as T | null;
			});
			this.onQuery({
				sql: stmt.sql,
				bindings: stmt.bindings,
				durationMs: Math.round((performance.now() - start) * 100) / 100,
				rowsReturned: row ? 1 : 0,
			});
			return row;
		} catch (err) {
			this.onQuery({
				sql: stmt.sql,
				bindings: stmt.bindings,
				durationMs: Math.round((performance.now() - start) * 100) / 100,
				error: err instanceof Error ? err : new Error(String(err)),
			});
			throw err;
		}
	}

	async run(stmt: SqlStatement): Promise<D1Result> {
		const start = performance.now();
		try {
			const result = await this._retry(() =>
				this.db
					.prepare(stmt.sql)
					.bind(...stmt.bindings)
					.run(),
			);
			this.onQuery({
				sql: stmt.sql,
				bindings: stmt.bindings,
				durationMs: Math.round((performance.now() - start) * 100) / 100,
				rowsAffected: getRowsAffected(result),
			});
			return result;
		} catch (err) {
			this.onQuery({
				sql: stmt.sql,
				bindings: stmt.bindings,
				durationMs: Math.round((performance.now() - start) * 100) / 100,
				error: err instanceof Error ? err : new Error(String(err)),
			});
			throw err;
		}
	}

	async runFirst<T = Record<string, unknown>>(stmt: SqlStatement): Promise<T | null> {
		const start = performance.now();
		try {
			const row = await this._retry(async () => {
				const r = await this.db
					.prepare(stmt.sql)
					.bind(...stmt.bindings)
					.first<T>();
				return (r ?? null) as T | null;
			});
			this.onQuery({
				sql: stmt.sql,
				bindings: stmt.bindings,
				durationMs: Math.round((performance.now() - start) * 100) / 100,
				rowsReturned: row ? 1 : 0,
			});
			return row;
		} catch (err) {
			this.onQuery({
				sql: stmt.sql,
				bindings: stmt.bindings,
				durationMs: Math.round((performance.now() - start) * 100) / 100,
				error: err instanceof Error ? err : new Error(String(err)),
			});
			throw err;
		}
	}

	async batch<T = unknown>(statements: SqlStatement[]): Promise<D1Result<T>[]> {
		const start = performance.now();
		try {
			const results = await this._retry(async () => {
				const prepared = statements.map((s) => this.db.prepare(s.sql).bind(...s.bindings));
				return this.db.batch<T>(prepared);
			});
			this.onQuery({
				sql: `BATCH (${statements.length} stmts)`,
				bindings: [],
				durationMs: Math.round((performance.now() - start) * 100) / 100,
				rowsAffected: results.reduce((s, r) => s + getRowsAffected(r as unknown as D1ExecResult), 0),
			});
			return results;
		} catch (err) {
			this.onQuery({
				sql: `BATCH (${statements.length} stmts)`,
				bindings: [],
				durationMs: Math.round((performance.now() - start) * 100) / 100,
				error: err instanceof Error ? err : new Error(String(err)),
			});
			throw err;
		}
	}

	async exec(sql: string): Promise<D1ExecResult> {
		const start = performance.now();
		try {
			// The Sessions API has no `exec` (multi-statement DDL/raw script) — it
			// would not be session-consistent anyway. Use the raw binding: `exec` is
			// DDL/setup, always served by the primary regardless.
			const result = await this._retry(() => this.binding.exec(sql));
			this.onQuery({
				sql,
				bindings: [],
				durationMs: Math.round((performance.now() - start) * 100) / 100,
				rowsAffected: getRowsAffected(result),
			});
			return result;
		} catch (err) {
			this.onQuery({
				sql,
				bindings: [],
				durationMs: Math.round((performance.now() - start) * 100) / 100,
				error: err instanceof Error ? err : new Error(String(err)),
			});
			throw err;
		}
	}
}
