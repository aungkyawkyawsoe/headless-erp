# Distributed Locks — DO-backed mutex with leases

`@mmbix/locks` — cross-isolate, cross-worker mutual exclusion: **one Durable
Object per lock name**, atomic acquire/release, time-based leases, reentrant
renewal.

## Why

Batch jobs, counters, inventory deduction, and critical sections must never run
concurrently — even across isolates or separate workers. `LockService` gives a
Stripe-of-locks: acquire → work → release, with a lease that expires if the
holder crashes.

## How it works

- One `LockDO` instance per name (`lock:<name>`) — workerd serializes requests
  per instance, so the check-and-set logic is atomic everywhere.
- **Leases** — a lock expires after `ttlMs` (default 60s); a crashed holder
  can't deadlock the system.
- **Owner tokens** — only the owner can release/renew; wrong owners are
  rejected.
- **Renew** — long jobs extend their lease (`handle.renew()`).

## Use it

```ts
import { LockService } from '@mmbix/locks';

const locks = new LockService(env); // needs the LOCK DO binding

// Blocking acquire (waits up to timeoutMs)
await locks.withLock('inventory:sku-1', async () => {
	// critical section — runs exclusively
}, { timeoutMs: 10_000 });

// Non-blocking: run only if free (returns null otherwise)
const result = await locks.tryWithLock('batch:orders', async () => doBatch());

// Manual handle
const handle = await locks.tryAcquire('order-123', 30_000);
if (handle) {
	try { … } finally { await handle.release(); }
}
```

### REST routes

| Route                                   | Purpose                                                           |
| --------------------------------------- | ----------------------------------------------------------------- |
| `POST /api/locks/:name/acquire` (admin) | `{ ttlMs?, timeoutMs? }` → `{ owner, expiresAt }` — 409 when held |
| `POST /api/locks/:name/release` (admin) | `{ owner }` — 409 when owned by someone else                      |
| `GET /api/locks/:name/status` (auth)    | `{ locked, owner?, expiresAt? }`                                  |

## Guardrails

- Lease expiry = crash recovery (no manual cleanup needed).
- Owner-scoped release/renew — nobody can unlock your critical section.
- No D1 table — each DO self-heals its SQLite storage.

## Tests

`apps/api/test/locks.spec.ts` — 7 tests: acquire/exclude/release, lease expiry
(takeover), blocked new owners + owner renew, `withLock` cleanup on error,
wrong-owner rejection, wait-timeout, and the HTTP routes.
