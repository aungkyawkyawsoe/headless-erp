# Headless Entity Engine — Documentation

**The single source of truth for the software factory.** Build any application
(CRM, MES, ERP, HR) from declarative data — this documentation tells you how.

**Runtime:** Cloudflare Workers · **Database:** D1 (SQLite) · **Storage:** R2 ·
**Bundle:** ~224 KB gzip · **Cold start:** ~5 ms

---

## 🚀 Start here (5 minutes)

| Step                            | Doc                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1 · Understand the philosophy   | [Use Cases](getting-started/use-cases.md)                                                           |
| 2 · Run it locally + first curl | [Quickstart](getting-started/quickstart.md)                                                         |
| 3 · Install & configure         | [Installation](getting-started/installation.md) · [Configuration](getting-started/configuration.md) |
| 4 · Read the factory blueprint  | [MECE Capability Map](concepts/factory-blueprint.md)                                                |

---

## 📚 Documentation by domain

### Concepts — how the platform thinks

| Doc                                                | What It Covers                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| [Factory Blueprint](concepts/factory-blueprint.md) | MECE capability map — the platform's buckets and invariants                    |
| [Architecture](concepts/architecture.md)           | Collection engine: facade + collaborators, read/write pipelines, perf patterns |
| [Entities](concepts/entities.md)                   | Dynamic schema, system fields, lifecycle                                       |
| [Field Types](concepts/field-types.md)             | All 40 field types with SQL mappings                                           |
| [Relations](concepts/relations.md)                 | M2O / O2M / M2M / M2A + nested filters                                         |
| [Document Workflow](concepts/document-workflow.md) | Draft → Submitted → Approved → Cancelled                                       |

### Backend API — the REST + tRPC surface (`apps/api`)

| Doc                                                                                                 | What It Covers                                                             |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [API Reference Index](backend-api/README.md)                                                        | All 17 API references in one place                                         |
| [Authentication](backend-api/authentication.md)                                                     | Login, JWT, RBAC, rate limits, dev token                                   |
| [Entities API](backend-api/entities.md)                                                             | Collection + item CRUD, filters, pagination, **read batch (`/api/query`)** |
| [Client SDK](backend-api/sdk.md)                                                                    | `@mmbix/sdk` — typed client, `mmbix-typegen`, offline queue, React hooks   |
| [Users, Roles & Permissions](backend-api/users-roles-permissions.md)                                | User management + RBAC                                                     |
| [Search](backend-api/search.md) · [Audit](backend-api/audit.md) · [Reports](backend-api/reports.md) | Discovery & governance                                                     |
| [Webhooks](backend-api/webhooks.md) · [Scheduler](backend-api/scheduler.md)                         | Events & automation                                                        |
| [Directus → D1 Sync](backend-api/directus-sync.md)                                                    | One-way external HR → `hrm_employees` sync (REST, idempotent)               |
| [tRPC Layer](backend-api/trpc.md)                                                                   | Type-safe RPC with end-to-end types                                        |

### Backend Plugins — declarative enterprise features (`apps/api`)

| Doc                                                                      | What It Covers                                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [Plugins Index](backend-plugins/README.md)                               | All plugin docs in one place                                           |
| [Plugins — Development Guide](backend-plugins/plugins.md)                | Two plugin kinds, lifecycle, events, decision guide                    |
| [Workflows & Marketplace](backend-plugins/workflows-marketplace.md)      | State machines as data, DB-driven interceptors                         |
| [Workflows — Example Guide](backend-plugins/workflow-examples.md)        | PO approval scenario with copy-paste curl                              |
| [Decision Tables](backend-plugins/decision-tables.md)                    | Drools-style business rules                                            |
| [KPI Registry + Materialization](backend-plugins/kpi-materialization.md) | Metric definitions as data, pre-computed BI values                     |
| [Idempotency & Outbox](backend-plugins/idempotency-outbox.md)            | Durable side-effects, dedupe, dead-letter queue                        |
| [Data Lineage](backend-plugins/data-lineage.md)                          | Per-field audit — who set what, when                                   |
| [Computed Fields](backend-plugins/computed-fields.md)                    | Formula fields — virtual / stored / lookup aggregates + cascade recalc |

