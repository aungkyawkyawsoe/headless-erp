# Entities API

Full CRUD for collections and items.

## Endpoints Overview

| Method | Path                                        | Permission | Description                                                         |
| ------ | ------------------------------------------- | ---------- | ------------------------------------------------------------------- |
| GET    | `/api/collections`                          | admin      | List collections                                                    |
| POST   | `/api/collections`                          | admin      | Create collection                                                   |
| GET    | `/api/collections/:slug`                    | admin      | Get collection + full schema                                        |
| PUT    | `/api/collections/:slug`                    | admin      | Update collection schema                                            |
| DELETE | `/api/collections/:slug`                    | admin      | Delete collection                                                   |
| GET    | `/api/entities/field-types`                 | auth       | List all field types                                                |
| GET    | `/api/entities/:collection`                 | read       | List items                                                          |
| POST   | `/api/entities/:collection`                 | create     | Create item                                                         |
| GET    | `/api/entities/:collection/:id`             | read       | Get item                                                            |
| PUT    | `/api/entities/:collection/:id`             | write      | Update item                                                         |
| DELETE | `/api/entities/:collection/:id`             | delete     | Soft delete item                                                    |
| POST   | `/api/entities/:collection/:id/restore`     | write      | Restore from trash                                                  |
| DELETE | `/api/entities/:collection/:id/force`       | admin      | Hard delete                                                         |
| POST   | `/api/entities/:collection/action/:action`  | write      | [Custom action](../backend-plugins/collection-actions.md)           |
| POST   | `/api/entities/:collection/bulk/transition` | write      | Bulk status change                                                  |
| POST   | `/api/query`                                | read       | [Read batch — one view = one round trip](#read-batch-post-apiquery) |

---

## Naming rules — SQL reserved keywords are rejected

Collection slugs (→ table names) and field names (→ column names) may NOT be
SQL reserved keywords — the API returns `400` at create/update time instead of
failing at SQL runtime.

- **Rejected slugs**: `in`, `order`, `group`, `values`, `index`, `select`, `table`, …
  → use `check_in`, `orders`, `shift_groups`, …
- **Rejected field names**: same list (case-insensitive).
- Source of truth: `RESERVED_SQL_WORDS` / `isReservedSqlWord()` in `@mmbix/utils`
  (`packages/utils/src/validation.ts`) — verified against sqlite3: each entry
  fails as an unquoted column name.

---

## Read Batch — `POST /api/query`

The generic **one-view-one-round-trip** read: a view declares ALL its data needs
as keyed `{ collection, params }` specs; the server executes them **in parallel**
through the same entity engine (per-collection row filters + field restrictions

- response cache apply automatically) and returns one keyed payload.

```bash
curl -X POST http://localhost:8788/api/query \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"queries": [
    {"key": "cards", "collection": "records", "params": {"limit": "24", "sort": "-timestamp"}},
    {"key": "hero",  "collection": "hr_employees",  "params": {"fields": "id,name_mm,eid"}}
  ]}'
```

**Response `200`** — per-key results with **error isolation** (a failing source
never blanks the rest of the view):

```json
{
  "success": true,
  "data": {
    "results": [
      { "key": "cards", "ok": true,  "data": [ ... ], "meta": { "limit": 24, "has_more": false } },
      { "key": "hero",  "ok": true,  "data": [ ... ] },
      { "key": "x",     "ok": false, "error": "You do not have \"read\" permission on this collection" }
    ]
  }
}
```

**Notes**

- `params` are the same URL search params as `GET /api/entities/:collection`
  (`limit`, `sort`, `fields`, `filter[field][_eq]=…`, `cursor`, `count_only`…).
- Auth: `requireAuth` + a per-collection read check; row filters & field
  restrictions are applied by the engine inside each sub-query.
- Cap: 12 queries per batch.
- Consumed by the SDK as `client.queryMany()` / the `useView` React hook.

---

## Conditional reads — `ETag` / `304`

Every successful `GET` carries a weak `ETag` — a hash of the exact bytes the
server would send. Send it back as `If-None-Match` on the next read of the same
URL: when nothing changed the API answers **`304 Not Modified`** with no body,
and the client keeps the data it already holds.

```bash
curl -i http://localhost:8788/api/entities/orders -H 'Authorization: Bearer dev-token'
# → 200, ETag: W/"1a2b3c"

curl -i http://localhost:8788/api/entities/orders \
  -H 'Authorization: Bearer dev-token' -H 'If-None-Match: W/"1a2b3c"'
# → 304, no body, ETag: W/"1a2b3c"
```

It needs no version to store and no invalidation to wire, because **the tag is
the content**:

- A write changes the bytes → the tag changes → the next revalidation is a `200`.
- A different `?fields=` / `?filter=` / `?sort=` is a different representation → a
  different tag, so one variant can never answer for another. (`fields=*` is the
  lean default read by design, so it shares the default's tag — same bytes.)
- Row-level RBAC means two users see different bytes, so they share a tag only
  when their payloads are byte-identical — a hit is never a leak.
- It works across isolates, because nothing has to be replicated.

Only reads are conditional (`POST`/`PUT`/`DELETE` responses carry no `ETag`),
and routes that publish their own version-based tag — the app manifest, MVE
templates — keep it. `@mmbix/sdk` revalidates automatically: it stores the tag
together with the body it received and replays it on the next read of that URL
(**memory-only** — no response body is ever written to disk). Opt out with
`createClient({ conditionalGet: false })`.

---

## Collection Management (Admin Only)

### Create Collection

`POST /api/collections`

```bash
curl -X POST http://localhost:8788/api/collections \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"name": "Products", "fields": [{"name": "title", "type": "text", "required": true}]}'
```

**Response `201`:** The collection with `table_name: "cms_products"`, parsed `schema_json`, `is_singleton`, `hidden` booleans.

**Singleton:** when `is_singleton: true`, a partial UNIQUE index (`(1) WHERE deleted_at IS NULL`) guarantees at most one non-deleted record at the database level — concurrent double-creates are rejected, and soft-deleting the record frees the slot. Toggling `is_singleton` via `PUT /api/collections/:slug` creates/drops the index (returns `400` if the collection already holds multiple non-deleted rows).

**Headless engine config (optional, all in the create/update body):**

| Field               | Type                                                      | What it does                                                                                                                                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `composite_indexes` | `[{ columns: string[] }]`                                 | Declarative multi-column DB index (created idempotently at table-create + backfilled). E.g. `[{"columns":["status","superior_tg_id"]}]`                                                                                                                                                                        |
| `status_machine`    | `{ field, transitions }`                                  | Config-driven state machine enforced on every update (approved→rejected is blocked). E.g. `{"field":"status","transitions":{"pending":["approved","rejected"]}}`                                                                                                                                               |
| `policies`          | `{ auto_index?, cache?, offline_reads?, audit?, hooks? }` | Runtime feature policies (see [Headless Performance Engine](../backend-plugins/performance-engine.md)). E.g. `{"auto_index":{"mode":"propose"},"cache":{"enabled":true,"ttl_s":60}}`. `offline_reads` is the only one that lets a CLIENT persist rows on the device (deny by default, `{enabled, max_age_s}`). |
| `list_fields`       | `string[]`                                                | Default list projection (leaner `SELECT`) when the caller omits `?fields=`                                                                                                                                                                                                                                     |

```bash
curl -X POST http://localhost:8788/api/collections \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"name":"Orders","slug":"orders",
       "fields":[{ "name":"status","type":"select","options":["pending","approved"] }],
       "composite_indexes":[{"columns":["status"]}],
       "status_machine":{"field":"status","transitions":{"pending":["approved"]}},
       "policies":{"auto_index":{"mode":"propose"},"cache":{"enabled":true,"ttl_s":60}}}'
```

**Query params on list/detail:** `?count_only=true` returns only `meta.total` and skips the SELECT + row enrichment (the `fetchCount` fast path). `?fields=a,b` projects columns; `?list_fields` (schema default) applies when omitted.

**Errors:**

| Status | When                                     |
| ------ | ---------------------------------------- |
| 400    | Invalid field type / missing fields      |
| 409    | Slug or name already exists (`CONFLICT`) |

### List Collections

`GET /api/collections` — returns collections with `schema_json` stripped for efficiency.

### Get Collection Detail

`GET /api/collections/:slug` — returns full schema with parsed `schema_json`.

**Opt-in `?with=relation_schemas`** — also returns every `m2o` TARGET's schema,
keyed by slug, in `data.related_schemas`:

```bash
curl 'http://localhost:8788/api/collections/directory?with=relation_schemas' \
  -H 'Authorization: Bearer dev-token'
# → { "data": { ...schema, "related_schemas": {
#       "departments":   { ...full schema row... },
#       "designations":  { ...full schema row... } } } }
```

Each bundled value is the EXACT object a direct `GET /api/collections/:slug`
returns (same keys, parsed `schema_json`, `id → user → system` field order), so a
client can cache it under the target's own key with no drift. Targets are
deduplicated, the collection itself is excluded, and a dangling/deleted target is
skipped rather than failing the read. Without the parameter the key is absent —
the bundle costs one batched read and is only paid when asked for.

**Why:** a table/board UI resolves each relation column's display leaf (the field
a nested filter targets, and the type its filter UI uses) from the related schema.
Bundling replaces one request per relation with zero extra round trips.

### Update Collection Schema

`PUT /api/collections/:slug`

```bash
curl -X PUT http://localhost:8788/api/collections/products \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{
    "fields": [
      {"name": "title", "type": "text", "required": true},
      {"name": "price", "type": "currency"},
      {"name": "stock_qty", "type": "integer", "index": true}
    ],
    "description": "Updated product catalog"
  }'
```

This triggers the EntityMigrator, which keeps the physical D1 table in sync with `schema_json` (send the **full** field list — schema updates replace it):

- new fields → `ADD COLUMN` (stored `formula` fields typed by `result_type`)
- removed fields → `DROP COLUMN` (their indexes are dropped first)
- `index`/`unique` toggles → `CREATE`/`DROP INDEX`, `CREATE UNIQUE INDEX`
- `composite_indexes` changes → composite `CREATE`/`DROP INDEX`
- column **type** or **`required`** (nullability) changes → full **table rebuild**:
  surviving data is copied and engine/composite indexes recreated atomically

`unique` is **soft-delete-aware**: it is enforced by a partial index —
`uidx_<table>_<col>` … `WHERE deleted_at IS NULL`, the same rule the engine's
uniqueness pre-check and every read use. Only LIVE rows count, so a
soft-deleted record does not squat its value; restoring a row that would
collide with a live duplicate is rejected with **400** `VALIDATION_ERROR`.

A DDL failure (e.g. a new `unique` flag over duplicate values) returns **400** and leaves `schema_json` untouched — schema and table never silently diverge. Field renames are a delete + add (no stable field identity), so the old column's data is dropped.

### Delete Collection

`DELETE /api/collections/:slug` — drops the data table and removes registration.

---

## Item CRUD

### Create Item

`POST /api/entities/:collection`

```bash
curl -X POST http://localhost:8788/api/entities/products \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"title": "Widget", "price": 9.99, "status": "active"}'
```

**Response `201`:**

```json
{
	"success": true,
	"data": {
		"id": "545a77f8-...",
		"title": "Widget",
		"price": 9.99,
		"status": "active",
		"doc_status": "draft",
		"display_number": null,
		"_owner": "00000000-...",
		"created_at": "2026-07-31T03:54:11.746Z",
		"updated_at": "2026-07-31T03:54:11.746Z"
	}
}
```

**Errors:** `400` with `VALIDATION_ERROR` when required fields missing.

**Idempotent creates (client-supplied `id`):** pass a UUID `id` in the body to make `POST` replay-safe. A retry with the same `id` returns the **existing record** instead of creating a duplicate (handles network-timeout → resubmit). An `id` already in the trash returns `400`. HTTP clients usually prefer the `Idempotency-Key` header instead — see [Idempotency & Concurrency](#idempotency--concurrency).

```bash
# First call creates, a retry with the same id returns the same record
curl -X POST http://localhost:8788/api/entities/products \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"id": "9ef87bbe-4023-4e1c-8f2d-6a9b0c1d2e3f", "title": "Widget"}'
```

### List Items

`GET /api/entities/:collection`

**Query parameters:**

| Param                | Example                       | Description                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filter[field][_op]` | `filter[status][_eq]=active`  | Filter (see ops below)                                                                                                                                                                                                                                                                                                        |
| `sort`               | `-created_at`                 | Sort (prefix `-` = desc)                                                                                                                                                                                                                                                                                                      |
| `limit`              | `25`                          | Page size (default 25, max 100 — the enterprise contract). The values live in `@mmbix/config` (env-overridable via `API_DEFAULT_LIMIT` / `API_MAX_LIMIT`), are exposed via `GET /api/meta`, and the `@mmbix/sdk` mirrors + discovers them (`client.loadLimits()`). Every endpoint clamps — a client can never exceed the max. |
| `cursor`             | `<next_cursor>`               | **Cursor-based pagination** — pass the `next_cursor` from the previous page. O(log n) indexed seek, stable under concurrent inserts (unlike `offset`).                                                                                                                                                                        |
| `dir`                | `before`                      | Direction — omit for next page, `before` to walk backwards using `prev_cursor`.                                                                                                                                                                                                                                               |
| `fields`             | `id,title` or `category.name` | **Directus-style field projection** — see [Field Selection](#field-selection-directus-style) below. Lean by default: relations are NOT expanded AND their FK keys are hidden unless requested                                                                                                                                 |
| `trashed`            | `true`                        | Include soft-deleted items                                                                                                                                                                                                                                                                                                    |
| `search`             | `widget`                      | Text search within collection                                                                                                                                                                                                                                                                                                 |
| `aggregate`          | `sum=price`                   | Aggregation query                                                                                                                                                                                                                                                                                                             |

**Field Selection (Directus-style):**

Reads are **lean by default** — with no `?fields=` the response carries the record's **own data only**. Relation keys are **opt-in**: an m2o field does NOT come back as a scalar FK id (nor does its expanded object) unless you name it in `?fields=`. The system user-reference columns `_owner` / `created_by` / `updated_by` / `deleted_by` follow the same rule. The bare `*` wildcard obeys the SAME rule — `fields=*` returns the record's own data columns (+ virtual formulas), never relation keys: a relation must be named explicitly (`*,department` / `*,superiors.*`) or pulled in via `*.*`. Virtual fields (o2m/m2m/m2a/child-table, plus **virtual** formulas) are omitted entirely. `boolean` fields are returned as real `true`/`false` (not the stored `1`/`0`). This keeps payloads small, fast, and free of internal db keys.

> **Computed fields:** virtual `formula` fields are computed on read and appear with `*` or when named in `?fields=` — a named virtual formula **auto-selects its source columns** (`?fields=total` also fetches `qty`/`rate`) and chained formulas evaluate in dependency order. **Stored** formulas (`store: true`) are real columns — they behave like any other physical column (present by default, and **filterable/sortable/aggregatable**). Debug: `?formula_trace=true` attaches `_formula_trace` per row.

| `?fields=` value                | Result                                                                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| _(omitted)_                     | The record's own scalar columns only — relations keys (m2o/m2a FK columns) and `_owner`/`created_by`/`updated_by`/`deleted_by` are hidden (opt-in)                                                                                         |
| `*`                             | The record's own scalar columns + virtual computed **formula** fields — relation FKs and `_owner`/`created_by`/`updated_by`/`deleted_by` stay opt-in (name them: `*,department`, `*,created_by`; `*.*` expands every first-level relation) |
| `id,title,price`                | Only those columns (system `id`/`_meta`/`created_at`/`updated_at` always included)                                                                                                                                                         |
| `*, -password`                  | All columns **except** `password` (exclusion, minus prefix)                                                                                                                                                                                |
| `category`                      | m2o `category` expanded with **all** its columns (object)                                                                                                                                                                                  |
| `category.name`                 | m2o pruned to `{ "id", "name" }` — only the requested field                                                                                                                                                                                |
| `category.*`                    | m2o with every column of the related row                                                                                                                                                                                                   |
| `articles.title,articles.price` | o2m array pruned to `[{ "id", "title", "price" }]`                                                                                                                                                                                         |
| `*.*`                           | Every data column + all **first-level** relations expanded (all their columns) — root audit/user columns stay opt-in                                                                                                                       |
| `*.*.*`                         | Two levels deep (relations inside relations) — root audit/user columns stay opt-in                                                                                                                                                         |
| `orders.items.product.name`     | Deep multi-hop path — each step must be a relation, the last a column                                                                                                                                                                      |
| `-category.internal_note`       | Exclude a field inside an expanded relation                                                                                                                                                                                                |
| `created_by,_owner`             | Named system/user-reference columns are returned as scalar values                                                                                                                                                                          |

```bash
# Lean default — no relation keys, no user/audit columns, booleans are real booleans
curl "http://localhost:8788/api/entities/products" -H 'Authorization: Bearer dev-token'
# → { "id": "…", "title": "Widget", "price": 9.99, "in_stock": true }

# Ask for the related object
curl "http://localhost:8788/api/entities/products?fields=category.name,title" \
  -H 'Authorization: Bearer dev-token'
# → { "id": "…", "title": "Widget", "category": { "id": "…", "name": "Gadgets" } }

# Include a relation with ALL of its data (or category.* — identical)
curl "http://localhost:8788/api/entities/products?fields=category" -H 'Authorization: Bearer dev-token'
# → { "id": "…", "title": "Widget", "category": { "id": "…", "name": "Gadgets", "created_at": "…" } }

# Everything: all columns + all first-level relations
curl "http://localhost:8788/api/entities/products?fields=*.*" -H 'Authorization: Bearer dev-token'

# Everything except a sensitive field
curl "http://localhost:8788/api/entities/users?fields=*,-password" -H 'Authorization: Bearer dev-token'
```

**Rules:**

- An expanded relation object always includes `id` plus the requested columns (or all columns for `*` / bare-name forms).
- Unknown field names are ignored (never a 500); unknown dotted paths resolve to nothing.
- The schema-level `list_fields` projection still applies when `?fields=` is omitted (leaner SELECT), and relation names inside it are expanded the same way.
- **A selection is capped at `MAX_FIELD_SELECTIONS` (100) flat comma-separated entries**, counted before parsing (`*` included) — a larger list is rejected with `VALIDATION_ERROR`. The ceiling is shared from `@mmbix/types` (not hardcoded per caller) so a client that BUILDS a projection can stay legal by construction: the Studio's table projection spends the same budget, and a relation-heavy collection (`serial_events` — 6 m2o fields × ~18 entries) previously tripped it and blanked the whole table read.
- **Detail reads** (`GET /:collection/:id`, tRPC `entity.get`) accept the **same** `?fields=` syntax with identical semantics — one consistent behavior everywhere.
- There is no legacy mode: list and detail reads share one standard behavior.

**Filter operators:** `_eq`, `_neq`, `_gt`, `_gte`, `_lt`, `_lte`, `_contains`, `_icontains`, `_ncontains`, `_startswith`, `_endswith`, `_in`, `_nin`, `_null`, `_nnull`, `_between`, `_empty`, `_nempty`

| Operator             | SQL                       | Example                          | Description                    |
| -------------------- | ------------------------- | -------------------------------- | ------------------------------ |
| `_eq`                | `=`                       | `filter[status][_eq]=active`     | Equal                          |
| `_neq`               | `!=`                      | `filter[status][_neq]=deleted`   | Not equal                      |
| `_gt` / `_gte`       | `>` / `>=`                | `filter[price][_gt]=5`           | Greater than (or equal)        |
| `_lt` / `_lte`       | `<` / `<=`                | `filter[price][_lte]=100`        | Less than (or equal)           |
| `_contains`          | `LIKE %v%`                | `filter[title][_contains]=foo`   | Case-sensitive contains        |
| `_icontains`         | `LIKE %v%`                | `filter[title][_icontains]=Foo`  | Case-insensitive contains      |
| `_ncontains`         | `NOT LIKE %v%`            | `filter[title][_ncontains]=foo`  | Does not contain               |
| `_startswith`        | `LIKE v%`                 | `filter[title][_startswith]=Foo` | Starts with                    |
| `_endswith`          | `LIKE %v`                 | `filter[title][_endswith]=foo`   | Ends with                      |
| `_in`                | `IN`                      | `filter[id][_in]=a,b,c`          | In a comma-separated list      |
| `_nin`               | `NOT IN`                  | `filter[id][_nin]=a,b`           | Not in a list                  |
| `_null` / `_nnull`   | `IS NULL` / `IS NOT NULL` | `filter[deleted_at][_null]=true` | Is / is not NULL               |
| `_between`           | `BETWEEN`                 | `filter[price][_between]=5,100`  | Within range (comma-separated) |
| `_empty` / `_nempty` | `= ''` / `!= ''`          | `filter[slug][_empty]=true`      | Empty / non-empty string       |

**Logical groups** — combine conditions with `_and` / `_or` arrays:

```bash
# OR: status is draft OR featured
curl "http://localhost:8788/api/entities/posts?filter%5B_or%5D%5B0%5D%5Bstatus%5D%5B_eq%5D=draft&filter%5B_or%5D%5B1%5D%5Bfeatured%5D%5B_eq%5D=true" \
  -H 'Authorization: Bearer dev-token'

# AND group with nested relation: category name contains "Tech"
curl "http://localhost:8788/api/entities/posts?filter%5B_and%5D%5B0%5D%5Bcategory%5D%5Bname%5D%5B_icontains%5D=Tech&filter%5B_and%5D%5B1%5D%5Bstatus%5D%5B_eq%5D=published" \
  -H 'Authorization: Bearer dev-token'
```

```bash
# Filter by status
curl "http://localhost:8788/api/entities/products?filter%5Bstatus%5D%5B_eq%5D=active" \
  -H 'Authorization: Bearer dev-token'

# Filter by price range
curl "http://localhost:8788/api/entities/products?filter%5Bprice%5D%5B_gt%5D=5&filter%5Bprice%5D%5B_lt%5D=100" \
  -H 'Authorization: Bearer dev-token'
```

**Response meta:**

```json
{
	"meta": {
		"limit": 20,
		"has_more": true,
		"next_cursor": "9ef87bbe-4023-4...",
		"prev_cursor": "a1b2c3d4-..."
	}
}
```

- `has_more` — `true` when another page exists
- `next_cursor` — pass as `?cursor=` to fetch the next page
- `prev_cursor` — pass as `?cursor=&dir=before` to fetch the previous page

**Cursor pagination examples:**

```bash
# Page 1 (default sort: id DESC, cursor = bare item id; page size default 25, max 100)
curl "http://localhost:8788/api/entities/products?limit=25" -H 'Authorization: Bearer dev-token'

# Page 2 — use next_cursor from page 1
curl "http://localhost:8788/api/entities/products?limit=25&cursor=9ef87bbe-4023-4..." \
  -H 'Authorization: Bearer dev-token'

# Back to page 1
curl "http://localhost:8788/api/entities/products?limit=25&cursor=a1b2c3d4-...&dir=before" \
  -H 'Authorization: Bearer dev-token'
```

> **Custom sort + pagination:** with a `sort=` parameter the cursor is a **composite keyset** over `(sort fields..., id)` (base64 JSON), so pages stay correct under inserts and non-id orderings. Just pass `meta.next_cursor` / `meta.prev_cursor` unchanged. NULL sort values are not emitted on later pages (SQLite row-value comparison).

### Nested Relation Filters & Sorts (M2O)

Filter or sort by fields on a related collection using **dot notation** (multi-hop supported):

```bash
# Products whose category name is "Gadgets"
curl "http://localhost:8788/api/entities/products?filter%5Bcategory.name%5D%5B_eq%5D=Gadgets" \
  -H 'Authorization: Bearer dev-token'

# Multi-hop: orders whose customer's country is "Myanmar"
curl "http://localhost:8788/api/entities/orders?filter%5Bcustomer.country.name%5D%5B_eq%5D=Myanmar" \
  -H 'Authorization: Bearer dev-token'

# Sort by a related field (ascending), or prefix - for descending
curl "http://localhost:8788/api/entities/products?sort=category.name" -H 'Authorization: Bearer dev-token'
curl "http://localhost:8788/api/entities/orders?sort=-customer.country.name" -H 'Authorization: Bearer dev-token'
```

Every filter operator listed above works inside nested filters (e.g. `filter[category.name][_icontains]=Tech`). Nested conditions are translated to `IN` subqueries and invalid paths return `400`.

### Aggregations & Grouping

`GET /api/entities/:collection?aggregate[op]=field` returns a single aggregate row. All list filters (plain, function, and **nested relation filters**) apply — an aggregate count always equals the list `count=true` total for the same query.

| Param           | Example                | Description                                                                        |
| --------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| `aggregate[op]` | `aggregate[sum]=price` | `count`, `count_distinct`, `sum`, `avg`, `min`, `max` (repeatable)                 |
| `groupBy[]`     | `groupBy[]=status`     | Group by a column — plain field or `month(col)` / `year(col)` / `date(col)` bucket |
| `count=true`    | `count=true`           | Include the total row count in `meta.total` (KPI widgets)                          |

```bash
# Total rows (single-row shape: { count_all: 42 })
curl "http://localhost:8788/api/entities/products?aggregate%5Bcount%5D=*" -H 'Authorization: Bearer dev-token'

# Sum of price grouped by status
curl "http://localhost:8788/api/entities/products?aggregate%5Bsum%5D=price&groupBy%5B%5D=status" -H 'Authorization: Bearer dev-token'

# Monthly count (chart widgets) — bucket keys are UTC via strftime
curl "http://localhost:8788/api/entities/orders?aggregate%5Bcount%5D=*&groupBy%5B%5D=month(created_at)" -H 'Authorization: Bearer dev-token'

# Nested filter narrows the aggregate exactly like the list count
curl "http://localhost:8788/api/entities/products?filter%5Bcategory.name%5D%5B_eq%5D=Gadgets&aggregate%5Bcount%5D=*" -H 'Authorization: Bearer dev-token'
```

`groupBy[]` returns one row per group with the bucket column aliased (`month_created_at`, `year_created_at`, `date_created_at` for functions; the plain field name otherwise). Invalid group-by entries (unknown functions, virtual/non-schema fields) are ignored.

A grouped aggregate is **not page-limited** — `?limit=` does not apply, because a chart needs every bucket. It carries its own ceiling instead: at most **`data.aggregate.max_groups`** buckets per response (advertised by `GET /api/meta`, currently 5 000). The engine probes one bucket past the ceiling and fails with a `400 VALIDATION_ERROR` rather than truncate — so a runaway `groupBy[]=id` is a loud error that tells you to narrow the query, never a silently short chart.

### Get Item

`GET /api/entities/:collection/:id` — returns item with relations resolved (M2O expanded, O2M/M2M/M2A attached).

### Update Item

`PUT /api/entities/:collection/:id` — send only the fields to change.

```bash
curl -X PUT http://localhost:8788/api/entities/products/<id> \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"price": 12.50}'
```

#### Optimistic concurrency (`If-Match`)

Echo the `updated_at` you loaded in the `If-Match` header. If the record moved
on since (another user edited it), the write is rejected with **`409 Conflict`**
instead of silently clobbering their changes — reload the record and re-apply.
Without the header the write proceeds as before (last-write-wins).

```bash
# Capture the loaded row's updated_at, then save
UPDATED_AT=$(curl -s .../entities/products/<id> -H 'Authorization: Bearer dev-token' | jq -r .data.updated_at)
curl -X PUT http://localhost:8788/api/entities/products/<id> \
  -H "If-Match: $UPDATED_AT" -H 'Content-Type: application/json' \
  -d '{"price": 12.50}'
# → 200 on fresh write · 409 CONFLICT on a stale write
```

#### Rich text sanitization

`text_editor` and `markdown` field values are HTML-sanitized at the write
boundary (create **and** update): scripts, event handlers, `javascript:` URLs
and non-allowlisted tags are stripped, so stored rich text can never carry
executable markup. Safe formatting (p/h2/strong/em/u/lists/links/tables) is kept.

### Soft Delete

`DELETE /api/entities/:collection/:id` — sets `deleted_at`/`deleted_by`. Items excluded from list by default.

**Referential guard (409):** the delete is refused with `409 CONFLICT` when any
live row still references this one through an m2o field that explicitly declares
`cascade_delete: false` (RESTRICT). The error names the blocking collection(s),
e.g. `Cannot delete this record — it is still referenced by 3 record(s) in "MRO Item Model".`
Relations with no flag stay permissive, and `cascade_delete: true` cascades instead
— see [Cascade Delete vs RESTRICT](../concepts/relations.md#cascade-delete-vs-restrict-m2o).
The admin-only `/force` hard delete bypasses the guard.

### Restore

`POST /api/entities/:collection/:id/restore` — clears `deleted_at`.

### Hard Delete

`DELETE /api/entities/:collection/:id/force` — permanently removes the row. Admin only.

---

## Idempotency & Concurrency

Three independent layers protect retryable writes from duplicates and stale
overwrites — they compose freely (you can use all three at once).

### 1. `Idempotency-Key` header (Stripe-style)

Send the same key on a retryable write and the API replays the **stored response**
of the first attempt instead of executing the write a second time — the classic
network-timeout → resubmit case (Workers/fetch auto-retry). Supported on:

| Endpoint                                       | Permission | Stored status |
| ---------------------------------------------- | ---------- | ------------- |
| `POST /api/entities` (create collection)       | admin      | `201`         |
| `POST /api/entities/:collection` (create item) | create     | `201`         |
| `POST /api/entities/:collection/import`        | create     | `200`         |
| `POST /api/bulk/:collection` (bulk ops)        | create     | `200`         |
| Module item create (`POST /api/modules/...`)   | —          | `201`         |

Semantics:

- **Key scope:** composite `METHOD:path:key` — the same key on a different
  endpoint can never replay the wrong response.
- **First write wins:** `INSERT ... ON CONFLICT DO NOTHING` — racing retries
  store exactly one response; every later retry replays it.
- **Only success is stored:** a failed request is never replayed — the retry
  re-runs the operation.
- **TTL:** stored responses expire after **24 hours** (pruned lazily on lookup).
- **Shape:** any string up to 200 chars (commonly a UUID).

```bash
curl -X POST http://localhost:8788/api/entities/products \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 9ef87bbe-4023-4e1c-8f2d-6a9b0c1d2e3f' \
  -d '{"title": "Widget"}'
# Retry the identical request → same 201 body, no duplicate row
```

### 2. Client-supplied `id` (create replay)

Alternative for item creates: put a UUID `id` in the body (see
[Create Item](#create-item)). The insert uses that id as the primary key, so a
retry finds the existing row and returns it — no header needed, and the `id`
doubles as a deterministic client-chosen key. The two mechanisms compose: the
body `id` still wins as the row key when both are present.

### 3. `If-Match` (optimistic concurrency)

Echo the loaded `updated_at` on `PUT /api/entities/:collection/:id` — if the
record moved on, the write gets **`409 Conflict`** instead of silently
clobbering another user's edit. See [Update Item](#update-item).

---

## Date/Time Functions

Filter values can use date functions:

```bash
# Items created this year
curl "http://localhost:8788/api/entities/products?filter%5Bcreated_at%5D%5B_year%5D=2026" \
  -H 'Authorization: Bearer dev-token'

# Items created in a specific month
curl "http://localhost:8788/api/entities/products?filter%5Bcreated_at%5D%5B_month%5D=7" \
  -H 'Authorization: Bearer dev-token'
```

Supported: `_year`, `_month`, `_day`, `_hour`, `_strftime`.

---

## Permissions

| Action   | Route Guard                            | Non-Admin Behavior       |
| -------- | -------------------------------------- | ------------------------ |
| `read`   | `businessGuard('collection','read')`   | 403 without `can_read`   |
| `create` | `businessGuard('collection','create')` | 403 without `can_create` |
| `write`  | `businessGuard('collection','write')`  | 403 without `can_write`  |
| `delete` | `businessGuard('collection','delete')` | 403 without `can_delete` |

Admins bypass all checks. Additionally, row filters and field restrictions apply to non-admin reads (see [Users, Roles & Permissions](users-roles-permissions.md)).
