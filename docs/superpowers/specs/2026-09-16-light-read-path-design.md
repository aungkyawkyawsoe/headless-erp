# Light Read Path — global read-latency reduction across API + tgapp — design (2026-09-16)

Status: implemented 2026-09-16 (see "Implementation status" at the end — most of the
design was already present in the working tree or in committed code, so only two
items needed code). Not committed (project rule: never commit unless explicitly
asked).

## Problem

The tgapp (Telegram Mini App) waits ~5 seconds for a screen to render on mobile /
weak Wi-Fi. The cause is **not one slow query** — D1 queries themselves are cheap.
The cost is the **number of network round trips** stacked on every read, plus a
client-side waterfall that serializes them.

Measured / traced contributors, ranked:

1. **Per-request authz D1 overhead (4–6 queries) + an uncached identity read on 100% of traffic.**
   Every `/api/*` request runs one JWT verification (`apps/api/src/index.ts:269-286`) whose
   `AuthService.verifyToken` performs `authzVersion` + `_getCachedUser` + `_getCachedRole`
   - `_healActingEmployee → findLiveEmployeeById` (deliberately uncached,
     `apps/api/src/lib/services/auth.service.ts:329-338`). Then `businessGuard` →
     `PermissionEvaluator.checkBusiness` repeats `authzVersion` + a `_role_permissions`
     read (`apps/api/src/lib/services/permission-evaluator.ts:112-121`), and the row
     filter / field restrictions may repeat the same lookup
     (`apps/api/src/lib/services/data-filter.service.ts`).
2. **Boot `GET /auth/me` is heavy and partly duplicated.** The Telegram path does a
   directory read + role sync + `ensureProvisionedTelegramRole` **twice**
   (`apps/api/src/routes/auth.ts:228, 237-241`) + an explicitly uncached
   `roleAuthSummary` (`auth.service.ts:647-665`). It blocks every route behind
   `AuthGate`. A second `refreshMe()` also fires on resume from an independent
   `visibilitychange` listener (`apps/tgapp/src/app/auth-gate.tsx:170-192` vs
   `apps/tgapp/src/shared/app-access.ts:110-125`).
3. **Client-side serial identity chain** `tgId → employee → summary` when `/auth/me`
   does not carry `employee_id` (`apps/tgapp/src/modules/attendance/pages/attendance-page.tsx:75-104`).
4. **Sequential whole-set master walks.** `fetchAllPages` awaits each page
   (`apps/tgapp/src/shared/api/fetch-all.ts:60-70`); `hrm_employees` (238 rows) ≈ 3
   serial requests, fired on mount by many kiosk pages
   (`apps/tgapp/src/shared/lookups/api.ts:73-82,143-160`,
   `apps/tgapp/src/shared/hooks/use-mro-item-models.ts:60-77`).
5. **Response cache is opt-OUT, and authenticated responses stay origin-bound.**
   CORRECTION: the hardcoded `DEFAULT_POLICY.cache.enabled` is `true`
   (`packages/core/src/policy/policy-resolver.ts:140`), so caching is already on
   unless a collection opts out. The remaining structural fact is that
   authenticated responses are `private, no-store`
   (`apps/api/src/middleware/edge-cache.ts:34-41`), so the Cloudflare CDN cannot
   absorb a repeat read — the isolate `CacheLayer` is the only shared-memory win.
   (This item was originally mis-stated as "no cache by default"; corrected on
   review.)
6. **Extra D1 per request for schema/migrations** — the plugin-migration liveness
   probe runs before every route (`apps/api/src/index.ts:544-551`,
   `apps/api/src/lib/services/plugin-migration.service.ts:66-79`) plus
   `ensureMigrations` (`apps/api/src/lib/services/collection-schema.service.ts:92-99`);
   cold isolates also pay `SELECT * FROM _entity_schemas`.
7. **Relation expansion multiplies queries** — one query per relation family plus one
   RBAC id query per related collection per level for non-admins
   (`apps/api/src/lib/services/collection-relations.service.ts:605-723`).
8. **No data prefetch per page** — ~90 lazy route chunks
   (`apps/tgapp/src/app/router.tsx`); only launcher/dock/widgets chunks are warmed,
   and `prefetchApp()` is called without `{data:true}`
   (`apps/tgapp/src/modules/launcher/prefetch.ts:81-85`), so a first navigation pays
   chunk fetch **then** data fetch, serially.
