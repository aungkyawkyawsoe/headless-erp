# Client SDK — `@mmbix/sdk` + `@mmbix/sdk-react`

The typed client layer for the headless entity engine — **zero-waste by
construction**: typed queries (no hand-rolled URLs), expired-token awareness,
401 self-heal, transient retry, replay-safe writes, a schema typegen that
produces **one file** with both TypeScript types and Zod schemas (zero drift),
and an offline queue with idempotent replay for flaky networks.

| Package            | Role                                                               | Docs                                                                 |
| ------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `@mmbix/sdk`       | Typed REST client + `mmbix-typegen` CLI + offline queue            | [`packages/sdk/README.md`](../../packages/sdk/README.md)             |
| `@mmbix/sdk-react` | TanStack Query hooks (dedupe, cache, keyset, one-view-one-request) | [`packages/sdk-react/README.md`](../../packages/sdk-react/README.md) |

Runtime: **browser, Cloudflare Worker (BFF), Node** — `fetch`-based, token
storage injected, no `window`/`localStorage` at module scope.

---

## 1. Install

```bash
pnpm --filter <app> add @mmbix/sdk @mmbix/sdk-react
```

## 2. Generate types from your schema (`mmbix-typegen`)

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

- Types are `z.infer<schema>` — **compile-time and runtime can never diverge**;
  re-run after any schema change (`npx mmbix-typegen`).
- **Stored computed fields** (`formula` + `store: true`) are typed by their
  `result_type`: `number` → `z.number()`, `boolean` → `z.union([z.boolean(), z.number()])`
  (D1 returns raw 0/1), `string`/`json` → `z.string()`. **Virtual** formulas
  (computed on read) are omitted from the row shape like o2m/m2m fields — they
  appear only when expanded.
- Full CLI reference: [mmbix-typegen](../cli/typegen.md).

## 3. Typed client

```ts
import { createClient, localStorageTokenStorage } from '@mmbix/sdk';
import type { Schema } from './generated/schema';

const client = createClient<Schema>({
	baseUrl: '/api', // same-origin (Vite proxy / worker)
	tokenStorage: localStorageTokenStorage(), // survives reloads
	refreshSession: () => client.auth.login(initData).then((r) => (r.status === 'approved' ? r.token : null)),
});

// Auth — Telegram (approval gate) + password
const login = await client.auth.login(initData); // 'approved' | 'pending'
if (login.status === 'approved') {
	/* token stored — start the app */
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
	{ ifMatch: created.updated_at }, // optimistic concurrency (409 on stale)
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

## 4. Composable client (Directus-style `.with()`)

Compose only what you need, in any order, with the return type updated per feature:

```ts
const client = createClient<Schema>({ baseUrl: 'https://api.example.com' })
	.with(rest()) // request() / queryMany() / items()
	.with(staticToken('super-secure-token')) // fixed bearer (service accounts)
	.with(authenticate({ tokenStorage, refreshSession })); // full login/logout/refresh
