/**
 * Per-isolate DB-liveness proof.
 *
 * Both migration runners used to probe `sqlite_master` on EVERY request to
 * detect a wiped database (tests reset D1 per test while the isolate persists):
 * the plugin runner probes `_migrations`, the core runner probes
 * `_entity_schemas`. That was two D1 round trips of pure overhead on 100% of
 * traffic, for a fact that cannot change within one request.
 *
 * Now there is ONE detector — whichever runner probes first (in practice the
 * plugin middleware, which runs before every route) — and it records the result
 * here. The other runner consults `dbVerifiedWithin()` instead of probing again.
 * Correctness is preserved because a FAILED probe calls `invalidateDbLiveness()`,
 * which clears the core guard too, so BOTH runners re-migrate on the fresh DB.
 */
/** Default window: enough to dedupe the probe WITHIN one request (the plugin and
 *  core runners both probe milliseconds apart), which is all a production DB
 *  needs — nothing resets it. */
const DEFAULT_PROBE_DEDUPE_MS = 200;

/**
 * Environment-tunable window. A TEST database is reset between tests while the
 * isolate persists, so the suite needs the short (200ms) window to re-detect the
 * wipe. Production never resets, so the API widens it (see `apps/api/src/index.ts`)
 * — otherwise the `sqlite_master` probe is one wasted D1 round trip on nearly
 * every request, since sparse user traffic is usually >200ms apart.
 */
let probeDedupeMs = DEFAULT_PROBE_DEDUPE_MS;

/** Configure the dedupe window (idempotent; one value per isolate). */
export function configureDbLiveness(dedupeMs: number): void {
	if (Number.isFinite(dedupeMs) && dedupeMs >= 0) probeDedupeMs = dedupeMs;
}

/** The core `MigrationRunner`'s per-isolate guard key (see migrations.ts). */
const CORE_GUARD = '__MIGRATIONS_INIT__';

let verifiedAt = 0;

/** Record that the database was just observed alive (tables present). */
export function markDbVerified(): void {
	verifiedAt = Date.now();
}

/** True when a liveness proof was recorded within the dedupe window — the caller
 *  may skip its own `sqlite_master` probe for this request. */
export function dbVerifiedWithin(ms: number = probeDedupeMs): boolean {
	return Date.now() - verifiedAt < ms;
}

/**
 * The database was found WIPED. Clears the liveness proof AND the core migration
 * guard, so the core runner re-runs its full migration path on the next request
 * even though it never probed for itself.
 */
export function invalidateDbLiveness(): void {
	verifiedAt = 0;
	(globalThis as Record<string, unknown>)[CORE_GUARD] = false;
}
