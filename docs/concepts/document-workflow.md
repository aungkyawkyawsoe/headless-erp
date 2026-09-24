# Document Workflow

Every collection has a `doc_status` field representing a document lifecycle.

## Status Values

| Status           | Description                          |
| ---------------- | ------------------------------------ |
| `draft`          | Initial state (default)              |
| `submitted`      | Submitted for review                 |
| `approved`       | Approved                             |
| `cancelled`      | Cancelled                            |
| `pending_review` | Waiting for review (approval plugin) |
| `rejected`       | Rejected (approval plugin)           |
| `approved_l{n}`  | Multi-level approval levels          |

## Valid Transitions

```
draft           → submitted | cancelled | pending_review
submitted       → approved  | cancelled
approved        → cancelled
cancelled       → draft     (reopen)
pending_review  → approved  | rejected | cancelled
rejected        → draft     | cancelled
```

## Changing Status

Set `doc_status` directly in an update:

```bash
curl -X PUT http://localhost:8788/api/entities/invoices/<id> \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"doc_status": "submitted"}'
```

## Status Permissions

Collection permissions support two extra actions:

| Permission    | Allows                     |
| ------------- | -------------------------- |
| `can_submit`  | Move status to `submitted` |
| `can_approve` | Move status to `approved`  |

Set via `POST /api/permissions`:

```json
{
	"role_id": "<role-id>",
	"collection_slug": "invoices",
	"can_read": true,
	"can_write": true,
	"can_create": true,
	"can_delete": false,
	"can_submit": true,
	"can_approve": false
}
```

## Bulk Status Transition

Move many records at once:

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
		"results": [
			{ "id": "<id-1>", "status": "updated" },
			{ "id": "<id-2>", "status": "updated" }
		]
	}
}
```

## Audit Trail

Every status change is recorded in the audit log with before/after snapshots:

```bash
curl http://localhost:8788/api/audit/invoices/<id> -H 'Authorization: Bearer dev-token'
```

## Multi-Level Approvals

With the approvals plugin enabled, `approved_l1`, `approved_l2`, etc. represent sequential approval levels. See the approvals plugin docs for configuration.
