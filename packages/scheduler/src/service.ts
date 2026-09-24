/**
 * SchedulerService — DATA side of the hybrid model.
 *
 * Task rows live in D1 (`_scheduler_tasks`); each task owns one Durable Object
 * (`task:<id>`) whose alarm is its next run. This service:
 *
 *   schedule()  → upsert row + arm the DO alarm
 *   cancel()    → mark cancelled + delete the alarm
 *   runNow()    → execute immediately through the DO (same path as the alarm)
 *   retry()     → reset a failed task (fresh attempt budget) + re-arm
 *   reconcile() → watchdog: re-arm every due task whose alarm was lost
 *   prune()     → housekeeping for finished rows
 *
 * `runTask()` is the single execution path — invoked by the DO alarm handler
 * and by the DO `/run` RPC. It handles: due-guards, handler dispatch, success
 * (done | repeat re-arm), failure (backoff re-arm | exhausted→failed).
 */

import { D1Client } from '@mmbix/core';
import { nextCronRun, nextCronRunInTz, isValidCron, isValidTimeZone } from './cron';
import { getHandler, hasHandler, listHandlers } from './registry';
import type { RunOutcome, ScheduleInput, ScheduledTask, SchedulerEnv, SchedulerOps } from './types';

// ─── Tuning constants ──────────────────────────────────

export const SCHEDULER_DEFAULT_MAX_ATTEMPTS = 5;
export const SCHEDULER_BACKOFF_BASE_MS = 30_000; // 30s, doubles per attempt
export const SCHEDULER_BACKOFF_CAP_MS = 60 * 60_000; // 60 min
export const SCHEDULER_TASK_PREFIX = 'task:';

/** Exponential backoff: 30s, 1m, 2m, 4m, … capped at 60m. */
export function schedulerBackoffMs(attempts: number): number {
	if (attempts <= 1) return SCHEDULER_BACKOFF_BASE_MS;
	return Math.min(SCHEDULER_BACKOFF_CAP_MS, SCHEDULER_BACKOFF_BASE_MS * 2 ** (attempts - 1));
}

// ─── Row helpers ───────────────────────────────────────

const TASK_COLUMNS =
	'id, type, name, payload_json, status, run_at, repeat_ms, cron, timezone, max_attempts, attempts, run_count, last_error, last_result, last_run_at, completed_at, created_at, updated_at';

function toTask(row: Record<string, unknown>): ScheduledTask {
	return {
		id: String(row.id),
		type: String(row.type),
		name: row.name == null ? null : String(row.name),
		payload_json: String(row.payload_json),
		status: row.status as ScheduledTask['status'],
		run_at: String(row.run_at),
		repeat_ms: row.repeat_ms == null ? null : Number(row.repeat_ms),
		cron: row.cron == null ? null : String(row.cron),
		timezone: row.timezone == null ? 'UTC' : String(row.timezone),
		max_attempts: Number(row.max_attempts),
		attempts: Number(row.attempts),
		run_count: Number(row.run_count),
		last_error: row.last_error == null ? null : String(row.last_error),
		last_result: row.last_result == null ? null : String(row.last_result),
		last_run_at: row.last_run_at == null ? null : String(row.last_run_at),
		completed_at: row.completed_at == null ? null : String(row.completed_at),
		created_at: String(row.created_at),
		updated_at: String(row.updated_at),
	};
}

function toMs(value: string | number): number {
	const ms = typeof value === 'number' ? value : new Date(value).getTime();
	if (!Number.isFinite(ms)) throw new Error('invalid runAt — expected an ISO string or epoch ms');
	return ms;
}

// ─── Service ───────────────────────────────────────────

export class SchedulerService {
	constructor(private readonly db: D1Client) {}

	// ── Schedule ─────────────────────────────────────────

