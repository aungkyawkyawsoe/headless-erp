# @mmbix/sdk

Typed client SDK for the Mmbix headless entity engine — **zero-waste by
construction**: typed queries (no hand-rolled URLs), expired-token awareness,
401 self-heal, transient retry, replay-safe writes, and a schema typegen that
produces **one file** with both TypeScript types and Zod schemas (zero drift).

> 📚 Full reference in the docs tree: [`docs/backend-api/sdk.md`](../../docs/backend-api/sdk.md)
> (typegen CLI → typed client → offline queue → `@mmbix/sdk-react` hooks → page-size policy).

## Install

```bash
pnpm --filter <app> add @mmbix/sdk
```

## 1. Generate types from your schema

```bash
mmbix-typegen --url http://localhost:8788/api --token dev-token --out ./src/generated
# or from a local snapshot:
mmbix-typegen --schema ./schema.json --out ./src/generated
```

Emits `src/generated/schema.ts` — the **single source of truth**:

```ts
export const HrAttendanceSchema = z.object({ ... });
export type Schema = { 'hr_attendance': z.infer<typeof HrAttendanceSchema>; ... };
export const Schemas = { 'hr_attendance': HrAttendanceSchema, ... };
```

Computed fields are typed by their `result_type`: **stored** formulas
(`store: true`) are real columns and land in the row shape (`number` →
`z.number()`, `boolean` → `z.union([z.boolean(), z.number()])`, …); **virtual**
formulas (computed on read, expand-only) are omitted from the row shape like
o2m/m2m fields.

## 2. Typed client

```ts
import { createClient, localStorageTokenStorage } from '@mmbix/sdk';
import type { Schema } from './generated/schema';

const client = createClient<Schema>({
	baseUrl: '/api', // same-origin (Vite proxy / worker)
	tokenStorage: localStorageTokenStorage(), // survives reloads
	refreshSession: () => client.auth.login(initData).then((r) => (r.status === 'approved' ? r.token : null)), // 401 self-heal (pending → null → the 401 surfaces)
});

// Auth
const login = await client.auth.login(initData); // Telegram — resolves with 'approved' | 'pending'
if (login.status === 'approved') {
	// token already stored — start the app
} else {
	// 'pending' — show the approval-wait screen (tg_id/full_name available)
}
await client.auth.loginPassword(email, password);

// Typed CRUD — compile-time checked against the generated Schema
const page = await client.items('hr_attendance').list({
	filter: { employee_tg_id: { _eq: tgId }, timestamp: { _gte: iso } },
	fields: ['id', 'type', 'timestamp', 'status'], // dot paths expand relations
	sort: '-timestamp',
	limit: 24,
});
const next = await client.items('hr_attendance').list({ cursor: page.meta.next_cursor });

const created = await client.items('hr_attendance').create(
	{ type: 'check-in', timestamp: new Date().toISOString() },
	{ id: uuid(), idempotencyKey: 'k1' }, // replay-safe
);
const updated = await client.items('hr_attendance').update(
	id,
	{ note: 'x' },
	{
		ifMatch: created.updated_at, // optimistic concurrency (409)
	},
);

// One view = ONE round trip — batch every read the view renders (POST /api/query)
const { results } = await client.queryMany([
	{ key: 'cards', collection: 'hr_attendance', query: { limit: 24, sort: '-timestamp' } },
	{ key: 'hero', collection: 'hr_employees', query: { fields: ['name_mm'] } },
]);
// results: [{ key: 'cards', ok: true, data: [...] }, ...] — per-key error isolation

// Permission-aware pruning — never ask for fields the role can't see
const allowed = await client.fieldRestrictions('hr_employees'); // ['id','name',...] | null
await client.pruneFields('hr_attendance', ['id', 'salary']); // -> ['id'] when salary hidden

// Runtime purification — parse any API response with the generated schema
Schemas.hr_attendance.parse(row);
```

## 3. Composable client (Directus-style `.with()`)

The client supports Directus-style feature composition — compose only what you
need, in any order, with the return type updated per feature:

```ts
import { createClient, rest, staticToken, authenticate } from '@mmbix/sdk';

// Anonymous client, then compose features onto it:
const client = createClient<Schema>({ baseUrl: 'https://api.example.com' })
	.with(rest()) // request() / queryMany() / items()
	.with(staticToken('super-secure-token')) // fixed bearer token (service accounts)
	.with(authenticate({ tokenStorage, refreshSession })); // full login/logout/refresh

await client.login(initData); // from authenticate()
const token = client.getToken(); // from authenticate()/staticToken()
client.setToken('rotated');
const rows = await client.items('articles').list({ limit: 10 }); // from rest()
```

| Composable                                         | Adds                                                       | Notes                                                                                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `rest()`                                           | `request`, `queryMany`, `items`                            | This SDK is rest-native — the composable binds the same methods for Directus parity and marks the slot where future opt-in features plug in  |
| `staticToken(token)`                               | `getToken`, `setToken`                                     | Fixed bearer token — service accounts, cron workers                                                                                          |
| `authenticate({ tokenStorage?, refreshSession? })` | `login`, `loginPassword`, `logout`, `getToken`, `setToken` | Full auth wiring; skips the storage you already passed to `createClient`                                                                     |
| `graphql()`                                        | —                                                          | Not offered: our `queryMany()` batch delivers the practical win (one round trip, exact fields) without a second query language on the server |
| `realtime()`                                       | —                                                          | Roadmap: needs a backend events channel (Durable Objects fan-out / SSE) before the SDK can expose `subscribe()`                              |

`createClient(options)` alone stays the minimal entry point — the composables
are an optional DX layer, not a replacement.

## Zero-waste guarantees

| Concern                          | Mechanism                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| No hand-rolled URLs              | typed `ListQuery` → `serializeQuery` (filters, fields, cursor, count)                        |
| Expired token waste              | `isTokenExpired` — re-auth up front, no doomed request + 401                                 |
| 401 churn                        | `refreshSession` — one refresh, one retry                                                    |
| Transient failures               | automatic retry with backoff (408/429/502/503)                                               |
| Duplicate writes                 | client-generated UUID + `Idempotency-Key`                                                    |
| Stale overwrites                 | `If-Match` optimistic concurrency                                                            |
| Re-downloading an unchanged read | conditional GET — the `ETag` is replayed as `If-None-Match`, and a 304 is served from memory |
| Type/runtime drift               | typegen emits types AND Zod from the same schema                                             |

## Page-size policy (enterprise grade)

The **backend defines the contract** — the values live in `@mmbix/config`
(env-overridable at deploy time via `API_DEFAULT_LIMIT` / `API_MAX_LIMIT`),
the server exposes the effective policy via `GET /api/meta`, and every
client-facing endpoint clamps to it. A frontend can only _adjust_ its page
size within it — it can never exceed the ceiling:

| Constant                        | Value   | Where                                                                |
| ------------------------------- | ------- | -------------------------------------------------------------------- |
| `DEFAULT_PAGE_SIZE`             | **25**  | a `list()`/`queryMany` spec with no `limit` gets 25                  |
| `MAX_PAGE_SIZE`                 | **100** | any `limit` above 100 is clamped (the server truncates there anyway) |
| `client.limits`                 | —       | the active policy (defaults until `loadLimits()` runs)               |
| `normalizePageSize(n, policy?)` | —       | exported helper for custom transports                                |

```ts
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, normalizePageSize } from '@mmbix/sdk';

await client.items('hr_attendance').list({}); // limit=25 (explicit)
await client.items('vehicle_tyres').list({ limit: 300 }); // limit=100 (clamped)

// Discover the server's contract at runtime (a deployment may differ) — the
// SDK adopts it and clamps against it from then on. Falls back to 25/100.
await client.loadLimits(); // GET /api/meta → { pagination: { default_page_size, max_page_size } }
console.log(client.limits); // e.g. { defaultPageSize: 50, maxPageSize: 200 }
```

**Aggregate loads walk — they never inflate the page size.** Callers that need
more than one page (directories, pickers, full collections) must cursor-walk:

