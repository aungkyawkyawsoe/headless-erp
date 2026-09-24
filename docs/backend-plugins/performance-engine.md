# Headless Performance Engine — Self-Tuning Index, Response Cache & Runtime Policies

The entity engine is **headless-first**: it derives performance behavior from how the
database is _actually used_ at runtime, and makes every capability **toggleable via
REST** — no code, no redeploy. Four subsystems work together:

1. **Self-Tuning Index Advisor** — observes real query shapes, verifies with `EXPLAIN`,
   and auto-creates the composite indexes that turn full scans into index seeks.
2. **Declarative Composite Indexes** — any collection can declare multi-column indexes
   in `schema_json` (the advisor never duplicates a declared one).
3. **Headless Response Cache** — policy-driven read caching that skips D1 for repeated
   identical reads, invalidated automatically on every write.
4. **Runtime Policy Engine** — the control plane that enables/configures/disposes
   `auto_index`, `cache`, `offline_reads`, `audit`, and `hooks` per collection via REST.

---

## 1. Self-Tuning Index Advisor

`packages/core/src/db/auto-indexer.ts` — a headless indexer with **zero business
hardcoding**. It:

1. **OBSERVE** — every `listItems` records a normalized filter signature (multi-column
   filter + sort) per collection into an in-isolate frequency ledger.
2. **VERIFY** — when a signature clears a frequency threshold, run `EXPLAIN QUERY PLAN`;
   only act when the plan reports a `SCAN`.
3. **CREATE** — issue the composite index (`CREATE INDEX IF NOT EXISTS`), honoring a
   per-collection budget (default 4) and the declarative override.
4. **JOURNAL** — every auto-created index is recorded for observability.

**Guard-rails (enterprise):**

- `MIN_OBSERVATIONS` (5) — one-off ad-hoc queries never trigger an index.
- Rate-limited: one tuning pass per 60s per isolate; bounded probes per pass.
- `existingTables` check skips stale/dropped tables before any EXPLAIN.
- Idempotent DDL; failures fail closed (never guess).
- Tables must exist in the _current_ DB before probing.

**Per-collection behavior** is decided at tune-call time by the collection's
`auto_index` policy — `propose` recommends without issuing DDL (change management).

### Operations telemetry

```
GET /api/operations/index-advisor        (admin)
```

Returns `{ mode, journal, candidates }` — what the engine created/recommended and why.

---

## 2. Declarative Composite Indexes

Declare on any collection (via `POST /api/collections` or `PUT /api/collections/:slug`):

```jsonc
{
  "fields": [...],
  "composite_indexes": [{ "columns": ["status", "superior_tg_id"] }]
}
```

- Created idempotently at table-create **and** backfilled for existing collections
  (swept in `_backfillDeletedAtIndexes`).
- The leading column is what a single-column `=`/`IN` filter can seek on.
- The auto-index advisor **never** duplicates a declared composite.
- **Applying to an existing production DB that was seeded before these shipped:**
  the module seeds forward them on create/re-run, but a data-free sync is
  available — see `apps/api/scripts/README.md` → _Converging index & workflow
  metadata in production_ (`converge-indexes.mjs`, driven by the `lib/index-meta.mjs`
  Single Source of Truth).

**Seed-aligned examples in the miniapp modules** (declared in `apps/api/scripts/seed-*.mjs`, applied idempotently on create **and** re-run so existing collections converge):

| Collection                               | Composite index                                       | Status machine                                       |
| ---------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| `hr_requests`                            | `(status, superior_tg_id)`                            | pending → approved / rejected / cancelled            |
| `hr_tasks`                               | `(assignee_tg_id, status, due_date)`                  | —                                                    |
| `hr_attendance`                          | `(employee_tg_id, timestamp)`                         | —                                                    |
| `store_purchases`                        | `(status, remaining_qty)`                             | pending → confirmed                                  |
| `vehicle_maintenance`                    | `(status, maintenance_date)` + `(vehicle_id, status)` | — (edit form is a free status picker in the miniapp) |
| `vehicle_permits` / `vehicle_insurances` | `(vehicle_id, status)`                                | confirmed ↔ pending → expired                        |
| `vehicle_trips`                          | `(vehicle_id, status)`                                | planned → started → delivered / cancelled            |
| `vehicle_fuel_logs`                      | `(vehicle_id, date)`                                  | —                                                    |

---

## 3. Headless Response Cache

Opt a collection in via its `cache` policy (REST, no code):

```jsonc
{
	"policies": { "cache": { "enabled": true, "ttl_s": 60, "layer": "auto" } },
}
```

- Cache key: `(collection, auth-fingerprint, canonical-url)` — **auth-scoped**, so one
  user's data never leaks to another.
- Only safe, recomputable read shapes are cached (never cursor, export, aggregate,
  or `explain`).
- **Write-invalidation**: every create/update/soft-delete/restore/hard-delete (on the
  service path AND on direct-DB business writes in `store` + `task-engine`) clears the
  collection's cached reads, so fresh rows/edits are always visible.
- `fnv1a` key hashing — workerd-safe, synchronous, deterministic.

The `layer` field is reserved for future cross-isolate tiers; today the in-isolate
CacheLayer tier is authoritative (`auto` = memory).

---

## 4. Runtime Policy Engine (the headless control plane)

Any collection can enable/configure/dispose engine behaviors at runtime via REST:

| Method   | Path                                       | Purpose                                   |
| -------- | ------------------------------------------ | ----------------------------------------- |
| `GET`    | `/api/collections/:slug/policies`          | current per-collection policy (raw)       |
| `GET`    | `/api/collections/:slug/policies/resolved` | merged policy (env defaults × collection) |
| `GET`    | `/api/collections/:slug/policies/features` | discoverable feature list                 |
| `PUT`    | `/api/collections/:slug/policies`          | partial-merge update (enable/configure)   |
| `DELETE` | `/api/collections/:slug/policies/:feature` | dispose one feature (reset to default)    |

