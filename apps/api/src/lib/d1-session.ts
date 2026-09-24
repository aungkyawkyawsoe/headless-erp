/**
 * Per-request D1 SESSION scope — the API worker's half of the read-replication
 * seam (see `@mmbix/core` `d1-executor.ts`).
 *
 * D1 read replication serves a read from the replica nearest the user ONLY when
 * the query is issued through the Sessions API (`db.withSession(bookmark)`).
 * This module opens ONE session per request and registers it as the executor
 * for every `D1Client` in that request, so no call site has to thread it.
 *
 * Bookmark choice — `first-primary`:
 *   - the FIRST query of the session is served by the PRIMARY, so a read can
 *     never miss a write committed before this request (read-your-writes across
 *     requests), which is exactly the guarantee the authz-freshness contract
 *     depends on;
 *   - every LATER query in the same session may be served by a nearby replica
 *     that has caught up to the session's bookmark — sequential consistency, and
 *     the latency win when a request issues more than one query (authz + data +
 *     relations).
 *
 * `withSession` is absent on non-D1 environments and older runtimes — the caller
 * guards on its presence, so local dev and tests keep the plain binding.
 *
 * NOTE: read replication must also be ENABLED on the database (dashboard or
 * `read_replication.mode: auto` via the REST API) for a session to reach a
 * replica; the Sessions API is safe to run either way.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { setD1ExecutorResolver } from '@mmbix/core';
import type { D1Database } from '@cloudflare/workers-types';

const storage = new AsyncLocalStorage<D1Database>();

// Registered once at module load — D1Client consults this for every query.
setD1ExecutorResolver(() => storage.getStore());

/** Run `fn` with `session` as the D1 executor for every D1Client it constructs. */
export function runWithD1Session<T>(session: D1Database, fn: () => T): T {
	return storage.run(session, fn);
}

/** The session bound to the current request, when one was opened. */
export function currentD1Session(): D1Database | undefined {
	return storage.getStore();
}

/**
 * Open a read-replication session from a D1 binding, or return undefined when
 * the runtime exposes no `withSession`. `first-primary` (see the module doc).
 */
export function openD1Session(db: D1Database): D1Database | undefined {
	const withSession = (db as unknown as { withSession?: (bookmark?: string) => D1Database }).withSession;
	if (typeof withSession !== 'function') return undefined;
	try {
		return withSession.call(db, 'first-primary');
	} catch {
		// A session must never break a request — fall back to the plain binding.
		return undefined;
	}
}