```

| Composable                                         | Adds                                                       | Notes                                                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `rest()`                                           | `request`, `queryMany`, `items`                            | rest-native — same methods as the base client                                                                             |
| `staticToken(token)`                               | `getToken`, `setToken`                                     | fixed bearer — service accounts, cron workers                                                                             |
| `authenticate({ tokenStorage?, refreshSession? })` | `login`, `loginPassword`, `logout`, `getToken`, `setToken` | skips storage already passed to `createClient`                                                                            |
| `graphql()`                                        | —                                                          | **Not offered** — `queryMany()` delivers the practical win (one round trip, exact fields) without a second query language |
| `realtime()`                                       | —                                                          | Roadmap — needs a backend events channel (Durable Objects fan-out / SSE) before `subscribe()` can ship                    |

## 5. Zero-waste guarantees

| Concern             | Mechanism                                                             |
| ------------------- | --------------------------------------------------------------------- |
| No hand-rolled URLs | typed `ListQuery` → `serializeQuery` (filters, fields, cursor, count) |
| Expired token waste | `isTokenExpired` — re-auth up front, no doomed request + 401          |
| 401 churn           | `refreshSession` — one refresh, one retry                             |
| Transient failures  | automatic retry with backoff (408/429/502/503)                        |
| Duplicate writes    | client-generated UUID + `Idempotency-Key`                             |
| Stale overwrites    | `If-Match` optimistic concurrency                                     |
| Type/runtime drift  | typegen emits types AND Zod from the same schema                      |

## 6. Page-size policy (one contract everywhere)

The **backend defines the contract** — values live in `@mmbix/config`
(`API_DEFAULT_LIMIT` / `API_MAX_LIMIT`), exposed via `GET /api/meta`, and every
client-facing endpoint clamps to it. The SDK mirrors + discovers it:

| Constant                        | Value   | Where                                              |
| ------------------------------- | ------- | -------------------------------------------------- |
| `DEFAULT_PAGE_SIZE`             | **25**  | a `list()`/`queryMany` spec with no `limit`        |
| `MAX_PAGE_SIZE`                 | **100** | any `limit` above 100 is clamped server-side       |
| `client.limits`                 | —       | active policy (defaults until `loadLimits()` runs) |
| `normalizePageSize(n, policy?)` | —       | exported helper for custom transports              |

```ts
await client.loadLimits(); // GET /api/meta → { pagination: { default_page_size, max_page_size } }
```

**Aggregate loads walk, they never inflate the page size:**

```ts
let cursor: string | undefined;
const rows = [];
for (let i = 0; i < 6 && (i === 0 || cursor); i++) {
	const page = await client.items('hr_employees').list({ limit: client.limits.maxPageSize, cursor });
	rows.push(...page.data);
	cursor = page.meta.next_cursor ?? undefined;
}
```

### Error codes — a single source (`@mmbix/types` → `GET /api/meta` → SDK)

The error envelope and its codes are a **canonical contract**, not scattered
literals. The catalog lives in `@mmbix/types` (`contract.ts`, `ERROR_CODES`)
and is shared three ways:

- **API** — `fail()` derives the default code for a status from
  `errorCodeForStatus(status)` (`STATUS_TO_ERROR_CODE`); the whole canonical
  set is advertised on `GET /api/meta` under `data.error_codes` (API-only
  subset — SDK-only codes like `NETWORK_ERROR` never leak).
- **SDK** — `@mmbix/sdk` builds its typed errors FROM the same catalog
  (`KNOWN_ERROR_CODES === ERROR_CODES`), so a backend code can never silently
  drift from what clients match on.
- **Tooling** — number of distinct codes and their status map are pinned by
  tests (`apps/api/test/contract.spec.ts`).

Every `HttpError` exposes three fields:

```ts
import { HttpError, apiErrorCodeOf } from '@mmbix/sdk';

