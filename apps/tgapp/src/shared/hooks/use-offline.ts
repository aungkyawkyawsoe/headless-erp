import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { invalidateCollection } from '@mmbix/sdk-react';

import { queryClient } from '@/shared/api/query-client';
import { invalidateDomainsReading } from '@/shared/api/invalidation';
import { offlineQueue } from '@/shared/api/sdk';
import { isOnline, setOnline, subscribeConnectivity } from '@/shared/platform/connectivity';
import { flushOffline, pendingCount, subscribeQueue } from '@/shared/platform/offline';
import { useLiveWebApp } from '@/shared/platform/use-live-web-app';

/**
 * Fire a toast WITHOUT a static import of the DS toast module.
 *
 * `use-offline` sits on the ENTRY path (mounted by `App`), so importing
 * `@mmbix/design-system/toast` here pulled base-ui's toast manager +
 * FloatingPortal into the boot chunk and defeated `App`'s lazy `Toaster`. Offline
 * sync only ever runs after boot, so the dynamic import costs nothing critical.
 */
async function notify(notification: { type: 'success' | 'warning'; title: string; description?: string }): Promise<void> {
	const { toast } = await import('@mmbix/design-system/toast');
	toast.add(notification);
}

/** Live API-reachability (drives the offline banner). */
export function useOnline(): boolean {
	return useSyncExternalStore(subscribeConnectivity, isOnline, () => true);
}

/** Number of writes waiting to replay (drives the sync badge). */
export function usePendingCount(): number {
	return useSyncExternalStore(subscribeQueue, pendingCount, () => 0);
}

/**
 * Replay queued writes (if the API is reachable) and, when anything landed,
 * invalidate the read cache so the change shows on every mounted view.
 *
 * This is the second half of the offline pipeline that the SDK's queue cannot do
 * on its own: replay bypasses the SDK transport, so its `onWrite` hook never
 * fires for a replayed mutation. Returns the number of writes replayed.
 */
/**
 * The collections the pending writes touch, read from each `/entities/<slug>`
 * path. Returns `null` when ANY queued write is not a plain entity write (a
 * domain route like `/hr/attendances/punch`), because then we cannot name the
 * collections it moved and must fall back to a full invalidation.
 */
function queuedCollections(): Set<string> | null {
	const collections = new Set<string>();
	for (const item of offlineQueue.pending()) {
		const match = /^\/entities\/([^/?]+)/.exec(item.path);
		if (!match) return null;
		collections.add(decodeURIComponent(match[1]));
	}
	return collections;
}

export async function syncOfflineNow(): Promise<number> {
	if (!isOnline()) return 0;
	// Capture the touched collections BEFORE the flush (the queue empties on it),
	// so the post-replay refresh is scoped to exactly what changed.
	const collections = queuedCollections();
	const before = offlineQueue.pending().length;
	const replayed = await flushOffline();
	// A queued write can also be DROPPED during replay — the SDK drops permanent
	// 4xx (a validation/authorization rejection that will never succeed). That
	// used to be completely silent: the pending count simply fell and the user
	// read it as success. Anything neither replayed nor still queued was dropped,
	// so say so loudly — silent data loss is the worst possible outcome.
	const dropped = Math.max(0, before - replayed - offlineQueue.pending().length);
	if (dropped > 0) {
		void notify({
			type: 'warning',
			title: dropped === 1 ? '1 change could not be saved' : `${dropped} changes could not be saved`,
			description: 'The server rejected them — please re-enter and try again.',
		});
	}
	if (replayed <= 0) return 0;
	if (collections === null) {
		// An unmappable path — the safe, broad refresh.
		await queryClient.invalidateQueries();
	} else {
		// Invalidate ONLY the moved collections (+ the read-only feed domains that
		// derive from them). A queued punch used to refetch every active query on
		// the screen — including unrelated lists, catalogs and dashboards.
		await Promise.all(
			[...collections].flatMap((collection) => [
				invalidateCollection(queryClient, collection),
				invalidateDomainsReading(queryClient, collection),
			]),
		);
	}
	void notify({
		type: 'success',
		title: replayed === 1 ? 'Offline change synced' : `${replayed} offline changes synced`,
	});
	return replayed;
}

/**
 * Mount ONCE (in `App`). Auto-runs `syncOfflineNow` at the moments reachability
 * is likely restored: the browser `online` event, the tab becoming visible,
 * Telegram re-`activated`-ing the Mini App, and app boot. All funnel through the
 * in-flight-guarded `flushOffline()`, so a burst never double-replays.
 */
export function useOfflineSync(): void {
	// The Telegram bridge can land a tick after boot — this re-renders when it does,
	// so the `activated` listener is bound even on a slow SDK load.
	const wa = useLiveWebApp();
	const run = useCallback(() => {
		void syncOfflineNow();
	}, []);

	useEffect(() => {
		const onOnline = () => {
			setOnline(true);
			run();
		};
		const onOffline = () => setOnline(false);
		window.addEventListener('online', onOnline);
		window.addEventListener('offline', onOffline);

		// Returning to the app (tab focus / Telegram re-activation) is the other
		// moment connectivity is likely back. One handler for both — the visibility
		// check keeps a hidden→visible flip from firing while backgrounded.
		const onVisible = () => {
			if (document.visibilityState !== 'visible') return;
			run();
		};
		document.addEventListener('visibilitychange', onVisible);
		wa?.onEvent('activated', onVisible);

		// Best-effort boot attempt — the banner covers the case where this fails.
		run();

		return () => {
			window.removeEventListener('online', onOnline);
			window.removeEventListener('offline', onOffline);
			document.removeEventListener('visibilitychange', onVisible);
			wa?.offEvent('activated', onVisible);
		};
	}, [run, wa]);
}
