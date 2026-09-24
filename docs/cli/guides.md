# Guides — Step-by-Step Workflows

Hands-on workflows using the verified CLI. All examples assume the dev servers are running (`pnpm dev` → API on `:8788`) and the CLI is linked (`headless` available).

---

## 1. Create a New ERP Module

The `module create` command is the fastest path to a working module: **entities + frontend plugin + optional microservice worker** in one command.

### Interactive (recommended for exploring)

```bash
headless module create
```

Answers: template (HRM / Accounting / Blank) → whether to create entities → whether to scaffold a worker.

### Non-interactive (scripting / CI)

```bash
# Full module from the accounting template, including a microservice worker
headless module create --template accounting --worker

# Minimal: entities + frontend plugin only
headless module create --template hrm
```

### What you get

```
apps/tgapp/src/plugins/<id>/
├── manifest.ts        # nav items + entityMap (reference — the DB is the source of truth)
└── plugin.tsx         # self-contained React component + meta (no registry imports)
Module registered in the backend (POST /api/modules → sidebar dock)
apps/plugin-<id>/              # (--worker) Hono microservice
```

### After scaffolding

1. **Add nav sections** — edit the generated `manifest.ts` to add parent/children nav groups (the generated file includes starter items to build on).
2. **Map slugs to collections** — extend `entityMap` so every nav URL resolves to a real backend collection.
3. **Verify** — confirm every nav URL resolves to a real backend collection:

```bash
headless db collections
```

4. **Reload** — `pnpm dev` picks up the module automatically (the dock reads `GET /api/modules`, so registration happened at scaffold time — no barrel file).

---

## 2. Entity Lifecycle (Schema → Data)

```bash
# Inspect an entity's schema
headless db schema employees
#   designation (m2o), department (m2o), salary (currency) ...

# Query data (read-only)
headless db query "SELECT id, full_name, salary FROM cms_employees LIMIT 5"

# List all collections
headless db collections
```

**Enterprise field types available** (see `packages/utils/src/validation.ts` for the full list):
`text`, `longtext`, `slug`, `password`, `integer`, `number`, `bigint`, `currency`, `percent`, `rating`, `boolean`, `select`, `color`, `timestamp`, `datetime`, `time`, `date`, `email`, `url`, `phone`, `icon`, `tags`, `progress`, `json`, `m2o`, `o2m`, `m2m`, `table`, `file`, `csv`, `uuid`, `m2a`, `formula`, `text_editor`, `code`, `markdown`, `signature`, `duration`, `barcode`, `location`.

**Under the hood:** every schema/data operation above hits the entity engine — a
thin facade over focused collaborators (`SchemaService` / `ItemQueryService` /
`ItemMutationService` / `RelationResolver` / `CascadeService`). Read the
[collection engine architecture](../concepts/architecture.md)
and the [Entities API reference](../backend-api/entities.md)
(idempotency headers, `If-Match`, pagination, filters) to understand the
request pipelines.

---

## 3. Backup & Restore (Disaster Recovery)

```bash
# 1. Take a full backup (schema + all rows)
headless db backup
#   File: backup-2026-08-01T07-18-01.json
#   Collections: 56 · Total rows: 16

# 2. Preview a restore without touching anything
headless db restore --dry-run backup-2026-08-01T07-18-01.json

# 3. Restore (destructive but idempotent)
headless db restore --confirm backup-2026-08-01T07-18-01.json
#   Schemas: 56/56 · Collections: 56/56 · Rows: 16
```

**Restore is safe to re-run** — it deletes conflicting collections, recreates schemas with correct types (unwraps `schema_json` → `fields`, strips system columns), and imports rows with `on_conflict: overwrite`.

### Schema-only workflows (IaC)

```bash
headless db schema:export snapshot.json   # capture the schema
headless db diff                          # detect drift vs latest snapshot
headless db watch --once                  # CI/CD drift gate (non-zero on drift)
```

---

## 4. Migrations

```bash
headless db migrate:status        # what's applied / pending
headless db migrate:create add-customers   # new timestamped migration file
headless db migrate:dry-run       # preview SQL
headless db migrate               # apply
```

Migrations live in `packages/core/src/db/migrations.ts`. The CLI wraps D1 migration execution against the local dev database.

---

## 5. Plugins & Domain Workers

```bash
# Scaffold a backend plugin (manifest + hooks + services)
headless plugin create

# Scaffold a frontend-only module plugin
headless plugin create --frontend

# Inspect what exists
headless plugin list
headless plugin info accounting

# Workers — list both conventions (<name>-worker and plugin-<name>)
headless worker list
headless worker info hrm

# Move a plugin into a dedicated worker (microservice isolation)
headless worker assign

# Or create a fresh worker group
headless worker create
```

**Microservice pattern:** a plugin worker owns business logic and calls the core API over a **service binding** (`env.API.fetch(...)`) — private, sub-millisecond, never traverses the public internet. Crashes in one worker don't affect others.

---

## 6. Environment Profiles

```bash
headless config profile add staging   # apiUrl: http://staging...
headless config profile switch staging
headless config show                  # active profile + URL + token
```

Each profile stores its own `apiUrl` / `authToken` in `.headlessrc`. Use `--profile <name>` on any command to override the active profile.

---

## 7. Seed (Reset) — With Care

```bash
# Make a backup FIRST
headless db backup

# Then seed (wipes all tables + re-runs migrations — no demo data is inserted)
headless db seed --confirm
```

> ⚠️ `db seed` drops **all** tables. It is a fresh-start / reset tool, not an incremental seeder — the starter template ships with no demo data, so after a seed the DB is a clean slate. If you seed by accident, restore from the backup you made before running it.

---

## 8. Shell Completion

```bash
headless completion install            # auto-detect (bash/zsh/fish)
headless completion install --shell zsh
```

Add the generated script to your shell rc if you prefer manual setup:

```bash
headless completion generate >> ~/.zshrc
```

---

## 9. Deploy & Production Workflow

```bash
# Check everything is healthy before deploying
headless status

# Preview what will be deployed
headless deploy --dry-run

# Deploy everything
headless deploy

# Deploy a single target
headless deploy --target api
headless deploy --target frontend
headless deploy --target plugin-hrm

# Monitor live logs after deployment
headless logs api
```

---

## 10. Data Import/Export Workflow

```bash
# Export a collection as CSV
headless db export employees --output backup.csv

# Export specific columns
headless db export employees --fields full_name,email,salary > hr-report.csv

# Import CSV (skip existing records by id)
headless db import employees new-employees.csv

# Import CSV (overwrite existing records)
headless db import employees updated-employees.csv --on-conflict overwrite

# Import from stdin (piped)
cat data.csv | headless db import employees /dev/stdin --stdin
```
