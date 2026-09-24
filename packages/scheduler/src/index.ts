/**
 * @mmbix/scheduler — headless scheduler for Cloudflare Workers.
 *
 * Hybrid model: handlers are code (registerHandler), schedules are data (D1).
 * DO alarms give per-task precise timers; a cron watchdog self-heals lost
 * alarms. DOs run on demand — hibernated between runs, no sockets, no bill.
 *
 * Usage (worker):
 *   import { registerHandler, SchedulerService } from '@mmbix/scheduler';
 *   registerHandler('meeting.remind', async (payload, ctx) => { … });
 *   const svc = new SchedulerService(new D1Client(env.DB));
 *   await svc.schedule({ type: 'meeting.remind', runAt: …, payload: { … } }, env);
 */

export {
	SchedulerService,
	runTask,
	schedulerBackoffMs,
	SCHEDULER_DEFAULT_MAX_ATTEMPTS,
	SCHEDULER_BACKOFF_BASE_MS,
	SCHEDULER_BACKOFF_CAP_MS,
	SCHEDULER_TASK_PREFIX,
} from './service';
export { SchedulerDO } from './do';
export { registerBuiltinHandlers } from './builtins';
export type {
	HttpRequestPayload,
	RetryUntilPayload,
	EntityTransitionPayload,
	ExpirePayload,
	RollupPayload,
	RollupMeasure,
	RollupWhere,
	DeltaPayload,
	DeltaMeasure,
	DigestPayload,
	DigestChannel,
	EscalationPayload,
	EscalationLevel,
	LakeExportPayload,
} from './builtins';
export { registerHandler, getHandler, hasHandler, listHandlers, clearHandlers, schedulerRegistry, HandlerRegistry } from './registry';
export { parseCron, isValidCron, nextCronRun, nextCronRunInTz, isValidTimeZone } from './cron';
export type {
	ScheduledTask,
	ScheduleInput,
	TaskHandler,
	HandlerContext,
	RunOutcome,
	TaskStatus,
	SchedulerEnv,
	SchedulerOps,
} from './types';