```ts
let cursor: string | undefined;
const rows = [];
for (let i = 0; i < 6 && (i === 0 || cursor); i++) {
	const page = await client.items('hr_employees').list({ limit: client.limits.maxPageSize, cursor });
	rows.push(...page.data);
	cursor = page.meta.next_cursor ?? undefined;
}
```

The **backend enforces the same contract on every client-facing endpoint** (it
is the gatekeeper, the SDK is the mirror): the entity list, `?export=`
JSON/CSV, the export route, HR summary, search, drilldown, aggregates, outbox,
quota, KPI and tRPC all default to 25 and clamp to 100 — the miniapp's
server-backed CSV download was removed with the export ceiling. The only
higher limits left are **server-internal jobs** (scheduled-report generation,
archive janitor, KPI analytics) that are not client-driven row fetches. The
miniapp's `sdkListAll` / `sdkListAllPages` helpers implement the walk pattern;
a request for e.g. 300 rows walks 3 × 100.

## The 9 classic problems — how this stack prevents them

| #   | Problem                                                         | Prevention                                                                                                                                                                          | Where                                                |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | **Over-fetching** (payloads carry fields the UI doesn't render) | typed `fields` projection — the server skips relation resolution + decryption for unselected columns; `respectPermissions` prunes even `*` to the role's whitelist                  | SDK `ListQuery.fields` · server `RelationResolver`   |
| 2   | **Under-fetching** (incomplete data → chained requests)         | consolidated endpoints (`attendanceSummary` = punches + leaves in ONE round trip); SDK `client.request()` reaches any business endpoint typed                                       | `hr/attendance/summary` · SDK client                 |
| 3   | **N+1 fetching** (loop → per-item request)                      | server-side **batched** relation resolution (M2O/O2M/M2M via `IN` queries, never per-row); lean default = no relations at all                                                       | server `RelationResolver`                            |
| 4   | **Waterfall requests** (child waits for parent fetch)           | TanStack Query: sibling hooks in one component fire in parallel; identical keys across components share ONE request; keyset cursor pagination via `useInfiniteItems`                | `@mmbix/sdk-react`                                   |
| 5   | **Type drifting** (schema changes, frontend types stale)        | typegen reads `_entity_schemas` → ONE generated file where types are `z.infer<schema>` — compile-time and runtime can never diverge; `npx mmbix-typegen` regenerates                | `packages/sdk` typegen                               |
| 6   | **Stale caches vs DB state** (single source of truth)           | write-through invalidation: every mutation invalidates the collection's queries (`invalidateCollection`); the server invalidates its response cache on writes too                   | SDK-react hooks · server `invalidateCollectionReads` |
| 7   | **Dual validation** (form logic duplicated in FE + BE)          | the SAME schema drives both: backend `FieldValidator` (declarative rules) + generated Zod for frontend forms/request bodies (`MutateOptions.validate`) — one definition, both sides | typegen Zod · `FieldValidator`                       |
| 8   | **Unnecessary auth round-trips**                                | expired tokens cleared up front (client-side `exp` check) + 401 self-heal — no doomed request, no 401+refresh dance                                                                 | SDK `isTokenExpired`/`refreshSession`                |
| 9   | **Duplicate writes**                                            | client UUID + `Idempotency-Key` + offline queue replay (409 = already landed)                                                                                                       | SDK items/offline                                    |

## Offline queue + app hooks (the gateway wiring)

`createClient` accepts an `offlineQueue` plus four app-level hooks so the app
routes its ENTIRE data pipeline through one client (auth → offline → error →
connectivity → cache):

