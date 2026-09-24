import {
	ConditionalResponseCache,
	createClient,
	createOfflineQueue,
	localStorageQueueStorage,
	localStorageResponseStorage,
} from '@mmbix/sdk';
import { invalidateCollection } from '@mmbix/sdk-react';
import { clearPersistedMasters } from '@/shared/api/persisted-masters';
import { clearToken, getToken, setToken, telegramLogin } from '@/shared/auth';
import { invalidateDomainsReading } from '@/shared/api/invalidation';
import { queryClient } from '@/shared/api/query-client';
import { setOnline } from '@/shared/platform/connectivity';
import type { Schema } from '@/generated/schema';

/**
 * The app-wide SDK client — the SINGLE gateway for every data operation in the
 * mini-app (entity CRUD, auth, list reads, server actions, media uploads).
 *
 * One transport, one pipeline for the whole app:
 *   • auth      — token storage bridges `shared/auth` so EVERY path shares the
 *                 same session; expired tokens are skipped up front; a 401
 *                 self-heals via the Telegram refresh (deduped).
 *   • errors    — every failed request funnels into console (swap for a toast
 *                 channel when a UI exists).
 *   • offline   — a network-failed WRITE is stashed in `offlineQueue` and
 *                 replayed by `flushOffline()` (shared/platform/offline.ts); an
 *                 `Idempotency-Key` rides every write, so a replay can never
 *                 duplicate a server-side change.
 *   • state     — `onSettled` feeds the app-wide connectivity signal the offline
 *                 banner reads (shared/platform/connectivity.ts).
 *   • reads     — conditional GETs (ETag/304) serve unchanged reads from memory,
 *                 and collections the SERVER marks offline-readable persist to
 *                 the device, so a dropped connection still shows data.
 */

/**
 * Read cache — the ETag/304 body store, plus offline persistence.
 *
 * Persistence is NOT an app-side allowlist: a body reaches the device only when
 * the server blessed that response with `X-Offline-Max-Age` (the collection's
 * `schema_json.policies.offline_reads`, a Studio toggle). Device copies are scoped
 * to the signed-in account by the cache's auth fingerprint and purged when the
 * token is cleared, so a shared phone never serves one user's rows to the next.
 */
export const readCache = new ConditionalResponseCache(200, localStorageResponseStorage('mmbix-sdk-read-cache'));

const authTokenStorage = {
	get: () => getToken(),
	set: (token: string) => setToken(token),
	clear: () => {
		clearToken();
		// A device copy must not outlive the session allowed to see it.
		readCache.clear();
		clearPersistedMasters();
	},
};

/**
 * The app-wide offline write queue. localStorage-backed (survives a WebView
 * reload) and scoped to the signed-in account by the queue's own token
 * fingerprint, so a device shared between two Telegram accounts never replays
 * one user's pending writes under the other.
 */
export const offlineQueue = createOfflineQueue({
	storage: localStorageQueueStorage('mmbix-sdk-offline-queue'),
	baseUrl: '/api',
	getToken,
	onFailed: (item, err) => {
		// Permanent drops (a concurrency-rejected If-Match write, or a non-409 4xx)
		// and 5xx retries both land here — the banner is the user-facing channel;
		// console keeps the detail for support.
		console.warn(`[tgapp offline] replay failed (${item.method} ${item.path})`, err);
	},
});

export const sdk = createClient<Schema>({
	baseUrl: '/api',
	tokenStorage: authTokenStorage,
	refreshSession: async () => {
		const result = await telegramLogin();
		return result.status === 'approved' ? result.token : null;
	},
	offlineQueue,
	// Conditional GETs + offline reads (see `readCache` above).
	conditionalGet: readCache,
	// Bound every request so a HUNG connection (a mobile network that never answers)
	// surfaces in seconds instead of spinning until the browser's own ~5-minute
	// socket timeout. On abort the SDK reports unreachable (`onSettled` → the
	// offline banner), serves a persisted read when the server blessed one, and
	// QUEUES a write (idempotency-keyed, so a replay can never duplicate it) — i.e.
	// the app degrades exactly as it does for any other network failure. Generous on
	// purpose: a genuinely slow 2G read must still be allowed to finish.
	timeoutMs: 30_000,
	// Fired on any HTTP/envelope failure — funnel into the app's error UI.
	onError: (_path, _method, status, message) => {
		console.error(`[tgapp api] ${status}: ${message}`);
	},
	// Every request outcome proves (or disproves) API reachability — the app-wide
	// signal the offline banner and replay scheduler read.
	onSettled: (_path, _method, ok) => setOnline(ok),
	// The server names every collection a write touched (primary row + cascade
	// parents + hook/denorm writes). Invalidate exactly those, plus the custom
	// read domains built from them — no module has to remember which domains its
	// writes affect.
	onChange: (change) => {
		for (const collection of change.collections) {
			void invalidateCollection(queryClient, collection);
			void invalidateDomainsReading(queryClient, collection);
		}
	},
});
