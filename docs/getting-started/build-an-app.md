# Getting Started — zero to a production app (the complete walkthrough)

Everything, in order: **install → configure → run → build every feature → verify → harden → operate → deploy → maintain**.
Follow top to bottom and you go from an empty machine to a live, governed app.

> **Mental model:** the factory is a **headless entity engine** (Cloudflare Workers + D1 + R2) with a **visual
> Studio** and an **agent control plane (MCP)**. You declare _data_ (collections, pages, roles, jobs) and the
> engine provides auth, CRUD, validation, audit, search, cache, offline and more. One factory-level module
> (`idp`) and gated plugins ship with it; your own verticals are added as modules.

---

## 0. TL;DR (the fast path)

```bash
pnpm install
pnpm dev                      # API :8788 · Studio :5174
open http://localhost:5174    # log in with apps/api/.dev.vars admin credentials
```

Then **either** build in the Studio (`/apps/<app>`), **or** let an agent do it over MCP (§15), **or** curl the API (§6).

---

## 1. Prerequisites

| Tool               | Version | Why                         |
| ------------------ | ------- | --------------------------- |
| Node.js            | ≥ 20    | runtime + tooling           |
| pnpm               | ≥ 10    | workspace package manager   |
| Wrangler CLI       | ≥ 4     | `npx wrangler` (dev/deploy) |
| Cloudflare account | —       | only for §18 deploy         |

Optional: **opencode** (the agent path, §15) · a **Stitch** API key (design source, §15).

---

## 2. Install

```bash
git clone <repo-url> && cd headless-erp
pnpm install
```

### Project anatomy

```
apps/
  api/        ← the engine worker (Hono + D1 + R2), the `idp` module, gated plugins, the Factory MCP
  studio/     ← the visual Studio (schema designer, page builder, admin, IDP portal)
packages/
  core/       ← D1 client, QueryBuilder, entity engine, expressions, cache
  types/      ← shared types incl. the DSL (codec / patch / app) + the ModuleManifest contract
  utils/ config/ compute/ scheduler/ sdk/ sdk-react/ design-system/ ui-views/ views/ cli/ …
infra/        ← env.prod / env.testco — the single source of truth for resource names
sandbox/      ← local AI sandbox (dev tool)
docs/         ← this documentation
```

---

## 3. Configure

### 3.1 The env SSOT (never edit wrangler by hand)

`apps/api/wrangler.jsonc` and `apps/api/wrangler.testco.jsonc` are **generated** from `infra/env.prod` and
`infra/env.testco`:

```bash
pnpm gen:infra     # regenerate configs from the env files
pnpm check:infra   # drift gate — run in CI
```

`infra/env.prod` holds every resource **name** (worker, D1, R2, queues, analytics dataset, domain) and
non-secret vars. Full resource map: `infra/README.md`.

### 3.2 Local secrets (`apps/api/.dev.vars`, git-ignored)

`headless init` writes these for you:

```bash
npx headless init . --db-name my-saas-db --admin-email admin@my.co --admin-name "My Admin" --admin-password 'Strong#Pass1'
```

| Var                                                | Meaning                                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_NAME` | the bootstrap admin (first login creates it)                                        |
| `JWT_SECRET`                                       | signs session tokens                                                                |
| `IS_DEV="true"`                                    | **local-only** — enables the public `dev-token` as full admin. Never in production. |

### 3.3 Production secrets (`wrangler secret put` — never in `vars`)

`ADMIN_PASSWORD` · `JWT_SECRET` · `BACKUP_ENCRYPTION_KEY` (hex 64 — without it the nightly R2 backup **fails
closed**) · plus any provider tokens (`TELEGRAM_BOT_TOKEN`, …).

### 3.4 Feature flags

Which add-ons ship is build-time gated by `PLUGINS` (unset ⇒ all, `none` ⇒ none, a list ⇒ only those) and
`DOMAIN_MODULES` (this repo ships `idp`). A disabled plugin's routes **404** and register nothing. Runtime
install/remove is the `_addons` table (§15.6).

---

## 4. Run locally

```bash
pnpm dev
```

| Process                 | URL                     | Notes                                  |
| ----------------------- | ----------------------- | -------------------------------------- |
| `@mmbix/api` (wrangler) | `http://localhost:8788` | engine + **Factory MCP** at `/api/mcp` |
| `@mmbix/studio` (vite)  | `http://localhost:5174` | the Studio                             |

