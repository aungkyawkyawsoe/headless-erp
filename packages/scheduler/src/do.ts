/**
 * SchedulerDO — one Durable Object per task (`task:<id>`), on demand.
 *
 * The DO is idle (hibernated) between runs — no sockets, no memory, no bill.
 * Each DO carries a single alarm = the task's next run time. When the alarm
 * fires, `alarm()` executes the task through the shared `runTask()` path and
 * re-arms itself for the next occurrence / backoff retry.
 *
 * RPC surface (called by SchedulerService over the stub):
 *   POST /arm    { id, runAt } → setAlarm(runAt) (+ store task id)
 *   POST /cancel               → deleteAlarm
 *   POST /run    { id }        → execute now (manual trigger), returns RunOutcome
 *   GET  /ping                 → { ok, taskId, alarm } (health/debug)
 */

import { runTask } from './service';
import type { RunOutcome, SchedulerEnv, SchedulerOps } from './types';

const TASK_ID_PREFIX = 'task:';

function json(body: unknown, status = 200): Response {
	return Response.json(body, { status });
}

export class SchedulerDO {
	private readonly taskIdFromName: string | null;

	constructor(
		private readonly ctx: DurableObjectState,
		private readonly env: SchedulerEnv,
	) {
		const name = this.ctx.id.name;
		this.taskIdFromName = name && name.startsWith(TASK_ID_PREFIX) ? name.slice(TASK_ID_PREFIX.length) : null;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		try {
			switch (url.pathname) {
				case '/arm': {
					const { id, runAt } = (await request.json()) as { id?: string; runAt?: number };
					if (typeof runAt !== 'number' || !Number.isFinite(runAt)) {
						return json({ ok: false, error: 'runAt (epoch ms) is required' }, 400);
					}
					if (id?.trim()) await this.ctx.storage.put('taskId', id.trim());
					this.ctx.storage.setAlarm(runAt);
					await this.flush();
					return json({ ok: true, alarm: runAt });
				}
				case '/cancel': {
					this.ctx.storage.deleteAlarm();
					await this.flush();
					return json({ ok: true });
				}
				case '/run': {
					const { id } = (await request.json()) as { id?: string };
					const taskId = id?.trim() || (await this.taskId()) || '';
					if (!taskId) return json({ ok: false, error: 'task id is required' }, 400);
					const outcome: RunOutcome = await runTask(this.env, taskId, 'manual', this.ops);
					return json(outcome);
				}
				case '/ping': {
					const alarm = await this.ctx.storage.getAlarm();
					return json({ ok: true, taskId: await this.taskId(), alarm });
				}
				default:
					return json({ ok: false, error: `unknown path ${url.pathname}` }, 404);
			}
		} catch (err) {
			return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
		}
	}

	/**
	 * Fired when the alarm time is reached. At-least-once: the runtime retries
	 * on uncaught exceptions, but retries are capped — runTask itself catches
	 * handler failures and re-arms, so an exhausted alarm budget never loses a
	 * task (the watchdog also re-arms on cron ticks).
	 */
	async alarm(): Promise<void> {
		const taskId = await this.taskId();
		if (!taskId) return;
		try {
			await runTask(this.env, taskId, 'alarm', this.ops);
		} catch (err) {
			console.error(`[scheduler-do] alarm failed for ${taskId}:`, err instanceof Error ? err.message : err);
		}
	}

	/** Resolve the task id: from storage (set at arm time) or the DO name. */
	private async taskId(): Promise<string | null> {
		if (this.taskIdFromName) return this.taskIdFromName;
		const stored = await this.ctx.storage.get<string>('taskId');
		return stored ?? null;
	}

	/** Local storage ops — re-arming from inside the DO never self-calls the stub. */
	private readonly ops: SchedulerOps = {
		arm: async (runAtMs) => {
			this.ctx.storage.setAlarm(runAtMs);
			await this.flush();
		},
		disarm: async () => {
			this.ctx.storage.deleteAlarm();
			await this.flush();
		},
	};

	/**
	 * setAlarm/deleteAlarm are fire-and-forget (void). Awaiting a subsequent
	 * ordered read guarantees the alarm write has been applied before the
	 * handler returns — avoids races where the next caller (or the test runner
	 * popping storage) observes a half-written alarm.
	 */
	private async flush(): Promise<void> {
		await this.ctx.storage.getAlarm();
	}
}