```ts
import { createClient, createOfflineQueue, localStorageQueueStorage } from '@mmbix/sdk';

const client = createClient<Schema>({
	baseUrl: '/api',
	tokenStorage: localStorageTokenStorage(),
	refreshSession: () => client.auth.login(initData).then((r) => (r.status === 'approved' ? r.token : null)),

	// Network-failed WRITES are stashed here and replayed on reconnect. Reads,
	// login calls and FormData bodies NEVER queue; per-request `noQueue: true`
	// opts read-encoded POSTs (e.g. `/reports/execute` GROUP-BYs) out as well.
	offlineQueue: createOfflineQueue({
		storage: localStorageQueueStorage('mmbix-sdk-offline-queue'),
		baseUrl: client.baseUrl,
		getToken: () => client.auth.getToken(),
	}),

	// Fired after every successful non-login write — invalidate read caches here.
	onWrite: (path) => {
		invalidateListReads(pathToCollections(path));
	},

	// Fired when a response carries the engine's change envelope (meta.changed) —
	// the EXACT collections this write touched, including server-side hook/denorm
	// writes the client cannot see. Prefer this over onWrite: invalidate only what
	// actually changed instead of guessing.
	onChange: (change) => {
		for (const collection of change.collections) invalidateCollection(collection);
	},

	// Fired when a write was stashed for replay — drive the sync banner.
	onQueued: (item) => {
		banner.setPending(item.path);
	},

	// Fired on any HTTP/envelope failure — funnel into the app's error toasts.
	onError: (_p, _m, status, message) => toast.error(message),

	// Fired on every request outcome: ok=true when the server answered at all
	// (even 4xx/5xx — the API is reachable), ok=false on network failure.
	onSettled: (_p, _m, ok) => connectivity.set(ok),
});
```

The change envelope (`meta.changed`) is the zero-waste counterpart to blind
invalidation: the engine already knows every collection a write touched (its own
row, cascade parents, hook/denorm writes) and reports them, so `onChange` refreshes
exactly those queries. Reads never carry it.

Replay semantics (`createOfflineQueue.flush()`): 2xx **and** 409 (the write
already landed — idempotent replay) count as success; **except** a 409 on a
queued write that carried `ifMatch` — that is a real optimistic-concurrency
rejection (the record changed while offline, the server refused the stale
write), so the item is **dropped** and surfaced via `onFailed` (never counted
as replayed). Permanent 4xx (non-409) are **dropped** too (retrying can't help
— surfaced via `onFailed`); 5xx / network errors stay queued for the next
attempt. Storage/fetch/token are injected, so the same queue runs in the
browser, a Worker BFF, or Node.

**Account scoping.** The queue is tagged with the writing account's fingerprint —
a hash of the token's `user_id` subject (`tokenSubjectOf`), _not_ of the token
bytes: the server mints a fresh token on every login/refresh, so hashing the
token would read one user's re-login as a different account. A queue tagged for
another account is never replayed (its items are kept — the owner may return —
and `flush()` reports the mismatch via `console.warn` + a `0` count); an EMPTY
queue simply adopts the current identity, so a device that switches accounts (or
a token that rotates) never warns about writes that do not exist. `clearQueue()`
discards the tag along with the items.

Every mutating request now carries an auto-generated `Idempotency-Key`
(stable across SDK retries + offline replays) unless the caller supplies one
explicitly — so a blind network retry or an offline replay can never duplicate
a server-side write, even when the body carries no client UUID.

### The miniapp is fully on the SDK

`apps/tgapp` routes EVERY data operation through one app-wide client
(`src/shared/api/sdk.ts`): entity CRUD, auth (`sdk.auth.*`), list reads, server
actions and media uploads — with the offline write queue wired into that same
client. `src/shared/platform/offline.ts` is the app-side facade (cached pending
count + single-flight `flushOffline()`); `useOfflineSync()` replays on reconnect
/ tab focus / Telegram `activated` and invalidates the QueryClient so replayed
writes surface immediately, and `OfflineBanner` shows the offline / pending
state. New code should call `sdk.items(...)` / `sdk.request` directly.

## React hooks

Pair with **[@mmbix/sdk-react](../sdk-react/README.md)** for TanStack-Query-powered
hooks: `useItems` (dedupe + cache), `useInfiniteItems` (keyset pagination),
`useView` (one-view-one-request), and mutations with automatic write-invalidation.

## Runtime support

Browser, Cloudflare Worker (BFF), Node — `fetch`-based, token storage injected,
no `window`/`localStorage` at module scope (`localStorageTokenStorage` guards
itself).

## Scripts

```bash
pnpm --filter @mmbix/sdk typecheck   # tsc --noEmit
pnpm --filter @mmbix/sdk test        # vitest (incl. live smoke vs dev API)
pnpm --filter @mmbix/sdk build       # bundles bin/typegen.js (node CLI)
```