	/**
	 * Create (or re-schedule) a task. Re-scheduling an existing id reactivates
	 * it (status → pending, attempts → 0) while keeping run_count.
	 */
	async schedule(input: ScheduleInput, env: SchedulerEnv): Promise<ScheduledTask> {
		const type = input.type?.trim();
		if (!type) throw new Error('type is required — the registered handler name');
		if (input.maxAttempts !== undefined && (input.maxAttempts < 1 || !Number.isInteger(input.maxAttempts))) {
			throw new Error('maxAttempts must be a positive integer');
		}
		if (input.payload !== undefined && (input.payload === null || typeof input.payload !== 'object')) {
			throw new Error('payload must be an object');
		}
		if (input.cron !== undefined && !isValidCron(input.cron)) {
			throw new Error(`invalid cron expression "${input.cron}"`);
		}
		if (input.timezone !== undefined && !isValidTimeZone(input.timezone)) {
			throw new Error(`invalid timezone "${input.timezone}" — expected an IANA name like "Asia/Yangon"`);
		}
		// Fail fast on configuration errors: a handler is code registered at
		// worker startup, so a schedule for an unknown type is a typo, not a
		// future capability. (Tasks already in the table for a removed handler
		// still fail gracefully at run time and land in `failed`.)
		if (!hasHandler(type)) {
			throw new Error(`no handler registered for type "${type}" — registerHandler() it first`);
		}

		const id = input.id?.trim() || crypto.randomUUID();
		const now = new Date().toISOString();
		const timezone = input.timezone?.trim() || 'UTC';

		// First-run time:
		//   explicit runAt          → that instant
		//   cron (no runAt)         → the next grid occurrence in the task timezone
		//   otherwise               → now + delayMs (0 = run immediately)
		let runAtMs: number;
		if (input.runAt !== undefined) {
			runAtMs = toMs(input.runAt);
		} else if (input.cron) {
			const from = new Date(Date.now() + (input.delayMs ?? 0));
			const next = timezone === 'UTC' ? nextCronRun(input.cron, from) : nextCronRunInTz(input.cron, timezone, from);
			runAtMs = next ? next.getTime() : Date.now() + (input.delayMs ?? 0);
		} else {
			runAtMs = Date.now() + (input.delayMs ?? 0);
		}
		const runAt = new Date(runAtMs).toISOString();
		const maxAttempts = input.maxAttempts ?? SCHEDULER_DEFAULT_MAX_ATTEMPTS;

		await this.db.run({
			sql: `INSERT INTO _scheduler_tasks (id, type, name, payload_json, status, run_at, repeat_ms, cron, timezone, max_attempts, attempts, run_count, last_error, last_result, last_run_at, completed_at, created_at, updated_at)
				VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 0, 0, NULL, NULL, NULL, NULL, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					type = excluded.type,
					name = excluded.name,
					payload_json = excluded.payload_json,
					status = 'pending',
					run_at = excluded.run_at,
					repeat_ms = excluded.repeat_ms,
					cron = excluded.cron,
					timezone = excluded.timezone,
					max_attempts = excluded.max_attempts,
					attempts = 0,
					last_error = NULL,
					completed_at = NULL,
					updated_at = excluded.updated_at`,
			bindings: [
				id,
				type,
				input.name?.trim() ?? null,
				JSON.stringify(input.payload ?? {}),
				runAt,
				input.repeatMs ?? null,
				input.cron?.trim() ?? null,
				timezone,
				maxAttempts,
				now,
				now,
			],
		});

		// Arm the DO alarm. If arming fails (or the binding is absent) the row is
		// still persisted — the cron watchdog picks it up on the next tick.
		try {
			await this.arm(id, runAtMs, env);
		} catch (err) {
			console.error(`[scheduler] arm failed for ${id}:`, err instanceof Error ? err.message : err);
		}

		const row = await this.get(id);
		if (!row) throw new Error('task row missing after schedule');
		return row;
	}

	// ── Reads ────────────────────────────────────────────

	async get(id: string): Promise<ScheduledTask | null> {
		const row = await this.db.first<Record<string, unknown>>({
			sql: `SELECT ${TASK_COLUMNS} FROM _scheduler_tasks WHERE id = ?`,
			bindings: [id],
		});
		return row ? toTask(row) : null;
	}

