# Quickstart

Get a **working, production-grade API + admin panel in under 5 minutes** —
configure the model, not the infrastructure (see [Use Cases](use-cases.md)).

## The zero-config path (recommended — Directus-style)

```bash
# 1. Scaffold a fresh project — answers D1 database name + admin email/name/password,
#    then writes them to apps/api/wrangler.jsonc and apps/api/.dev.vars automatically.
#    Run inside a fresh clone to initialize the current folder in place (or use a
#    name for a nested project):
headless init . --db-name my-saas-db --admin-email admin@my.co --admin-name "My Admin" --admin-password 'Strong#Pass1'

pnpm dev          # API :8788 · admin UI :5173
```

1. Open **http://localhost:5173** and log in with the credentials you chose.
2. Create a collection through the REST API (step 4 below) — it instantly
   appears in the **Content** tab as browsable CRUD pages
   (`/content/<slug>`: list → detail → create → edit).
3. Start POSTing — you now have a live CRUD API with auth, validation,
   filtering, search, pagination, audit, and media. Nothing else to configure.

> Prefer the repo as-is (skip scaffolding)? Follow the steps below directly:
> `pnpm install` → `npx wrangler dev` → log in as `dev@mmbics.com` /
> `dev-password-for-local-only` (dev only).

## 1. Install Dependencies

```bash
pnpm install
```

## 2. Run Locally

```bash
npx wrangler dev
```

The server starts at `http://localhost:8788`. In dev mode (`IS_DEV=true`), use `dev-token` for authentication.

## 3. Verify Health

```bash
curl http://localhost:8788/api/health
```

**Response:**

```json
{ "status": "ok", "version": "0.7.0", "timestamp": "2026-07-31T03:53:55.313Z" }
```

## 4. Create a Collection

```bash
curl -X POST http://localhost:8788/api/collections \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-token' \
  -d '{
    "name": "Products",
    "fields": [
      {"name": "title", "type": "text", "required": true},
      {"name": "price", "type": "currency"},
      {"name": "status", "type": "select", "options": ["active", "archived"], "default": "active"}
    ]
  }'
```

**Response:** `201` with the created collection, including `table_name: "cms_products"`.

## 5. Create Items

```bash
curl -X POST http://localhost:8788/api/entities/products \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-token' \
  -d '{"title": "Widget", "price": 9.99, "status": "active"}'
```

**Response:** `201` with the item. Note the auto-generated system fields: `doc_status: "draft"`, `created_at`, `_owner`.

## 6. List Items

```bash
curl "http://localhost:8788/api/entities/products" \
  -H 'Authorization: Bearer dev-token'
```

**Response:** `200` with `{ success: true, data: [...], meta: { limit, has_more, ... } }`.

## 7. Filter + Sort

```bash
# Filter: price > 5
curl "http://localhost:8788/api/entities/products?filter%5Bprice%5D%5B_gt%5D=5" \
  -H 'Authorization: Bearer dev-token'

# Sort: newest first
curl "http://localhost:8788/api/entities/products?sort=-created_at" \
  -H 'Authorization: Bearer dev-token'

# Paginate (cursor-based — O(log n) keyset seek, stable under inserts; page size default 25, max 100)
curl "http://localhost:8788/api/entities/products?limit=25" -H 'Authorization: Bearer dev-token'
# → meta.next_cursor → pass as ?cursor= for the next page
curl "http://localhost:8788/api/entities/products?limit=25&cursor=<next_cursor>" \
  -H 'Authorization: Bearer dev-token'
```

## 8. Get / Update / Delete

```bash
# Get single item (replace ID with one from your list)
curl "http://localhost:8788/api/entities/products/<id>" -H 'Authorization: Bearer dev-token'

# Update
curl -X PUT "http://localhost:8788/api/entities/products/<id>" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-token' \
  -d '{"price": 12.50}'

# Soft delete (moves to trash)
curl -X DELETE "http://localhost:8788/api/entities/products/<id>" \
  -H 'Authorization: Bearer dev-token'

# Restore
curl -X POST "http://localhost:8788/api/entities/products/<id>/restore" \
  -H 'Authorization: Bearer dev-token'

# Hard delete (admin only)
curl -X DELETE "http://localhost:8788/api/entities/products/<id>/force" \
  -H 'Authorization: Bearer dev-token'
```

## What's Next

- [Use Cases](use-cases.md) — who this is for and the power you get for free
- [Login with JWT](../backend-api/authentication.md) for production auth
- [Saved Views](../backend-api/views.md) to save filter presets
- [Field Linkage Rules](../backend-plugins/linkage-rules.md) for smart forms
- [Scalar API Reference](http://localhost:8788/api/docs) — interactive API docs

### What you already got (no extra config)

Creating a collection didn't just make a table — you also got:

| Capability                   | Where it is                                     |
| ---------------------------- | ----------------------------------------------- |
| JWT auth + RBAC              | `/api/auth` · roles/permissions on `/api/users` |
| Cursor pagination (O(log n)) | `?limit=` + `?cursor=` (meta.next_cursor)       |
| 15 filter operators          | `?filter[field][_gt]=5` · `_contains`, `_in`…   |
| Full-text search (FTS5)      | `?search=widget`                                |
| Validation (12 rules)        | declared on fields → enforced server-side       |
| Soft delete + restore        | `DELETE` → trash · `POST /:id/restore`          |
| Audit log                    | `/api/audit`                                    |
| Media (R2)                   | `/api/media` uploads                            |
| Admin UI forms + tables      | SPA at `:5173` — generated from the schema      |
