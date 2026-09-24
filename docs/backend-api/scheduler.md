# Scheduler

Cron-based scheduled jobs. Jobs are stored in D1 and executed on demand via `POST /api/scheduler/run`.

## Endpoints

| Method | Path                 | Permission | Description          |
| ------ | -------------------- | ---------- | -------------------- |
| GET    | `/api/scheduler`     | admin      | List all jobs        |
| POST   | `/api/scheduler`     | admin      | Create a job         |
| PUT    | `/api/scheduler/:id` | admin      | Update a job         |
| DELETE | `/api/scheduler/:id` | admin      | Delete a job         |
| POST   | `/api/scheduler/run` | admin      | Run all due jobs now |

## Create a Job

`POST /api/scheduler`

```bash
curl -X POST http://localhost:8788/api/scheduler \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{
    "name": "Daily Report",
    "cron": "0 9 * * *",
    "action": "webhook",
    "collection_slug": "products",
    "config": {"url": "https://hooks.example.com/daily-report"},
    "description": "Send daily product report"
  }'
```

| Field             | Required | Description                               |
| ----------------- | -------- | ----------------------------------------- |
| `name`            | ✅       | Job name                                  |
| `cron`            | ✅       | Cron expression                           |
| `action`          | ✅       | Action type (e.g. `webhook`)              |
| `collection_slug` | ❌       | Target collection                         |
| `config`          | ❌       | Action-specific config (e.g. webhook URL) |
| `description`     | ❌       | Notes                                     |

## Run Due Jobs

`POST /api/scheduler/run` — executes all jobs whose cron schedule matches the current time.

```bash
curl -X POST http://localhost:8788/api/scheduler/run -H 'Authorization: Bearer dev-token'
```

> In production, trigger this endpoint from a Cloudflare Cron Trigger (see `wrangler.jsonc`), or an external cron service.

## Update / Delete

```bash
# Update
curl -X PUT http://localhost:8788/api/scheduler/<id> \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"cron": "0 18 * * *"}'

# Delete
curl -X DELETE http://localhost:8788/api/scheduler/<id> -H 'Authorization: Bearer dev-token'
```

## Errors

| Status | When           |
| ------ | -------------- |
| 403    | Non-admin user |
