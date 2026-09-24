import { afterEach, describe, expect, it, vi } from 'vitest';

import { wrapTimers, type SlowTimerInfo, type TimerHandler, type TimerHost } from './slow-timer-watchdog';

/** A fake timer host that RUNS the handler inline (with the timer's own extra args, as
 *  a real `setTimeout` does) — so a spec decides how long it looks like it took, with no
 *  real waiting and without patching any global. */
function fakeHost() {
	const calls: Array<{ handler: TimerHandler; timeout?: number; args: unknown[] }> = [];
	const fire = (handler: TimerHandler, timeout: number | undefined, args: unknown[]) => {
		calls.push({ handler, timeout, args });
		return typeof handler === 'function' ? handler(...args) : handler;
	};
	const host: TimerHost = {
		setTimeout: (handler, timeout, ...args) => fire(handler, timeout, args),
		setInterval: (handler, timeout, ...args) => fire(handler, timeout, args),
	};
	return { host, calls };
}

/** Pretend the handler's own `performance.now()` readings advance by `ms` — a
 *  deterministic, instant "it held the main thread this long". */
function freezeElapsed(ms: number) {
	let first = true;
	vi.spyOn(performance, 'now').mockImplementation(() => {
		if (first) {
			first = false;
			return 0;
		}
		return ms;
	});
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('wrapTimers', () => {
	it('reports a handler at or past the threshold, naming where it was scheduled', () => {
		const seen: SlowTimerInfo[] = [];
		const { host } = fakeHost();
		wrapTimers(host, (info) => seen.push(info), 40);
		freezeElapsed(62);

		host.setTimeout(() => 'done', 10);

		expect(seen).toHaveLength(1);
		expect(seen[0]?.kind).toBe('setTimeout');
		expect(seen[0]?.ms).toBe(62);
		// The stack is captured when the timer is SCHEDULED — that IS the call site.
		expect(seen[0]?.scheduledFrom).toContain('scheduled setTimeout');
	});

	it('stays quiet under the threshold — and watches intervals too', () => {
		const seen: SlowTimerInfo[] = [];
		const { host } = fakeHost();
		wrapTimers(host, (info) => seen.push(info), 40);
		freezeElapsed(39);

		host.setTimeout(() => undefined, 10);
		host.setInterval(() => undefined, 10);

		expect(seen).toHaveLength(0);
	});

	it('passes the handler’s args + return value through, and lets a throw propagate', () => {
		const { host, calls } = fakeHost();
		wrapTimers(host, () => undefined, 40);
		freezeElapsed(1);

		const joined = host.setTimeout(((a: string, b: string) => `${a}${b}`) as TimerHandler, 5, 'a', 'b');
		expect(joined).toBe('ab');
		expect(calls[0]?.args).toEqual(['a', 'b']);
		expect(calls[0]?.timeout).toBe(5);

		expect(() =>
			host.setTimeout(
				(() => {
					throw new Error('boom');
				}) as TimerHandler,
				5,
			),
		).toThrow('boom');
	});

	it('never times a string handler — `setTimeout("…")` is passed through untouched', () => {
		const seen: SlowTimerInfo[] = [];
		const { host, calls } = fakeHost();
		wrapTimers(host, (info) => seen.push(info), 40);
		freezeElapsed(500);

		host.setTimeout('window.x = 1', 10);

		expect(calls).toHaveLength(1);
		expect(seen).toHaveLength(0);
	});
});
