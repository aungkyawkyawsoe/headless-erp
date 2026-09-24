# Saved Views (v0.7)

Save filter/sort/column presets as named views. Users can share views publicly or keep them private.

## Endpoints

| Method | Path                     | Description                 |
| ------ | ------------------------ | --------------------------- |
| POST   | `/api/views`             | Create a view               |
| GET    | `/api/views/:collection` | List views for a collection |
| GET    | `/api/views/detail/:id`  | Get a single view           |
| PUT    | `/api/views/:id`         | Update a view (owner only)  |
| DELETE | `/api/views/:id`         | Delete a view (owner only)  |

All routes require authentication.

## Create a View

`POST /api/views`

```bash
curl -X POST http://localhost:8788/api/views \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{
    "collection_slug": "products",
    "name": "High Price",
    "config": {
      "filter": [{"field": "price", "op": "gt", "value": 10}],
      "sort": "-price",
      "columns": ["id", "title", "price"],
      "pageSize": 25
    },
    "visibility": "private"
  }'
```

**Request fields:**

| Field             | Required | Description                     |
| ----------------- | -------- | ------------------------------- |
| `collection_slug` | ✅       | Target collection               |
| `name`            | ✅       | View name                       |
| `config`          | ✅       | View configuration (below)      |
| `visibility`      | ❌       | `private` (default) or `public` |

**`config` fields:**

| Field       | Type    | Description                                |
| ----------- | ------- | ------------------------------------------ |
| `filter`    | array   | `[{field, op, value}]` — filter conditions |
| `sort`      | string  | `"price"` or `"-price"`                    |
| `columns`   | array   | Field names to display                     |
| `pageSize`  | number  | Items per page                             |
| `isDefault` | boolean | Mark as the user's default view            |

**Response `201`:**

```json
{
	"success": true,
	"data": {
		"id": "3f109d5c-...",
		"collection_slug": "products",
		"name": "High Price",
		"user_id": "00000000-...",
		"visibility": "private",
		"config": { "filter": [{ "field": "price", "op": "gt", "value": 10 }], "sort": "-price", "pageSize": 25 },
		"created_at": "2026-07-31T03:58:16.733Z"
	}
}
```

## List Views for a Collection

`GET /api/views/:collection` — returns the user's own views + public views.

```bash
curl http://localhost:8788/api/views/products -H 'Authorization: Bearer dev-token'
```

## Get / Update / Delete

```bash
# Get one
curl http://localhost:8788/api/views/detail/<view-id> -H 'Authorization: Bearer dev-token'

# Update (owner only)
curl -X PUT http://localhost:8788/api/views/<view-id> \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"name": "Renamed", "config": {"sort": "price"}}'

# Delete (owner only)
curl -X DELETE http://localhost:8788/api/views/<view-id> -H 'Authorization: Bearer dev-token'
```

**Errors:**

| Status | When                                          |
| ------ | --------------------------------------------- |
| 400    | Missing `collection_slug` / `name` / `config` |
| 404    | View not found, or not the owner              |

## Usage Pattern

1. Frontend saves the user's current filter/sort state as a view
2. On load, fetch `GET /api/views/:collection` and let the user pick
3. Apply the view by converting `config.filter` to query params on `GET /api/entities/:collection`

## Multiple Defaults

Setting `isDefault: true` on a new/updated view automatically unsets other defaults for the same user + collection.
