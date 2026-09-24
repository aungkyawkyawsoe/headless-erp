# Headless Scheduler — scheduled tasks for any use case

A **headless scheduler** on Cloudflare: schedule anything, from anywhere, for any
purpose — ERP/enterprise jobs, reminders, delayed emails, recurring syncs,
follow-up digests, scheduled publish, retry-with-backoff tasks. One reusable
engine, zero business logic baked in.

**Hybrid model:**

- **Handlers are code** — real functions registered in the worker
  (`registerHandler('meeting.remind', …)`), like widgets in the design-system.
- **Schedules are data** — rows in `_scheduler_tasks` (D1), created via the
  REST API or `SchedulerService`.

## Why DO alarms + a cron watchdog?

| Piece                                     | Role                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Durable Object per task** (`task:<id>`) | Precise per-task timer (`setAlarm`), on-demand — hibernates between runs, **no sockets, no bill while idle** |
| **DO `alarm()` handler**                  | Executes the task at run time: handler → done, repeat, or backoff-retry                                      |
| **Cron watchdog** (`*/10 * * * *`)        | Self-healing — re-arms any due task whose alarm was lost (crash, eviction, direct-DB insert)                 |
| **D1 (`_scheduler_tasks`)**               | Source of truth: schedule, params, status, attempts, results — inspectable/queryable                         |

At-least-once semantics: failures back off exponentially (30s → 60s → 2m … cap
60m, default budget 5 attempts) and the alarm IS the retry timer. After the
budget is exhausted a task stays `failed` for manual `retry`. **Handlers must be
idempotent** (at-least-once → a crashed run may re-execute once via the
watchdog; use the same dedupe pattern as the outbox for side effects).

## Enterprise use cases (all supported — handlers are just code)

| Use case                               | Schedule example                                                                                       | The handler does                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Scheduled reporting                    | `{ type: 'report.generate', cron: '0 8 * * mon-fri', timezone: 'Asia/Yangon', payload: { reportId } }` | Runs the report service, stores the result in R2 / sends it                                  |
| Email digests & reminders              | `{ type: 'email.send', cron: '30 8 * * *', payload: { templateId, to, data } }`                        | Calls the email provider (notifications plugin / fetch) — ⚠️ Workers has no native SMTP send |
| Cron tasks (any grid)                  | `{ type: 'sync.orders', cron: '*/30 * * * *' }`                                                        | Whatever the job needs — DB, fetch, R2, queues                                               |
| Server functions / rules on a schedule | `{ type: 'server-rule.run', payload: { ruleId } }`                                                     | Dispatches a declarative server-function rule (same service the hooks use)                   |
| KPI materialization                    | `{ type: 'kpi.materialize', cron: '30 3 * * *' }`                                                      | Calls `runKpiMaterialization`                                                                |
| Webhook / 3rd-party retry              | `{ type: 'webhook.deliver', payload: { url, body }, maxAttempts: 5 }`                                  | `fetch` + automatic backoff (the alarm is the retry timer)                                   |
| Scheduled publish                      | `{ type: 'entity.publish', runAt: publishAt, payload: { id } }`                                        | draft → published                                                                            |
| Follow-up / task digests               | `{ type: 'digest.followups', cron: '30 8 * * *' }`                                                     | Existing HR/meeting-task digest logic                                                        |
| Retry-with-backoff jobs                | any type + `maxAttempts`                                                                               | Failures auto-backoff; budget exhausted → `failed` → manual `retry()`                        |

## 🏭 Factory parts (built-in handlers — no code needed)

The scheduler ships **generic parts** that any app can compose — register once at
startup (`registerBuiltinHandlers()`, done automatically by the plugin).