```bash
curl http://localhost:8788/api/health          # {"status":"ok","version":"…"}
# interactive API reference (Scalar):
open http://localhost:8788/api/docs
```

**Login:** the `ADMIN_*` values from `apps/api/.dev.vars` (factory default `dev@mmbics.com` /
`dev-password-for-local-only`). In dev, `Authorization: Bearer dev-token` bypasses login.

---

## 5. First 5 minutes — the Directus-style loop

Create a model and you instantly get CRUD + auth + validation + filters + search + pagination + audit.

```bash
# 1) create a collection (this runs the DDL server-side)
curl -X POST http://localhost:8788/api/collections \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer dev-token' \
  -d '{"name":"Products","fields":[
        {"name":"title","type":"text","required":true},
        {"name":"price","type":"currency"},
        {"name":"status","type":"select","options":["active","archived"],"default":"active"}]}'
# → 201, table_name "cms_products"

# 2) create / list / filter / sort / paginate
curl -X POST http://localhost:8788/api/entities/products \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer dev-token' \
  -d '{"title":"Widget","price":9.99}'

curl "http://localhost:8788/api/entities/products?filter%5Bprice%5D%5B_gt%5D=5&sort=-created_at&limit=25" \
  -H 'Authorization: Bearer dev-token'
# → data:[…], meta:{ limit, has_more, next_cursor }   (page size default 25, max 100; cursor = O(log n) keyset)
```

Every row carries system fields: `id`, `doc_status`, `created_at`, `_owner`, soft-delete columns.

- Soft delete `DELETE /api/entities/products/<id>` → restore `POST …/restore` → hard delete `DELETE …/force` (admin).
- Batch reads for one screen: `POST /api/query` with `{ requests:[{ collection, params }] }` (≤12, parallel).
- Writes answer with a **change envelope** `meta.changed = { collections, rows }` so a client invalidates precisely.

---

## 6. The data plane (what you're modelling)

| Concept           | Notes                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| **Field types**   | **41** — the SSOT is `packages/utils/src/field-types.ts` (`text currency select m2o m2m json formula …`) |
| **Required**      | a field is `NOT NULL` **unless** `required:false` is explicit                                            |
| **Unique**        | soft-delete-aware partial index (`uidx_<table>_<col> … WHERE deleted_at IS NULL`)                        |
| **Relations**     | `m2o` / `o2m` / `m2m` / `m2a`; nested filters ride the same query                                        |
| **System fields** | `id doc_status display_number _owner created_at updated_at deleted_at`                                   |
| **Filters**       | `?filter[field][_eq                                                                                      | _gt | _lt | _in | _contains…]=…` |
| **Pagination**    | cursor-based (`meta.next_cursor`)                                                                        |
| **Search**        | `?search=` — per-collection policy picks `contains` or index-backed `prefix`                             |
| **Change schema** | `PUT /api/collections/:slug` (adds fields via the same migrator the Studio uses)                         |

Deep dives: [Entities](../backend-api/entities.md) · [Field Types](../concepts/field-types.md) ·
[Relations](../concepts/relations.md).

---

## 7. Auth & access

| Layer            | How                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------- |
| **Dev**          | `Authorization: Bearer dev-token` (only when `IS_DEV=true`)                             |
| **Login**        | `POST /api/auth/login` → JWT; send `Authorization: Bearer <jwt>`                        |
| **Providers**    | Clerk / Auth0 / Supabase / OIDC are wired into `requireAuth` (auto-verified)            |
| **RBAC**         | roles + per-collection grants + **field-level** restrictions + **row filters**          |
| **Machine keys** | `_api_keys` with a **scope** (`read`                                                    | `write` | `admin`, default `read`; a read key is refused a mutating tool/route) |
| **Employees**    | a web login can sign in _as an employee_ (`_users.employee_id`); offboarding revokes it |

```bash
curl -s -X POST localhost:8788/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"<admin>","password":"<password>"}' | head -c 200
curl -s localhost:8788/api/auth/me -H "Authorization: Bearer <jwt>"
```

Authz is **version-keyed** (a role/permission change lands on the very next read, across isolates), and a
client should re-read `/auth/me` on resume. Deep dive:
[Authentication](../backend-api/authentication.md) · [Users, Roles & Permissions](../backend-api/users-roles-permissions.md).

