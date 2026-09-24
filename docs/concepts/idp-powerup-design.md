# IDP Power-Up — Design

**Status:** Shipped (`DOMAIN_MODULES=hr,idp,mro`; portal in `apps/studio`, API in `apps/api/src/domain-modules/idp/`)
**Date:** 2026-08-30
**Scope:** Add an Internal Developer Platform (IDP) layer to the Studio so it becomes a build **+ operate + govern** platform for config-driven internal apps — with zero new infrastructure and zero duplication of existing machinery.

---

## 1. Vision

The Studio is already a **software builder**: users create `_modules` (apps) that wrap collections with menus, views, pages, and business logic, rendered by a runtime shell. What it lacks is the **operate + govern** layer around that software.

This design adds an opt-in **`idp` domain-module** plus a **portal surface** in the Studio so that:

> **Studio = where software gets built. IDP = the catalog, ownership, environments, deployments, scorecards, and golden-path scaffolding around that software — powered by the same entity engine, so catalog entries are live, not stale metadata.**

The core thesis: **the existing plugins (`workflow`, `kpi`, `snapshot`, `templates`, `events`/`outbox`, `policies`) are already the IDP's organs.** This power-up wires them together. It does not build new infrastructure.

---

## 2. Why native, not Backstage/Cortex/Port

|                                        | Native IDP (this design) | Backstage          | Cortex  | Port    |
| -------------------------------------- | ------------------------ | ------------------ | ------- | ------- |
| Runs on workerd                        | ✅                       | ❌ (Node+Postgres) | ❌ SaaS | ❌ SaaS |
| Reuses entity engine / RBAC / workflow | ✅                       | ❌                 | ❌      | ❌      |
| Catalog entries are **live** apps      | ✅                       | ❌ synced metadata | ❌      | ❌      |
| Fits config-driven app builder         | ✅                       | ❌ (code/repos)    | ⚠️      | ⚠️      |
| FOSS plugin ecosystem                  | ❌                       | ✅                 | ❌      | ❌      |
| Operational cost                       | Low                      | High               | Paid    | Paid    |

**Decision:** build native. Backstage catalogs source code/repos/CI — a different universe from config-driven apps. Cortex/Port would make us pay to duplicate our own entity engine. Our catalog is live because it _is_ the source of truth.

---

## 3. Data model — three new entities (opt-in)

All three are plain entity-engine collections, gated by `DOMAIN_MODULES=idp`. No new tables beyond what the entity engine already creates.

### 3.1 `environment`

Represents a deploy target.

| field        | type    | notes                                               |
| ------------ | ------- | --------------------------------------------------- |
| `name`       | text    | e.g. "Production"                                   |
| `slug`       | text    | `dev` / `staging` / `prod`                          |
| `kind`       | text    | `dev` / `staging` / `prod` (drives promotion order) |
| `url`        | text    | optional base URL                                   |
| `is_default` | boolean | default target for new modules                      |

### 3.2 `deployment`

Represents one release of a module to an environment.

| field            | type                     | notes                                                    |
| ---------------- | ------------------------ | -------------------------------------------------------- |
| `module_id`      | relation → `_modules`    | the app being deployed                                   |
| `environment_id` | relation → `environment` | the target                                               |
| `version`        | text                     | maps to module `config_version`                          |
| `status`         | text                     | `draft` / `review` / `promoted` / `live` / `rolled_back` |
| `deployed_at`    | datetime                 |                                                          |
| `deployed_by`    | relation → user          | from auth context                                        |

`deployment` is a **workflow collection** (see §5.1) — its `status` is driven by the workflow engine.

### 3.3 `ownership`

Assigns responsibility for a module.

| field        | type                  | notes                                        |
| ------------ | --------------------- | -------------------------------------------- |
| `module_id`  | relation → `_modules` |                                              |
| `owner_type` | text                  | `user` for now; `team` is a future extension |
| `owner_id`   | relation → user       |                                              |
| `role`       | text                  | `owner` / `maintainer` / `viewer`            |

`ownership` maps onto existing `policies` RBAC scopes (§5.5). **Phase 1 ships `user` ownership only** — a `team` entity is deliberately out of scope until a real need appears (YAGNI).

---

## 4. Portal surface (Studio)

A new Studio page, **distinct from the schema designer**. Portal consumers (read-oriented) differ from schema editors (write-oriented); same login, same RBAC, differentiated views.

