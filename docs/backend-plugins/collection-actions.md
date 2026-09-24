# Collection Actions (v0.7)

Define custom server-side actions on a collection — like buttons that run business logic. Actions are **declarative** (no arbitrary code), which keeps them safe and compatible with the Workers runtime.

## Example Schema

Add an `actions` block to the collection schema:

```json
{
  "name": "Invoices",
  "fields": [...],
  "actions": {
    "crud": {"create": true, "read": true, "update": true, "delete": true},
    "bulk": ["delete", "export", "transition"],
    "custom": [
      {
        "name": "mark_paid",
        "label": "Mark as Paid",
        "type": "single",
        "action": "update",
        "data": {"status": "paid"},
        "confirm": "Mark this invoice as paid?"
      },
      {
        "name": "archive",
        "label": "Archive Selected",
        "type": "bulk",
        "action": "update",
        "data": {"doc_status": "cancelled"}
      },
      {
        "name": "notify_customer",
        "label": "Notify Customer",
        "type": "single",
        "action": "webhook",
        "url": "https://hooks.example.com/invoice-notify"
      }
    ]
  }
}
```

## Action Fields

| Field        | Description                              |
| ------------ | ---------------------------------------- |
| `name`       | Action identifier (used in the URL)      |
| `label`      | Display label                            |
| `type`       | `single` (one record) or `bulk` (many)   |
| `action`     | `update` \| `delete` \| `webhook`        |
| `data`       | For `update`: the field values to set    |
| `url`        | For `webhook`: destination URL           |
| `confirm`    | Optional confirmation message for the UI |
| `permission` | `read` \| `write` \| `approve`           |

## Executing an Action

`POST /api/entities/:collection/action/:action`

```bash
curl -X POST http://localhost:8788/api/entities/invoices/action/mark_paid \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"ids": ["<invoice-id>"], "data": {"note": "Paid via API"}}'
```

**Response:**

```json
{
	"success": true,
	"data": {
		"action": "mark_paid",
		"processed": 1,
		"results": [{ "id": "<invoice-id>", "status": "updated" }]
	}
}
```

## Behavior

### `update`

- Merges the action's static `data` with per-request `data` (request wins)
- Updates each record via the full pipeline: **linkage rules, default resolution, expression validation, field encryption**
- Results reported per record

### `delete`

- Soft-deletes each record (respects permission + hooks)

### `webhook`

- Sends `POST` to the configured URL with:

```json
{
	"event": "action.mark_paid",
	"collection": "invoices",
	"ids": ["<invoice-id>"],
	"data": {},
	"timestamp": "2026-07-31T05:03:49.089Z"
}
```

## Errors

| Status | When                                                 |
| ------ | ---------------------------------------------------- |
| 400    | Webhook action without URL / unsupported action type |
| 404    | Action not found on collection                       |
| 403    | No write permission                                  |
| 500    | Action execution failed                              |

> **Why declarative?** The Workers runtime disallows `new Function()`/`eval` ("Code generation from strings disallowed"). Arbitrary JS handlers cannot run. Declarative actions are safer and work everywhere.