	async list(opts: { status?: string; type?: string; limit?: number } = {}): Promise<ScheduledTask[]> {
		const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
		const clauses: string[] = [];
		const bindings: unknown[] = [];
		if (opts.status && ['pending', 'done', 'failed', 'cancelled'].includes(opts.status)) {
			clauses.push('status = ?');
			bindings.push(opts.status);
		}
		if (opts.type?.trim()) {
			clauses.push('type = ?');
			bindings.push(opts.type.trim());
		}
		const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
		bindings.push(limit);
		const rows = await this.db.all<Record<string, unknown>>({
			sql: `SELECT ${TASK_COLUMNS} FROM _scheduler_tasks ${where} ORDER BY run_at ASC LIMIT ?`,
			bindings,
		});
		return rows.map(toTask);
	}

	/** Registered handler types (the code side — what CAN be scheduled). */
	listHandlers(): string[] {
		return listHandlers();
	}

	async stats(): Promise<Record<string, number>> {
		const rows = await this.db.all<{ status: string; count: number }>({
			sql: 'SELECT status, COUNT(*) AS count FROM _scheduler_tasks GROUP BY status',
			bindings: [],
		});
		const out: Record<string, number> = { pending: 0, done: 0, failed: 0, cancelled: 0 };
		for (const r of rows) out[r.status] = Number(r.count);
		return out;
	}

	// ── Mutations ────────────────────────────────────────

	/** Mark a task cancelled and disarm its alarm. Returns false when missing. */
	async cancel(id: string, env: SchedulerEnv): Promise<boolean> {
		const row = await this.get(id);
		if (!row) return false;
		await this.db.run({
			sql: `UPDATE _scheduler_tasks SET status = 'cancelled', updated_at = ? WHERE id = ?`,
			bindings: [new Date().toISOString(), id],
		});
		try {
			await this.disarm(id, env);
		} catch (err) {
			console.error(`[scheduler] disarm failed for ${id}:`, err instanceof Error ? err.message : err);
		}
		return true;
	}

	/** Execute immediately through the DO (same path as the alarm). */
	async runNow(id: string, env: SchedulerEnv): Promise<RunOutcome> {
		const ns = env.SCHEDULER;
		if (!ns) throw new Error('SCHEDULER DO binding is not configured');
		const stub = ns.get(ns.idFromName(SCHEDULER_TASK_PREFIX + id));
		const res = await stub.fetch('https://scheduler/run', {
			method: 'POST',
			body: JSON.stringify({ id }),
		});
		if (!res.ok) {
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			throw new Error(body.error ?? `scheduler run failed (${res.status})`);
		}
		return (await res.json()) as RunOutcome;
	}

	/** Reset a failed task: fresh attempt budget, due now, re-armed. */
	async retry(id: string, env: SchedulerEnv): Promise<boolean> {
		const row = await this.get(id);
		if (!row || row.status !== 'failed') return false;
		const now = new Date().toISOString();
		await this.db.run({
			sql: `UPDATE _scheduler_tasks SET status = 'pending', attempts = 0, last_error = NULL, run_at = ?, updated_at = ? WHERE id = ?`,
			bindings: [now, now, id],
		});
		try {
			await this.arm(id, Date.now(), env);
		} catch (err) {
			console.error(`[scheduler] re-arm failed for ${id}:`, err instanceof Error ? err.message : err);
		}
		return true;
	}

	/**
	 * Watchdog — called by the cron trigger. Re-arms every due task whose alarm
	 * was lost (DO evicted before arm, missed setAlarm, crashed alarm handler,
	 * or rows inserted outside the service). Idempotent: arming an already-armed
	 * DO with the same time is a no-op.
	 */
	async reconcile(env: SchedulerEnv, limit = 200): Promise<{ armed: number }> {
		const ns = env.SCHEDULER;
		if (!ns) return { armed: 0 };
		const due = await this.db.all<{ id: string; run_at: string }>({
			sql: `SELECT id, run_at FROM _scheduler_tasks
				WHERE status IN ('pending', 'failed') AND attempts < max_attempts AND run_at <= ?
				ORDER BY run_at ASC LIMIT ?`,
			bindings: [new Date().toISOString(), limit],
		});
		let armed = 0;
		for (const row of due) {
			try {
				await this.arm(String(row.id), new Date(String(row.run_at)).getTime(), env);
				armed++;
			} catch (err) {
				console.error(`[scheduler] reconcile arm failed for ${row.id}:`, err instanceof Error ? err.message : err);
			}
		}
		return { armed };
	}

