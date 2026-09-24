# Architecture — The Collection Engine

**Updated for the enterprise decomposition (v0.8).** The entity engine is no longer a
2,300-line god class. `CollectionService` is a thin **facade**; every concern lives in a
focused collaborator with injected dependencies. Public API is unchanged — routes,
plugins, and tRPC keep calling `CollectionService` exactly as before.

---

## 1. Component map

| File                                               | Responsibility                                                           | Size |
| -------------------------------------------------- | ------------------------------------------------------------------------ | ---- |
| `src/lib/services/collection.service.ts`           | **Facade** — wiring, `setAuth()`, public API surface, re-exports         | ~150 |
| `src/lib/services/collection-schema.service.ts`    | **SchemaService** — collection lifecycle, table DDL, schema cache        | ~400 |
| `src/lib/services/collection-query.service.ts`     | **ItemQueryService** — reads, keyset, aggregates, decrypt-on-read        | ~700 |
| `src/lib/services/collection-mutation.service.ts`  | **ItemMutationService** — writes, hooks, audit, webhooks, encrypt        | ~700 |
| `src/lib/services/collection-relations.service.ts` | **RelationResolver** — `?fields=` projection + relation expansion        | ~450 |
| `src/lib/services/collection-cascade.service.ts`   | **CascadeService** — M2M junctions + cascade delete (BFS)                | ~190 |
| `src/lib/services/collection.shared.ts`            | Types (`CollectionInfo`, `CollectionPolicy`, …), RBAC row-filter helpers | ~170 |

Dependency flow (one direction, no cycles):

```text
CollectionService (facade)
├─ SchemaService        ← schema cache, table DDL
├─ ItemQueryService     ← SchemaService + RelationResolver
├─ ItemMutationService  ← SchemaService + CascadeService (+ getItem callback)
├─ RelationResolver     ← SchemaService (getCollections) + auth
└─ CascadeService       ← SchemaService (getCollection/getCollections)
```

Collaborators receive `db` plus **closures** (`() => this.getCollections()`,
`() => this._auth`) instead of mutable references — `setAuth()` and cache
invalidation stay consistent without passing state around.

---

## 2. Read pipeline (`listItems`)

```text
1. SchemaService.getCollection()          → cached schema (fields, policies)
2. QueryParser.parse(url)                 → filters / sorts / fields / aggregate
3. Index advisor observes filter shape    → non-blocking auto-index learning
4. Response cache lookup                  → key = (collection, auth-fingerprint, url)
5. SQL: filters + search + group filters + nested subqueries
6. Keyset pagination                     → (sort fields…, id) row-value cursor, no OFFSET
7. Row-level RBAC filter                 → injected at SQL level
8. RelationResolver.resolveRelations()   → batched m2o/o2m/m2m/m2a + prune per ?fields=
9. Field-level RBAC filter               → strips hidden columns
10. Decrypt-on-read                      → skipped when projection excludes encrypted fields
11. mergeRowData + cursor meta           → next_cursor / prev_cursor
12. Response cache store                 → policy-driven TTL
```

**N+1 avoidance:** relations are fetched once per level for the whole page
(`resolveM2O(items, …)`), child tables are indexed by `parentId:fieldName`, and
recursion across rows is batched — one query per relation type per level, never
one per row.

---

## 3. Write pipeline (`createItem`)

```text
1. SchemaService.getCollection()          → cached schema
2. Idempotent replay                     → client-supplied UUID id ⇒ same id = same row
3. Required-field validation             → NOT NULL semantics (required !== false)
4. Constraint validation                 → min/max/max_length + unique (ONE db.batch)
5. M2A + server hooks + plugin hooks     → validate / before_insert
6. Child-table extraction                → never leaks into the parent row
7. Encrypt-on-write                      → AES-256-GCM for encrypted fields
8. Naming series                         → display_number
9. Singleton guard                      → + partial UNIQUE index (concurrency-safe)
10. Atomic D1 batch                     → parent insert + M2M junction rows
11. Child rows, after_insert hooks, audit (opt-in), webhook
12. Response-cache invalidation          → writes clear collection reads
```

Optimistic concurrency (`If-Match` → `expectedUpdatedAt`) 409s stale updates;
soft-delete/restore/hard-delete share the same row-filter + audit + cascade path.

---

## 4. Performance patterns (why it scales)

| Pattern                  | Where                                                           | Big O                             |
| ------------------------ | --------------------------------------------------------------- | --------------------------------- |
| Keyset cursor pagination | `ItemQueryService` (row-value predicates, id tiebreaker)        | O(log n) indexed seek             |
| Batched relation fetch   | `RelationResolver.resolveLevel` (m2o/o2m/m2m once per level)    | O(1) queries per relation type    |
| Batched recursion        | `recurseAndPruneSingle/Array` (whole page in one level pass)    | kills per-row recursion           |
| Cascade delete batching  | `CascadeService.cascadeDelete` (`WHERE field IN (…)` per level) | O(inbound fields × levels)        |
| Memoized cascade map     | `CascadeService` (WeakMap on schema-array identity)             | ~0 work when no cascade fields    |
| Unique-check batching    | `ItemMutationService` (`db.batch`, chunked at 50)               | O(1) round-trips                  |
| O(1) nested-query hops   | per-request name→field maps                                     | O(hops) instead of O(hops×fields) |
| Response cache           | policy-driven (`policies.cache`), auth-fingerprint keyed        | skips D1 on repeated reads        |
| Decrypt skip             | projection/RBAC excludes encrypted fields ⇒ no AES              | saves CPU per row                 |
| Index advisor            | observes hot multi-column filters, auto-creates composites      | data-driven indexing              |