| Part                        | type                | payload                                                                                      | What it does                                                                                                                                                                                                                                      |
| --------------------------- | ------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HTTP call**               | `http.request`      | `{ url, method?, headers?, body? }`                                                          | Scheduled/cron fetch — webhooks, pings, 3rd-party APIs, email/Telegram providers. Non-2xx → backoff retry.                                                                                                                                        |
| **Retry-until**             | `http.retry-until`  | `{ url, …, until: { status?, bodyIncludes?, jsonField?, jsonEquals? } }`                     | Calls until the response meets the condition (SLA check: "poll until ready"). Condition miss → backoff retry, capped by `maxAttempts`.                                                                                                            |
| **State transition**        | `entity.transition` | `{ collection \| table, id, status }`                                                        | Flips one record's status at run time — publish / expire / archive / cancel / approve. Idempotent.                                                                                                                                                |
| **Expiry engine**           | `entity.expire`     | `{ collection \| table, dateField, toStatus, fromStatus?, batch? }`                          | Scans records whose `dateField` is due and transitions them (scheduled publish/expiry). Run on a cron; `fromStatus` guard = transitions once.                                                                                                     |
| **Aggregation**             | `query.rollup`      | `{ collection \| table, groupBy?, measures, where? }`                                        | count/sum/avg/min/max snapshot over a table → `_rollup_values` (latest window, replace-per-collection).                                                                                                                                           |
| **Incremental aggregate**   | `aggregate.delta`   | `{ collection \| table, sinceField?, measures, groupBy?, where? }`                           | Counts only rows since the last run and ACCUMULATES (sum/count add, min/max keep extreme) — running totals, zero re-scan.                                                                                                                         |
| **Digest**                  | `notify.digest`     | `{ collection \| table, fields?, title?, windowMs?, channel? }`                              | Collects the window, formats a human summary, delivers to a webhook (Telegram/email provider). Window advances with `last_run_at` — never re-sends.                                                                                               |
| **Escalation ladder (SLA)** | `escalation.ladder` | `{ collection \| table, deadlineField, levels: [{ afterMs, action }], fromStatus?, batch? }` | SLA automation: records past a level's deadline get that level's action (`log` / `entity.transition` / `http.request`) **once** — state-tracked in `_escalation_state`, never double-escalates. Level order = ascending `afterMs`. Run on a cron. |
| **Lake export**             | `lake.export`       | `{ collection \| table, prefix, batch? }`                                                    | Keyset-paginated (`id > lastId`) JSONL export to R2 under `prefix/<stamp>/NNNN.jsonl` — bulk data-dump to the lake, chunked and resumable.                                                                                                        |

```bash
# Every hour, post the new order count to the Telegram bot (miniapp digest)
curl -X POST http://localhost:8788/api/scheduler/tasks -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"type":"http.request","cron":"0 * * * *","payload":{"url":"https://api.telegram.org/bot<TOKEN>/sendMessage","body":{"chat_id":"…","text":"Hourly digest"}}}'

# Publish a document at 09:00 Yangon time
curl -X POST http://localhost:8788/api/scheduler/tasks -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"type":"entity.transition","cron":"0 9 * * *","timezone":"Asia/Yangon","payload":{"collection":"articles","id":"doc-123","status":"published"}}'

# Every 5 minutes: auto-expire orders past their due date (scheduled state machine)
curl -X POST http://localhost:8788/api/scheduler/tasks -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"type":"entity.expire","cron":"*/5 * * * *","payload":{"collection":"orders","dateField":"expire_at","toStatus":"expired","fromStatus":"pending"}}'

# Nightly sales rollup by store
curl -X POST http://localhost:8788/api/scheduler/tasks -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"type":"query.rollup","cron":"30 3 * * *","payload":{"collection":"orders","groupBy":"store_id","measures":[{"op":"count","as":"cnt"},{"op":"sum","field":"total","as":"revenue"}]}}'

# Running daily totals (incremental — only new rows since yesterday are read)
curl -X POST http://localhost:8788/api/scheduler/tasks -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"type":"aggregate.delta","cron":"0 0 * * *","payload":{"collection":"orders","groupBy":"store_id","measures":[{"op":"sum","field":"total","as":"revenue"}]}}'

# Escalate overdue invoices: remind at 1h, escalate to manager webhook at 24h, cancel at 72h
curl -X POST http://localhost:8788/api/scheduler/tasks -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"type":"escalation.ladder","cron":"*/15 * * * *","payload":{"collection":"invoices","deadlineField":"due_at","levels":[{"afterMs":3600000,"action":{"type":"log","message":"invoice due soon"}},{"afterMs":86400000,"action":{"type":"http.request","url":"https://api.telegram.org/bot<TOKEN>/sendMessage","body":{"chat_id":"…","text":"Invoice OVERDUE 24h"}}},{"afterMs":259200000,"action":{"type":"entity.transition","collection":"invoices","status":"cancelled"}}]}}'

# Nightly JSONL dump of orders to the data lake (R2)
curl -X POST http://localhost:8788/api/scheduler/tasks -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"type":"lake.export","cron":"0 2 * * *","payload":{"collection":"orders","prefix":"lake/orders","batch":1000}}'
```

