import { describe, expect, it } from 'vitest';

import { createIdleQueue } from './idle-queue';

/** A manual scheduler: collects the callbacks so a test drives the idle frames. */
function manualSchedule() {
	const callbacks: Array<() => void> = [];
	return {
		schedule: (fn: () => void) => {
			callbacks.push(fn);
		},
		flush() {
			const fn = callbacks.shift();
			fn?.();
		},
		pending: () => callbacks.length,
	};
}

/** Let the queue's promise chain (run → settle → schedule) settle. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createIdleQueue', () => {
	it('starts nothing until the scheduler ticks', () => {
		const order: string[] = [];
		const s = manualSchedule();
		const q = createIdleQueue({ run: async (id) => void order.push(id), schedule: s.schedule });

		q.push(['a', 'b']);
		expect(order).toEqual([]);
		expect(s.pending()).toBe(1);
	});

	it('runs ONE task per idle frame, in order', async () => {
		const order: string[] = [];
		const releases: Array<() => void> = [];
		const s = manualSchedule();
		const q = createIdleQueue({
			run: (id) => {
				order.push(id);
				return new Promise<void>((resolve) => releases.push(resolve));
			},
			schedule: s.schedule,
		});

		q.push(['a', 'b']);
		s.flush();
		await tick();
		expect(order).toEqual(['a']);
		// 'b' must NOT be scheduled while 'a' is still running — that is the whole
		// point on a slow connection.
		expect(s.pending()).toBe(0);

		releases.shift()?.();
		await tick();
		expect(order).toEqual(['a']);
		expect(s.pending()).toBe(1);

		s.flush();
		await tick();
		expect(order).toEqual(['a', 'b']);

		releases.shift()?.();
		await tick();
	});

	it('ignores duplicate ids that are still queued', () => {
		const s = manualSchedule();
		const q = createIdleQueue({ run: async () => {}, schedule: s.schedule });
		q.push(['a']);
		q.push(['a', 'b']);
		expect(q.size()).toBe(2);
	});

	it('keeps going after a failing task', async () => {
		const order: string[] = [];
		const s = manualSchedule();
		const q = createIdleQueue({
			run: async (id) => {
				order.push(id);
				if (id === 'bad') throw new Error('boom');
			},
			schedule: s.schedule,
		});

		q.push(['bad', 'good']);
		s.flush();
		await tick();
		expect(order).toEqual(['bad']);
		// The rejection was swallowed, so the next task is already scheduled.
		expect(s.pending()).toBe(1);

		s.flush();
		await tick();
		expect(order).toEqual(['bad', 'good']);
		await tick();
	});

	it('drains fully, then accepts a fresh push', async () => {
		const order: string[] = [];
		const s = manualSchedule();
		const q = createIdleQueue({ run: async (id) => void order.push(id), schedule: s.schedule });

		q.push(['a']);
		s.flush();
		await tick();
		expect(order).toEqual(['a']);

		s.flush(); // the queue is empty → draining resets
		expect(s.pending()).toBe(0);

		q.push(['b']);
		expect(s.pending()).toBe(1);
		s.flush();
		await tick();
		expect(order).toEqual(['a', 'b']);
	});

	it('clear() drops waiting ids and a later push restarts it', async () => {
		const order: string[] = [];
		const s = manualSchedule();
		const q = createIdleQueue({ run: async (id) => void order.push(id), schedule: s.schedule });

		q.push(['a', 'b']);
		s.flush();
		await tick();
		expect(order).toEqual(['a']);
		expect(s.pending()).toBe(1); // 'b' is scheduled

		q.clear();
		expect(q.size()).toBe(0);
		s.flush(); // the already-scheduled pump finds nothing to do
		await tick();
		expect(order).toEqual(['a']);

		q.push(['c']);
		expect(s.pending()).toBe(1);
		s.flush();
		await tick();
		expect(order).toEqual(['a', 'c']);
	});

	it('clear() stops a run in flight from scheduling its successor', async () => {
		const order: string[] = [];
		const releases: Array<() => void> = [];
		const s = manualSchedule();
		const q = createIdleQueue({
			run: (id) => {
				order.push(id);
				return new Promise<void>((resolve) => releases.push(resolve));
			},
			schedule: s.schedule,
		});

		q.push(['a', 'b']);
		s.flush();
		await tick();
		expect(order).toEqual(['a']);

		q.clear();
		releases.shift()?.();
		await tick();
		expect(order).toEqual(['a']);
		expect(s.pending()).toBe(0);
	});
});
