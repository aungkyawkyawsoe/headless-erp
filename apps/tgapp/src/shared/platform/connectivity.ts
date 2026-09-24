/**
 * App-wide API-reachability signal — the ONE source the offline banner and the
 * replay scheduler read.
 *
 * Fed from two sides:
 *   • the SDK client's `onSettled` hook — `ok` is true whenever the API answered
 *     at all (even a 4xx/5xx proves the server is reachable), false only on a
 *     network-level failure. This is the authoritative signal;
 *   • the browser's `online`/`offline` events — a fast path that flips the flag
 *     the moment the OS reports the link dropping (before a request fails).
 *
 * Framework-free on purpose: the (non-React) SDK gateway writes to it, React
 * reads it through `useOnline()`.
 */

type Listener = () => void;

let online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
const listeners = new Set<Listener>();

/** True while the API is believed reachable. */
export function isOnline(): boolean {
	return online;
}

/** Record a reachability result (idempotent — no-op when unchanged). */
export function setOnline(next: boolean): void {
	if (online === next) return;
	online = next;
	for (const listener of listeners) listener();
}

/** Subscribe to reachability changes (for `useSyncExternalStore`). */
export function subscribeConnectivity(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