All list reads are ordered by a total keyset (sort fields + `id`), so pages stay
correct under concurrent inserts/deletes — deterministic, cursor-based, no OFFSET.

---

## 5. Idempotency & consistency guarantees

- **Create replay:** same client UUID `id` ⇒ returns the existing record (no duplicate).
- **Idempotency-Key header (Stripe-style):** stored response replay on
  `POST /api/entities`, `POST /api/entities/:collection`, and
  `POST /api/entities/:collection/import` — key scoped to (method, path), 24h TTL.
- **Optimistic concurrency:** `If-Match: <updated_at>` ⇒ stale writes get 409.
- **Atomicity:** parent row + M2M junction rows commit in one D1 batch.
- **Singleton:** check-then-insert race closed by a partial UNIQUE index.

---

## 6. Adding a feature — where does it go?

| Feature                           | Home                                              |
| --------------------------------- | ------------------------------------------------- |
| New filter operator / sort option | `QueryParser` + `ItemQueryService.applyOperator`  |
| New relation shape (`?fields=`)   | `RelationResolver`                                |
| New validation rule               | `ItemMutationService.validateFieldConstraints`    |
| New lifecycle hook point          | `ItemMutationService` (+ `ServerFunctionService`) |
| New cache policy / layer          | `ItemQueryService` + `@mmbix/core` CacheLayer     |
| New cascade semantics             | `CascadeService`                                  |
| New schema DDL / system column    | `SchemaService`                                   |

Keep the facade thin — if a feature touches more than one collaborator, wire it
in the facade constructor, not inside a collaborator.

---

## Consistency Model (multi-isolate)

Workers reuse an isolate for many requests, but state is never shared across
isolates — every cache here is **per-isolate in-memory**: the schema cache
(`schema:{slug}` / `schemas:all`), the permission cache (`perm:*`, 60 s default
TTL), the response cache (`readc:{collection}:{authFp}:{urlHash}` — keyed per
collection + auth fingerprint + canonical URL, TTL from `policies.cache.ttl_s`,
default 60 s), the report cache (`report:{slug}:*`, `SHORT_TTL`), the rate-limit
counter map (10 000-entry cap), the field-encryption init flag, and the
plugin-migration guard (both once per isolate). Invalidation
(`cache.invalidateCollection`, `invalidateCollectionReads`, permission
invalidation) therefore only clears the **issuing isolate** — other isolates
serve stale data up to their TTLs.

Mitigations already in place:

- Short TTLs (60 s default) bound how long another isolate can serve a stale
  schema, permission, or read.
- Response caching is per-collection opt-in (`policies.cache.enabled`); row and
  field restrictions are enforced at read time, never cached across users — the
  response-cache key includes an auth fingerprint.
- The client app adds client-side pull-to-refresh + 30 s list caches, so a stale
  read self-heals on the next refresh.
- The DO-backed rate limiter (`RATE_LIMIT_DO`) is the in-repo pattern for
  cross-isolate state.

Deployments that need strict cross-isolate invalidation should replicate that
pattern — a Durable Object owning the cache (same shape as `RATE_LIMIT_DO`).

## Factory vs domain modules

The API is a **generic entity engine** — entities CRUD, `/api/query` batch
reads, plugins, auth/RBAC, search, reports, tRPC, scheduler — usable to build
ANY software on top of it. Two **business modules** ship as opt-in extras,
each a self-contained vertical under `apps/api/src/domain-modules/`
(`hr/`, `store/`) that speaks only the generic engine API:

- `/api/hr` — meeting tasks, attendance summary, the 08:30 digest cron
  (see `docs/backend-api/tasks-follow-up.md`).
- `/api/store` — FIFO issue/requisition/writeoff fulfillment.

They are mounted through a single config-gated registry
(`domain-modules/index.ts` → `mountDomainModules`); the factory core
(`routes/`, `plugins/`, `lib/`, `services/`) never references them. Copy a
folder to scaffold a new business vertical, or use `headless module create`.

Control which modules ship with the `DOMAIN_MODULES` env:

| Value            | Behavior                                      |
| ---------------- | --------------------------------------------- |
| `hr,store`       | **Default** — both modules enabled            |
| `none`           | Pure factory — no domain modules at all       |
| `store` (subset) | Only the listed modules ship (`/api/hr` 404s) |

Disabled modules return the standard `404 NOT_FOUND` body — the surface is
indistinguishable from a factory without them. The scheduled handler's HR
digest is gated by the same flag.

**Telegram auth is generic but configurable.** The approval gate
(`docs/backend-api/authentication.md`) reads its directory + role from config,
not hardcoded `hr_*` slugs:

- `TELEGRAM_DIRECTORY_COLLECTION` / `TELEGRAM_DIRECTORY_FIELD` — which
  collection + field gate login (default `hr_employees` / `tg_id`). Point the
  directory at any collection (e.g. `staff`) to run the same approval flow for
  a different domain.
- `TELEGRAM_ROLE_NAME` + `TELEGRAM_ROLE_COLLECTIONS` — the role provisioned
  for approved users and the collections granted read/write/create
  (default `Employee` + the hr/vehicle/store set; an empty list provisions the
  role with no permissions).

Business modules are also scaffoldable via the CLI
(`headless module create` — templates in `packages/cli/templates`): the
shipped hr/store modules are a reference implementation, not a closed set.
