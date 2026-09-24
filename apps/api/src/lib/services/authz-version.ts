/**
 * Authorization-data version stamp — the ONE cross-isolate freshness signal for
 * every cached authz decision.
 *
 * The `CacheLayer` is per-isolate and Workers reuse many isolates, so a TTL on a
 * `user:` / `role:` / `perm:` entry lets an admin write in ONE isolate keep
 * serving the OLD answer in every OTHER isolate for the whole TTL — the
 * "changed the role but the Mini App still shows the old access" report.
 *
 * Instead of a cross-isolate invalidation channel (which Workers do not have),
 * every authz cache key carries this stamp, and the stamp is derived from the
 * data itself: the newest `updated_at` across the three tables every authz
 * decision reads (`_users`, `_roles`, `_role_permissions`). Any write bumps its
 * row's `updated_at`, so the next read MISSES every isolate's cache and re-reads
 * fresh — with no write-path bookkeeping to keep in sync.
 *
 * The stamp itself is cached for a very short window (1s) purely to avoid an
 * extra D1 aggregate on a burst of requests in one isolate. Worst-case staleness
 * is therefore ~1s, not the 15–60s the per-entry TTLs allowed.
 *
 * `_users.last_login` is deliberately NOT versioning: `AuthService.login` writes
 * it on every sign-in, and letting that churn the stamp would evict every authz
 * cache on each login. The login path updates the column with raw SQL so it does
 * not touch `updated_at`.
 */

import { D1Client, cache } from '@mmbix/core';

const VERSION_CACHE_KEY = 'authz:version';
const VERSION_TTL_MS = 1_000;

/**
 * The current authz-data stamp. Reads `MAX(updated_at)` across the users, roles
 * and role-permission tables — three tiny tables, so the aggregate is cheap.
 */
export async function authzVersion(db: D1Client): Promise<string> {
	const cached = cache.get<string>(VERSION_CACHE_KEY);
	if (cached !== undefined) return cached;

	let version = '0';
	try {
		const row = await db.first<{ v: string | number | null }>({
			sql: `SELECT MAX(t) AS v FROM (
					SELECT MAX(updated_at) AS t FROM _users
					UNION ALL SELECT MAX(updated_at) FROM _roles
					UNION ALL SELECT MAX(updated_at) FROM _role_permissions
				)`,
			bindings: [],
		});
		version = String(row?.v ?? '0');
	} catch {
		// Pre-migration / partially provisioned DB — auth is broken anyway; cache
		// the fallback for the short window so a failing aggregate is not run per
		// request while the DB settles.
		version = '0';
	}

	cache.set(VERSION_CACHE_KEY, version, VERSION_TTL_MS);
	return version;
}

/**
 * Drop the cached stamp so the NEXT read in this isolate re-derives it
 * immediately after a write (other isolates catch up within the 1s window).
 * Called by every authz write path — no need to hunt down cached entries: their
 * keys embed the stamp, so they simply stop matching on the next lookup.
 */
export function invalidateAuthzVersion(): void {
	cache.delete(VERSION_CACHE_KEY);
}

/** Append the stamp to an authz cache key so a data change retires the entry. */
export function withAuthzVersion(key: string, version: string): string {
	return `${key}:v${version}`;
}
