# tgapp — Enterprise TanStack Data Layer (whole app)

**Goal:** every API call in the Mini App goes through ONE smart data layer — deduped,
cached with deliberate staleness, invalidated write-through, keyset-paged, typed, and
zero-waste (never refetch what didn't change, never walk what can be scoped server-side).

This is the **current-state + target blueprint** for the whole app. It is the sibling of
the movement-module work (server-scoped `/mro/movement/groups`, in-flight dedupe,
TanStack infinite query) — but applied everywhere.

---

## 1. The three state layers (be clear about what "store" means)

| Layer                                                                                         | Owner                                                                 | Tool in this repo                                                                                       |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Server data** (every API result)                                                            | TanStack Query **cache = the store**. No Redux/Zustand/redux-toolkit. | `@tanstack/react-query` via `@mmbix/sdk-react`                                                          |
| **URL / navigation state**                                                                    | URL search params (survive reload/back/share)                         | `nuqs` (already app-wide via `NuqsAdapter`)                                                             |
| **UI/client state** (sheets open, form drafts, theme, chosen filters that are not URL-worthy) | React local state / context first                                     | `@tanstack/react-store` only when real cross-screen client state appears — server data never goes there |

Rule: if the value came from `fetch`/the SDK it is **server state** → TanStack Query.
A separate global store for API data is the classic enterprise mistake; the query cache
already gives dedupe, GC, retries, devtools, and background refetch.

---

## 2. What already exists (verified — build on it, don't rebuild)

- `SdkProvider` is mounted in `apps/tgapp/src/app/App.tsx` with the app-wide `sdk` client.
- `@mmbix/sdk-react` `createQueryClient()` defaults: **staleTime 30 s · retry 1 ·
  refetchOnWindowFocus false** (`packages/sdk-react/src/index.tsx`).
- Hooks available app-wide: `useItems`, `useInfiniteItems` (keyset via `meta.next_cursor`),
  `useItem`, `useView` (one view = one `POST /api/query` batch, cap 12 sources),
  `usePermissionFields` (`respectPermissions` prunes projections to the role whitelist),
  mutations with **automatic write-invalidation** (`invalidateCollection` clears every
  query whose key starts with the collection, incl. `['view', …]` batches that read it).
- `@mmbix/sdk` handles auth (`isTokenExpired`), offline queue + idempotency, typed query
  builder, `client.request()` for typed business endpoints.
- Server side invalidates its own response cache on writes (`invalidateCollectionReads`),
  so client cache + server cache never disagree for long.

### The gap

Most MRO/hub modules today cast `sdk` to a local `OpsSchema` and hand-roll TanStack keys

- `staleTime`, or use raw `fetch` for domain endpoints. That works but is fragmented:
  keys drift, invalidation is manual, masters are re-walked. This blueprint unifies it.

---

## 3. Call taxonomy — every route falls into exactly one pattern

| #   | Kind of call                                                                                          | Mechanism                                                                                                                         | Cache key                                                   | Invalidation                                                                  |
| --- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| A   | Entity list / detail / search / pickers (`hr_*`, `mro_*`, `veh_*` …)                                  | `@mmbix/sdk-react` `useItems` / `useInfiniteItems` / `useItem`                                                                    | `[collection, normalizedQuery]` (automatic)                 | automatic on that collection's mutation                                       |
| B   | N reads that one screen needs at once                                                                 | `useView` (or `sdk.queryMany`)                                                                                                    | `['view', spec]`                                            | automatic (it knows each source collection)                                   |
| C   | Domain **read-only report** endpoints (`/mro/movement/*`, `/hr/attendance/summary`, custom SQL feeds) | typed module fetch fn (Bearer `{data}` envelope, **in-flight dedupe**) wrapped in `useQuery` / `useInfiniteQuery`                 | module-scoped stable key, e.g. `['mro-movements','groups']` | register "this endpoint reads collection X" → invalidate on X writes (see §6) |
| D   | Business **writes** (create draft, `confirm`, transfers, adjustments)                                 | SDK `items().create/update/…` or typed `client.request()`                                                                         | —                                                           | **prefix invalidation map** (§6) + server cache invalidation                  |
| E   | Whole-set directories                                                                                 | never client-walk a big table for one screen; server keyset endpoint, or `fetchAllPages` **only** behind a long-stale masters key | `[collection, …]`                                           | on master writes                                                              |

---

## 4. Query keys — one design rule

1. First segment is the **prefix/domain** you invalidate: collection slug for entity reads,
   `'mro-movements'` / `'hr-attendance'` for custom feeds.
2. Everything that changes the payload is part of the key: filter, `fields` projection,
   sort, cursor-less scope (`direction`, `location`).
3. Keys are **serializable + stable**: `nuqs` state and object args are normalized
   (`JSON.stringify` via TanStack hashing) — never put functions/Date in a key.
4. URL-owned scope (tab, store filter) belongs in the URL **and** the key, so back/forward
   reuses cache.
5. Every key comes from a **factory** (`qk.*`, `masterQk.*`, `globalSearchKey`) — a bare
   string-literal `queryKey: ['…']` array is never written at a call site. The key
   vocabulary then has ONE home per module (so `tsc` catches a typo) and is invalidatable
   by prefix.

```ts
// pattern A — entities (automatic keys, no factory needed)
const { data } = useItems<OpsSchema, 'mro_item_model'>('mro_item_model', { fields: ['id', 'name'], filter: { … } });

// pattern C — custom feed (stable module key)
export const qk = {
  groups: () => ['mro-movements', 'groups'] as const,
  groupLines: (group: string, direction: MovementDirection, location: MovementStoreScope) =>
    ['mro-movements', 'lines', group, direction, location] as const,
};

export function useMovementGroups() {
  return useInfiniteQuery({
    queryKey: qk.groups(),
    queryFn: ({ pageParam }) => fetchMovementGroups({ cursor: pageParam ?? null }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: MOVEMENT_STALE_MS, // read-only confirmed data: 60 s
  });
}
```

---

## 5. Stale-time tiers — "flawless stale" in one table

The tiers are DEFINED ONCE in `shared/api/invalidation.ts` (`STALE_MS`), with the
master value owned by `MASTER_STALE_MS` in `shared/constants.ts`. No `useQuery`
anywhere may carry a raw millisecond literal — it names a tier.

| Tier               | Constant          | Value                    | What it covers                                                                                                                                                         |
| ------------------ | ----------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live`             | `STALE_MS.live`   | 0 s                      | data that changes outside this screen and must be pixel-fresh (approvals on the same list, my role after admin edit — role app_access already has a 60 s server cache) |
| `list`             | `STALE_MS.list`   | 30 s (sdk-react default) | most lists + per-term picker searches; mutations invalidate instantly anyway                                                                                           |
| `module read-only` | `STALE_MS.module` | 60 s                     | movement feeds/ledger, requisitions, tyres, attendance hub reads (only other modules write them)                                                                       |
| `master`           | `MASTER_STALE_MS` | 5 min                    | pickers/directories: `mro_item_name/suppliers/model`, `hrm_employees`, `veh_fleets` — changed rarely, huge win for every picker                                        |

**The flawless part is not the number — it's write-through invalidation.** A mutation
makes its queries stale _immediately_, so staleTime only controls _passive revisits_.
Anything a user can change on-screen must invalidate; anything a _different_ user could
change needs a modest tier instead of 0 (0 = every mount refetch, the current hub cost).

---

## 6. Smart invalidation for custom endpoints — the source map

Custom feeds don't map to one collection automatically. Keep ONE registry:

```ts
// shared/api/invalidation.ts (abridged — the real registry)
/** Custom (pattern-C) feed prefixes → the collections whose writes make them stale. */
const FEED_SOURCES: Record<string, readonly string[]> = {
	'mro-movements': [
		'mro_inbounds',
		'mro_inbound_lines',
		'mro_outbounds',
		'mro_outbound_lines',
		'mro_transfers',
		'mro_transfer_lines',
		'mro_item_model',
		'mro_item_name',
		'mro_inventory',
	],
	stock: [
		'mro_item_model',
		'mro_inbounds',
		'mro_inbound_lines',
		'mro_outbounds',
		'mro_outbound_lines',
		'mro_transfers',
		'mro_transfer_lines',
		'mro_adjustments',
		'mro_adjustment_lines',
	],
	'store-requests': ['mro_requisitions', 'mro_requisition_lines'],
};

export async function invalidateDomain(queryClient: QueryClient, prefix: string): Promise<void> {
	await queryClient.invalidateQueries({ queryKey: [prefix] });
}
```

Every confirm/create/edit then calls ONE helper (`invalidateDomain(qc, 'mro-movements')`),
so a confirmed inbound refreshes Screen 1's group directory _and_ Screen 2/3 feeds in one
call — no module knows another module's keys.

---

## 7. Every call, dynamically — the decision procedure

When adding ANY new route/call, run this checklist:

1. **Kind?** Entity read → **A** (sdk-react). Part of a screen's batch → **B** (`useView`).
   Domain report → **C**. Write → **D** with the source map. Whole-set → **E** (scoped
   endpoint, never a client walk).
2. **Projection:** always pass `fields` (lean) — never `*` on lists; expand relations only
   when the UI renders them; `respectPermissions` where roles can hide fields.
3. **Pagination:** >1 screen of rows → keyset; `useInfiniteItems` for entities, cursor
   feed helper for pattern C. Sentinel + `waitForScroll` (never auto-drain short lists).
4. **Dedupe:** SDK + TanStack dedupe entity reads; module fetch helpers carry an
   in-flight map (movement's `movementFetch` is the template) so StrictMode/dev remounts
   and double-taps never double-request.
5. **Concurrency:** sibling hooks fire in parallel; a view batches; prefetch the next
   screen (group row → feed page 1 on tap intent) instead of waterfalling.
6. **Freshness:** choose the tier (§5); writes invalidate (§6); never `refetch()` in a
   `useEffect`.
7. **Error/UX:** TanStack `isPending/isError/isFetchingNextPage`; sentinel retry inline;
   one module ErrorBoundary; offline queue from the SDK for writes.

---

## 8. Migration roadmap (per module)

| Module                                                                                                  | Today                                                              | Target                                                                          | Effort   |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- | -------- |
| movement (`movements/`)                                                                                 | Screen 1 done (endpoint + infinite); screens 2/3 local cursor hook | move 2/3 to one shared `useCursorFeed`; register source map                     | S        |
| mro-categories hub                                                                                      | `ops` casts + manual whole walk, stale 0                           | sdk-react `useItems` + **server-scoped** counts endpoint (kill the client walk) | M        |
| goods-issues, inbounds, stock-moves, adjustments, store-requests                                        | `ops` casts, hand keys                                             | sdk-react hooks + prefix source map on confirm/create                           | M        |
| items, employees, fleets, tyres, fluids, odo, incidents, insurances, licenses, maintenances, attendance | mixed (attendance already SDK)                                     | audit → pattern A/B hooks, master tiers, invalidate                             | S–M each |
| shared masters (`mro_item_name/suppliers/model`, employees, fleets)                                     | re-walked per mount                                                | one `master` 5-min stale key per master; invalidate on rename/create            | S        |

Suggested order: **(1)** shared `invalidation.ts` + stale constants; **(2)** movement
screens 2/3 → shared feed hook; **(3)** one vertical (goods-issues + inbounds) fully
converted as the reference; **(4)** sweep remaining modules.

**Status — first pass done:**

- `apps/tgapp/src/shared/api/invalidation.ts` — `STALE_MS` tiers, `FEED_SOURCES`
  registry (domains: `mro-movements`, `stock`, `store-requests`),
  `invalidateDomain()` + `invalidateDomainsReading()`.
- `apps/tgapp/src/shared/hooks/use-cursor-feed.ts` — shared TanStack cursor feed
  hook (per-scope cache keys, `firstPage` extras, `loadFailed`/`moreFailed`).
- Movement screens 2/3 (`movement-models-page`, `movement-ledger-page`) moved off
  their local `useEffect` cursor state onto `useCursorFeed`; screen 2 gained a
  keyed `qk.groupLines` entry — and, with it, a keyed `qk.groupModels` entry for
  its DEFAULT reading (the group's SKU register, `/mro/movement/models`, now
  keyset-paged on `(last movement day, model)`): one screen, two readings
  (`?tab=models|lines`) over the same scope, each streaming its own cursor pages.
  Movement/outbound/inbound stale constants now alias `STALE_MS.module`.
- Write-through confirms (each refreshes its own list AND every domain it
  affects): inbound / outbound / transfer / adjustment confirms call
  `invalidateDomain(qc, 'mro-movements')`; every stock-moving confirm also calls
  `invalidateDomain(qc, 'stock')` (on-hand + expiry reports); an outbound
  confirm additionally calls `invalidateDomain(qc, 'store-requests')` (a
  request-linked issue advances the requisition's fulfilment lifecycle).
- MRO item-model create/edit (`items` pages) call
  `invalidateDomainsReading(qc, 'mro_item_model')` so a re-grouped SKU can never
  leave a cached movement directory listing its lines under the old master.
- mro-categories hub: the item-groups tab now reads ONE aggregate
  `GET /api/mro/catalog/groups` (server-scoped count directory) instead of
  cursor-walking the whole `mro_item_model` catalogue client-side.
- The on-hand report is ONE shared hook (`shared/hooks/use-on-hand-report`,
  `ON_HAND_QUERY_KEY = ['stock','onhand']`, module tier) used by BOTH the stock
  dashboard's quantity tabs and the ပစ္စည်းများ list's qty chips; `items` no
  longer re-walks `/api/mro/stock/onhand` per mount and the cached list rows no
  longer bake a qty (chips merge the live report at RENDER time via the pure
  `onHandByModelOf`). Stock-moving confirms invalidate the whole `stock` domain
  write-through.
- The `mro_item_model` SKU directory is ONE canonical superset read
  (`shared/hooks/use-mro-item-models`, `MRO_ITEM_MODELS_QUERY_KEY =
['mro','item-models']`, master tier: id + name + tracking + expiry_alert_days
  - reference_tread_mm). Every line picker — inbound / outbound / transfer /
    adjustment doc forms, the requisition create form, and the tyres register +
    fitment board + detail sheet — reads THIS single cache entry (tyres filter to
    `tracking === 'serial'` client-side); each module's local fetch + local
    `qk.itemModels` key + per-module directory casts were deleted, and item
    create/edit invalidate the key write-through so a new/renamed SKU shows in
    every picker immediately.
- Done so far: shared invalidation registry + stale tiers, movement screens
  2/3 on `useCursorFeed`, write-through confirms (see above), item-groups
  aggregate endpoint, on-hand + SKU-directory consolidation.
- Remaining: pattern-A/B hook sweep across the remaining verticals (fluids /
  odo / incidents / insurances / licenses / maintenances already partial;
  attendance/vehicles use the SDK).

**Status — second pass (audit remediation, all green: `tsc`, 30 vitest, vite build):**

- Staleness tiers are aliased to TWO single sources everywhere — module
  doc-list feeds → `STALE_MS.module`, master/identity reads →
  `MASTER_STALE_MS` (`shared/constants`) — no module re-declares a raw ms
  number any more (adjustments/items/stock/stock-moves/incidents/insurances/
  licenses/attendance/employees/fleets/fluids/odo/goods-issues/inbounds/
  movements). The mro-categories hub sits on the master tier for its
  supplier tab (write-through after + / rename keeps them fresh).
- Current-employee resolution is ONE memoized, in-flight-coalesced
  implementation (`fetchCurrentEmployee` + `CurrentEmployee` in
  `modules/attendance/data/api.ts`, cached per acting tg id). The local
  clones in store-requests / tyres and the cross-module import from
  store-requests in the incidents pages were deleted; every attributing
  screen (doc confirms, create forms, tyres inspections) imports it from
  attendance.
- The classification masters (`mro_suppliers` / `mro_item_name`)
  are now ONE canonical whole-set read per master in
  `shared/hooks/use-mro-masters.ts` (`['mro','suppliers']`
  / `['mro','item-names']`, master tier). The items form pickers, the
  masters-hub supplier tab and the inbound form's supplier picker all
  collide into those cache entries; the per-module whole-set fetchers
  were deleted. Every writer invalidates the shared key write-through (the
  hub create/edit pages + the items quick-adds + the inbound supplier
  quick-add), so a master added in any module shows in every module's picker.
  `mro_item_name` rows are written under two conventions (`name` quick-add vs
  `name_en`/`name_mm` hub) — the shared directory reads the superset and
  normalizes ONE display `name` (`name_en` → `name`), so both flows render.
- Dead master lookups were deleted from `shared/lookups` (`store_categories` /
  `store_locations` / `store_item_models` / `store_purchases` /
  `hr_departments` + their hooks/types/keys had zero consumers after the MRO
  migration). It keeps only the two live masters (`veh_fleets` +
  `hrm_employees`).
- The asset register read is now ONE server-scoped endpoint,
  `GET /api/mro/assets/holder` (`qk.holderAssets()`): the engine returns every
  issued asset unit of an `assets`-flagged item (a tyre, a jack) with the plate,
  SKU name + photo (`mro_item_model.image`, so a register row paints the SKU's own
  picture instead of a kind glyph), item-name pair, custodian and live readings
  resolved in the same D1 query, scoped by `?vehicle=` or `?employee=`
  (`?filter=` is ignored on this service-owned table, so the old client cursor-walk
  of the whole `mro_stock_serials` register is gone). The wheel plan (both the rig
  and its on-board list), the truck's store request and an employee's asset
  register all read the one entry; the seated-tyre board is derived from it
  client-side (no second read).
  - A register ROW's title is the item name over its SKU (`unitTitleOf` in
    `apps/tgapp/src/modules/tyres/data/labels.ts`), reusing the ONE picker label
    (`mroItemModelLabel`) so a card reads exactly like the form the SKU was chosen
    in — including its dedupe (a model already named “Tyre 11R22.5” under “Tyre”
    is not printed twice) and a kind fallback for an unnamed SKU.
- `fetchAllPages` (whole-set walk, throws on truncation) and `walkPages`
  (early-exit "newest row per group" resolver, used by the fleet care/odo
  reads) are deliberately TWO helpers — different contracts; each now
  cross-references the other so no third variant appears.
- The whole-set walk now OWNS its wire page size: `fetchAllPages` hands the
  fetcher `(cursor, pageSize)` and every caller puts `limit: pageSize` on the
  request (default `LOOKUP_LIMIT` = 100). Previously callers omitted `limit`
  and silently paged at the SDK's 25-row default — one whole-set master read
  (vehicles / item-models / suppliers / item-names / employees)
  became four requests. Every whole-set read is now ONE request until the
  collection truly passes 100 rows.
- The tyres register page no longer double-fetches: it used to fire its
  cursor list BEFORE the shared vehicle/SKU masters arrived (rows joined empty
  at fetch time) and then `useRefetchWhenReady` rebuilt every loaded page the
  moment they landed — two full serials walks per cold mount. The list is now
  gated on the lookups exactly like the fitment board and the detail sheet's
  Move section (masters are warm on every visit after the first), and the
  refetch-on-ready hook was deleted. Cold `/app/tyres`: 3 requests total
  (vehicles + SKU catalog at 100/page + serials page 1) instead of 10.
- Not addressed in this pass (documented debt): the local `OpsSchema` casts
  (they await typegen coverage of the `mro_*`/`veh_*` collections) and batching
  MRO doc-card child-line reads into `POST /api/query`; both are mechanical
  follow-ups with a green baseline.

**Status — third pass (stale-tier SSOT sweep, all green: `tsc -p`, `tsc -b`, 92 vitest, vite build):**

- Every `staleTime` in the app now names a tier constant — no raw millisecond
  literal survives in any `useQuery`. Fixed the stragglers: the four detail
  pages' child-line reads (`ADJUSTMENT_STALE_MS` / `INBOUND_STALE_MS` /
  `OUTBOUND_STALE_MS` / `TRANSFER_STALE_MS` — they had re-typed `60 * 1000`
  next to the imported constant in the SAME file), the personnel/vehicle picker
  searches (`STALE_MS.list`), the five form-seed reads (`staleTime: 0` →
  `STALE_MS.live`), and the attendance summary/shift reads (new
  `ATTENDANCE_STALE_MS`).
- `REQUISITIONS_STALE_MS` and `TYRE_STALE_MS` no longer re-declare `60 * 1000`;
  they alias `STALE_MS.module` like every other module feed constant — the last
  two raw numbers at the definition level.

**Status — fourth pass (search standard + key factories, all green: `tsc -p`, `tsc -b`, 92 vitest, vite build):**

- ONE SERVER-SEARCH standard (`shared/constants.ts`): `SEARCH_MIN_CHARS = 3` + a
  single settle window `SEARCH_DEBOUNCE_MS = 600`. The old `PICKER_SEARCH_*`
  names (15 files) and the banned `DEFAULT_DEBOUNCE_MS` are gone — pickers, the
  list toolbar and the kiosk type-aheads all read the same two numbers.
- The 8 search-first kiosk pages (accidents, fluids, odo, licenses, maintenance,
  movements, insurances, tyres) dropped their local `SUGGEST_DEBOUNCE_MS = 700`
  copies and now GATE the type-ahead at `SEARCH_MIN_CHARS` — a 1–2 char term
  issues NO request (the existing "keep typing or press Search" line covers it),
  while the explicit Search action still resolves ANY length on demand. The list
  toolbar is deliberately NOT gated (it has no submit affordance).
- Every `queryKey` is now a factory call — the last `queryKey: ['…']` literals
  (mro supplier/group edit, item edit, the `?item_name=` preselect, the
  personnel search, the vehicle global search) moved into their owning
  `qk` / `masterQk` / `globalSearchKey`.
- Deliberately NOT added: `placeholderData`/`keepPreviousData`. These lists stream
  pages behind a sentinel and show a skeleton on a key change; keeping the prior
  rows on a FILTER/tab change would render another scope's data as if it were the
  new one. A skeleton is the honest state there — the decision stays.

---

## 9. Do / Don't

**Do** — one fetch per logical read, keyed stably; invalidate by prefix; treat the query
cache as the only server store; scope server-side what can be scoped; keep 4xx out of
retry; let staleTime work for revisits and invalidation work for freshness.

**Don't** — fetch in `useEffect`; `*`-select lists; client-walk whole tables; per-mount
`staleTime: 0` "just in case"; a global store for API data; per-module duplicated
dedupe/key helpers (share the pattern); disable caching to "see changes" (invalidate
instead).

---

## 10. Reference files

- `apps/tgapp/src/app/App.tsx` — `SdkProvider` (client + query client)
- `packages/sdk-react/src/index.tsx` — hooks, defaults, `invalidateCollection`, `useView`
- `apps/tgapp/src/modules/movements/` — the reference implementation (dedupe, groups
  endpoint, infinite query, stale 60 s)
- `apps/tgapp/src/shared/api/` — sdk client (sdk.ts), query-client singleton (query-client.ts), `STALE_MS` tiers + `FEED_SOURCES` registry (invalidation.ts), fetch-all walk helper