### 4.1 Catalog view

Read-only grid over `_modules` + `ownership` + `deployment`:

- each module card: name, owner, latest version, environment status, docs link
- search + filter by owner / environment / status

### 4.2 App detail view

Per-module: ownership, environments, deployment history, linked collections/pages, docs, scorecard status.

### 4.3 Golden-path scaffolder

Surface the existing `templates` registry + CLI in the UI: "new module from approved template," with versioning and promotion.

---

## 5. Synergy wiring — how new features amplify existing machinery

The power is **multiplicative**: one action flows through five existing systems.

### 5.1 Deploy-approval = `workflow`

`deployment` becomes a workflow collection. A declarative state machine governs `status`:
`draft → review → promoted → live`, with rollback. Guards use the safe expression evaluator (e.g. `user.is_admin == true`). Every transition is audited (`_workflow_history`). **Workflow finally gets a flagship use case.**

### 5.2 Cross-environment IaC = `snapshot`

Promoting a module dev→staging→prod applies a **snapshot diff** of its schema. Environments give `snapshot` a target; `snapshot` gives environments a promotion mechanism.

### 5.3 Scorecards = `kpi` + `decision-table`

"Every prod app has an owner + docs + a live deployment" becomes a **KPI** over the catalog, materialized nightly, shown on the catalog view. KPI gets a purpose beyond dashboards.

### 5.4 Ship visibility = `events` + `outbox`

Promote-to-prod fires an event → durable outbox → notifications. Events get a real consumer.

### 5.5 Ownership = `policies` RBAC

`owner`/`maintainer`/`viewer` maps to existing permission scopes. "Who can promote to prod" is enforced by the same `policies` machinery. Ownership gives RBAC a subject.

### 5.6 Self-serve creation = `templates` + CLI

The scaffolder UI surfaces the existing `templates` registry (`v_template.json`) and `headless` CLI. Templates stop being a hidden JSON registry.

---

## 6. Module boundary

Follow the existing `domain-modules` convention exactly (mirror `hr`/`store`):

```
apps/api/src/domain-modules/idp/
  routes.ts        # /api/idp/* — environments, deployments, ownership, catalog
  service.ts       # IDP service (speaks only generic engine API)
  collections.ts   # entity definitions for environment/deployment/ownership
```

- Mounted via `mountDomainModules` (§ `domain-modules/index.ts`)
- Gated by `DOMAIN_MODULES=idp` — disabled = 404, never dead code
- Factory core (`routes/`, `plugins/`, `lib/`, `services/`) never imports it

---

## 7. Phased plan

**Phase 1 — Data + API**

- `idp` domain-module: `environment`, `deployment`, `ownership` entities + routes
- `DOMAIN_MODULES=idp` gating
- Tests: entity CRUD, RBAC on IDP routes

**Phase 2 — Portal views**

- Catalog view + app detail view in Studio
- Same login/RBAC, read-oriented

**Phase 3 — Operate wiring**

- `deployment` as a workflow collection (draft→review→promote→live)
- Snapshot-diff promotion across environments
- Events/outbox notifications on deploy

**Phase 4 — Govern + create**

- Scorecard KPIs over the catalog
- Golden-path scaffolder UI (templates + CLI)

---

## 8. Error handling

- New failure codes MUST be added to `@mmbix/types/contract.ts` (`ERROR_CODES`), never hardcoded — per repo contract.
- IDP routes use the existing `success`/`fail` response helpers and `requireAuth`/`requireAdmin`.
- Workflow guards return the same validation errors as the workflow plugin.

---

## 9. Testing

- `apps/api/test/idp.spec.ts`: entity CRUD, RBAC, workflow transitions on `deployment`, snapshot promotion, scorecard KPI computation.
- Always `cd apps/api && npx tsc --noEmit` + vitest after changes.
- Studio: `cd apps/studio && npx tsc --noEmit && npx vite build`.

---

## 10. Non-goals (guardrails)

- **No** git-repo / CI / Kubernetes cataloging. If that need ever appears, real Backstage runs as a _separate_ Node service with read-only API + SSO — never in-worked, never in this module.
- **No** new runtime, database, or identity model.
- **No** new plugin that duplicates `workflow`/`kpi`/`snapshot`/`templates` — the IDP only _consumes_ them.
- **No** `_custom_widgets` table or `/api/widgets` route — widgets remain real design-system files.