---

## 8. The two UIs

| Route         | Surface                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `/`           | Apps gallery                                                                                           |
| `/apps/:slug` | **App workbench** — schema designer, page canvas, menus, layouts, **Policy panel**, **Generate panel** |
| `/studio`     | Studio admin — users, roles, config, DS exports, add-ons, API keys, **Operations** telemetry           |
| `/idp/*`      | IDP portal — catalog, environments, deployments, usage, policies, audit, access, users                 |
| `/api-docs`   | Scalar API reference                                                                                   |

The Studio is **RBAC-aware** (a non-admin never sees a control the API would 403) and code-split (the entry
bundle is ~20 kB).

---

## 9. UI: pages & blocks

A page is `{ path, title, module?, blocks[] }`. A block is `{ id, type, label?, layout:{order,colSpan}, config }`.
The **block vocabulary is `BLOCK_REGISTRY`** (`packages/ui-views/src/block-registry.ts`) — read it over MCP as
**`factory://blocks`**, which also carries each block's `defaults` (how to configure it) and nesting rules.

Common blocks: `table` `{title,collection,limit}` · `list` · `entity-form` `{collection}` · `kpi`
`{label,collection}` · `chart` · `report` · `pivot` · `kanban` `{collection,groupBy}` · `calendar`
`{collection,dateField}` · `row`/`column`/`grid`/`card` (containers) · `heading`/`section-header`.

Add blocks three ways:

```bash
# a) manifest page (declarative)
curl -s localhost:8788/api/mcp -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"apply_manifest","arguments":{"manifest":{
       "version":1,"pages":[{"path":"/orders","title":"Orders","blocks":[
         {"id":"t1","type":"table","layout":{"order":0},"config":{"collection":"po"}}]}]}}}}'

# b) patch an existing page (idempotent by id) — ops: ADD MOVE REMOVE UPDATE BIND SPLIT
curl -s localhost:8788/api/mcp -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"apply_patch","arguments":{
       "page_id":"<id>","ops":[{"id":"o1","op":"ADD","parent":"t1","node":{
         "id":"k1","type":"kpi","layout":{"order":0},"config":{"label":"Total","collection":"po"}}}]}}}'
```

**c)** drag-and-drop on the Studio **Page canvas** (`/apps/<slug>`).

> An unknown block `type` is **dropped with a warning** at every write seam — a block the renderer cannot draw
> is never persisted. Menus are a separate manifest key and need an existing module.

---

## 10. Policies (per collection, no redeploy)

Studio **Policy panel** (App workbench + Collections workbench) or:

```bash
curl -s -X PUT localhost:8788/api/collections/po/policies \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"policies":{ "cache":{"enabled":true}, "offline_reads":{"enabled":false},
        "writes":{"mode":"any","append_only":false,"frozen_fields":[],"actor_fields":["_owner"]},
        "search":{"mode":"prefix","fields":["code"]},
        "integrity":{"enabled":true,"limit":50,"rules":[{"type":"duplicate","fields":["code"]}]},
        "generation":{"enabled":true,"require_review":true},
        "design_source":{"provider":"none"} }}'
```

| Policy          | Effect                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `cache`         | per-collection response cache                                                                  |
| `offline_reads` | advertise `X-Offline-Max-Age` so a client may persist rows (deny-by-default)                   |
| `writes`        | `service` (generic API 403) · `append_only` · `frozen_fields` · `freeze_when` · `actor_fields` |
| `search`        | `contains` (default) or index-backed `prefix`                                                  |
| `integrity`     | bounded data-quality rules → `GET /api/collections/:slug/integrity`                            |
| `generation`    | the design→schema gate (OFF by default)                                                        |
| `design_source` | accepted design provider (`none`/`stitch`/`figma`/`manual`)                                    |

Schema/policy saves support optimistic concurrency: send `If-Match: <_schema_version>` and a stale write is a
**409** with `current_version`.

---

## 11. Automation (all declarative — no `eval`, no server code)

