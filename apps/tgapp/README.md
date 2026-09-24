# @mmbix/tgapp — Telegram Mini App

Mobile-first Telegram Mini App frontend for the Mmbix entity engine — React 19 +
Vite + Tailwind v4 + Cloudflare Workers, on the **`@mmbix/sdk`** gateway and the
**`@mmbix/design-system`**.

## Stack

| Layer      | Choice                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI         | React 19 + react-router v7 (lazy routes) + `nuqs` (URL state)                                                                                            |
| Styling    | Tailwind v4 (official Vite plugin) + `@mmbix/design-system/styles.css`                                                                                   |
| Data       | `@mmbix/sdk` app-wide client + `@mmbix/sdk-react` hooks (`SdkProvider`)                                                                                  |
| Backend    | Core API worker (`API` service binding → `WORKER_API` in `infra/env.prod`, today `mff-sys-api`) — dev: Vite proxy → `:8788`; prod: service binding `API` |
| Deployment | `wrangler deploy` (worker `WORKER_MINIAPP` in `infra/env.prod`, today `mff-sys-miniapp` + SPA assets, single-page-app fallback)                          |

## Develop

```bash
# 1. Run the API worker (terminal A) — apps/api
pnpm --filter @mmbix/api dev          # serves http://localhost:8788

# 2. Run this app (terminal B)
pnpm --filter @mmbix/tgapp dev        # http://localhost:5175
```

Open http://localhost:5175 in a plain browser → the auth gate shows a dev
sign-in screen with THIS browser's **unique, persisted demo Telegram ID**
(stable across reloads, distinct per browser/computer — each browser can be a
different test user side by side). The API runs the same approval/revocation
directory gate in dev as in production (`hrm_employees.etg_id` is the source of
truth), so to reach the app cross-browser:

1. Copy the ID the dev screen shows.
2. Register it as an employee's `etg_id` in the directory.
3. Sign in (or re-check on the register screen) → approved.
   Removing that `tg_id` later logs the browser out (same as production). "New id"
   mints a fresh identity for a second demo user on the same browser. A real
   Telegram session (`https://t.me/<bot>/<app>`) uses real `initData` login.

### After creating collections

```bash
	pnpm --filter @mmbix/tgapp typegen    # offline: schema.source.json → src/generated/schema.ts
```

The generated file is the single source of truth for `sdk.items(...)` types and
Zod schemas. Typegen runs OFFLINE from the committed schema snapshot
`schema.source.json` (no live dev API needed); `pnpm typegen:check` fails if the
generated file and the snapshot drift (also enforced in CI).

### Design-system changes

The DS ships a built `dist` — after changing `packages/design-system`, rebuild it:

```bash
pnpm --filter @mmbix/design-system build
```

## Structure

```
src/
  main.tsx                  entry — DS styles BEFORE app CSS, initial theme
  index.css                 Tailwind v4 + theme tokens (dark default, data-theme light)
  app/                      composition root — providers, routing, session gate
    App.tsx                 SdkProvider + router + nuqs + Telegram init
    router.tsx              lazy routes behind AuthGate (single source of navigation)
    auth-gate.tsx           approved / pending / retry session gate
  modules/                  feature modules — one folder per screen area (MECE)
    launcher/               phone-style home: app registry + grid + dock + placeholder
      registry.ts           APPS / DOCK_APP_IDS — the launcher's single source of truth
      launcher-page.tsx     the paged 4-column grid, search, dock
      app-placeholder-page.tsx  /app/:appId screen until an app gets a real page
      app-icon.tsx          AppTile (grid) + DockIcon (dock)
    attendance/            ရုံးတက် — dashboard + requests + approvals
      pages/               the three route screens (attendance, request-list, approvals)
      components/          module-scoped UI (attendance-cards, -header, live-clock, quick-actions)
      data/                api.ts (typed client + fetchers) · types.ts (row shapes) · query-keys.ts (TanStack key factory)
      utils/time.ts        punch-time helpers (formatPunchTime, latestPunchesToday)
  shared/                   cross-module infrastructure (one home per concern)
    api/sdk.ts              THE app-wide SDK client (single data gateway)
    auth.ts                 token storage + telegramLogin (+ dev fallback)
    components/
      app-header.tsx        fixed top app bar (safe-area clearance lives here)
      module-shell.tsx      standard module page shell (app bar + native back)
      skeletons.tsx         Shimmer / ListSkeleton loading states
    platform/telegram.ts    Telegram WebApp bridge (no dependency)
    platform/haptics.ts     haptic feedback wrappers (safe no-ops in browsers)
    platform/theme.ts       data-theme scheme resolution
    time/myanmar.ts         MMT (UTC+6:30) + Burmese date/clock formatting
    url-state.ts            THE URL view-state contract — param keys + parsers
  generated/schema.ts       mmbix-typegen output (regenerate after schema changes)
```

