# Feature Flags — kill-switches & staged rollouts

A headless feature-flag service: toggle any capability per **key**, per
**tenant**, or **globally** — evaluated in-memory (no DB hit per check) and
updated at runtime via REST. No deploy, no restart.

| Flag state                        | Who sees it                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `enabled: false`                  | nobody                                                                                           |
| `enabled: true, rollout_pct: 0`   | nobody (0%)                                                                                      |
| `enabled: true, rollout_pct: 100` | everybody                                                                                        |
| `enabled: true, rollout_pct: 30`  | deterministic 30% — the same caller always gets the same answer (`fnv1a(key + subject)` hashing) |

Lookup is **tenant → global fallback**: if no tenant-scoped flag exists, the
global value applies. A tenant row always shadows the global one.

## Routes

| Route                          | Purpose                                                |
| ------------------------------ | ------------------------------------------------------ |
| `GET /api/flags`               | List flags                                             |
| `PUT /api/flags/:key`          | Upsert — `{ enabled, rollout_pct?, config_json? }`     |
| `GET /api/flags/:key`          | Fetch one flag                                         |
| `GET /api/flags/:key/evaluate` | Evaluate — `?tenant=&subject=` → `{ enabled, source }` |
| `DELETE /api/flags/:key`       | Remove (`?tenant=` for tenant-scoped rows)             |

```bash
# Kill-switch the new checkout flow globally
curl -X PUT http://localhost:8788/api/flags/checkout.v2 -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" -d '{"enabled":false}'

# Roll the export feature out to 10% of tenants (deterministic)
curl -X PUT http://localhost:8788/api/flags/export.enabled -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" -d '{"enabled":true,"rollout_pct":10}'

# Force-enable for one tenant (overrides global)
curl -X PUT "http://localhost:8788/api/flags/export.enabled?tenant=acme" -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" -d '{"enabled":true}'

# Evaluate
curl "http://localhost:8788/api/flags/export.enabled/evaluate?tenant=acme&subject=user-42" \
  -H "Authorization: Bearer dev-token"
```

## In code

```ts
import { FlagService } from '@mmbix/flags';

const svc = new FlagService(new D1Client(env.DB));
await svc.set('checkout.v2', { enabled: false });

const r = await svc.evaluate('export.enabled', { tenant: 'acme', subject: 'user-42' });
if (r.enabled) {
	/* new export path */
}
```

## Enterprise guardrails

- **Deterministic rollouts** — the same `subject` always maps to the same
  bucket, so a user never flips between enabled/disabled on adjacent requests.
- **No per-check DB load** — evaluate is an in-memory read of D1 rows fetched
  once per isolate; flags are cheap to call on every request.
- **Tenant isolation** — tenant rows shadow global rows; `?tenant=` scoping
  everywhere.

## Tests

`apps/api/test/flags.spec.ts` — global/tenant fallback, rollout bucketing,
HTTP CRUD + evaluate, removal.