### Compute & Core — reusable engine (`packages/compute` + `packages/core`)

| Doc                                                          | What It Covers                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| [Compute & Core Index](compute-core/README.md)               | How the engine layer fits together                             |
| [Compute Functions](compute-core/compute-functions.md)       | 150 functions · 13 groups · tree-shaken sub-path imports       |
| [Expression Evaluator](compute-core/expression-evaluator.md) | The safe rule engine — no eval, deterministic, complexity caps |

### CLI — scaffolding & operations (`packages/cli`)

| Doc                            | What It Covers                             |
| ------------------------------ | ------------------------------------------ |
| [CLI Reference](cli/README.md) | Commands, scaffolders, module create       |
| [Commands](cli/commands.md)    | Every command with flags                   |
| [Guides](cli/guides.md)        | Step-by-step workflows                     |
| [Typegen](cli/typegen.md)      | `mmbix-typegen` — SDK schema → types + Zod |

### Security & Design

| Doc                                       | What It Covers                         |
| ----------------------------------------- | -------------------------------------- |
| [Security Overview](security/overview.md) | Auth, rate limiting, injection defense |
| [Design Specs](design-specs/specs/)       | RFC-style feature proposals            |

---

## ⚡ Quick Facts (Verified)

| Metric            | Value                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bundle (gzip)     | ~224 KB                                                                                                                                                                                                |
| Cold start        | ~5 ms                                                                                                                                                                                                  |
| Tests             | **733 passing** on `dev` (core 287 · api 81 · compute 68 · utils 50 · sdk 87 · sdk-react 14 · design-system 42 · studio 75 · tgapp 24 · cli 5)                                                         |
| Field types       | 40                                                                                                                                                                                                     |
| Plugins           | 20                                                                                                                                                                                                     |
| Compute functions | 150 (13 groups, tree-shaken sub-path imports)                                                                                                                                                          |
| Auth              | JWT + Bearer token (dev-token in dev mode)                                                                                                                                                             |
| Error codes       | **Canonical catalog in `@mmbix/types`** (`ERROR_CODES`) — `fail()` derives codes via `errorCodeForStatus`, `GET /api/meta` advertises `data.error_codes`, SDK builds typed errors from the same source |
| Page size         | **Default 25, max 100** — one contract everywhere (`@mmbix/config` → `GET /api/meta` → `@mmbix/sdk` `loadLimits()`); every endpoint clamps                                                             |
| Pagination        | Cursor-based (O(log n) indexed seek)                                                                                                                                                                   |
| Edge caching      | Cache-Control: s-maxage=30s (CDN)                                                                                                                                                                      |
| Rate limiting     | Role-aware tiers (anon 100, auth 300, admin 1000 req/min)                                                                                                                                              |

---

## 🔑 Default Dev Credentials

| Setting              | Value                                           |
| -------------------- | ----------------------------------------------- |
| Admin username       | `dev@mmbics.com` (email, from `ADMIN_USERNAME`) |
| Admin password       | `dev-password-for-local-only` (dev only)        |
| Dev token            | `dev-token` (only when `IS_DEV=true`)           |
| Base URL (local)     | `http://localhost:8788`                         |
| Scalar API Reference | `/api/docs`                                     |

> `headless init` scaffolds a project with **your** admin email / name / password
> written to `apps/api/.dev.vars` — the first login creates that superadmin.

> **🔒 Production:** Never deploy with dev credentials. Use
> `wrangler secret put ADMIN_PASSWORD` and `wrangler secret put JWT_SECRET`.
> See [Security Overview](security/overview.md#production-checklist). All
> `/api/*` routes require auth. Dev: `Authorization: Bearer dev-token`.
> Production: JWT from `POST /api/auth/login`.