## Conventions

- **Structure rule:** a screen area lives in its own `modules/<name>/` folder,
  categorized into `pages/` (route screens), `components/` (module-scoped UI)
  and `data/` + `utils/` (module logic). Generic code shared across modules goes
  in `shared/<domain>/` (`api`, `auth`, `components`, `platform`, `time`).
  Never create new top-level folders in `src/` besides `modules/*` and
  `shared/*`.
- Every data operation goes through `sdk` (`sdk.items(...)` / `sdk.request(...)`)
  — never raw `fetch` for `/api/*`.
- **Page data goes through TanStack Query** (`useQuery` + a `qk` key factory in
  the module's `data/query-keys.ts`) — the `SdkProvider` in `app/App.tsx`
  already mounts a `QueryClient` (30s staleTime), so navigation between pages
  serves cached data instantly instead of refetching on every mount. Writes
  invalidate their queries by key prefix (e.g. `qk.requestsAll()`).
- **Every `queryKey` comes from a factory** (`qk.*` in `data/query-keys.ts`,
  `masterQk.*`, `globalSearchKey`) — never a bare `queryKey: ['…']` literal, so
  each key has ONE home and can be invalidated by prefix.
- **One server-search standard** (`shared/constants.ts`): `SEARCH_MIN_CHARS = 3`
  - the single settle window `SEARCH_DEBOUNCE_MS = 600`. A picker / kiosk
    type-ahead issues NOTHING below 3 chars (it shows a blank prompt), then one
    debounced request per pause; the list toolbar (no submit affordance) searches
    from 1 char. Static/predefined lists never query at all.
- `@mmbix/sdk-react` hooks (`useItems`, `useView`, mutations) are available
  anywhere under `SdkProvider` (wired in `app/App.tsx`).
- Theme tokens live in `src/index.css`; the DS consumes the same CSS variables.
- **URL view-state contract (`shared/url-state.ts`)** — every screen's view state
  (open tab, filters, search text) lives in the URL so reloads and pasted links
  restore it. Read/write it through **ONE `useViewState(schema)` container per
  screen** — the schema object is that screen's single source of truth for its
  view state; never N × per-key hooks. Keys come ONLY from the canonical
  `URL_PARAM` map and parsers from the shared builders (`searchParam`,
  `pageParam`, `stringParam`, `stringOrEmptyParam`, `stringListParam`,
  `enumParam`) — never a bare key string or an ad-hoc `parseAs*` chain. Rules:
  lowercase **snake_case** keys; one key per concept app-wide (`tab` · `status` ·
  `type` · `location`); defaults are omitted from the URL; the container
  **replaces** (never pushes) so a screen owns one back-press.
  Import: `import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state'`.
- **State model (3 tiers, do not mix)** — (1) _server data_ → TanStack Query
  (`qk` keys); (2) _view state_ → the URL via `useViewState`; (3) _ephemeral UI_
  → `useState` in the component (a sheet's open flag, a pre-debounce input).
  SVOT: a value has ONE home — never mirror a URL value into `useState`, and
  never cache server data outside TanStack Query.
- The BFF worker (`worker/index.ts`) only runs in production — dev uses the Vite
  proxy. `/health` returns worker status.
