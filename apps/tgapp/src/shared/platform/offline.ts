/**
 * Offline write queue facade — the app's read/write view over the SDK's replay
 * queue (`offlineQueue` in `shared/api/sdk.ts`).
 *
 * The SDK already does the hard part: a write that fails at the NETWORK level is
 * stashed (client UUID + stable Idempotency-Key) and replay is duplicate-safe
 * (2xx and a 409-on-already-landed both count as success; a 409 carrying
 * `If-Match` is a real concurrency rejection and is dropped; permanent 4xx are
 * dropped; 5xx/network stay queued). This module adds what the UI needs:
 *
 *   • a stable `pendingCount()` the banner can render (recomputed only when the
 *     queue actually changes, so `useSyncExternalStore` never parses storage on
 *     every render);
 *   • `flushOffline()` with a single in-flight guard, so concurrent triggers
 *     (boot + `online` + tab focus + Telegram `activated`) can never replay the
 *     same queue twice at once.
 *
 * Invalidation after a successful replay is deliberately NOT here — the caller
 * (`useOfflineSync`) owns the QueryClient. Keeping this module free of the React
 * tree lets it be tested in isolation.
 */
import { offlineQueue } from '@/shared/api/sdk';

type Listener = () => void;

let queueCount = offlineQueue.pending().length;
const listeners = new Set<Listener>();

// Recompute the cached count on every queue change (enqueue / replay / clear).
// `subscribe` at module scope keeps the count warm before any hook mounts, so
// the first banner render never shows a stale number.
offlineQueue.subscribe(() => {
	const next = offlineQueue.pending().length;
	if (next === queueCount) return;
	queueCount = next;
	for (const listener of listeners) listener();
});

/** Pending count — cheap to call from render (cached, see above). */
export function pendingCount(): number {
	return queueCount;
}

/** Subscribe to pending-count changes (for `useSyncExternalStore`). */
export function subscribeQueue(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

let inflight: Promise<number> | null = null;

/**
 * Replay every queued write, oldest first. Resolves with the replayed count.
 * Concurrent callers share ONE run (the triggers fire in bursts; the queue must
 * not be walked twice).
 */
export function flushOffline(): Promise<number> {
	if (!inflight) {
		inflight = offlineQueue.flush().finally(() => {
			inflight = null;
		});
	}
	return inflight;
}

/** Drop every queued write (e.g. on logout — pending writes can never replay as
 *  the next account; the SDK also refuses cross-account replay on its own). */
export function discardOffline(): void {
	offlineQueue.clear();
}