| Feature                      | Where                      | Notes                                                                                                       |
| ---------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Server functions** (hooks) | manifest `serverFunctions` | JSON rules on `after_insert`/`after_update`/…                                                               |
| **Linkage rules**            | field inspector / schema   | `visible_when` / `readonly_when` / `required_when`                                                          |
| **Validation**               | schema                     | 12 rule types, expression-based                                                                             |
| **Defaults**                 | schema                     | expression defaults                                                                                         |
| **Computed fields**          | `formula` field type       | virtual / stored / lookup aggregates + cascade recalc                                                       |
| **Workflows**                | manifest `workflows`       | states + transitions + doc-status map                                                                       |
| **Decision tables**          | plugin                     | Drools-style rules                                                                                          |
| **Outbox / webhooks**        | plugins                    | durable side-effects, retries, dead-letter                                                                  |
| **Jobs (cron/repeat/once)**  | manifest `schedules`       | `type` must come from `list_handlers` (`query.rollup`, `notify.digest`, `entity.expire`, `http.request`, …) |

```bash
# a nightly job the watchdog arms even if the DO alarm is lost
curl -s localhost:8788/api/mcp -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"apply_manifest","arguments":{"manifest":{
       "version":1,"schedules":[{"name":"nightly-rollup","type":"query.rollup","cron":"0 3 * * *",
         "payload":{"collection":"po","measures":[{"op":"sum","field":"total"}]}}]}}}}'
```

An unregistered handler `type` is refused by **plan and apply** and writes no row — a typo never becomes a job
that silently never runs.

---

## 12. Analytics & governance

| Feature           | How                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| **KPIs**          | manifest `kpis` — materialized aggregates (`_kpi_values`)                                          |
| **Reports**       | manifest `reports` — named on-demand exports (`POST /api/scheduled-reports/schedule/:id/generate`) |
| **Integrity**     | `GET /api/collections/:slug/integrity` (declared rules: orphan/aggregate_mismatch/duplicate/stale) |
| **Audit**         | `GET /api/audit` · MCP `get_audit`                                                                 |
| **Data lineage**  | per-field audit (who set what, when)                                                               |
| **Index advisor** | MCP `get_operations` (default) · Studio Operations tab                                             |

---

## 13. AI: governed generation + the compact DSL

**Design → schema + UI** goes through a human gate (a state, not a yes/no):
`draft → review → promoted → live`. `apply` is the **only** write; it creates the collection first, then
upserts the page(s), idempotently.

```bash
curl -s localhost:8788/api/mcp -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"propose_schema","arguments":{
       "collection":{"name":"Purchase Order","slug":"po"},
       "prompt":"Purchase Order with code, total: currency, due date"}}}'
# → { id, status:"draft", fields:[…], pages:[…] }   (nothing written)

ID=<id>
curl -s -X PATCH localhost:8788/api/generation/$ID/fields -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' -d '{"fields":[{"name":"total","type":"currency"}]}'   # learned next time
curl -s -X POST localhost:8788/api/generation/$ID/submit  -H 'Authorization: Bearer dev-token'
curl -s -X POST localhost:8788/api/generation/$ID/approve -H 'Authorization: Bearer dev-token'
curl -s -X POST localhost:8788/api/generation/$ID/apply   -H 'Authorization: Bearer dev-token'
```

**The compact App DSL** (an encoding, not a second engine) makes agent payloads ~38% smaller:

```jsonc
{
	"v": 1,
	"cols": [{ "s": "po", "n": "Purchase Order", "f": ["code:text!", "total:cur", "supplier:m2o>supplier", "status:sel(draft,approved)"] }],
	"pages": [
		{ "p": "/orders", "t": "Orders", "b": [{ "id": "t1", "type": "table", "layout": { "order": 0 }, "config": { "collection": "po" } }] },
	],
	"roles": ["Clerk", { "n": "Manager", "d": "approves" }],
	"grants": [{ "r": "Clerk", "c": "po", "can": "rwc" }],
	"menus": [{ "m": "finance", "l": "Orders", "target": "po" }],
	"kpis": [{ "n": "PO Count", "c": "po", "agg": "count" }],
}
```

Shorthand: `name:type` (`!` required, `#` unique), `>target` relation, `(a,b,c)` options; permission letters
`r w c d s a`. Pass it as `app` to `plan_manifest`/`apply_manifest`. Deep dive:
[Governed Generation](../backend-api/generation.md).

---

## 14. Operations & maintenance (day 2)

```bash
# job health — status, next run, and last_error (a stopped job is never silent)
curl -s localhost:8788/api/mcp -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_operations","arguments":{"domain":"jobs"}}}'

# run a job now (operator path); retry a failed one
curl -s -X POST localhost:8788/api/scheduler/tasks/<id>/run   -H 'Authorization: Bearer dev-token'
curl -s -X POST localhost:8788/api/scheduler/tasks/<id>/retry -H 'Authorization: Bearer dev-token'
```