	/** Housekeeping — delete finished rows older than `days`. */
	async prune(days = 7): Promise<number> {
		const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
		const result = await this.db.run({
			sql: `DELETE FROM _scheduler_tasks WHERE status IN ('done', 'cancelled') AND updated_at < ?`,
			bindings: [cutoff],
		});
		return result.meta?.changes ?? 0;
	}

	// ── DO helpers ───────────────────────────────────────

	private async arm(id: string, runAtMs: number, env: SchedulerEnv): Promise<void> {
		const ns = env.SCHEDULER;
		if (!ns) return;
		const stub = ns.get(ns.idFromName(SCHEDULER_TASK_PREFIX + id));
		const res = await stub.fetch('https://scheduler/arm', {
			method: 'POST',
			body: JSON.stringify({ id, runAt: runAtMs }),
		});
		await res.text(); // consume — keeps the DO connection reusable
		if (!res.ok) throw new Error(`arm failed (${res.status})`);
	}

	private async disarm(id: string, env: SchedulerEnv): Promise<void> {
		const ns = env.SCHEDULER;
		if (!ns) return;
		const stub = ns.get(ns.idFromName(SCHEDULER_TASK_PREFIX + id));
		const res = await stub.fetch('https://scheduler/cancel', { method: 'POST' });
		await res.text(); // consume — keeps the DO connection reusable
		if (!res.ok) throw new Error(`disarm failed (${res.status})`);
	}
}

// ─── Shared execution path (DO alarm + manual run) ─────

/**
 * Execute one task. Used by the SchedulerDO alarm handler (`via: 'alarm'`) and
 * by the DO `/run` RPC (`via: 'manual'`). Single-threaded per task (one DO per
 * task) so two executions can never race. The DO passes its own storage ops so
 * re-arming happens locally (a stub self-call would deadlock the input gate).
 */
