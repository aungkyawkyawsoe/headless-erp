# HR Tasks + Follow-up

Asana/OmniFocus-style task tracking for the Telegram Mini App. Tasks are
assigned to employees via their `tg_id`, tracked through `todo →
in_progress → done`, and followed up on with **Telegram bot push** reminders
(due-soon / overdue) plus instant "done ✅" notifications to the assigner.

## Collection

Seeded by `apps/api/scripts/seed-hr-module.mjs` (idempotent; re-run anytime).

### `hr_tasks` — standalone tasks (no meeting relation)

| Field              | Type     | Notes                                            |
| ------------------ | -------- | ------------------------------------------------ |
| `title`            | text     | required                                         |
| `description`      | longtext |                                                  |
| `assignee_tg_id`   | text     | responsible employee (`hr_employees.tg_id`)      |
| `created_by_tg_id` | text     | assigner                                         |
| `status`           | select   | `todo` / `in_progress` / `done` (default `todo`) |
| `priority`         | select   | `low` / `medium` / `high` (default `medium`)     |
| `due_date`         | date     | indexed                                          |
| `completed_at`     | datetime | set when the task completes                      |

> **Permissions:** the seed provisions the Employee (Telegram) role's
> `_role_permissions` rows for all `hr_*` collections up-front via
> `POST /api/users/permissions` (idempotent). Login-time provisioning
> (`POST /api/auth/telegram`) covers collections created later.

## Endpoints

All under `/api/*` — require `Authorization: Bearer <token>`.

| Method       | Path                         | Who      | Description                                      |
| ------------ | ---------------------------- | -------- | ------------------------------------------------ |
| GET/POST/PUT | `/api/entities/hr_tasks`     | Employee | Generic collection CRUD (create/edit tasks)      |
| POST         | `/api/hr/tasks/:id/complete` | Employee | **The sanctioned "done" transition** (see below) |
| POST         | `/api/hr/tasks/digest`       | admin    | Manual digest trigger (testing / ops)            |

### `POST /api/hr/tasks/:id/complete`

1. Loads the task — 404 if missing.
2. Only the **assignee** or the **assigner** may complete — anyone else gets `403`.
3. Sets `status = done` + `completed_at`, then notifies the assigner instantly:
   in-app `hr_notifications` row (durable) + Telegram push ("✅ …ပြီးပြီ") —
   unless the assigner completed it themselves.
4. **Idempotent:** completing an already-done task returns
   `{ status: 'done', alreadyDone: true }` without re-notifying.

Actor identity is resolved from the Telegram JWT (`tg-<id>@telegram.local`);
admins may pass `{ "actorTgId": "<id>" }` in the body (tests/ops).

```bash
curl -X POST http://localhost:8788/api/hr/tasks/<task-id>/complete \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"actorTgId": "3"}'
# → { "success": true, "data": { "taskId": "...", "status": "done", "notifiedTgId": "2" } }
```

## Daily follow-up digest (cron)

`30 8 * * *` (08:30, `wrangler.jsonc` → `triggers.crons`). The scheduled
handler runs `runTaskDigest` (only on the 08:30 trigger — never the 02:00
backup cron):

- Scans non-done tasks with `due_date` **≤ today + 2** (due-soon) or **< today**
  (overdue).
- Groups by assignee → one in-app `hr_notifications` row (type `reminder`) +
  one Telegram push per assignee.
- **Deduped per task per MMT day** — re-running the same day is a no-op; still
  open tasks get re-reminded the next morning.
- Telegram push is best-effort: missing `TELEGRAM_BOT_TOKEN` (local dev) or a
  bot error logs and skips — the in-app notification is always written.

```bash
# Manual trigger (admin)
curl -X POST http://localhost:8788/api/hr/tasks/digest \
  -H 'Authorization: Bearer dev-token'
# → { "success": true, "data": { "tasks": 5, "assignees": 3, "reminders": 3, ... } }
```

## Config

| Env                  | Purpose                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN` | Bot token for push. Private DM `chat_id` == `tg_id`, so no extra capture needed. Missing → in-app only. |

## Tests

`apps/api/test/hr-tasks.spec.ts` — collection CRUD, complete-route
authorization + assigner notification + idempotency, digest reminder creation

- same-day dedupe. E2E: `node apps/api/scripts/verify-hr.mjs` (task steps
  included).
