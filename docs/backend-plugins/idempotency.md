# Idempotency — Stripe-style `Idempotency-Key` support

`@mmbix/idempotency` — D1-backed idempotency keys: **a request runs exactly
once; retries with the same key get the cached response**.

## Why

Enterprise APIs face duplicate side effects when clients retry after a timeout
or network blip — duplicate payments, duplicate orders, duplicate emails.
`Idempotency-Key` solves it: the client sends the same key on retries, the
server dedupes.

## How it works

- **Atomic claim** — one `INSERT … ON CONFLICT` per key (`_idempotency_keys`):
  the first request claims the key and runs; concurrent same-key requests get
  **409** until it completes.
- **Replay** — a completed key returns the cached 2xx response (status, safe
  headers, body) without re-running.
- **Crashed callers** — a stale `processing` claim (older than the TTL, default
  24h) is taken over.
- **Failed attempts** — recorded as `failed`; the next call with the same key
  re-runs. (The API middleware uses `recordFailures: false` — non-2xx responses
  are never cached, so a validation retry re-validates.)

## Use it

### Middleware (entity writes — already wired in `apps/api`)

```bash
# Same key → same response, ONE record created
curl -X POST http://localhost:8788/api/entities/orders \
  -H "Authorization: Bearer dev-token" -H "Idempotency-Key: order-create-123" \
  -H "Content-Type: application/json" -d '{"customer_id":"c1","total":99}'
```

### Service (any operation)

```ts
import { IdempotencyService } from '@mmbix/idempotency';

const svc = new IdempotencyService(new D1Client(env.DB));
const { replayed, value } = await svc.run(`charge:${key}`, async () => {
	return chargeCard(amount); // runs once per key
});
```

### Admin routes

| Route                                | Purpose                                      |
| ------------------------------------ | -------------------------------------------- |
| `GET /api/idempotency/keys?key=…`    | Cached entry metadata (status, never bodies) |
| `POST /api/idempotency/prune?days=7` | Delete expired keys (also prunes lazily)     |

## Guardrails

- Keys are scoped `METHOD|path|key` — different routes never collide.
- Key length 8–255 chars (rejected otherwise).
- `recordFailures: false` mode (middleware) never caches non-2xx.
- Rows auto-prune (every 100th run + nightly cron).

## Tests

`apps/api/test/idempotency.spec.ts` — 8 tests: run-once/replay, failed-then-
retry, in-progress conflict, prune, and the HTTP middleware (same key → cached
response + single insert, different keys → separate records, GET ignores keys).
