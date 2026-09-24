# Export / Import

Export collection data as JSON or CSV. Import JSON or CSV to create records in bulk.

## Endpoints

| Method | Path                                 | Permission | Description              |
| ------ | ------------------------------------ | ---------- | ------------------------ |
| GET    | `/api/export/schema`                 | admin      | Export all schemas       |
| GET    | `/api/export/:collection`            | read       | Export collection data   |
| POST   | `/api/export/:collection/import`     | create     | Import JSON              |
| POST   | `/api/export/:collection/import/csv` | create     | Import CSV (file upload) |

## Export Collection

`GET /api/export/:collection`

### JSON (default)

```bash
curl "http://localhost:8788/api/export/products?format=json" -H 'Authorization: Bearer dev-token'
```

### CSV

```bash
curl "http://localhost:8788/api/export/products?format=csv" -H 'Authorization: Bearer dev-token'
```

Returns a `text/csv` download with `Content-Disposition: attachment`.

### Query Parameters

| Param                | Default | Description                                                                                                                                             |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`             | `json`  | `json` or `csv`                                                                                                                                         |
| `limit`              | 25      | Max rows — page-size policy (default 25, max 100, `@mmbix/config` → `GET /api/meta`); a bigger export is a cursor-walk job, never one oversized request |
| `fields`             | all     | Comma-separated fields to include                                                                                                                       |
| `trashed`            | `false` | Include soft-deleted rows                                                                                                                               |
| `sort`               | —       | Sort clauses, e.g. `-created_at,title`                                                                                                                  |
| `search`             | —       | Global term matched across text fields                                                                                                                  |
| `filter[field][_eq]` | —       | Exact-match filter — the same shape the entity list API accepts, so exports mirror the visible (tab-filtered) table                                     |

```bash
# CSV mirroring a tab-filtered list (e.g. pending maintenance jobs)
curl "http://localhost:8788/api/export/vehicle_maintenance?format=csv&sort=-maintenance_date&filter[status][_eq]=pending" \
  -H 'Authorization: Bearer dev-token'
```

## Export Schema (Admin)

`GET /api/export/schema` — all collection definitions as JSON (for backup/migration).

**Response `200`:** `{ success: true, data: [...] }` — one entry per collection. JSON-encoded
columns (`schema_json`, `system_field_options`) are returned **parsed as nested objects**,
not escaped strings:

```json
{
	"success": true,
	"data": [
		{
			"id": "...",
			"name": "Products",
			"slug": "products",
			"table_name": "cms_products",
			"schema_json": {
				"fields": [{ "name": "title", "type": "text", "required": true }],
				"audit_enabled": true
			},
			"system_field_options": { "deleted_at": true },
			"created_at": "...",
			"updated_at": "..."
		}
	]
}
```

## Import JSON

`POST /api/export/:collection/import`

```bash
curl -X POST http://localhost:8788/api/export/products/import \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{
    "format": "json",
    "data": [{"title": "Imported A", "price": 10}, {"title": "Imported B", "price": 20}]
  }'
```

| Field    | Default | Description                                     |
| -------- | ------- | ----------------------------------------------- |
| `format` | `json`  | Input format                                    |
| `data`   | —       | Array of records (or a JSON string of an array) |

> **Full pipeline:** this route delegates to the collection import pipeline
> (same as `POST /api/entities/:collection/import`) — every row runs linkage,
> defaults, validation, row-filter RBAC, audit and webhooks. A client-supplied
> `id` must be a valid UUID and is **idempotent**: re-importing an existing id
> returns the existing record instead of duplicating or overwriting it.

**Response `201`:** Import summary (`imported`, `skipped`, `errors`).

## Import CSV

`POST /api/export/:collection/import/csv` — multipart form with a `file` field.

```bash
curl -X POST http://localhost:8788/api/export/products/import/csv \
  -H 'Authorization: Bearer dev-token' \
  -F "file=@products.csv"
```

CSV must have a header row. Example:

```csv
title,price,status
Imported C,30,active
Imported D,40,archived
```

**Response `201`:**

```json
{
	"success": true,
	"data": {
		"imported": 2,
		"skipped": 0,
		"errors": [],
		"total_rows": 2,
		"sample": [{ "id": "...", "status": "imported", "row": 1 }]
	}
}
```

On partial failure: `partial: true` plus `imported_ids` for rollback.

## CSV Formatting Notes

- Every row runs the full collection import pipeline (validation, hooks, audit, webhooks)
- CSV cell values starting with `=`, `+`, `-`, `@` are prefixed with `'` on export (formula-injection protection)
