/**
 * One-app-at-a-time launcher guard.
 *
 * React Router 7 commits a navigation inside `React.startTransition`, so while a
 * tapped app's lazy chunk is still loading the launcher stays MOUNTED and
 * INTERACTIVE — deliberately, so the home screen keeps painting instead of
 * blanking to a spinner. But that also leaves a window (as long as the chunk
 * fetch) during which a SECOND tile tap is accepted, and because the last
 * transition wins, the user lands on the app they tapped second — the "I can
 * still press another app icon" bug. On a slow connection the window is
 * seconds long.
 *
 * The fix is an explicit, SYNCHRONOUS lock taken in the click handler, before
 * React has a chance to re-render: `begin()` returns false for every tap while
 * an open is in flight, so only the first one navigates. The lock lives for the
 * life of the launcher instance — the instance is discarded when the
 * destination commits, and a fresh one (with a fresh lock) mounts if the user
 * comes back.
 */
export interface OpenGuard {
	/**
	 * Claim the open slot for `appId`. Returns false when an open is already
	 * pending (the caller must then ignore the tap entirely).
	 */
	begin(appId: string): boolean;
	/** Release the slot (only needed for the safety timeout / a failed open). */
	release(): void;
	/** The app id currently being opened, or null when idle. */
	pending(): string | null;
}

/** A fresh, independent guard — one per launcher mount. */
export function createOpenGuard(): OpenGuard {
	let pending: string | null = null;
	return {
		begin(appId) {
			if (pending !== null) return false;
			pending = appId;
			return true;
		},
		release() {
			pending = null;
		},
		pending() {
			return pending;
		},
	};
}
