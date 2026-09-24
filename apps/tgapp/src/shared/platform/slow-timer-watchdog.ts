/**
 * DEV-ONLY attribution for Chrome's unattributable timer advisory. Blink reports a
 * timer task that overruns its long-task budget as a bare
 * `[Violation] 'setTimeout' handler took Nms` — the message carries NO call site, so
 * it cannot be traced from the console at all. This wraps the page's timers before the
 * first render (armed from `main.tsx`) and prints the route plus the stack that
 * SCHEDULED the handler, so the next report names a file instead of a duration. It
 * REPORTS only — it never swallows a thrown handler.
 *
 * `import.meta.env.DEV` is `false` in a production build, so the wrapper (and its
 * per-timer overhead) is dropped from the shipped bundle.
 */

/** Blink warns past its ~50 ms long-task budget; sit just under it to see the near-misses too. */
const THRESHOLD_MS = 40;

/** A DOM timer handler — a function (timed) or a source string (passed straight through). */
export type TimerHandler = string | ((...args: unknown[]) => unknown);

export interface TimerHost {
	setTimeout: (handler: TimerHandler, timeout?: number, ...args: unknown[]) => unknown;
	setInterval: (handler: TimerHandler, timeout?: number, ...args: unknown[]) => unknown;
}

export interface SlowTimerInfo {
	kind: 'setTimeout' | 'setInterval';
	/** How long the handler held the main thread, in ms. */
	ms: number;
	/** The stack that SCHEDULED the handler — the call site to go and fix. */
	scheduledFrom: string;
}

/** Replace `host`'s two timer functions with timing wrappers reporting every handler
 *  whose synchronous run reaches `thresholdMs`. Exported for its own spec — the app
 *  arms it through `armSlowTimerWatchdog` below. */
export function wrapTimers(host: TimerHost, onSlow: (info: SlowTimerInfo) => void, thresholdMs = THRESHOLD_MS): void {
	const wrap =
		(kind: SlowTimerInfo['kind'], original: TimerHost['setTimeout']) =>
		(handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
			if (typeof handler !== 'function') return original(handler, timeout, ...args);
			const scheduledFrom = new Error(`scheduled ${kind}`).stack ?? '';
			return original(
				(...called: unknown[]) => {
					const startedAt = performance.now();
					try {
						return handler(...called);
					} finally {
						const ms = performance.now() - startedAt;
						if (ms >= thresholdMs) onSlow({ kind, ms, scheduledFrom });
					}
				},
				timeout,
				...args,
			);
		};

	host.setTimeout = wrap('setTimeout', host.setTimeout);
	host.setInterval = wrap('setInterval', host.setInterval);
}

/** Arm the wrapper on the live `window`, once per document (idempotent, so a double
 *  call cannot double-wrap). Called by `main.tsx` behind its `import.meta.env.DEV`
 *  guard — before the first render, so every timer the app schedules is covered. */
export function armSlowTimerWatchdog(): void {
	if (typeof window === 'undefined') return;
	const host = window as unknown as TimerHost & { __slowTimerArmed?: boolean };
	if (host.__slowTimerArmed) return;
	host.__slowTimerArmed = true;
	wrapTimers(host, ({ kind, ms, scheduledFrom }) => {
		console.warn(`[slow ${kind}] ${ms.toFixed(1)} ms on ${location.pathname}${location.search}\nScheduled from:\n${scheduledFrom}`);
	});
}
