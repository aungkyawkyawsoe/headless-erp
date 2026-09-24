/**
 * IdempotencyService — Stripe-style idempotency keys, D1-backed.
 *
 * Guarantees:
 *   - A key runs its operation exactly once; concurrent/replayed calls with the
 *     same key get the cached result (strong consistency — D1 primary reads).
 *   - A stale 'processing' claim (crashed caller) is taken over after `ttlMs`.
 *   - Failures are recorded as `failed` → the next call with the same key
 *     re-runs (unless `recordFailures: false`).
 *
 * Backed by `_idempotency_keys (key PRIMARY KEY, status, response_json, error,
 * created_at, updated_at)` — the single INSERT..ON CONFLICT claim is atomic, so
 * two concurrent calls can never both run the operation.
 *
 * Value must be JSON-serializable (Response payloads work — the API middleware
 * serializes status/headers/body).
 */

import { D1Client } from '@mmbix/core';

export interface IdempotencyOptions {
	/** Lease/expiry window in ms (default 24h). */
	ttlMs?: number;
	/** Record failures so a retry with the same key re-runs (default true). */
	recordFailures?: boolean;
}

export interface IdempotencyResult<T> {
	/** true when the cached result from a previous run was replayed. */
	replayed: boolean;
	value: T;
}

/** Thrown when the same key is still 'processing' (concurrent request). */
export class IdempotencyConflictError extends Error {
	constructor(key: string) {
		super(`a request with idempotency key "${key}" is already in progress`);
		this.name = 'IdempotencyConflictError';
	}
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const PRUNE_EVERY = 100; // lazy prune cadence (per isolate)

// Matches the plugin migration DDL — self-healing bootstrap for other workers.
const ENSURES = `CREATE TABLE IF NOT EXISTS _idempotency_keys (key TEXT PRIMARY KEY, status TEXT NOT NULL, response_json TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;

export class IdempotencyService {
	private pruneCounter = 0;

	constructor(private readonly db: D1Client) {}

	/**
	 * Run `fn` exactly once per `key`. Returns the fresh result (replayed=false)
	 * or the cached result (replayed=true) for duplicate keys.
	 */
	async run<T>(key: string, fn: () => Promise<T> | T, opts: IdempotencyOptions = {}): Promise<IdempotencyResult<T>> {
		const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
		const recordFailures = opts.recordFailures !== false;
		const now = new Date().toISOString();
		const staleBefore = new Date(Date.now() - ttlMs).toISOString();

		await this.ensureTable();

		// Atomic claim: insert as 'processing'. If the same key is already a
		// stale 'processing' claim (crashed caller) → take it over. A fresh
		// 'processing' claim or a 'done'/'failed' row → no change (changes = 0).
		const claim = await this.db.run({
			sql: `INSERT INTO _idempotency_keys (key, status, response_json, error, created_at, updated_at)
				VALUES (?, 'processing', NULL, NULL, ?, ?)
				ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at
					WHERE _idempotency_keys.status = 'processing' AND _idempotency_keys.created_at <= ?`,
			bindings: [key, now, now, staleBefore],
		});

		let owned = (claim.meta?.changes ?? 0) > 0;

		if (!owned) {
			const row = await this.db.first<{ status: string; response_json: string | null }>({
				sql: 'SELECT status, response_json FROM _idempotency_keys WHERE key = ?',
				bindings: [key],
			});

			if (row?.status === 'done' && row.response_json != null) {
				return { replayed: true, value: JSON.parse(row.response_json) as T };
			}
			if (row?.status === 'failed') {
				// Previous attempt failed → the caller is allowed to retry: take the
				// key over and re-run (a failed op has no result to preserve).
				const took = await this.db.run({
					sql: `UPDATE _idempotency_keys SET status = 'processing', updated_at = ? WHERE key = ? AND status = 'failed'`,
					bindings: [new Date().toISOString(), key],
				});
				owned = (took.meta?.changes ?? 0) > 0;
			}
		}

		if (!owned) throw new IdempotencyConflictError(key);

		// We own the key — run the operation.
		try {
			const value = await fn();
			const serialized = value === undefined ? null : JSON.stringify(value);
			await this.db.run({
				sql: `UPDATE _idempotency_keys SET status = 'done', response_json = ?, error = NULL, updated_at = ? WHERE key = ?`,
				bindings: [serialized, new Date().toISOString(), key],
			});
			this.maybePrune(ttlMs);
			return { replayed: false, value };
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			if (recordFailures) {
				await this.db.run({
					sql: `UPDATE _idempotency_keys SET status = 'failed', error = ?, updated_at = ? WHERE key = ?`,
					bindings: [error, new Date().toISOString(), key],
				});
			} else {
				// Nothing to cache — free the key for an immediate retry.
				await this.db.run({ sql: `DELETE FROM _idempotency_keys WHERE key = ?`, bindings: [key] });
			}
			throw err;
		}
	}

	/** Look up a cached result by key (no side effects). */
	async get<T = unknown>(key: string): Promise<{ status: string; value?: T; error?: string } | null> {
		await this.ensureTable();
		const row = await this.db.first<{ status: string; response_json: string | null; error: string | null }>({
			sql: 'SELECT status, response_json, error FROM _idempotency_keys WHERE key = ?',
			bindings: [key],
		});
		if (!row) return null;
		return {
			status: row.status,
			value: row.response_json ? (JSON.parse(row.response_json) as T) : undefined,
			error: row.error ?? undefined,
		};
	}

	/** Delete rows older than `ttlDays` (housekeeping — also prunes lazily). */
	async pruneExpired(ttlDays = 1): Promise<number> {
		const cutoff = new Date(Date.now() - ttlDays * 86_400_000).toISOString();
		const result = await this.db.run({
			sql: `DELETE FROM _idempotency_keys WHERE updated_at < ?`,
			bindings: [cutoff],
		});
		return result.meta?.changes ?? 0;
	}

	private async ensureTable(): Promise<void> {
		const g = globalThis as unknown as Record<string, boolean>;
		if (g.__IDEMPOTENCY_TABLE__) return;
		await this.db.exec(ENSURES);
		g.__IDEMPOTENCY_TABLE__ = true;
	}

	private maybePrune(ttlMs: number): void {
		this.pruneCounter++;
		if (this.pruneCounter % PRUNE_EVERY === 0) {
			void this.pruneExpired(Math.max(1, Math.ceil(ttlMs / 86_400_000)));
		}
	}
}
