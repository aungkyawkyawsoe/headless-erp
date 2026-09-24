# Use Cases — Less Configure, Gain Big Power

The headless entity engine is a **zero-configuration backend for data products**:
point it at a database, define collections via the REST API (or CLI), and you
instantly get a production-grade API + admin panel.
Like Directus — but with enterprise depth built in from day one.

## The core loop (Directus-style)

```
headless init my-saas   →  pnpm dev   →   login
   →  create a collection (REST API / CLI)
   →  you now have a full CRUD API + admin UI for it
```

Nothing to compile, nothing to deploy, nothing to wire up. Define the shape of
your data once — everything else follows.

**Collections are created through the REST API, the CLI, or the Studio schema
designer** — all paths converge on the same validated service. `POST /api/entities`
with a name + fields, and the collection instantly appears in the admin
**Content** tab as browsable CRUD pages (list → detail → create → edit), plus
the full API surface (filters, search, validation, relations, audit…).

```bash
# One command → production collection (auth, forms, search, filters, audit)
headless collection create Blog --template blog
headless collection create Customers --field full_name:text:required --field email:email
```

## What you configure vs what you get

| You configure (~5 minutes)       | You get automatically (no code)                                 |
| -------------------------------- | --------------------------------------------------------------- |
| Admin email + password (at init) | JWT auth, RBAC roles/permissions, admin panel                   |
| A collection + its fields        | REST CRUD + filters (15 operators) + cursor pagination + search |
| Field types (text, number, m2o…) | Validation (12 rule types), defaults, linkage show/hide/calc    |
| A relation field (m2o/o2m)       | Nested resolution, cascade rules, lookup rendering              |
| A collection slug                | Route: `/api/entities/<slug>`, admin UI: `<slug>` list/detail   |
| (optional) a module              | Sidebar nav, menu tree, custom pages                            |
| (optional) a client (factory)    | Isolated D1 + R2 + secrets + workers on Cloudflare              |

The philosophy: **schema = contract**. Your field definitions are the source of
truth for the database tables, the API shape, the admin forms, validation,
search, exports, and reports. Configure the model — the engine generates the rest.

## Beyond CRUD — the enterprise power-ups

All of the below are **data, not code** — install/edit via REST, hot-reloadable,
no deploy:

| Power-up                  | One-liner                                                                                            | Docs                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Declarative workflows** | A JSON state machine per collection — guards, role gates, audit, optimistic locking                  | [workflows](../backend-plugins/workflows-marketplace.md)           |
| **Decision tables**       | Drools-style rules: `amount > 1000 && grade == 'premium'` → set/compute/abort                        | [decision tables](../backend-plugins/decision-tables.md)           |
| **KPI registry**          | Define a metric once (`sum(amount) where status=approved`), materialize, read pre-computed BI values | [KPI + materialization](../backend-plugins/kpi-materialization.md) |
| **Compute everywhere**    | 150 pure functions (NPV, TAX_BRACKETS, MOVING_AVERAGE, CONFIDENCE…) in every guard/rule/formula      | [compute](../compute-core/compute-functions.md)                    |
| **Outbox + idempotency**  | Side-effects become durable + deduped; dead-letter queue for poison messages                         | [idempotency & outbox](../backend-plugins/idempotency-outbox.md)   |
| **Data lineage**          | Per-field audit: where did this value come from, who set it, when                                    | [lineage](../backend-plugins/data-lineage.md)                      |
| **Plugin marketplace**    | DB-driven interceptors, native or binding (separate worker) — hot-reloadable                         | [marketplace](../backend-plugins/workflows-marketplace.md)         |

## Who this is for

### 1. Headless CMS / content platform

Collections like `articles`, `pages`, `categories` with statuses, authors, and
media. Frontend (Next.js, mobile, or the included admin SPA) consumes the REST
or tRPC API. Built-in search, audit trail, saved views, and export make it
production-ready without additional services.

### 2. Internal admin tools (no-code data apps)

Build an inventory tracker, a leave register, or a CRM-lite in an afternoon:
create collections via a few `POST /api/entities` calls (or a script), and get
forms, tables, filters, and dashboards for free. RBAC keeps non-technical users
on rails.

### 3. Multi-tenant SaaS backend (software factory)

One template, many clients. `headless client add acme` provisions an **isolated
stack** (own D1, R2, secrets, workers) with a consistent naming convention —
then `headless client deploy acme` ships it to Cloudflare. Every tenant gets
the same power, zero shared state.