try {
	await client.items('x').list();
} catch (e) {
	if (e instanceof HttpError) {
		e.code; // raw server code (preserved as-received, incl. legacy/unknown)
		e.apiCode; // narrowed to the canonical ERROR_CODES (or 'API_ERROR')
		e.requestId; // server request_id, when present
	}
	// Both narrow to the canonical code, or null when unrecognized:
	const code = apiErrorCodeOf(e); // ApiErrorCode | null
}
```

## 7. The 9 classic problems — how the stack prevents them

| #   | Problem                      | Prevention                                                                                                                                                |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Over-fetching                | typed `fields` projection — server skips relation resolution + decryption for unselected columns; `respectPermissions` prunes `*` to the role's whitelist |
| 2   | Under-fetching               | consolidated endpoints (`attendanceSummary`); `client.request()` reaches any business endpoint typed; virtual formulas auto-select their source columns   |
| 3   | N+1 fetching                 | server-side **batched** relation resolution (M2O/O2M/M2M via `IN` queries, never per-row)                                                                 |
| 4   | Waterfall requests           | TanStack Query — sibling hooks fire in parallel; identical keys share ONE request; keyset cursor pagination via `useInfiniteItems`                        |
| 5   | Type drifting                | typegen → ONE file where types are `z.infer<schema>` — compile-time and runtime can never diverge                                                         |
| 6   | Stale caches vs DB state     | write-through invalidation (`invalidateCollection`); the server invalidates its response cache on writes too                                              |
| 7   | Dual validation              | the SAME schema drives both — backend `FieldValidator` + generated Zod for frontend forms (`MutateOptions.validate`)                                      |
| 8   | Unnecessary auth round-trips | expired tokens cleared up front + 401 self-heal                                                                                                           |
| 9   | Duplicate writes             | client UUID + `Idempotency-Key` + offline queue replay (409 = already landed)                                                                             |

## 8. Offline queue + app hooks (the gateway wiring)

`createClient` accepts an `offlineQueue` plus four app-level hooks so the app
routes its ENTIRE data pipeline through one client (auth → offline → error →
connectivity → cache):

```ts
const client = createClient<Schema>({
	baseUrl: '/api',
	tokenStorage: localStorageTokenStorage(),
	refreshSession: () => client.auth.login(initData).then((r) => (r.status === 'approved' ? r.token : null)),

	// Network-failed WRITES are stashed here and replayed on reconnect. Reads,
	// login calls and FormData bodies NEVER queue; per-request `noQueue: true`
	// opts read-encoded POSTs out as well.
	offlineQueue: createOfflineQueue({
		storage: localStorageQueueStorage('mmbix-sdk-offline-queue'),
		baseUrl: client.baseUrl,
		getToken: () => client.auth.getToken(),
	}),

	onWrite: (path) => invalidateListReads(pathToCollections(path)), // invalidate read caches
	onQueued: (item) => banner.setPending(item.path), // drive the sync banner
	onError: (_p, _m, status, message) => toast.error(message), // error toasts
	onSettled: (_p, _m, ok) => connectivity.set(ok), // reachability
});
```

**Replay semantics (`createOfflineQueue.flush()`):**

- 2xx **and** 409 (the write already landed — idempotent replay) count as success.
- A 409 on a queued write that carried `ifMatch` is a real optimistic-concurrency
  rejection → **dropped** + surfaced via `onFailed` (never counted as replayed).
- Permanent 4xx (non-409) are **dropped** too (retrying can't help) → `onFailed`.
- 5xx / network errors stay queued for the next attempt.
- Every mutating request carries an auto-generated `Idempotency-Key` (stable
  across retries + replays) unless the caller supplies one — a blind retry or
  replay can never duplicate a server-side write.
- Storage/fetch/token are injected — the same queue runs in the browser, a
  Worker BFF, or Node.

**Account scoping.** The queue is tagged with the writing account's fingerprint —
a hash of the token's `user_id` subject (`tokenSubjectOf`), _not_ of the token
bytes, because the server mints a fresh token on every login/refresh. A queue
tagged for another account is never replayed (items kept — the owner may return —
`0` returned); an empty queue just adopts the current identity, so an account
switch or a token rotation never warns about writes that do not exist.

## 9. React hooks (`@mmbix/sdk-react`)

| Hook                                                | What it does                                                     | Zero-waste property                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `useItems(collection, query?, opts?)`               | One cursor-paginated page                                        | identical keys across components → ONE request; remounts within `staleTime` → 0 requests |
| `useInfiniteItems(collection, query?, opts?)`       | Infinite keyset pagination via `meta.next_cursor`                | no OFFSET — stable deep pages                                                            |
| `useView(sources, opts?)`                           | Declare every data need; **one round trip** to `POST /api/query` | N reads → 1 request; failed source degrades to `[]`                                      |
| `useItem(collection, id, opts?)`                    | Single row by id                                                 | cache-shared — projection is part of the key                                             |
| `useCreateItem` / `useUpdateItem` / `useRemoveItem` | Writes with **auto-invalidate** of the collection                | zero stale — a write is visible to every consumer instantly                              |
| `useItemsMutation(collection)`                      | create/update/remove bundle                                      | —                                                                                        |
| `usePermissionFields(collection)`                   | The role's field whitelist (`/auth/me`)                          | —                                                                                        |

```ts
const { data } = useView({
	cards: { collection: 'hr_attendance', query: { filter: { employee_tg_id: { _eq: tgId } }, limit: 24 } },
	hero: { collection: 'hr_employees', query: { fields: ['name_mm', 'photo_url'] } },
});
// data.cards / data.hero — ONE round trip total.
```

## 10. Worked example — the miniapp pattern

`apps/tgapp` routes EVERY data operation through one app-wide client
(`src/shared/api/sdk.ts`): entity CRUD (`sdk.items(...)`), auth (`sdk.auth.*`),
list reads (the `sdkListPage` / `sdkListAll` / `sdkListAllPages` bridges),
server actions + media (`sdk.request`), plus the offline queue / error toasts /
connectivity hooks. `SdkProvider` in `src/app/App.tsx` wires the hooks. The
legacy REST client exists only for dynamic MVE collections and bespoke caches.

**When to reach for which hook (new views):** `useView` when a view renders
several small list reads (≤ 100 rows each) — one `/api/query` round trip;
`useItems`/`useInfiniteItems` for cached/paginated lists; `useItem` for
single-row loads; the mutation hooks for writes with zero-stale invalidation.
Cursor-walks (> 100 rows) and custom business endpoints (`/reports/*`,
`attendanceSummary`) can't batch into `queryMany` — call `sdk.request` directly.

## 11. Scripts

```bash
pnpm --filter @mmbix/sdk typecheck   # tsc --noEmit
pnpm --filter @mmbix/sdk test        # vitest (incl. live smoke vs dev API)
pnpm --filter @mmbix/sdk build       # bundles bin/typegen.js (node CLI)
```

## See also

- [mmbix-typegen CLI](../cli/typegen.md) — the generator reference
- [Entities API](entities.md) — the REST surface the SDK wraps (filters, cursor, `POST /api/query`)
- [Computed Fields](../backend-plugins/computed-fields.md) — stored formulas are typed by `result_type`
- [tRPC Layer](trpc.md) — the type-safe RPC alternative for server-to-server calls
- [Authentication](authentication.md) — tokens, providers, RBAC
