# IDP Power-Up — Implementation Plan

**Status:** Ready
**Date:** 2026-08-30
**Design:** `docs/concepts/idp-powerup-design.md`

This plan breaks the IDP power-up into small, independently-testable steps. Each step is a thin layer over existing machinery — no new infrastructure, no new plugins, no duplication.

---

## Phase 1 — Data + API (`idp` domain-module)

**Status: ✅ COMPLETE** — implemented + tested (518/518 API tests pass).

**Goal:** the three IDP entities exist as real collections, with an `/api/idp/*` surface, gated by `DOMAIN_MODULES=idp`.

### Step 1.1 — Register the module

- Add `{ id: 'idp', path: '/api/idp', routes: idpRoutes }` to `domainModules` in `apps/api/src/domain-modules/index.ts`.
- Default `DOMAIN_MODULES` stays `hr,store` — `idp` is opt-in (add `idp` to enable).

### Step 1.2 — Create the `idp` folder

```
apps/api/src/domain-modules/idp/
  routes.ts        # /api/idp/* — environments, deployments, ownership, catalog
  service.ts       # IDP service (speaks only generic engine API)
  collections.ts   # entity definitions for environment/deployment/ownership
```

### Step 1.3 — Entity definitions (`collections.ts`)

Define the three collections as data (mirroring the `templates` registry style):

- `idp_environment`: `name`, `slug`, `kind`, `url`, `is_default`
- `idp_deployment`: `module_id` (relation), `environment_id` (relation), `version`, `status`, `deployed_at`, `deployed_by`
- `idp_ownership`: `module_id` (relation), `owner_type`, `owner_id`, `role`

Provision via the entity engine (`POST /api/collections` path) so DDL + cache invalidation are handled server-side. `required: false` on optional fields (repo rule).

### Step 1.4 — Routes (`routes.ts`)

Mirror the `hr`/`store` route shape (Hono + `requireAuth`, `success`/`fail`, `PermissionEvaluator`):

- `GET /api/idp/catalog` — read-only catalog over `_modules` + ownership + latest deployment (one round trip, like `getAppManifest`)
- `GET/POST/PUT/DELETE /api/idp/environments` — admin CRUD
- `GET/POST /api/idp/deployments`, `GET /api/idp/deployments/:id` — create/list deployment records
- `GET/POST /api/idp/ownership` — assign ownership

### Step 1.5 — Tests (`apps/api/test/idp.spec.ts`)

- Entity CRUD for the three collections
- RBAC: non-admin blocked from write routes, allowed read
- Catalog returns live module data

**Done when:** `cd apps/api && npx tsc --noEmit` clean + vitest passes.

---

## Phase 2 — Portal views (Studio)

**Status: ✅ COMPLETE** — implemented + validated (`tsc --noEmit` clean, `vite build` succeeds).

**Goal:** catalog + app-detail surfaces in the Studio, read-oriented, same login/RBAC.

### Step 2.1 — Catalog page

New Studio page (mirror `AppsPage.tsx`): read-only grid over `GET /api/idp/catalog` — owner, version, environment status, docs link, search/filter.

### Step 2.2 — App detail page

Per-module: ownership, environments, deployment history, linked collections/pages, docs, scorecard status.

### Step 2.3 — Route + nav

Wire into the Studio router + dock.

**Done when:** `cd apps/studio && npx tsc --noEmit && npx vite build` clean.

---

## Phase 3 — Operate wiring

**Status: ✅ COMPLETE** — implemented + tested (520/520 API tests pass).

**Goal:** deployments become governed, cross-environment, observable.

### Step 3.1 — `deployment` as a workflow collection

Declarative state machine: `draft → review → promoted → live`, with `rolled_back`. Guards via safe expression evaluator. Attach via the workflow plugin (side table, no schema change).

### Step 3.2 — Snapshot-diff promotion

`POST /api/idp/deployments/:id/promote` applies a snapshot diff of the module's schema to the target environment, then writes the deployment record.

### Step 3.3 — Events/outbox notifications

Promote-to-prod fires an event → durable outbox → notification (reuse `events`/`outbox` plugins).

**Done when:** a promote action runs workflow transition + snapshot diff + event, all tested.

---

## Phase 5 — Software-factory usage

**Status: ✅ COMPLETE** — implemented + tested (520/520 API tests pass).

**Goal:** factory-level usage telemetry — what's built, adopted, and shipped.

### What was added

- `idp_template_usage` collection — captures golden-path template adoption (the one usage signal not derivable from source tables).
- `GET /api/idp/usage?days=N` — **derived from source-of-truth tables** (`_modules`, `_entity_schemas`, `idp_deployment`, `idp_ownership`), never a parallel log. Returns time-bucketed activity series + health totals + template adoption. Deterministic (same data → same numbers).
- Studio portal: a **Factory activity** card on the catalog page (totals + template adoption).

### Zero-duplication principle

Usage is **derived**, not logged separately — the source tables are the single version of truth. The only new table is `idp_template_usage`, because which template produced which module is otherwise indistinguishable.

---

## Guardrails (from design §10)

- No git/CI/K8s cataloging — that's the only case for real Backstage (separate service).
- No new runtime/database/identity.
- No new plugin duplicating `workflow`/`kpi`/`snapshot`/`templates`.
- New error codes go in `@mmbix/types/contract.ts`, never hardcoded.