**Compose them** — parts chain naturally: `query.rollup` / `aggregate.delta` →
(read `_rollup_values` in your own handler) → `notify.digest` / `http.request` to
deliver; `entity.expire` + `notify.digest` = "expire licenses, then notify the
merchants". Parts meant for recurring schedules (`query.rollup`, `aggregate.delta`,
`notify.digest`, `entity.expire`) advance their window via `last_run_at`.

## 🚗 Recipes (example use cases — the "car")

### Reusable patterns (any domain)

| Pattern                     | How                             | Example                                         |
| --------------------------- | ------------------------------- | ----------------------------------------------- |
| Delayed task                | `runAt` / `delayMs`             | Order timeout, OTP expiry, reminder             |
| Recurring job               | `cron` / `repeatMs`             | Nightly sync, hourly rollup, weekly report      |
| Retry ladder + dead-letter  | `maxAttempts` + auto-backoff    | Webhook delivery, 3rd-party sync                |
| Watchdog / reconciler       | `reconcile()` on the cron       | Fix lost alarms, stuck workflows, unpaid orders |
| Digest / aggregation window | `query.rollup` + `http.request` | Daily email/Telegram digest, morning briefing   |
| Scheduled state machine     | `entity.transition`             | Publish / expire / renew / archive              |
| Escalation ladder (SLA)     | schedule per level              | "Not done by T → notify next level"             |
| Rate-limited batch          | `http.request` + your handler   | Bulk email, bulk import, queue drain            |
| ETL / sync runner           | `http.request` + your handler   | Forex rates, inventory sync, CRM pull           |
| Archive / retention / GDPR  | your handler                    | Log archival, retention, right-to-erasure       |
| Heartbeat / uptime monitor  | `http.request` periodic         | Service health, merchant API availability       |
| Cache warmer / precompute   | `query.rollup`                  | Dashboard precompute, edge cache refresh        |

### Cloudflare product combos (scheduler = wake-up call)

| Combo                   | Use case                                                                        |
| ----------------------- | ------------------------------------------------------------------------------- |
| × **Workers AI**        | Nightly AI digest / classification of new records, scheduled content generation |
| × **Vectorize**         | Nightly embeddings for new documents → semantic search index auto-update        |
| × **Browser Rendering** | Scheduled PDF reports / dashboard screenshots → R2                              |
| × **Queues**            | Scheduled batch enqueue with reliable delivery (outbox/webhook-queue)           |
| × **R2**                | Report archive, media archival, backup                                          |
| × **Email Workers**     | Inbound email → scheduled follow-up task                                        |
| × **Workflows**         | Kick long multi-step jobs (monthly close) with approval gates                   |
| × **Analytics Engine**  | Hourly/daily metric rollups → D1 → dashboards                                   |
| × **Agents SDK**        | Scheduled AI agent runs — "every morning, review the inbox and propose actions" |

## 1. Register a handler (code)

`apps/api/src/handlers/…` (anywhere in the worker bundle):

```ts
import { registerHandler } from '@mmbix/scheduler';

registerHandler('meeting.remind', async (payload, ctx) => {
	// payload: { meetingId, userId }
	// ctx.task, ctx.attempts, ctx.env (bindings), ctx.log
	const row = await ctx.env.DB.prepare('SELECT … FROM meetings WHERE id = ?').bind(payload.meetingId).first();
	// … send the reminder …
	return { sent: true, meetingId: payload.meetingId }; // stored as last_result
});
```

## 2. Schedule (data)

### REST API (all auth required, writes admin-only)

| Route                                 | Purpose                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `POST /api/scheduler/tasks`           | Schedule — `{ type, runAt \| delayMs, repeatMs \| cron, timezone?, payload, maxAttempts, id? }` |
| `GET /api/scheduler/tasks`            | List — `?status=pending&type=…&limit=50`                                                        |
| `GET /api/scheduler/tasks/:id`        | One task (status, attempts, last_error, last_result)                                            |
| `DELETE /api/scheduler/tasks/:id`     | Cancel + disarm                                                                                 |
| `POST /api/scheduler/tasks/:id/run`   | Run now (same path as the alarm)                                                                |
| `POST /api/scheduler/tasks/:id/retry` | Reset a failed task (fresh attempt budget)                                                      |
| `GET /api/scheduler/handlers`         | Registered handler types                                                                        |
| `POST /api/scheduler/reconcile`       | Watchdog — re-arm due/lost alarms                                                               |
| `POST /api/scheduler/prune?days=7`    | Housekeeping for done/cancelled rows                                                            |
| `GET /api/scheduler/stats`            | Counts by status                                                                                |

