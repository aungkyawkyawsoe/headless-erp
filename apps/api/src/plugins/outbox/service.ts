/**
 * OutboxService — durable side-effect dispatcher (exactly-once-ish, ERP-grade).
 *
 * Side-effects that must survive (trigger plugins, webhook fan-out, custom
 * tasks) are enqueued as rows instead of fire-and-forget promises. A scheduled
 * flush retries them with exponential backoff; after MAX_ATTEMPTS a row moves
 * to the dead-letter table for manual inspection/retry.
 *
 * Idempotency: `dedupe_key` (UNIQUE) — re-enqueueing the same logical side
 * effect (e.g. a retried workflow transition) is a no-op, so a client retry can
 * never fire an email/tax-calculation twice.
 *
 * Tables (created by the plugin migration):
 *   _outbox      — pending / done / failed work
 *   _outbox_dlq  — poison messages (attempts exhausted)
 */

import { D1Client } from '@mmbix/core';

export interface OutboxEntry {
	id: string;
	type: string;
	dedupe_key: string | null;
	payload_json: string;
	status: 'pending' | 'done' | 'failed';
	attempts: number;
	next_attempt_at: string;
	error: string | null;
	created_at: string;
	updated_at: string;
}

export interface OutboxEnqueueOptions {
	/** Unique key — re-enqueue with the same key is a no-op (returns duplicated=true). */
	dedupeKey?: string;
	/** Minimum delay before the row is eligible (ms). Default 0. */
	delayMs?: number;
}

export const OUTBOX_MAX_ATTEMPTS = 5;
export const OUTBOX_BACKOFF_BASE_MS = 60_000; // 1 min, doubles per attempt, capped 60 min

