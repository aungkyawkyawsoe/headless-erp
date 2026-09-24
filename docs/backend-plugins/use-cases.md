# Platform Parts — enterprise use cases (the "car" on the factory floor)

The factory ships **generic parts** — each is a small, tested abstraction over
a Cloudflare primitive. You compose them for any business use case; no part
knows your domain. This page shows real enterprise scenarios as part
compositions (curl + which parts are involved). One part alone is useful; the
compositions are where the power is.

| Part                                  | Package                     | Cloudflare primitive         |
| ------------------------------------- | --------------------------- | ---------------------------- |
| Scheduler (DO alarms + cron watchdog) | `@mmbix/scheduler`          | Durable Object alarms + cron |
| Async Jobs                            | `@mmbix/scheduler` (façade) | DO alarm, fire immediately   |
| Idempotency keys                      | `@mmbix/idempotency`        | D1 dedupe table              |
| Distributed locks                     | `@mmbix/locks`              | DO-backed mutex + leases     |
| Event bus                             | `@mmbix/events`             | Queues pub/sub + DLQ         |
| Feature flags                         | `@mmbix/flags`              | D1 + deterministic hashing   |
| Usage quotas                          | `@mmbix/quota`              | D1 atomic counters           |
| GDPR erasure                          | `@mmbix/gdpr`               | D1 + audit table             |
| Materialized views                    | `@mmbix/views`              | D1 snapshot tables           |

---

## 1. Scheduled reporting (ERP close, weekly digest, payroll run)

**Parts:** scheduler + jobs + views (+ your report handler)

```bash
# Nightly read model for the finance dashboard (03:30 Yangon time)
curl -X POST http://localhost:8788/api/scheduler/tasks -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"type":"view.refresh","cron":"30 3 * * *","timezone":"Asia/Yangon","payload":{"view":"store_totals"}}'

# Monday 08:30 — generate + email the weekly ERP report (any registered handler)
curl -X POST http://localhost:8788/api/scheduler/tasks -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"type":"report.generate","cron":"30 8 * * 1","timezone":"Asia/Yangon","payload":{"reportId":"stock-aging"},"maxAttempts":5}'
```

Why it works: the cron runs on the **task's timezone** (DST-aware), the alarm IS
the retry timer (5 attempts, exponential backoff), and the watchdog re-arms
anything lost to a crash. Scheduled reporting is just a handler + a cron row.

## 2. Email / Telegram digests & reminders

**Parts:** scheduler (`http.request`, `notify.digest`) + events

```bash
# 08:30 daily digest of new signups → Telegram bot
curl -X POST http://localhost:8788/api/scheduler/tasks -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"type":"notify.digest","cron":"30 8 * * *","timezone":"Asia/Yangon","payload":{"collection":"users","fields":["email"],"title":"New signups","channel":{"type":"webhook","url":"https://api.telegram.org/bot<TOKEN>/sendMessage","body":{"chat_id":"…"}}}}'
```

> ⚠️ Workers has no native SMTP — send email via an HTTP email provider
> (Resend/Mailgun/SES API) through `http.request`; the digest part collects the
> window and the webhook delivers it. For event-driven mail ("order shipped"),
> subscribe a webhook action to a topic on the event bus.

## 3. SLA escalation (invoices, tickets, equipment service)

**Parts:** scheduler (`escalation.ladder`) — the whole ladder is one task

```bash
curl -X POST http://localhost:8788/api/scheduler/tasks -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"type":"escalation.ladder","cron":"*/15 * * * *","payload":{"collection":"invoices","deadlineField":"due_at","levels":[
    {"afterMs":3600000,"action":{"type":"log"}},
    {"afterMs":86400000,"action":{"type":"http.request","url":"https://api.telegram.org/bot<TOKEN>/sendMessage","body":{"chat_id":"…","text":"Invoice OVERDUE 24h"}}},
    {"afterMs":259200000,"action":{"type":"entity.transition","collection":"invoices","status":"cancelled"}}]}}'
```

State-tracked per record per level — a cron re-run never double-escalates.

## 4. Webhook delivery with retries + dedupe (3rd-party syncs)

**Parts:** scheduler (`http.request` with `maxAttempts`) + idempotency + events

```bash
# Deliver a webhook up to 5 times with exponential backoff
curl -X POST http://localhost:8788/api/scheduler/tasks -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"type":"http.request","payload":{"url":"https://partner.example.com/hook","body":{"orderId":"o1"}},"maxAttempts":5}'

# Idempotent REST call — retries replay the cached response
curl -X POST http://localhost:8788/api/entities/orders \
  -H "Authorization: Bearer dev-token" -H "Idempotency-Key: order-create-001" \
  -H "Content-Type: application/json" -d '{"amount":100}'
```

## 5. Quota'd & flag-gated API tiers (multi-tenant SaaS)

**Parts:** quota + flags (+ rate limiter built into the API)

```bash
# Tenant acme: 10k requests/day
curl -X POST http://localhost:8788/api/quotas/consume -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" -d '{"key":"api:acme","amount":1,"limit":10000,"windowMs":86400000}'

# Roll the premium feature out to 10% of tenants, force-on for acme
curl -X PUT http://localhost:8788/api/flags/premium.export -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" -d '{"enabled":true,"rollout_pct":10}'
curl -X PUT "http://localhost:8788/api/flags/premium.export?tenant=acme" -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" -d '{"enabled":true}'
```

## 6. Compliance: right-to-erasure + immutable audit

**Parts:** gdpr (+ the audit log)

```bash
curl -X POST http://localhost:8788/api/gdpr/erasure -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"subject":"user@example.com","piiField":"email","dryRun":true}'
# then, after review:
curl -X POST http://localhost:8788/api/gdpr/erasure -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"subject":"user@example.com","piiField":"email","mode":"anonymize"}'
curl http://localhost:8788/api/gdpr/requests -H "Authorization: Bearer dev-token"
```

## 7. Cross-isolate critical sections (stock, wallets, sequence numbers)

**Parts:** locks

```ts
import { LockService } from '@mmbix/locks';

await locks.withLock(
	'stock:item-42',
	async () => {
		// read remaining → decrement → write: atomic across every isolate
	},
	{ ttlMs: 10_000, waitMs: 5_000 },
);
```

## 8. Background heavy work without blocking requests

**Parts:** jobs

```bash
curl -X POST http://localhost:8788/api/jobs -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" -d '{"type":"lake.export","payload":{"collection":"orders","prefix":"lake/manual"}}'
curl http://localhost:8788/api/jobs/<jobId> -H "Authorization: Bearer dev-token"   # poll → done
```

---

## Decision guide

| You need…                                    | Use                                                  |
| -------------------------------------------- | ---------------------------------------------------- |
| "Do X at 09:00 / every 5 min / in 2 hours"   | **scheduler** (`runAt` / `cron` / `delayMs`)         |
| "Do X now but don't block the request"       | **jobs**                                             |
| "Exactly-once side effect, retries replay"   | **idempotency**                                      |
| "Only one worker may touch this resource"    | **locks**                                            |
| "Notify N systems when something happens"    | **events** (Queues pub/sub)                          |
| "Turn feature X off / roll it out gradually" | **flags**                                            |
| "Cap tenant/API usage"                       | **quota**                                            |
| "Erase a person's data (compliance)"         | **gdpr**                                             |
| "Fast dashboard/BI reads over big tables"    | **views** (+ scheduler to refresh)                   |
| "Retry a failing call with backoff"          | **scheduler** `maxAttempts` (the alarm is the timer) |
