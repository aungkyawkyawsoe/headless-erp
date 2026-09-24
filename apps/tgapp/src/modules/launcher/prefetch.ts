/**
 * Launcher route-chunk prefetch.
 *
 * Every page is a lazy chunk (see `app/router.tsx`), so the FIRST tap on a tile
 * pays a network fetch for that chunk before the screen can render — the biggest
 * source of "tap … wait" on a slow connection. Warming the likely-next chunk
 * removes that stall:
 *
 *   - the pinned apps (attendance / approval / settings) are prefetched as soon
 *     as the launcher mounts — they are the most common destinations;
 *   - any tile is prefetched on `pointerdown`, so the chunk is already in flight
 *     (or cached) by the time the tap's `click` navigates;
 *   - the tiles currently ON SCREEN are warmed one at a time on idle
 *     (`prefetchAppsOnIdle`), so even a tap that races the `pointerdown` warm
 *     finds the chunk ready while never crowding out the current screen's own
 *     reads on a slow link.
 *
 * Failures are swallowed: a prefetch is a hint, never a requirement — the lazy
 * route still loads on navigation. Each loader runs at most once per session.
 *
 * KEEP IN SYNC WITH `app/router.tsx` — a tile whose id is missing here simply
 * never prefetches (harmless), but a stale path would silently do nothing.
 */
import { createIdleQueue } from './idle-queue';

const LOADERS: Record<string, () => Promise<unknown>> = {
	attendance: () => import('@/modules/attendance/pages/attendance-page'),
	approval: () => import('@/modules/attendance/pages/approval-page'),
	settings: () => import('@/modules/settings/settings-page'),
	hr: () => import('@/modules/employees/pages/employees-page'),
	vehicles: () => import('@/modules/fleets/pages/fleets-page'),
	'daily-odo': () => import('@/modules/odo/pages/odo-list-page'),
	fluid: () => import('@/modules/fluids/pages/fluids-list-page'),
	licenses: () => import('@/modules/licenses/pages/licenses-page'),
	insurance: () => import('@/modules/insurances/pages/insurances-page'),
	tyres: () => import('@/modules/tyres/pages/tyres-page'),
	'store-requests': () => import('@/modules/store-requests/pages/store-requests-page'),
	maintenance: () => import('@/modules/maintenances/pages/maintenances-page'),
	emergency: () => import('@/modules/incidents/pages/incident-page'),
	'item-categories': () => import('@/modules/mro-categories/pages/mro-categories-page'),
	reports: () => import('@/modules/stock/pages/stock-page'),
	outbounds: () => import('@/modules/goods-issues/pages/outbound-hub-page'),
	inbounds: () => import('@/modules/inbounds/pages/inbound-hub-page'),
	'stock-moves': () => import('@/modules/stock-moves/pages/stock-moves-page'),
	adjustments: () => import('@/modules/adjustments/pages/adjustments-page'),
	movements: () => import('@/modules/movements/pages/movement-groups-page'),
	projects: () => import('@/modules/projects/pages/projects-page'),
};

/** Chunks already requested this session (cleared again on failure, for retry). */
const started = new Set<string>();

/** Load one chunk, remembering it so the same import is never requested twice. */
function warmChunk(id: string): Promise<void> {
	const load = LOADERS[id];
	if (!load || started.has(id)) return Promise.resolve();
	started.add(id);
	return load().then(
		() => undefined,
		(error: unknown) => {
			// A failed prefetch must not poison the id — allow a later retry.
			started.delete(id);
			throw error;
		},
	);
}

// Speculative chunk warms, one idle frame at a time (see idle-queue.ts).
const idleWarm = createIdleQueue({ run: warmChunk });

/**
 * Warm the lazy chunk for launcher app `id` (idempotent, fire-and-forget).
 *
 * `opts.data` also warms the app's DATA (currently the attendance dashboard's
 * summary + tasks). That is reserved for an INTENT signal — a `pointerdown` on
 * the tile — because warming data on mount fired network reads for a screen the
 * user had not chosen, competing with `/auth/me` and the launcher chunk for a
 * slow link's bandwidth. The dynamic import keeps the dashboard's data layer out
 * of the launcher's own chunk.
 */
export function prefetchApp(id: string, opts: { data?: boolean } = {}): void {
	if (opts.data && id === 'attendance') {
		void import('@/modules/attendance/prefetch').then((m) => m.prefetchAttendanceDashboard()).catch(() => {});
	}
	void warmChunk(id).catch(() => {});
}

/**
 * Warm the chunks for the tiles currently on screen, sequentially, in the
 * background. Safe to call on every page/search change: ids already requested
 * are filtered out, and ids already queued are ignored by the queue.
 */
export function prefetchAppsOnIdle(ids: readonly string[]): void {
	idleWarm.push(ids.filter((id) => LOADERS[id] && !started.has(id)));
}

/**
 * Stop warming. The launcher calls this when it unmounts (the user opened an
 * app): an app's own screen must not compete with speculative chunk downloads
 * for a slow connection's bandwidth. Already-loaded chunks stay cached, and a
 * later `prefetchAppsOnIdle` restarts the queue.
 */
export function stopIdleWarm(): void {
	idleWarm.clear();
}