### 4. B2B / agency client projects

Ship a branded admin panel + API per client from the same codebase. The
`@mmbix/design-system` admin UI is included; white-label it and add modules per
client without forking the core.

### 5. Backend-as-a-service for an existing frontend

You already have a SPA/mobile app. Define the data model via the API or CLI,
authenticate with the existing auth flow, and consume typed APIs
(REST + tRPC) with pagination, filtering, search, and media built in.

### 6. Module-based line-of-business apps

Business modules are **scaffolded, not shipped** — `headless module create` prompts
for entities + a frontend plugin (Strapi/Frappe-style generation from templates in
`packages/cli`), and `headless collection create --template <id>` gives you
ready-made collections. A Frappe-style bench where the starter is clean and you
build what you need.

### 7. Enterprise workflows & custom business logic (no-code + code)

Any collection can adopt a **declarative workflow** — a JSON state machine with
custom states, guards (safe expressions), role-gated transitions, and an audit
trail — installed via REST, no deploy:

```bash
curl -X POST http://localhost:8788/api/workflows -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' -d '{
    "name": "Shipment Lifecycle", "collection": "shipments", "initial": "packed",
    "states": ["packed", "in_transit", "delivered", "failed"],
    "transitions": [
      { "id": "ship", "from": "packed", "to": "in_transit", "guard": "doc.verified == true" },
      { "id": "deliver", "from": "in_transit", "to": "delivered", "roles": ["Logistics"] }
    ]
  }'
curl -X POST http://localhost:8788/api/workflows/<id>/transition \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{ "document_id": "<doc-id>", "to_state": "in_transit" }'
```

Business logic sits on the same **event spine** — Odoo/SAP-style interceptors
before insert/update/delete (transform the document, reject it, or run after
events), via either compiled TypeScript hooks (`db('invoices').beforeInsert(...)`)
or a **plugin marketplace** where interceptors are installed from the database
(enable/disable without deploying) and can run as trusted in-worker code or as
a separate worker via a service binding. See
[Declarative Workflows + Marketplace](../backend-plugins/workflows-marketplace.md).

## From zero to a live API in 5 steps

```bash
headless init my-saas --admin-email admin@my.co --admin-name "My Admin" --admin-password 'Strong#Pass1'
cd my-saas
pnpm dev                          # API :8788 · admin UI :5173
# 1. log in at http://localhost:5173 with your chosen credentials
# 2. create a "Products" collection via the REST API (step 4) — then it appears in the admin UI
# 3. start POSTing — the API is live:
curl -X POST http://localhost:8788/api/entities/products \
  -H "Authorization: Bearer <token>" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Widget","price":9.99}'
```

## Power beyond Directus

Directus gives you collections → instant API. This template adds, on top:

- **Cursor pagination** — `O(log n)` indexed page loads, no `OFFSET` scans
- **15 filter operators** + full-text search (FTS5) out of the box
- **Declarative field logic** — validation rules, default expressions,
  show/hide/calc linkage, and **computed fields** (virtual on read, stored as
  filterable real columns, or `SUM()`/`COUNT()` lookups over child rows — all
  no code)
- **Server hooks** — validate / before-insert / after-insert declarative rules
- **Declarative workflow engine** — state machines as data: custom states,
  guard expressions, role-gated transitions, audit trail (`/api/workflows`)
- **Plugin marketplace** — DB-driven interceptors inside the entity pipeline:
  install/enable/disable via REST, no deploy; native or service-binding
  execution (no worker-platform dependency)
- **Fluent interceptor API** — `db('invoices').beforeInsert(fn).insert(data)`
  (Odoo/SAP-style transforms, abort, and after-events)
- **AES-256-GCM field encryption** for sensitive data
- **Audit log, media (R2), reports, saved views, webhooks, scheduler, exports**
- **tRPC end-to-end typed layer** alongside REST
- **Multi-tenant factory deploy** — one command per client stack
- **Modules** — scaffolded business apps on a clean core (`headless module create`)

The trade-off vs Directus: no pre-built business modules and no GraphQL (tRPC + REST
instead). The win: a clean, deterministic template where every module is generated
from the CLI, you stay on Cloudflare's edge, keep the schema contract, and can ship
whole client stacks from the CLI.

## See also

- [Quickstart](quickstart.md) — the 5-minute path
- [Installation](installation.md) — environment & config
- [Entities reference](../backend-api/entities.md) — collections, filters, pagination
- [CLI scaffolders](../cli/README.md) — modules, collections, plugins
