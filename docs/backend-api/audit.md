# Audit Trail

Tracks who changed what and when. Every create/update/delete/status-change is logged with before/after snapshots.

## Endpoints

| Method | Path                              | Description                         |
| ------ | --------------------------------- | ----------------------------------- |
| GET    | `/api/audit/:collection/:id`      | Full history with snapshots         |
| GET    | `/api/audit/:collection/:id/diff` | Structured diff between two entries |

Requires `read` permission on the collection.

## Get Document History

`GET /api/audit/:collection/:id`

```bash
curl http://localhost:8788/api/audit/products/<id> -H 'Authorization: Bearer dev-token'
```

**Response:**

```json
{
	"success": true,
	"data": [
		{
			"id": "bd1774c3-...",
			"collection_slug": "products",
			"document_id": "545a77f8-...",
			"action": "create",
			"user_id": "00000000-...",
			"changes": {
				"snapshot_before": null,
				"snapshot_after": { "id": "545a77f8-...", "title": "Widget", "price": 9.99 }
			},
			"timestamp": "2026-07-31T03:54:11.746Z"
		}
	]
}
```

Entries are ordered oldest → newest.

## Diff Between Two Versions

`GET /api/audit/:collection/:id/diff?from=<entryId>&to=<entryId>`

```bash
curl "http://localhost:8788/api/audit/products/<id>/diff?from=<old-entry>&to=<new-entry>" \
  -H 'Authorization: Bearer dev-token'
```

**Response:**

```json
{
	"success": true,
	"data": {
		"from": { "title": "Widget", "price": 9.99 },
		"to": { "title": "Widget", "price": 12.5 },
		"changes": [{ "field": "price", "from": 9.99, "to": 12.5 }]
	}
}
```

**Errors:**

| Status | When                                                                |
| ------ | ------------------------------------------------------------------- |
| 400    | Missing `from`/`to` params, or entries don't belong to the document |

## Audit Actions

| Action    | Meaning                    |
| --------- | -------------------------- |
| `create`  | Record created             |
| `update`  | Record updated             |
| `delete`  | Record soft-deleted        |
| `restore` | Record restored from trash |
| `submit`  | Status → `submitted`       |
| `approve` | Status → `approved`        |

## Service Methods (Programmatic)

The `AuditService` class also exposes v3 queries (available for internal use / plugins):

| Method                                  | Description                            |
| --------------------------------------- | -------------------------------------- |
| `findByFieldChange(collection, field)`  | Entries where a specific field changed |
| `findByUser(userId)`                    | All entries by a user                  |
| `findByDateRange(collection, from, to)` | Entries within a date range            |
| `globalSearch(q)`                       | Search across all audit entries        |
| `getChangeStats(collection, days)`      | Most-changed fields                    |

## Storage

- Table: `_audit_log`
- Writes are fire-and-forget (`waitUntil`) — they don't block the request
- Each entry stores JSON in `changes` with `snapshot_before`, `snapshot_after`, `fields`