9. **Payload CPU** — full-body hash for the ETag (`apps/api/src/lib/api/response.ts:62`)
   and full-body buffering for gzip (`apps/api/src/middleware/compression.ts:31-33`).
10. **Possible missing composite indexes** — default order `created_at DESC, id DESC`
    (`collection-query.service.ts:229,249`); attendance filters `employee + check_in`.

## Goal (measurable)

- Cut D1 round trips per authenticated GET from **~10–15 → 1–2**.
- Cut perceived tgapp screen time from **~5s → <1s** on mobile Wi-Fi.
- "100x faster DB" target: **10–100x on repeat/warm reads** (cache + dedup + batch),
  realistically **5–15x on cold reads**. A blanket 100x on a single cold D1 query is
  not achievable; the win comes from collapsing round trips, not from making one query
  100x faster.
- Preserve all existing correctness contracts: authz-version freshness, change
  envelope, conditional GET, offline-read policy, policy-enforced writes.

## Non-goals

- No change to the entity engine's public contract (routes, response shapes, error
  codes).
- No new business logic in the factory core.
- No weakening of authz: a revoke must still take effect on the very next request.
- Not a rewrite of the collection engine facade into a god class (it stays a facade +
  collaborators).

## Workstreams

The read path decomposes MECE into four independent workstreams. They are separately
shippable; sequence is W1 → W3 → W2 → W4, measuring after each.

### W1 — Request-path dedup + batch (server; highest ROI, lowest risk)

Root cause #1, #2, #6.

Changes:

1. **Request-scoped memo store.** Extend the existing request-scoped
   `AsyncLocalStorage` seam (`apps/api/src/lib/change-scope.ts`) — or add a sibling
   `request-scope.ts` — holding a per-request `Map` for identity/schema/authz reads.
   Any repeat read within one request costs zero D1. Request-scoped, so it preserves
   statelessness (no cross-request state).
2. **Batch the verification reads.** Coalesce `authzVersion` + user + role +
   `findLiveEmployeeById` into one `db.batch([...])` round trip instead of 4 sequential
   awaits. (9 `.batch()` call sites already exist in the repo as prior art.)
3. **Batch the authz bundle once per request.** `checkBusiness` /
   `getFieldRestrictions` / `getRowFilter` each re-fetch `authzVersion` +
   `_role_permissions`; resolve the role's permission row **once** per request and
   serve all three from the request-scoped memo. Freshness is preserved because the
   memo dies with the request and `authzVersion` is still read at the request boundary.
4. **Deduplicate `/auth/me` provisioning.** Call `ensureProvisionedTelegramRole` once;
   reuse its result for `roleAuthSummary` (`routes/auth.ts:228, 237-241`).
5. **Migration probe cadence.** Keep the reset probe (`plugin-migration.service.ts:66-79`)
   but memoize it per request; optionally add a short per-isolate TTL (~1s, mirroring
   `authz-version.ts`) so a steady stream of requests does not each pay the probe.
   Trade-off: a mid-test DB wipe must still be detected — the existing test suite pins
   this; the TTL must be short enough that tests still observe a reset.

Expected impact: **−4 to −6 D1 round trips on every authenticated GET**.

### W2 — Read response cache, default-on by policy

Root cause #5.

The dependency-tagged response cache already exists and is safe
(`readDependencies` returns the embedded slugs used as invalidation tags,
`collection-query.service.ts:109-137`). It is gated behind `policies.cache.enabled`.

Changes:

1. Derive the cache default in the **single policy source** (`DEFAULT_POLICY` in
   `packages/core` / `policy-resolver`), not in the route. Read-only / master
   collections default to cache-on; transactional views stay off.
2. Keep every existing safety gate: never cache cursor pages, exports, aggregates, or
   unbounded-dependency reads (unchanged).

Trade-off: an opt-out default trades a bounded staleness window (TTL) for up to 10–100x
on repeat reads. The existing `invalidateCollectionReads` + dependency tags mean a write
drops the entry immediately, so the window only applies to concurrent writes.

### W3 — Client read path (tgapp)

Root cause #3, #4, #8.

Changes:

1. **Guarantee `employee_id` on `/auth/me`** for Telegram sessions so the client never
   needs the `hrm_employees` lookup hop (`attendance-page.tsx:75-104`).
