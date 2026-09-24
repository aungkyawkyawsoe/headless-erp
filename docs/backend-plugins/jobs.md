# Async Jobs — fire-and-forget background work

A thin façade over the scheduler: `POST /api/jobs` enqueues a task that runs
**immediately** (the DO alarm fires asap), so long operations never block the
HTTP request. Clients poll `GET /api/jobs/:id` for status and result.

| Route                  | Purpose                                                     |
| ---------------------- | ----------------------------------------------------------- |
| `POST /api/jobs`       | Enqueue — `{ type, payload?, name? }` → `{ jobId, status }` |
| `GET /api/jobs`        | List — `?status=&limit=`                                    |
| `GET /api/jobs/:id`    | Status, attempts, `last_error`, `last_result`, `run_count`  |
| `DELETE /api/jobs/:id` | Cancel                                                      |

The `type` must be a registered handler (built-in part or custom
`registerHandler`), otherwise the request fails fast with `400`.

```bash
# Kick off a heavy export in the background
curl -X POST http://localhost:8788/api/jobs -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" -d '{"type":"lake.export","payload":{"collection":"orders","prefix":"lake/manual"}}'
# → { "jobId": "…", "status": "pending" }

# Poll for the result
curl http://localhost:8788/api/jobs/<jobId> -H "Authorization: Bearer dev-token"
# → { status: "done", last_result: "{\"rows\":1284,\"chunks\":2,…}", run_count: 1 }

# Typo in the type → fail-fast
curl -X POST http://localhost:8788/api/jobs -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" -d '{"type":"no.such.handler"}'   # → 400
```

## In code

```ts
import { SchedulerService } from '@mmbix/scheduler';

const svc = new SchedulerService(new D1Client(env.DB));
const job = await svc.schedule({ type: 'lake.export', payload: { table: 'orders', prefix: 'lake/manual' }, runAt: Date.now() }, env);
// store job.id; the worker completes in the background
```

## Enterprise guardrails

- **Fail-fast** — unknown handler types are rejected at enqueue time, not
  discovered hours later inside a failed alarm.
- **Never blocks** — the HTTP request returns as soon as the task is persisted
  and armed; execution happens in the DO.
- **Full observability** — same guarantees as the scheduler: attempts,
  `last_error`, backoff retries, `run_count` history, cancel.

## Tests

`apps/api/test/jobs.spec.ts` — enqueue → deterministic alarm fire → pollable
result, fail-fast rejection, list + cancel.
