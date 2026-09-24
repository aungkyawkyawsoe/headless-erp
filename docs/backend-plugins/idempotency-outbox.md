# Idempotency, Outbox & Reliability

ERP-grade reliability for side-effects: **at-most-once becomes durable +
exactly-once-ish**, retries back off, poison messages land in a dead-letter
queue, and reentrant hooks can't loop forever.

## The problem

Fire-and-forget side-effects (trigger plugins, emails, webhook fan-out) are
**at-most-once**: if the isolate dies mid-flight, the effect is lost. And a
client retry after a timeout can double-fire the effect. Both are unacceptable
for money-moving business logic.

## The Outbox pattern (implemented)

Side-effects that must survive are **enqueued as rows** instead of fired as
promises. A scheduled flush (`*/10 * * * *` cron) processes due rows with
exponential backoff (1m → 2m → 4m → … capped 60m); after **5 attempts** a row
moves to the dead-letter table for manual inspection/retry.

```
transition / after-hook → OutboxService.enqueue(type, payload, { dedupeKey })
                                 │
                                 ▼
                            _outbox (D1)
                                 │  scheduled flush
                                 ▼
                    plugin / hook / webhook executor
                                 │ failure → attempts+1, backoff
                                 ▼ attempts = 5
                          _outbox_dlq → POST /api/outbox/:id/retry
```

### Idempotency — the dedupe key

`dedupe_key` is UNIQUE. Re-enqueueing the same logical side-effect is a no-op
(`duplicated: true`). **Workflow trigger plugins already use this** — the key is
`wf:<workflow>:<doc>:<from>→<to>:<plugin>`, so a retried transition can never
fire an email/tax-calc twice.

### Where the outbox is used today

| Producer                                 | Dedupe key                                 |
| ---------------------------------------- | ------------------------------------------ |
| Workflow `on_transition.trigger_plugins` | `wf:<workflow>:<doc>:<from>→<to>:<plugin>` |

The transition response includes `side_effects: [outbox-ids]` so you can trace
the effects. Existing idempotency guarantees for writes:

- **Create** — client-supplied UUID `id` makes POST replay-safe (retry returns the existing record)
- **Update** — `If-Match: <updated_at>` → stale writes get 409 (never clobber)
- **Transitions** — optimistic lock → concurrent/double transitions get 409

## Outbox API (admin)

| Method | Path                    | Notes                                                                                         |
| ------ | ----------------------- | --------------------------------------------------------------------------------------------- |
| GET    | `/api/outbox`           | List (`?status=pending\|done\|failed&limit=50`)                                               |
| POST   | `/api/outbox`           | Enqueue a custom task `{ type, payload, dedupe_key? }` — types: `plugin` / `hook` / `webhook` |
| GET    | `/api/outbox/dlq`       | Dead-letter rows                                                                              |
| POST   | `/api/outbox/:id/retry` | Move a DLQ row back into the queue                                                            |
| DELETE | `/api/outbox/done`      | Prune finished rows (`?days=7`)                                                               |

```bash
# Manual retry of a poison message after fixing its cause
curl -X POST http://localhost:8788/api/outbox/<dlq-id>/retry \
  -H 'Authorization: Bearer dev-token'
```

## Hook-spine safety (hard limits)

| Guard            | Limit             | Why                                                                                                            |
| ---------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Reentrancy depth | 3                 | A hook that writes again (`after_insert → update → before_update`) is rejected past the cap — no infinite loop |
| Hooks per event  | 20                | A noisy event can't starve a request (defense in depth)                                                        |
| Per-hook timeout | 5s (configurable) | Timeouts/errors are logged, never fatal                                                                        |

## Marketplace failure policy

| `manifest.on_error` | Behavior                                              |
| ------------------- | ----------------------------------------------------- |
| `skip` (default)    | Log and continue — broken plugin never blocks a write |
| `abort`             | Reject the write (fail-closed — for critical rules)   |

Binding calls are **really cancelled** via `AbortController`
(`manifest.fetch_timeout_ms`, default 5000) — a stuck remote worker doesn't
keep burning CPU after the timeout.

## Files

| File                                              | Responsibility                           |
| ------------------------------------------------- | ---------------------------------------- |
| `apps/api/src/plugins/outbox/{plugin,service}.ts` | Outbox + DLQ (migration `022_outbox`)    |
| `apps/api/src/plugins/marketplace/chain.ts`       | Fail policy + AbortController timeouts   |
| `apps/api/src/core/plugin-hooks.ts`               | Depth guard + per-event budget           |
| `apps/api/src/index.ts`                           | Scheduled flush (`*/10 * * * *`) + prune |
