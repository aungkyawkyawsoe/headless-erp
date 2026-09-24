/**
 * QuotaService — atomic fixed-window usage quotas (D1).
 *
 *   quota.consume('api:acme', 1, { limit: 10_000, windowMs: 86_400_000 })
 *     → { allowed, used, limit, resetAt }
 *
 * One atomic UPSERT per key (INSERT … ON CONFLICT … RETURNING) — safe across
 * every isolate. Same window math as the rate limiter.
 */

import { D1Client } from '@mmbix/core';

export interface QuotaConsumeOptions {
	/** Max usage per window. */
	limit: number;
	/** Window length in ms (e.g. 24h). */
	windowMs: number;
}

export interface QuotaResult {
	allowed: boolean;
	used: number;
	limit: number;
	/** Epoch ms when the current window ends. */
	resetAt: number;
}

// `limit` is a reserved word in SQLite — the column is `max_value`, mapped back
// to `limit` on the service result shape.
const TABLE = `CREATE TABLE IF NOT EXISTS _quotas (key TEXT PRIMARY KEY, window INTEGER NOT NULL, used REAL NOT NULL, max_value REAL NOT NULL, updated_at TEXT NOT NULL)`;

export class QuotaService {
	constructor(private readonly db: D1Client) {}

	/** Atomically consume `amount` — returns whether the quota still allows it. */
	async consume(key: string, amount: number, opts: QuotaConsumeOptions): Promise<QuotaResult> {
		// A negative/NaN/Infinity amount would corrupt the window total (or let a
		// caller refund unboundedly) — reject it before it reaches the UPSERT.
		if (!Number.isFinite(amount) || amount < 0) {
			throw new Error('quota amount must be a finite non-negative number');
		}
		const k = key.trim();
		if (!k) throw new Error('quota key is required');
		const nowSec = Math.floor(Date.now() / 1000);
		const windowSec = Math.max(1, Math.floor(opts.windowMs / 1000));
		const window = Math.floor(nowSec / windowSec);
		const resetAt = (window + 1) * windowSec;
		await this.ensure();

		const row = await this.db.first<{ used: number; max_value: number }>({
			sql: `INSERT INTO _quotas (key, window, used, max_value, updated_at) VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(key) DO UPDATE SET
					used = CASE WHEN _quotas.window = excluded.window THEN _quotas.used + excluded.used ELSE excluded.used END,
					window = excluded.window,
					max_value = excluded.max_value,
					updated_at = excluded.updated_at
				RETURNING used, max_value`,
			bindings: [k, window, amount, opts.limit, new Date().toISOString()],
		});

		const used = Number(row?.used ?? amount);
		const limit = Number(row?.max_value ?? opts.limit);
		return { allowed: used <= limit, used, limit, resetAt: resetAt * 1000 };
	}

	/** Read current usage without consuming. */
	async peek(key: string, windowMs: number): Promise<QuotaResult> {
		const k = key.trim();
		const windowSec = Math.max(1, Math.floor(windowMs / 1000));
		const window = Math.floor(Math.floor(Date.now() / 1000) / windowSec);
		await this.ensure();
		const row = await this.db.first<{ used: number; max_value: number }>({
			sql: `SELECT used, max_value FROM _quotas WHERE key = ? AND window = ?`,
			bindings: [k, window],
		});
		return {
			allowed: (row?.used ?? 0) <= (row?.max_value ?? 0),
			used: Number(row?.used ?? 0),
			limit: Number(row?.max_value ?? 0),
			resetAt: (window + 1) * windowSec * 1000,
		};
	}

	async reset(key: string): Promise<boolean> {
		const result = await this.db.run({ sql: `DELETE FROM _quotas WHERE key = ?`, bindings: [key.trim()] });
		return (result.meta?.changes ?? 0) > 0;
	}

	async list(limit = 100): Promise<Array<Record<string, unknown>>> {
		await this.ensure();
		return this.db.all<Record<string, unknown>>({
			sql: `SELECT * FROM _quotas ORDER BY updated_at DESC LIMIT ?`,
			bindings: [Math.min(Math.max(1, limit), 500)],
		});
	}

	private async ensure(): Promise<void> {
		const g = globalThis as unknown as Record<string, boolean>;
		if (g.__QUOTA_TABLE__) return;
		await this.db.exec(TABLE);
		g.__QUOTA_TABLE__ = true;
	}
}
