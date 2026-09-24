/**
 * Request-scoped background-task registration.
 *
 * An async call that is neither awaited nor passed to `ctx.waitUntil()` can be
 * CANCELED when the invocation ends — the Workers runtime has no reason to keep
 * the isolate alive once the response is sent, so the promise is dropped
 * SILENTLY (no error, no log). Every other background task in this worker
 * (webhooks, audit, error reporting) already goes through `waitUntil`; the index
 * advisor's opportunistic tune run did not, so an index it "created" could be
 * rolled back mid-flight — and because the tuner sets its rate-limit stamp
 * BEFORE doing the work, the following 60s of requests would then skip the
 * retry. A self-tuning engine that silently never tunes is the worst outcome.
 *
 * This mirrors `change-scope.ts` / `d1-session.ts`: the host wires the request's
 * `waitUntil` into an AsyncLocalStorage scope once, and engine code deep in the
 * call stack registers work without every caller threading `c` down.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

type WaitUntil = (p: Promise<unknown>) => void;

const storage = new AsyncLocalStorage<WaitUntil>();

/** Run `fn` with `waitUntil` bound as the current request's background sink. */
export function runWithRequestTasks<T>(waitUntil: WaitUntil, fn: () => T): T {
	return storage.run(waitUntil, fn);
}

/**
 * Keep `promise` alive after the response is sent. Inside a request scope it is
 * handed to `ctx.waitUntil`; outside one (tests, CLI, scheduled handlers) it is
 * left to run, with its rejection swallowed so a background failure never
 * surfaces as an unhandled rejection.
 */
export function backgroundTask(promise: Promise<unknown>): void {
	const waitUntil = storage.getStore();
	if (waitUntil) {
		waitUntil(promise);
		return;
	}
	void promise.catch(() => {});
}
