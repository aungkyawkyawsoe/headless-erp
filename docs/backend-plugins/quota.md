# Usage Quotas — atomic rate budgets

Fixed-window usage budgets per key (API key, tenant, collection, endpoint):
`consume` is a single atomic D1 UPSERT (`INSERT … ON CONFLICT … RETURNING`),
so it is safe across every isolate — two concurrent requests can never both
sneak past the limit.

| Call                                        | Meaning                                                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `consume(key, amount, { limit, windowMs })` | Try to use `amount` — returns `{ allowed, used, limit, resetAt }`. `allowed=false` when `used > limit` (the amount is still recorded). |
| `peek(key, windowMs)`                       | Current usage without consuming.                                                                                                       |
| `reset(key)`                                | Clear a key (fresh window).                                                                                                            |
| `list(limit?)`                              | All quota rows, newest first.                                                                                                          |

Windows are fixed (epoch-aligned) — `windowMs: 3600_000` = this clock-hour, so
a 09:00:01 request and a 09:59:59 request share one budget. `resetAt` tells the
client when the budget refreshes.

## Routes

| Route                      | Purpose                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| `POST /api/quotas/consume` | `{ key, amount?, limit, windowMs }` → `{ allowed, used, limit, resetAt }` |
| `POST /api/quotas/peek`    | `{ key, windowMs }` → current usage                                       |
| `POST /api/quotas/reset`   | `{ key }` → clear                                                         |
| `GET /api/quotas?limit=`   | List rows                                                                 |

```bash
# Budget 10k requests/day for tenant acme
curl -X POST http://localhost:8788/api/quotas/consume -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"key":"api:acme","amount":1,"limit":10000,"windowMs":86400000}'
# → { "allowed": true, "used": 1, "limit": 10000, "resetAt": 1767225600000 }
```

## In code

```ts
import { QuotaService } from '@mmbix/quota';

const q = new QuotaService(new D1Client(env.DB));
const { allowed, resetAt } = await q.consume('ai:acme', 1, { limit: 500, windowMs: 86_400_000 });
if (!allowed) return c.json({ error: `quota exceeded — resets at ${new Date(resetAt).toISOString()}` }, 429);
```

## Enterprise guardrails

- **Atomic** — one UPSERT per consume; no read-then-write race across isolates.
- **Reserved-word-safe DDL** — the SQLite column is `max_value` (`limit` is a
  reserved word); the API surface still speaks `limit`.
- **Bound inputs** — keys/limits are validated and bound parameters, never
  string-concatenated.

## Tests

`apps/api/test/quota.spec.ts` — allow-then-block at the boundary, reset
restores, per-key independence, HTTP consume route.
