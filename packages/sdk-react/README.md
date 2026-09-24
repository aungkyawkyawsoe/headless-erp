# @mmbix/sdk-react

React server-state engine over [@mmbix/sdk](../sdk/README.md) — dedupe, cache,
**zero-stale write-invalidation**, keyset pagination and **one-view-one-request**
batches, all typed by the generated schema.

```bash
pnpm --filter <app> add @mmbix/sdk @mmbix/sdk-react
```

## Setup

```tsx
import { createClient, localStorageTokenStorage } from '@mmbix/sdk';
import { SdkProvider } from '@mmbix/sdk-react';
import type { Schema } from './generated/schema';

const client = createClient<Schema>({
	baseUrl: '/api',
	tokenStorage: localStorageTokenStorage(),
});

export function App() {
	return <SdkProvider client={client}>{/* your tree */}</SdkProvider>;
}
```

## Hooks

| Hook                                                | What it does                                                     | Zero-waste property                                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `useItems(collection, query?, opts?)`               | One cursor-paginated page                                        | identical (collection, query) across components → **ONE request**; remounts within `staleTime` → **0 requests** |
| `useInfiniteItems(collection, query?, opts?)`       | Infinite keyset pagination via `meta.next_cursor`                | no OFFSET — stable deep pages                                                                                   |
| `useView(sources, opts?)`                           | Declare every data need; **one round trip** to `POST /api/query` | N reads → **1 request**; failed source degrades to `[]`                                                         |
| `useItem(collection, id, opts?)`                    | Single row by id                                                 | cache-shared — the **projection is part of the key** (a lean `*` read and an expanded `*.*` read never collide) |
| `useCreateItem` / `useUpdateItem` / `useRemoveItem` | Writes with **auto-invalidate** of the collection                | zero stale — a write is visible to every consumer instantly                                                     |
| `useItemsMutation(collection)`                      | create/update/remove bundle                                      | —                                                                                                               |
| `usePermissionFields(collection)`                   | The role's field whitelist (`/auth/me`)                          | —                                                                                                               |

### Permission-aware field pruning (opt-in)

```ts
const { data } = useItems('hr_employees', { fields: '*' }, { respectPermissions: true });
// '*' → the role's whitelist; named fields → intersected. The server enforces
// the same rules anyway — the client just never asks for hidden fields.
```

### One view = one request

```ts
const { data } = useView({
	cards: { collection: 'records', query: { filter: { person_id: { _eq: tgId } }, limit: 24 } },
	hero: { collection: 'hr_employees', query: { fields: ['name_mm', 'photo_url'] } },
});
// data.cards / data.hero — ONE round trip total.
```

### Zero-stale writes

```ts
const { mutateAsync } = useCreateItem('records');
await mutateAsync({ body: { type: 'check-in', timestamp: new Date().toISOString() } });
// → invalidates every 'records' query — all mounted lists refetch.
```

## Testing

```bash
pnpm --filter @mmbix/sdk-react test   # vitest (jsdom): dedupe/cache/invalidation/pagination/prune/view
```

## Miniapp integration pattern (worked example)

`a client app` routes EVERY data operation through the SDK app-wide
(`SdkProvider` in `src/app/App.tsx` + the single gateway client in
`src/shared/api/sdk.ts`): auth (`sdk.auth.*`), entity CRUD (`sdk.items(...)`),
list reads (the `sdkListPage`/`sdkListAll`/`sdkListAllPages` bridges), server
actions + media (`sdk.request`), plus the offline queue / error toasts /
connectivity hooks. The legacy REST client is now a thin compat layer that
delegates to the SDK — `src/shared/api/client.ts` exists only for dynamic MVE
collections and the bespoke `fetchCount` (15s TTL) / template caches.

**When to reach for these hooks (new views):** `useView` when a view renders
several SMALL list reads (each ≤ 100 rows) — one `/api/query` round trip;
`useItems`/`useInfiniteItems` for cached/paginated lists; `useItem` for
single-row loads; `useCreateItem`/`useUpdateItem`/`useRemoveItem` for writes
with zero-stale invalidation. The existing MVE list layer stays on the custom
`listCache`/`lookup` maps (purpose-built for infinite scroll + persistence +
DATA_CHANGED refresh) — retrofitting it to TanStack would add churn with no
efficiency gain; cursor-walks (> 100 rows) and custom business endpoints
(attendance summary, `/reports/*`) can't batch into `queryMany` anyway.
