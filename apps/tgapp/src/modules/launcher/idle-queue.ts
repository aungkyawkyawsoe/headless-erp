/**
 * A gentle, SEQUENTIAL background queue for speculative work.
 *
 * Warming route chunks ahead of a tap is the difference between an instant app
 * open and a multi-second wait, but firing twenty `import()`s at once on a slow
 * connection competes with the reads the current screen actually needs. This
 * queue instead runs ONE task per idle frame and only schedules the next after
 * the previous settles, so speculative prefetches always yield to user-triggered
 * traffic. Failures are swallowed (a prefetch is a hint, never a requirement).
 */
export type IdleSchedule = (fn: () => void) => void;

const defaultSchedule: IdleSchedule = (fn) => {
	if (typeof requestIdleCallback === 'function') {
		requestIdleCallback(fn, { timeout: 2000 });
		return;
	}
	setTimeout(fn, 250);
};

export interface IdleQueueOptions {
	/** The (async) work for one id. Rejections are swallowed and never stall. */
	run: (id: string) => Promise<unknown>;
	/** How to wait for a free moment; injectable for tests. */
	schedule?: IdleSchedule;
}

export interface IdleQueue {
	/** Enqueue ids, ignoring duplicates already waiting. Starts draining if idle. */
	push(ids: readonly string[]): void;
	/** Drop everything still waiting and stop scheduling more (a pending `run`
	 *  finishes, but never schedules a successor). `push` restarts it. */
	clear(): void;
	/** Ids still waiting (running ids are no longer queued). */
	size(): number;
}

export function createIdleQueue({ run, schedule = defaultSchedule }: IdleQueueOptions): IdleQueue {
	const queue: string[] = [];
	const queued = new Set<string>();
	let draining = false;
	// Bumped by `clear()`: a `run` in flight when the queue is cleared must not
	// schedule its successor (see `IdleQueue.clear`).
	let epoch = 0;

	const pump = () => {
		const id = queue.shift();
		if (id === undefined) {
			draining = false;
			return;
		}
		queued.delete(id);
		const mine = epoch;
		// `Promise.resolve().then` also turns a synchronous throw into a rejection.
		void Promise.resolve()
			.then(() => run(id))
			.catch(() => {})
			.then(() => {
				if (mine === epoch) schedule(pump);
			});
	};

	return {
		push(ids) {
			for (const id of ids) {
				if (queued.has(id)) continue;
				queued.add(id);
				queue.push(id);
			}
			if (!draining && queue.length > 0) {
				draining = true;
				schedule(pump);
			}
		},
		clear() {
			epoch++;
			queue.length = 0;
			queued.clear();
			draining = false;
		},
		size() {
			return queue.length;
		},
	};
}