2. **Whole-set lookups without a serial walk.** Keyset pagination is sequential by
   nature, so parallelizing pages is not possible. Replace the `fetchAllPages` walk for
   high-row master sets (e.g. `hrm_employees`, 238 rows) with a server-side aggregate
   lookup endpoint (one request, bounded payload) — this is where a real 10–100x DB win
   lives for those screens. Keep `fetchAllPages` for genuinely unbounded sets.
3. **Data prefetch on intent.** Call `prefetchApp(id, { data: true })` from the launcher
   so tapping a dock app fetches its data during the tap animation
   (`launcher/prefetch.ts:81-85`).
4. **One `refreshMe` listener.** Collapse the two independent `visibilitychange`
   handlers into one owner.

Expected impact: **−2 to −3 round trips per screen**.

### W4 — Schema / index / denorm (data)

Root cause #10.

Changes:

1. Apply the auto-index advisor's recommendations (`?explain=true` plan endpoint,
   `collection-query.service.ts:523-546`) for the default sort shape and the hot
   attendance filter (`employee + check_in`).
2. Denormalize the attendance summary into a snapshot row so the dashboard reads one
   row instead of an aggregate over attendances (+ leaves).

Trade-off: denorm adds a write-side maintenance cost and a data-lineage obligation
(the snapshot must state what invalidates it). Indexes cost write throughput. Both are
bounded and reversible.

## Design principles applied

- **Single Source of Truth** — cache defaults derive from `DEFAULT_POLICY`; error codes
  stay in `@mmbix/types/contract.ts`.
- **Statelessness** — the memo is request-scoped; any isolate cache stays version-keyed.
- **Idempotency** — batched reads are pure; a replayed batch returns the same rows.
- **PoLP / Poka-Yoke** — cache default-on applies only to shapes proven safe by the
  dependency walker; a write can always invalidate its own entries.
- **Information Visibility** — the measurable budget (D1 rpt/GET, screen time) is the
  success signal; degradation must stay visible, never silent.
- **MECE** — the four workstreams cover server request path, server cache, client path,
  and data layer with no overlap.

## Testing

- W1: `apps/api/test/` specs for authz freshness + a new round-trip-count assertion
  (batched path); `cd apps/api && npx tsc --noEmit`.
- W2: extend existing `relation-cache.spec.ts` / `policy-resolver` tests for the new
  default.
- W3: tgapp unit specs + `npx tsc --noEmit`; a lookup-endpoint spec if added.
- W4: migration spec + `?explain=true` index-usage assertion.
- Always run the repo's existing suites via `pnpm test` after each workstream.

## Success criteria

- A repeat read of a master collection issues **0 D1 queries**.
- An authenticated GET issues **≤ 2 D1 round trips** in steady state.
- The tgapp attendance + launcher screens render in **< 1s** on a throttled mobile
  profile (measured in devtools / a live smoke run).
- All existing tests pass; no contract change.

## Risks / open questions

- W1's `/auth/me` provisioning change touches auth — must be pinned by the existing
  authz-freshness tests.
- W2's default flip is the riskiest for staleness; the exact set of "read-only/master"
  collections must be defined (by write mode? explicit flag?) — resolve during the plan.
- W4's attendance denorm needs a lineage statement and a backfill.
- Measurement baseline (wrangler tail timings / devtools throttling) should be captured
  before W1 so improvements are attributable.

## Implementation status (2026-09-16)

An audit of the working tree before implementing showed most of the design was
ALREADY present (either committed or in the in-flight uncommitted work). Only two
items required code. This is the honest accounting:

| Item                                                   | Status                        | Where                                                                                                                                                                    |
| ------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| W1 — ONE token verification per request                | Already present (uncommitted) | `apps/api/src/index.ts` pre-auth middleware + `requireAuth` reuse                                                                                                        |
| W1 — single DB-liveness probe (was two)                | Already present               | `packages/core/src/db/db-liveness.ts`; `plugin-migration.service.ts`                                                                                                     |
| W1 — relation recursion parallelized                   | Already present               | `collection-relations.service.ts` (`Promise.all`)                                                                                                                        |
| **W1 #3 — authz row read deduped per request**         | **Implemented here**          | `permission-evaluator.ts` — new `_getPermissionRow` shared by `checkBusiness` / `getFieldRestrictions` / `getRowFilter` (one `SELECT` of the row instead of up to three) |
| W2 — cache default                                     | Already true (committed)      | `DEFAULT_POLICY.cache.enabled: true` — no change needed (root-cause #5 corrected above)                                                                                  |
| W3 — `/auth/me` carries `employee_id` + login warms it | Already present (uncommitted) | `routes/auth.ts`, `auth-gate.tsx`                                                                                                                                        |
| W3 #3 — intent data prefetch on tile press             | Already present               | `app-icon.tsx:20` (`prefetchApp(id, { data: true })`)                                                                                                                    |
| **W3 #4 — resume `refreshMe` deduped**                 | **Implemented here**          | `app-access.ts` now `subscribeMe`s (the AuthGate owns the one resume read) instead of each consumer firing its own `refreshMe`                                           |
| W4 — default-sort index                                | Already present               | `collection-schema.service.ts:487` (`idx_<t>_deleted_created_id`)                                                                                                        |
| W4 — hot-filter composite indexes                      | Already present               | self-tuning index advisor (`auto-indexer.ts`), `autoIndex.enabled: true`, `mode: 'auto'`                                                                                 |

Verification: `apps/api` `npx tsc --noEmit` clean; API suite 257/257 pass; tgapp
`typecheck` clean; tgapp suite 472/472 pass.

Not done (needs measurement/decision, not code): the W2 "read-only/master opt-out"
default refinement, W4's declared attendance composite `(employee_id, check_in)` and
its denorm snapshot, and the W3 whole-set lookup endpoint. The auto-indexer already
covers the hot-filter shape at runtime, and the default-sort index already exists, so
W4's remaining items are optional hardening rather than open latency.

## Honest answer to "100x faster"

100x is real for **DB work on a repeat/warm read** (the isolate cache means D1 is not
touched at all). It is NOT real for **end-to-end screen latency**: the client-side
network round trips (device → edge → service binding, ~100–500ms each on weak Wi-Fi)
are outside the DB's reach. Realistic end-to-end: ~3–5x cold, ~10x warm + prefetched.
The remaining lever for end-to-end is fewer client round trips (W3), not faster D1.

## Remote-D1 hardening (2026-09-16, second pass)

Follow-up work after "fix all remaining + make it perfect for remote D1":

| Change                                                                 | Where                                                                                                                                                                                             | Why it helps remote D1                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1 session per request** — every query goes through the Sessions API | `packages/core/src/db/d1-executor.ts` (resolver seam) + `packages/core/src/db/d1-client.ts` (executor getter) + `apps/api/src/lib/d1-session.ts` + one root middleware in `apps/api/src/index.ts` | Read replication serves reads from the replica nearest the user; `first-primary` preserves read-your-writes. `exec` (DDL) intentionally uses the raw binding — the Sessions API has no `exec`. Zero call-site changes; the resolver is registered by the worker so core stays browser/Node-safe. Enable replication at the DB for the benefit (see `infra/README.md`). |
| **Page-size max 100 → 500**                                            | `packages/utils/src/constants.ts` (`MAX_PAGE_SIZE`) + `apps/tgapp/src/shared/constants.ts` (`LOOKUP_LIMIT`)                                                                                       | Whole-set directory reads (≈238 employees, SKU masters) complete in ONE round trip instead of 3 serial 100-row cursor pages — on remote D1 + mobile that is ~2 fewer client RTTs and 2 fewer D1 queries per open. Default page stays 25; only explicit lookups ask for more.                                                                                           |
| **`/auth/me` role provisioning de-duplicated**                         | `apps/api/src/routes/auth.ts`                                                                                                                                                                     | One `ensureProvisionedTelegramRole` pass instead of two — ~3 fewer D1 round trips on the boot-critical call.                                                                                                                                                                                                                                                           |
| **Approval tab counts removed**                                        | `apps/tgapp/src/modules/attendance/pages/approval-page.tsx`                                                                                                                                       | No digit badges (product call) and no `/hr/requests/counts` round trip on opening the Approval Center.                                                                                                                                                                                                                                                                 |

Also shipped in the same pass (from the dirty-state workstream): the shared
`useFormDirty` / `valuesEqual` primitive and the per-form disable-until-changed
gate — not perf, but it removes accidental no-op writes.

Verification: `@mmbix/core` 309 tests · `@mmbix/utils` 57 · `apps/api` 257 ·
`apps/tgapp` 479 — all pass; `typecheck` clean in core/api/tgapp.

Still open (measured decision, not code): verify D1 read replication is enabled
on the database, and capture a wrangler-tail / devtools baseline to confirm where
the remaining wall-clock sits.
