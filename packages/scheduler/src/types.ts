/**
 * @mmbix/scheduler — shared types
 *
 * Hybrid model:
 *   - handlers are CODE  (registered in the worker via `registerHandler`)
 *   - schedules are DATA (D1 rows in `_scheduler_tasks`)
 *
 * Every task owns one Durable Object instance (named `task:<id>`) whose single
 * alarm is the task's next run time. The cron watchdog re-arms any task whose
 * alarm was lost, so the scheduler self-heals without keeping DOs alive.
 */

export type TaskStatus = 'pending' | 'done' | 'failed' | 'cancelled';

/** A task row as stored in `_scheduler_tasks`. */
export interface ScheduledTask {
	id: string;
	/** Handler type — must match a registered handler (code). */
	type: string;
	name: string | null;
	/** JSON-encoded handler payload (data). */
	payload_json: string;
	status: TaskStatus;
	/** ISO string — next (or initial) run time. */
	run_at: string;
	/** Recurring interval in ms (data). Mutually exclusive-ish with `cron`. */
	repeat_ms: number | null;
	/** 5-field cron expression (data). Wins over `repeat_ms`. */
	cron: string | null;
	/** IANA timezone for the cron evaluation (default "UTC"). */
	timezone: string;
	max_attempts: number;
	/** Attempts for the CURRENT occurrence (reset after each success). */
	attempts: number;
	/** Total successful runs across the task's life. */
	run_count: number;
	last_error: string | null;
	/** JSON-encoded result of the last run. */
	last_result: string | null;
	last_run_at: string | null;
	/**
	 * When the task was DISARMED after exhausting its retry budget — the durable
	 * marker that this job has STOPPED (not merely failed once and is backing off).
	 * `null` while the task is armed/pending/recurring or mid-backoff. Cleared when
	 * the task is re-scheduled, retried, or a recurring occurrence succeeds.
	 */
	disarmed_at: string | null;
	completed_at: string | null;
	created_at: string;
	updated_at: string;
}

/** Input accepted by `SchedulerService.schedule()` (data side of the model). */
export interface ScheduleInput {
	/** Client-supplied id → idempotent upsert (re-schedule reactivates a done task). */
	id?: string;
	/** Handler type (code side of the model). Required. */
	type: string;
	name?: string;
	/** Payload passed to the handler at run time. */
	payload?: Record<string, unknown>;
	/** Absolute first run time — ISO string or epoch ms. */
	runAt?: string | number;
	/** First run = now + delayMs (default 0). Ignored when `runAt` is set. */
	delayMs?: number;
	/** Recurring interval in ms. */
	repeatMs?: number;
	/** 5-field cron expression (UTC) — wins over `repeatMs`. */
	cron?: string;
	/** IANA timezone the cron runs in (e.g. "Asia/Yangon"). Default "UTC". */
	timezone?: string;
	/** Per-occurrence retry budget (default 5). */
	maxAttempts?: number;
}

/** Context handed to a handler at run time. */
export interface HandlerContext {
	/** Snapshot of the task row at execution time. */
	task: ScheduledTask;
	/** Worker bindings — handlers reach DB/R2/DOs through this. */
	env: SchedulerEnv;
	/** 1-based attempt number for the current occurrence. */
	attempts: number;
	/** Structured logging helper (no-op safe). */
	log: (msg: string, data?: unknown) => void;
}

/** A scheduled handler (code side of the model). Return value is stored as last_result. */
export type TaskHandler = (payload: Record<string, unknown>, ctx: HandlerContext) => unknown | Promise<unknown>;

/** Outcome of executing a task (returned by runNow / DO /run). */
export interface RunOutcome {
	id: string;
	status: TaskStatus;
	attempts: number;
	run_count: number;
	/** ISO string when the task was re-armed for a repeat/retry, else null. */
	next_run_at: string | null;
	result?: unknown;
	error?: string;
	/**
	 * True when this run exhausted the retry budget and the task was disarmed
	 * (terminally failed). False while a failure is still backing off for a retry.
	 */
	disarmed?: boolean;
	/** Why the task did not run (guards in the execution path). */
	skipped?: 'not_found' | 'not_due' | 'cancelled' | 'done' | 'no_handler';
}

/** Minimal env shape the scheduler DO + service rely on. */
export interface SchedulerEnv {
	DB: D1Database;
	/** DO namespace binding (class `SchedulerDO`). Optional → watchdog arms later. */
	SCHEDULER?: DurableObjectNamespace;
}

/** Storage-level arm/disarm ops injected by the DO into runTask (avoids self-calls). */
export interface SchedulerOps {
	arm(runAtMs: number): Promise<void>;
	disarm(): Promise<void>;
}