/** Exponential backoff: 1m, 2m, 4m, 8m, … capped at 60m. */
export function outboxBackoffMs(attempts: number): number {
	return Math.min(60 * 60_000, OUTBOX_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

export class OutboxService {
	constructor(private readonly db: D1Client) {}

	// ─── Enqueue ──────────────────────────────────────────

	/**
	 * Enqueue a durable side effect. Returns the row id and whether the key
	 * was already in the queue (duplicated=true → caller can skip work).
	 */
	async enqueue(
		type: string,
		payload: Record<string, unknown>,
		opts: OutboxEnqueueOptions = {},
	): Promise<{ id: string; duplicated: boolean }> {
		const now = new Date().toISOString();
		const id = crypto.randomUUID();
		const nextAttempt = new Date(Date.now() + (opts.delayMs ?? 0)).toISOString();
		const result = await this.db.run({
			sql: `INSERT OR IGNORE INTO _outbox (id, type, dedupe_key, payload_json, status, attempts, next_attempt_at, error, created_at, updated_at)
				VALUES (?, ?, ?, ?, 'pending', 0, ?, NULL, ?, ?)`,
			bindings: [id, type, opts.dedupeKey ?? null, JSON.stringify(payload), nextAttempt, now, now],
		});
		const duplicated = (result.meta?.changes ?? 0) === 0;
		if (duplicated) {
			// The unique key already exists — find the existing row.
			const existing = await this.db.first<{ id: string }>({
				sql: 'SELECT id FROM _outbox WHERE dedupe_key = ?',
				bindings: [opts.dedupeKey ?? ''],
			});
			return { id: existing?.id ?? id, duplicated: true };
		}
		return { id, duplicated: false };
	}

	// ─── Flush (called by the scheduled handler) ──────────

	/**
	 * Process due rows. Each row is executed by its type handler; failures
	 * back off and eventually dead-letter. Returns a summary for logging.
	 */
	async flushDue(
		limit = 50,
		env?: Record<string, unknown>,
	): Promise<{ processed: number; succeeded: number; failed: number; dead_lettered: number }> {
		// The chain reads env via setChainEnv — make sure scheduled runs see it.
		if (env) {
			const { setChainEnv } = await import('@/plugins/marketplace/chain');
			setChainEnv(env);
		}
		// `failed` rows are RETRYING, not terminal: `markFailed` backs them off and
		// sets `next_attempt_at`. Selecting only `pending` orphaned every row after
		// its FIRST failure — the exponential backoff and the dead-letter path were
		// unreachable, so a poison message sat silently in the table forever. A
		// dead letter is the only terminal state; include `failed` so the retry
		// actually happens and eventually dead-letters.
		const due = await this.db.all<OutboxEntry>({
			sql: `SELECT * FROM _outbox WHERE status IN ('pending', 'failed') AND next_attempt_at <= ? ORDER BY created_at ASC LIMIT ?`,
			bindings: [new Date().toISOString(), limit],
		});
		let succeeded = 0;
		let failed = 0;
		let dead_lettered = 0;
		for (const row of due) {
			try {
				await this.execute(row);
				await this.markDone(row.id);
				succeeded++;
			} catch (err) {
				failed++;
				const attempts = row.attempts + 1;
				const error = err instanceof Error ? err.message : String(err);
				if (attempts >= OUTBOX_MAX_ATTEMPTS) {
					await this.deadLetter(row, error);
					dead_lettered++;
				} else {
					await this.markFailed(row.id, attempts, error);
				}
			}
		}
		return { processed: due.length, succeeded, failed, dead_lettered };
	}

	/** Execute a single outbox row by type. Throws on failure (caller handles backoff). */
	private async execute(row: OutboxEntry): Promise<void> {
		const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
		switch (row.type) {
			case 'plugin': {
				// payload: { plugin_id, input: { collection, event, doc } }
				const { runPluginById } = await import('@/plugins/marketplace/chain');
				await runPluginById(String(payload.plugin_id), payload.input as never);
				return;
			}
			case 'hook': {
				// payload: { collection, event, doc } — dispatch the hook spine.
				const { pluginHookRegistry } = await import('@/core/plugin-hooks');
				await pluginHookRegistry.dispatchFireAndForget(
					String(payload.collection),
					String(payload.event),
					(payload.doc ?? {}) as Record<string, unknown>,
					this.db,
				);
				return;
			}
			case 'webhook': {
				// payload: { url, method, headers, body }
				const res = await fetch(String(payload.url), {
					method: String(payload.method ?? 'POST'),
					headers: (payload.headers ?? {}) as Record<string, string>,
					body: payload.body === undefined ? undefined : JSON.stringify(payload.body),
				});
				if (!res.ok) throw new Error(`webhook responded ${res.status}`);
				return;
			}
			default:
				throw new Error(`unknown outbox type "${row.type}"`);
		}
	}

	// ─── Row lifecycle ────────────────────────────────────

	private async markDone(id: string): Promise<void> {
		await this.db.run({
			sql: `UPDATE _outbox SET status = 'done', updated_at = ? WHERE id = ?`,
			bindings: [new Date().toISOString(), id],
		});
	}

	private async markFailed(id: string, attempts: number, error: string): Promise<void> {
		const nextAttempt = new Date(Date.now() + outboxBackoffMs(attempts)).toISOString();
		await this.db.run({
			sql: `UPDATE _outbox SET status = 'failed', attempts = ?, error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?`,
			bindings: [attempts, error, nextAttempt, new Date().toISOString(), id],
		});
	}

	private async deadLetter(row: OutboxEntry, error: string): Promise<void> {
		// The DLQ row is the durable, queryable evidence (`GET /api/outbox/dlq`); the
		// log is on top of it, never instead of it — a poison message must be visible
		// both to an operator watching logs and to one reading the queue.
		console.error(`[outbox] dead-lettering ${row.type} (${row.id}) after ${row.attempts + 1} attempts: ${error}`);
		await this.db.run({
			sql: `INSERT INTO _outbox_dlq (id, type, dedupe_key, payload_json, attempts, error, failed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			bindings: [row.id, row.type, row.dedupe_key, row.payload_json, row.attempts + 1, error, new Date().toISOString()],
		});
		await this.db.run({ sql: `DELETE FROM _outbox WHERE id = ?`, bindings: [row.id] });
	}

	// ─── Management ───────────────────────────────────────

	async list(status: string | undefined, limit: number): Promise<OutboxEntry[]> {
		const valid = status !== undefined && ['pending', 'done', 'failed'].includes(status);
		const rows = await this.db.all<OutboxEntry>({
			sql: valid
				? `SELECT * FROM _outbox WHERE status = ? ORDER BY created_at DESC LIMIT ?`
				: `SELECT * FROM _outbox ORDER BY created_at DESC LIMIT ?`,
			bindings: valid ? [status as string, limit] : [limit],
		});
		return rows;
	}

	async listDlq(limit: number): Promise<Array<Record<string, unknown>>> {
		return this.db.all<Record<string, unknown>>({
			sql: `SELECT * FROM _outbox_dlq ORDER BY failed_at DESC LIMIT ?`,
			bindings: [limit],
		});
	}

	/** Retry a dead-lettered row — moves it back into the outbox (attempts reset). */
	async retryDlq(id: string): Promise<boolean> {
		const row = await this.db.first<Record<string, unknown>>({
			sql: `SELECT * FROM _outbox_dlq WHERE id = ?`,
			bindings: [id],
		});
		if (!row) return false;
		const now = new Date().toISOString();
		await this.db.run({
			sql: `INSERT INTO _outbox (id, type, dedupe_key, payload_json, status, attempts, next_attempt_at, error, created_at, updated_at)
				VALUES (?, ?, ?, ?, 'pending', 0, ?, NULL, ?, ?)`,
			bindings: [id, String(row.type), row.dedupe_key ?? null, String(row.payload_json), now, now, now],
		});
		await this.db.run({ sql: `DELETE FROM _outbox_dlq WHERE id = ?`, bindings: [id] });
		return true;
	}

	/** Prune finished rows older than `days` (housekeeping — run periodically).
	 *  Also prunes dead-letter rows by age so the DLQ can't grow unbounded (M13). */
	async pruneDone(days = 7): Promise<number> {
		const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
		const result = await this.db.run({
			sql: `DELETE FROM _outbox WHERE status = 'done' AND updated_at < ?`,
			bindings: [cutoff],
		});
		await this.pruneDlq(OUTBOX_DLQ_RETENTION_DAYS);
		return result.meta?.changes ?? 0;
	}

	/** Prune dead-letter rows older than `days` (retention on `failed_at`). */
	async pruneDlq(days = OUTBOX_DLQ_RETENTION_DAYS): Promise<number> {
		const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
		const result = await this.db.run({
			sql: `DELETE FROM _outbox_dlq WHERE failed_at < ?`,
			bindings: [cutoff],
		});
		return result.meta?.changes ?? 0;
	}
}

/** Default age cutoff for dead-letter rows (they never resolve themselves). */
export const OUTBOX_DLQ_RETENTION_DAYS = 30;
