# Installation

## Prerequisites

| Tool               | Version | Purpose                  |
| ------------------ | ------- | ------------------------ |
| Node.js            | >= 20   | Runtime                  |
| pnpm               | >= 10   | Package manager          |
| Cloudflare account | —       | Deploy Workers + D1 + R2 |
| Wrangler CLI       | >= 4    | `npx wrangler`           |

## Project Structure

```
headless/
├── apps/
│   ├── api/            ← The API worker (this documentation)
│   ├── studio/         ← UI Studio — schema designer / page builder (dev tool)
│   └── tgapp/          ← Telegram Mini App frontend (Vite + Tailwind + BFF worker)
├── packages/
│   ├── core/           ← Query builder, schema builder, entity engine
│   ├── types/          ← Shared TypeScript types
│   ├── utils/          ← Validators, sanitizers, error classes
│   └── config/         ← App configuration
└── package.json        ← Turborepo root
```

## 1. Install

```bash
git clone <repo-url>
cd headless
pnpm install
```

## 2. Configure Bindings

**Do not hand-edit the wrangler configs.** `apps/api/wrangler.jsonc`,
`apps/tgapp/wrangler.jsonc` and the test-only `apps/api/wrangler.testco.jsonc`
are **generated** from one env file per environment — `infra/env.prod`
(production) and `infra/env.testco` (tests/local dev). Change the prefix or any
resource name in the env file, then regenerate:

```bash
pnpm gen:infra      # regenerate all wrangler configs from the env files
pnpm check:infra    # drift gate — fails if a config disagrees with its env file
```

`infra/env.prod` is the single source of truth for every Cloudflare resource
name: workers, D1, R2, queues, analytics dataset, domain, and non-secret vars:

```bash
CF_ACCOUNT_ID=…                 # account id
WORKER_API=mff-sys-api           # API worker name
WORKER_MINIAPP=mff-sys-miniapp   # Mini App worker name
D1_NAME=mff-sys-db               # D1 database name
D1_ID=<your-d1-database-id>      # set after `wrangler d1 create`
R2_BUCKET=mff-sys-media          # R2 bucket
QUEUE_WEBHOOK/QUEUE_EVENTS (+ -dlq)  # queue names
ANALYTICS_DATASET=mff_sys_api_requests  # Workers Analytics Engine dataset
ADMIN_USERNAME=…                 # bootstrap admin email (password is a secret)
```

> ⚠️ **Never put secrets in the env file or in `vars`.** `ADMIN_PASSWORD`,
> `JWT_SECRET`, `BACKUP_ENCRYPTION_KEY`, `TELEGRAM_BOT_TOKEN`, `R2_SQL_TOKEN`,
> `ENCRYPTION_KEY` are set on the worker with `wrangler secret put` and live in
> the git-ignored `apps/api/.dev.vars` locally. `IS_DEV="true"` is **local-only**
> — in production it enables the publicly-known `dev-token` as full admin.

## 3. Create Cloudflare Resources

The names below are the production values from `infra/env.prod` — that file is
the source of truth, and the full resource map lives in `infra/README.md`.

```bash
# D1 database — paste the printed database_id into D1_ID in infra/env.prod,
# then run `pnpm gen:infra` to regenerate the configs.
npx wrangler d1 create mff-sys-db

# R2 bucket
npx wrangler r2 bucket create mff-sys-media

# Queues (webhook delivery + event bus, each with a dead-letter queue)
npx wrangler queues create mff-sys-webhook-delivery
npx wrangler queues create mff-sys-webhook-dlq
npx wrangler queues create mff-sys-events
npx wrangler queues create mff-sys-events-dlq
```

## 4. Run Locally

```bash
cd apps/api
npx wrangler dev
```

Migrations run automatically on first request. The starter template ships with NO demo data — the database starts as a clean slate. Create collections via the REST API (`POST /api/entities`), `headless collection create`, or `headless module create`.

**Bootstrap superadmin:** on first login, the API creates the Administrator from
`ADMIN_USERNAME` (email), `ADMIN_PASSWORD` and `ADMIN_NAME` (display name, default
`Administrator`). `headless init` writes these to `apps/api/.dev.vars` from the
email / name / password you choose — production uses `wrangler secret put`.

## 5. Typecheck & Test

```bash
# From repo root
pnpm typecheck   # 0 errors
pnpm test        # full workspace suite (core + utils + api)
```

## 6. Deploy

```bash
cd apps/api
npx wrangler deploy
```

### Before Production

1. Confirm `IS_DEV` is **not** present in the generated `vars` (it belongs only in local `.dev.vars`)
2. Set the secrets on the worker with `wrangler secret put` — the API **fails
   closed** in production until they exist: `ADMIN_PASSWORD`, `JWT_SECRET`,
   `BACKUP_ENCRYPTION_KEY` (hex 64), `TELEGRAM_BOT_TOKEN`, plus `R2_SQL_TOKEN`
   (when `ENABLE_R2_LAKE=true`) and `ENCRYPTION_KEY` (if the schema has
   `encrypted` fields). See the header comment in `apps/api/wrangler.jsonc`.
3. Run `pnpm deploy:api` from the repo root for the full pipeline

## What Migrations Create Automatically

On first request, `MigrationRunner.runPending()` creates all system tables:

| Table                              | Purpose                      |
| ---------------------------------- | ---------------------------- |
| `_entity_schemas`                  | Collection definitions       |
| `_users`                           | User accounts                |
| `_roles`                           | Role definitions             |
| `_role_permissions`                | Collection-level permissions |
| `_audit_log`                       | Change history               |
| `_media`                           | Media file metadata          |
| `_webhooks`                        | Webhook subscriptions        |
| `_scheduler_jobs`                  | Scheduled jobs               |
| `_modules` / `_module_collections` | Module grouping              |
| `_module_menus`                    | Module navigation            |
| `_module_views`                    | Module views                 |
| `_collection_views`                | Saved user views             |
| `_server_functions`                | Server-side JS hooks         |
| `_approvals`                       | Approval workflows           |
| `_tenants`                         | Multi-tenancy                |
| `_search_content`                  | Global search index          |
| `_migrations`                      | Migration tracking           |