```bash
# One-shot reminder in 2 hours
curl -X POST http://localhost:8788/api/scheduler/tasks \
  -H "Authorization: Bearer dev-token" -H "Content-Type: application/json" \
  -d '{"type":"meeting.remind","payload":{"meetingId":"m1","userId":"u7"},"delayMs":7200000}'

# Weekly ERP report, Mondays 08:30 Yangon time (IANA timezone)
curl -X POST http://localhost:8788/api/scheduler/tasks \
  -H "Authorization: Bearer dev-token" -H "Content-Type: application/json" \
  -d '{"type":"report.generate","payload":{"reportId":"stock-aging"},"cron":"30 8 * * 1","timezone":"Asia/Yangon","maxAttempts":5}'
```

### In code

```ts
import { SchedulerService } from '@mmbix/scheduler';

const svc = new SchedulerService(new D1Client(env.DB));
await svc.schedule({ type: 'meeting.remind', payload: { meetingId: 'm1' }, runAt: '2026-09-01T09:00:00Z' }, env);
```

## First-run semantics

| Input                   | First run                                                 |
| ----------------------- | --------------------------------------------------------- |
| `runAt`                 | Exactly that instant (past → fires immediately, catch-up) |
| `cron` (no `runAt`)     | The **next grid occurrence** in the task timezone         |
| `repeatMs` (no `runAt`) | Immediately, then every `repeatMs`                        |
| `delayMs` only          | `now + delayMs`                                           |

## Lifecycle

```
schedule() ──> _scheduler_tasks (pending, run_at) ──> arm DO alarm
alarm fires ─> runTask() ─> handler
   ├─ success + repeat (cron/repeat_ms) ──> next run_at computed ──> re-arm
   ├─ success + one-shot ──> done
   └─ failure ──> attempts+1
        ├─ < max_attempts ──> status failed, run_at = now + backoff ──> re-arm
        └─ ≥ max_attempts ──> failed (final) — manual retry() resets
```

## Cron dialect + timezones

5 fields: `minute hour day-of-month month day-of-week`. Supports `*`, steps
(`*/5`, `10/20`), ranges (`mon-fri`, `9-17`), lists (`0,30`), month/weekday
names (`JAN`, `fri`), and `L` for last day of month. When both day-of-month and
day-of-week are restricted, a day matches if **either** matches (classic cron).

**Timezones:** pass `timezone` (IANA, e.g. `Asia/Yangon`, default `UTC`) — the
cron fields are then evaluated as that zone's wall clock, DST-aware (spring-
forward gaps are skipped, winter/summer offsets handled). `runAt`/`delayMs` are
absolute instants and are not affected by the timezone.

## Safety & enterprise guardrails

- **Fail-fast:** an unknown handler `type` is rejected at schedule time
  (`no handler registered`) — a typo never silently schedules a dead task.
- **No double-fire:** `done`/`cancelled` tasks never re-execute (`runNow`
  returns `skipped`); re-scheduling the same `id` reactivates it and keeps
  `run_count` history.
- **At-least-once + idempotency:** handlers must be idempotent; use a dedupe
  key in your own table (or the outbox) for critical side effects.
- **Observability:** `last_error`, `last_result`, `attempts`, `run_count`,
  `stats`, `prune` — every state change is queryable in D1.
- **Security:** writes are admin-only; `type` maps to registered code only —
  no user-supplied code is ever executed.

## Gotchas

- Each task = one DO with **one alarm**; the DO re-arms itself after every run.
- A rescheduled task (`run_at` moved to the future) is re-armed, not executed,
  when the alarm fires early.
- The watchdog needs the `SCHEDULER` DO binding; without it, scheduling still
  persists rows and the watchdog arms them once the binding exists.
- Alarm handler wall time is 15 min; CPU is 30s by default (5 min configurable).

## Tests

`apps/api/test/scheduler.spec.ts` — 41 tests: cron parser (UTC + timezone +
DST gap), schedule→arm, run lifecycle, backoff/exhaustion, repeat (`repeat_ms`

- `cron`), cancel, alarm firing, watchdog reconcile (single + batch), prune,
  stats, idempotent re-schedule, double-fire protection, all 9 built-in parts
  (incl. injection guard, fetch-mocked webhook delivery, escalation state-
  tracking, R2 lake export), and the HTTP surface.
