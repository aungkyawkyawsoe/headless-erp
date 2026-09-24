# Bulk Operations

## Bulk Create / Update / Delete

`POST /api/bulk/:collection`

Rate limited to 10 req/min.

**Request body:**

```json
{
	"action": "create",
	"items": [
		{ "title": "Item A", "price": 5 },
		{ "title": "Item B", "price": 15 }
	]
}
```

`action` is one of: `create` | `update` | `delete`.

### Create

```bash
curl -X POST http://localhost:8788/api/bulk/products \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"action": "create", "items": [{"title": "Item A"}, {"title": "Item B"}]}'
```

**Response `200`:**

```json
{
	"success": true,
	"data": {
		"action": "create",
		"processed": 2,
		"results": [
			{ "id": "1343ffa5-...", "status": "created" },
			{ "id": "627d6768-...", "status": "created" }
		]
	}
}
```

### Update

Each item needs an `id`:

```json
{
	"action": "update",
	"items": [{ "id": "<id>", "price": 20 }]
}
```

### Delete

Items can be an ID string or `{id}`:

```json
{ "action": "delete", "items": ["<id-1>", "<id-2>"] }
```

## Permissions

| Action   | Required Permission        |
| -------- | -------------------------- |
| `create` | `can_create` on collection |
| `update` | `can_write` on collection  |
| `delete` | `can_delete` on collection |

Admins bypass the check. Failures per item are captured in the results array without aborting the batch.

---

## Bulk Status Transition

`POST /api/entities/:collection/bulk/transition`

Move many records to a new `doc_status` in one call. Requires `can_write`.

```bash
curl -X POST http://localhost:8788/api/entities/invoices/bulk/transition \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"ids": ["<id-1>", "<id-2>"], "to_status": "approved"}'
```

**Response:**

```json
{
	"success": true,
	"data": {
		"total": 2,
		"succeeded": 2,
		"failed": 0,
		"results": [{ "id": "<id-1>", "status": "updated" }]
	}
}
```

**Errors:**

| Status | When                               |
| ------ | ---------------------------------- |
| 400    | Missing `ids` array or `to_status` |
| 403    | No write permission on collection  |