- **Backups** — nightly R2 backup (`BACKUP_ENABLED=true`, gated to the `0 2 * * *` cron), encrypted with
  `BACKUP_ENCRYPTION_KEY`; status in `_backup_status`.
- **Crons** — declared in the generated wrangler config: keep-warm (every minute), outbox flush + scheduler
  watchdog (`*/10`), KPI materialization (`30 3`), backup + audit retention (`0 2`).
- **Add-ons** — `GET /api/addons`, `POST /api/addons/:id/install|uninstall` (admin) flips a module live at
  runtime. `GET /api/meta` stays build-allowlist only.
- **IaC** — export the live schema `GET /api/snapshot/export`; diff a proposed change `POST /api/snapshot/diff-v2`.

---

## 15. The MCP control plane (agent path)

Two MCP servers, two jobs:

| MCP                   | Job           | Config                                                                        |
| --------------------- | ------------- | ----------------------------------------------------------------------------- |
| **Factory API (MCP)** | build/operate | project `opencode.json` → `http://localhost:8788/api/mcp`, `Bearer dev-token` |
| **Stitch MCP**        | design source | global `~/.config/opencode/opencode.json` (key via header)                    |

**Factory MCP:** 17 tools — `search_capabilities`, `describe_capability`, `list_collections`,
`describe_collection`, `validate_fields`, `list_handlers`, `plan_manifest`, `apply_manifest`, `query`,
`mutate`, `get_audit`, `get_operations`, `run_integrity`, `propose_schema`, `submit_for_review`, `promote`,
`apply_patch` — plus resources `factory://capabilities`, `factory://guide`, `factory://blocks`.

```bash
curl -s localhost:8788/api/mcp -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 300
```

### 15.1 Stitch (design source) — real payload shape

Configure once (key stays out of the repo):

```jsonc
// ~/.config/opencode/opencode.json  (chmod 600)
{
	"$schema": "https://opencode.ai/config.json",
	"mcp": {
		"stitch": {
			"type": "remote",
			"url": "https://stitch.googleapis.com/mcp",
			"enabled": true,
			"headers": { "X-Goog-Api-Key": "<your-stitch-key>" },
		},
	},
}
```

Then **quit + restart opencode** (config loads once). Verify from a terminal:

```bash
curl -s https://stitch.googleapis.com/mcp -H "X-Goog-Api-Key: $STITCH_KEY" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
```

The real chain is `list_projects → get_project {name} → list_screens {projectId} → get_screen {name}`. A screen
is `{ name, title, deviceType, width, height, htmlCode, screenshot }` where **`htmlCode` is a file reference,
not markup** — fetch `htmlCode.downloadUrl` (text/html) and open `screenshot.downloadUrl`; compile both into a
`DesignDNA` (a regex adds little — the HTML is a styled mockup).

### 15.2 The end-to-end "boom"

```
Stitch (design) ─▶ agent ─(DesignDNA)─▶ Factory MCP ─(gate)─▶ live app: collections + pages
```

**One prompt to paste into opencode** (once both MCP servers are loaded):

> Connect to **Stitch**, read project `<name>`, and for screen `<title>` build a `DesignDNA` and POST it. Then
> read `factory://blocks`, `propose_schema` a collection named **<Name>** (`<slug>`), and show me the fields and
> pages — then wait. After I approve, `submit_for_review` → `promote` → apply. Finally add a menu item, a Clerk
> role with read/write, a nightly `query.rollup`, and verify by reading one page and one collection back.

**Studio equivalent:** `/apps/<slug>` → **Generate** panel → `prompt/DNA → Propose → review field types →
Submit for review → Approve → Apply (create app)`. The panel shows every proposed page + block types first.

---

## 16. Test & quality gates

```bash
pnpm test            # turbo: api + studio + core + types + sdk + compute + utils + cli (15 tasks)
pnpm check           # infra drift + typecheck + lint + format
pnpm check:bundle    # Studio bundle budget (fails if a heavy page is statically imported)
pnpm format          # prettier on ts, tsx, json, md
```