### Supported features

```jsonc
{
	"auto_index": { "enabled": true, "mode": "auto", "max_dynamic": 4 },
	"cache": { "enabled": true, "ttl_s": 60, "layer": "auto" },
	"offline_reads": { "enabled": false, "max_age_s": 86400 },
	"audit": { "enabled": false },
	"hooks": { "enabled": true },
}
```

- `auto_index.mode`: `"auto"` applies DDL; `"propose"` recommends only (change mgmt).
- Merged order: **env defaults ← global ← per-collection** (`PolicyResolver`).
- **Studio**: the per-collection **Runtime Policies** dialog edits `auto_index`, `cache`,
  and `offline_reads` visually. It is reachable from **two** places — the **Collections
  workbench** toolbar (where schemas are curated, `CollectionsWorkbench.tsx`) and the
  **App workbench** toolbar (`AppDetailPage.tsx`). Both render the same `PolicyPanel`,
  so there is one control plane, not two.

### `offline_reads` — the one policy that leaves the server

`cache` keeps rows in the server's own memory (the same trust boundary as D1).
`offline_reads` lets a **client device** keep a read body so the app still shows
data with no connection — a different trust boundary, where **logout and erasure
requests cannot reach the copy** and a shared/lost device exposes it. So it is the
only policy that defaults **OFF**, and it is deliberately independent of `cache`:
turning the server cache off does not grant device persistence, and vice versa.

While enabled, every successful entity read carries:

```
X-Offline-Max-Age: 86400      # seconds a client may serve the stored body
ETag: W/"…"                   # the same content hash used for 304 revalidation
```

The header rides the response it governs, which is what makes the policy
dynamic: flipping the Studio switch changes the very next read — no discovery
round trip, no cache to prime, and no collection list to leak to callers. Absent
header ⇒ the client must not persist (deny by default). `@mmbix/sdk` obeys it
automatically: it persists the body to its response-cache storage for that window,
scopes the copy to the signed-in account's fingerprint, slides the window on a
304, and purges it on logout.

**What to enable it for:** masters/lookups and a user's own records. **What not
to:** collections holding other people's personal data (employee directories,
leave/overtime reasons), anything with `encrypted: true` fields (they are
decrypted before the response leaves the API, so persistence would put the
plaintext back on the device), and money/stock documents.

#### The allowlist lives in D1, not in git

The policy is per-collection `schema_json.policies.offline_reads` — so an enabled
set is invisible in a diff. Record the intended set here when it changes.

Enabled (2026-09-10, dev, `max_age_s: 86400`) — masters/lookups only, the
form-dropdown rows a field worker needs with no signal:

```
mro_item_categories  mro_item_model  mro_item_name  mro_suppliers
veh_fleets           hrm_departments hrm_designations  hrm_shifts
```

Deliberately **off**: every transactional document (inbounds/outbounds/transfers/
adjustments/requisitions + their lines/lots/serials/events, `veh_fluids`,
`veh_permits`, `veh_insurances`, `veh_incidents`, `veh_odo_months`) and every HR
person-record (`hrm_employees`, `hrm_attendances`, `hrm_leaves`, `hrm_overtimes`,
`hrm_early_leaves`).

> ✅ **`hrm_attendances` (“own records”) is now row-scoped.** The Telegram role
> provisioning (`ensureRoleRowFilters` in `apps/api/src/routes/auth-telegram.ts`)
> sets the Employee role's `row_filters` on `hrm_attendances` to
> `employee eq $CURRENT_USER.employee_id` (only when none is configured, so an
> admin's hand-tuned filter is never clobbered). `DataFilterService` enforces it on
> list/detail/**write**/export/search, so an employee reads — and can `check_out` —
> only their OWN day row. Device persistence is therefore no longer a
> cross-employee copy; enabling `offline_reads` on this collection is now a plain
> product decision (use a short `max_age_s` ≈3600).

---

## 5. Cost-efficient reads (the whole stack together)

For an ERP on D1 the stack turns full-scan-heavy workloads into index-seek + cache hits:

| Pattern                             | Without                               | With                                                                          |
| ----------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| Badge/count                         | `?count=true` double query, full scan | `?count_only=true` (COUNT only) + composite index + response cache            |
| Hot filtered list                   | unindexed scan                        | composite index seek                                                          |
| Repeated dashboard reads            | re-read D1 every time                 | response cache (write-invalidate)                                             |
| Reference data (options, directory) | re-read on every form open            | response cache                                                                |
| Search                              | `LIKE %…%` scan                       | (global FTS5 `_search_index` available; entity-list path listed as follow-up) |

---

## Quick reference (curl)

```bash
# Declare a composite index + status machine + cache policy on a collection
curl -X POST $API/entities \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Orders","slug":"orders","fields":[...],
       "composite_indexes":[{"columns":["status","customer_id"]}],
       "status_machine":{"field":"status","transitions":{"pending":["approved","rejected"]}},
       "policies":{"auto_index":{"mode":"propose"},"cache":{"enabled":true,"ttl_s":60}}}'

# Resolve the merged policy
curl $API/collections/orders/policies/resolved -H "Authorization: Bearer $TOKEN"

# Tune a single feature — no code, no redeploy
curl -X PUT $API/collections/orders/policies \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"auto_index":{"mode":"propose"}}'

# Dispose a feature's policy (reset to default)
curl -X DELETE $API/collections/orders/policies/cache -H "Authorization: Bearer $TOKEN"

# Observability — what the engine auto-created / recommended
curl $API/operations/index-advisor -H "Authorization: Bearer $TOKEN"
```