export async function runTask(env: SchedulerEnv, id: string, via: 'alarm' | 'manual', ops?: Partial<SchedulerOps>): Promise<RunOutcome> {
	const db = new D1Client(env.DB);
	const nowMs = Date.now();
	const arm = ops?.arm ?? ((ms: number) => armQuietly(env, id, ms));
	const disarm = ops?.disarm ?? (() => disarmQuietly(env, id));

	const row = await db.first<Record<string, unknown>>({
		sql: `SELECT ${TASK_COLUMNS} FROM _scheduler_tasks WHERE id = ?`,
		bindings: [id],
	});
	if (!row) return { id, status: 'cancelled', attempts: 0, run_count: 0, next_run_at: null, skipped: 'not_found' };

	const task = toTask(row);

	// Terminal states never run again (re-schedule/retry reactivate the row).
	if (task.status === 'done' || task.status === 'cancelled') {
		await disarm();
		return { id, status: task.status, attempts: task.attempts, run_count: task.run_count, next_run_at: null, skipped: task.status };
	}

	// Alarm path only: a task rescheduled to a later time is re-armed, not run.
	if (via === 'alarm' && new Date(task.run_at).getTime() > nowMs) {
		await arm(new Date(task.run_at).getTime());
		return { id, status: task.status, attempts: task.attempts, run_count: task.run_count, next_run_at: task.run_at, skipped: 'not_due' };
	}

	const attempts = task.attempts + 1;
	const handler = getHandler(task.type);
	const nowIso = new Date(nowMs).toISOString();

	try {
		if (!handler) throw new Error(`no handler registered for type "${task.type}"`);

		const result = await handler(JSON.parse(task.payload_json) as Record<string, unknown>, {
			task,
			env,
			attempts,
			log: (msg, data) => console.info(`[scheduler] ${task.id}: ${msg}`, data ?? ''),
		});

		const nextMs = computeNextRun(task, nowMs);
		const resultJson = result === undefined ? null : JSON.stringify(result);

		if (nextMs !== null) {
			// Recurring — reset the attempt budget for the next occurrence.
			await db.run({
				sql: `UPDATE _scheduler_tasks
					SET status = 'pending', run_at = ?, attempts = 0, last_error = NULL, last_result = ?,
						last_run_at = ?, run_count = run_count + 1, updated_at = ?
					WHERE id = ?`,
				bindings: [new Date(nextMs).toISOString(), resultJson, nowIso, nowIso, id],
			});
			await arm(nextMs);
			return { id, status: 'pending', attempts: 0, run_count: task.run_count + 1, next_run_at: new Date(nextMs).toISOString(), result };
		}

		// One-shot — finished.
		await db.run({
			sql: `UPDATE _scheduler_tasks
				SET status = 'done', last_result = ?, last_run_at = ?, completed_at = ?, run_count = run_count + 1, updated_at = ?
				WHERE id = ?`,
			bindings: [resultJson, nowIso, nowIso, nowIso, id],
		});
		await disarm();
		return { id, status: 'done', attempts, run_count: task.run_count + 1, next_run_at: null, result };
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);

		if (attempts >= task.max_attempts) {
			// Budget exhausted → stays failed for manual retry; watchdog never re-arms.
			await db.run({
				sql: `UPDATE _scheduler_tasks SET status = 'failed', attempts = ?, last_error = ?, last_run_at = ?, updated_at = ? WHERE id = ?`,
				bindings: [attempts, error, nowIso, nowIso, id],
			});
			await disarm();
			return { id, status: 'failed', attempts, run_count: task.run_count, next_run_at: null, error };
		}

		// Backoff and re-arm — the alarm IS the retry timer; the watchdog backs it up.
		const backoffMs = schedulerBackoffMs(attempts);
		const nextMs = nowMs + backoffMs;
		await db.run({
			sql: `UPDATE _scheduler_tasks SET status = 'failed', attempts = ?, last_error = ?, run_at = ?, last_run_at = ?, updated_at = ? WHERE id = ?`,
			bindings: [attempts, error, new Date(nextMs).toISOString(), nowIso, nowIso, id],
		});
		await arm(nextMs);
		return { id, status: 'failed', attempts, run_count: task.run_count, next_run_at: new Date(nextMs).toISOString(), error };
	}
}

/** Next run after a success: cron wins (in the task's timezone), else repeat_ms, else one-shot. */
function computeNextRun(task: ScheduledTask, nowMs: number): number | null {
	if (task.cron) {
		const from = new Date(nowMs);
		const next = task.timezone && task.timezone !== 'UTC' ? nextCronRunInTz(task.cron, task.timezone, from) : nextCronRun(task.cron, from);
		return next ? next.getTime() : null;
	}
	if (task.repeat_ms && task.repeat_ms > 0) return nowMs + task.repeat_ms;
	return null;
}

async function armQuietly(env: SchedulerEnv, id: string, runAtMs: number): Promise<void> {
	try {
		const ns = env.SCHEDULER;
		if (!ns) return;
		const stub = ns.get(ns.idFromName(SCHEDULER_TASK_PREFIX + id));
		const res = await stub.fetch('https://scheduler/arm', { method: 'POST', body: JSON.stringify({ id, runAt: runAtMs }) });
		await res.text(); // consume
	} catch (err) {
		console.error(`[scheduler] arm failed for ${id}:`, err instanceof Error ? err.message : err);
	}
}

async function disarmQuietly(env: SchedulerEnv, id: string): Promise<void> {
	try {
		const ns = env.SCHEDULER;
		if (!ns) return;
		const stub = ns.get(ns.idFromName(SCHEDULER_TASK_PREFIX + id));
		const res = await stub.fetch('https://scheduler/cancel', { method: 'POST' });
		await res.text(); // consume
	} catch (err) {
		console.error(`[scheduler] disarm failed for ${id}:`, err instanceof Error ? err.message : err);
	}
}
