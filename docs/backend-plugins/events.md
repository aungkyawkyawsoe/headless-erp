# Event Bus — pub/sub on Cloudflare Queues

`@mmbix/events` — topic-based events with fan-out to subscribers (webhooks,
handlers, logs), delivery dedupe, queue retries and dead-letter.

## Why

Entity changes should trigger many things — webhooks, notifications, read
models, audits — without coupling them. The event bus decouples producers from
consumers: publish once, subscribe anywhere.

## How it works

```
publish(topic, payload) ──> <queue: QUEUE_EVENTS in infra/env.prod>
                              └─ consumeEventBatch (worker queue() handler)
                                   ├─ subscriber: webhook  → POST envelope
                                   ├─ subscriber: handler  → dispatch(type, envelope)
                                   └─ subscriber: log      → console
```

- **Envelope**: `{ id, topic, payload, created_at }` — `id` is the dedupe key.
- **Dedupe** (`_event_deliveries`): redeliveries (queue retry after an ack
  loss) never double-deliver. A FAILED delivery releases its dedupe slot and
  rethrows → Queues retries with backoff, then dead-letters.
- **Retry/DLQ** lives in the worker config (`queues.consumers`: 5 retries, 30s
  delay, `<QUEUE_EVENTS>-dlq` — names come from `infra/env.prod`).

## Use it

### Subscribe (REST)

```bash
# Fan out order.created to a webhook (e.g. Telegram bot)
curl -X POST http://localhost:8788/api/events/subscribers \
  -H "Authorization: Bearer dev-token" -H "Content-Type: application/json" \
  -d '{"topic":"order.created","name":"telegram","action":{"type":"webhook","url":"https://api.telegram.org/bot<TOKEN>/sendMessage"}}'

# …or to a scheduler handler (in-process fan-out)
curl -X POST http://localhost:8788/api/events/subscribers \
  -H "Authorization: Bearer dev-token" -H "Content-Type: application/json" \
  -d '{"topic":"order.paid","action":{"type":"handler","handler_type":"my.afterpaid"}}'
```

### Publish

```ts
import { EventService } from '@mmbix/events';
const events = new EventService(env.EVENTS);
await events.publish('order.created', { orderId: 'o1', total: 99 });
// REST: POST /api/events/publish { topic, payload }
```

## Guardrails

- At-least-once + per-subscriber dedupe (an ack loss never double-delivers).
- Handler actions dispatch through the scheduler registry (reuse any handler).
- Subscribers are data — add/remove without deploys.
- Delivery history prunes nightly (`pruneEventDeliveries`).

## Tests

`apps/api/test/events.spec.ts` — 5 tests: publish, webhook delivery + dedupe
(redelivery skipped), failed delivery → dedupe released → retry succeeds,
handler dispatch injection, subscriber CRUD + publish routes + prune.