API tests are `apps/api/test/*.spec.ts` (vitest + Cloudflare pool); Studio tests include jsdom component specs
and a Playwright smoke (`pnpm --filter @mmbix/studio test:e2e`). Commits run a pre-commit gate
(format · eslint · tsc · infra drift · security scan).

---

## 17. Deploy to production

```bash
pnpm gen:infra                 # 1. regenerate wrangler configs from infra/env.prod
pnpm check:infra               # 2. drift check (CI)
# 3. create resources once: wrangler d1 create <D1_NAME> · wrangler r2 bucket create <R2_BUCKET> · queues
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put JWT_SECRET
npx wrangler secret put BACKUP_ENCRYPTION_KEY     # hex 64: openssl rand -hex 32
pnpm deploy:api                # 4. deploy the worker (migrations run on first request)
pnpm deploy:studio             # 5. deploy the Studio
```

Checklist before go-live:

- `IS_DEV` is **not** set (or `dev-token` = full admin).
- Admin password is strong and only in a secret; `JWT_SECRET` rotated.
- Custom domain + HTTPS configured; the Studio points at the production API.
- Crons exist (keep-warm, outbox, scheduler watchdog, KPI, backup).
- `BACKUP_ENCRYPTION_KEY` set, or the nightly backup **fails closed**.

---

## 18. Troubleshooting

| Symptom                                                                  | Cause / fix                                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `dev-token` rejected                                                     | not local / `IS_DEV` off → use a real login or a scoped API key                 |
| Stitch tools missing in opencode                                         | config not reloaded → **quit + restart opencode**                               |
| `Incompatible auth server: does not support dynamic client registration` | the key header was empty → the client fell back to OAuth. Set the key.          |
| A block vanished after save                                              | its `type` is not in `factory://blocks` → dropped **with a warning** on purpose |
| `no handler registered for type`                                         | the job's `type` is not in `list_handlers` → nothing was written                |
| `Apply requires the "promoted" state`                                    | run `submit` → `approve` first (review is required)                             |
| `409 CONFLICT` on a schema save                                          | you sent a stale `If-Match: <_schema_version>` → reload and re-apply            |
| Pages look stale after an edit                                           | a composite write also invalidates the child collection; re-read                |
| `Error 1102` in prod                                                     | CPU/memory limit — see the Workers limits page                                  |

---

## 19. Cheat sheet

| Thing              | Value                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| API / Studio       | `:8788` / `:5174`                                                                                    |
| Health / API docs  | `/api/health` · `/api/docs`                                                                          |
| Dev auth           | `Authorization: Bearer dev-token` (local only)                                                       |
| Factory MCP        | `POST /api/mcp` · tools 17 · resources `factory://capabilities\|guide\|blocks`                       |
| Manifest keys (11) | `collections pages roles permissions workflows menus kpis serverFunctions apiKeys schedules reports` |
| Generation         | `propose_schema → submit_for_review → promote → POST /api/generation/:id/apply`                      |
| Page ops           | `ADD MOVE REMOVE UPDATE BIND SPLIT`                                                                  |
| Page size          | default 25 · max 100 (one contract)                                                                  |
| Scripts            | `pnpm dev` · `test` · `check` · `gen:infra` · `check:bundle` · `deploy:api` · `deploy:studio`        |

---

## 20. Where to go deeper

| Area                                         | Doc                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Philosophy & power-ups                       | [Use Cases](use-cases.md)                                                                   |
| Install / configure (prod)                   | [Installation](installation.md) · [Configuration](configuration.md)                         |
| Capability map (MECE)                        | [Factory Blueprint](../concepts/factory-blueprint.md)                                       |
| Engine internals                             | [Architecture](../concepts/architecture.md)                                                 |
| REST surface                                 | [Entities](../backend-api/entities.md) · [Authentication](../backend-api/authentication.md) |
| Agent control plane                          | [MCP](../backend-api/mcp.md) · [Governed Generation](../backend-api/generation.md)          |
| Client SDK                                   | [SDK](../backend-api/sdk.md) · `packages/sdk/README.md`                                     |
| Plugins (workflows, KPI, outbox, lineage, …) | [Plugins Index](../backend-plugins/README.md)                                               |
| CLI                                          | [CLI Reference](../cli/README.md)                                                           |
| Security                                     | [Security Overview](../security/overview.md)                                                |
| Agent template (Tier-0 skill)                | `docs/skills/factory-builder/SKILL.md`                                                      |
