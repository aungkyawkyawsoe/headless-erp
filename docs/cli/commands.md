# Command Reference

Every command below is verified against the current CLI. Options are shown exactly as `headless <cmd> --help` reports them.

---

## `init` — Scaffold a Fresh Project (Starter Template)

Scaffolds a complete, production-ready project from the starter template — the monorepo
with API worker, frontend admin UI (`@mmbix/design-system`), core engine, and **no business
modules** pre-installed. Like `create-next-app` / a fresh Frappe bench.

```bash
headless init my-saas                  # use the CLI repo as the template
headless init my-saas --template <path-or-git-url>   # from a template release
headless init my-saas --skip-install   # skip pnpm install
headless init my-saas --yes            # non-interactive (overwrite existing dir)

# Non-interactive bootstrap superadmin (guided mode prompts for these)
headless init my-saas --admin-email admin@acme.com --admin-name "Acme Admin" --admin-password 'Strong#Pass123'
```

| Option                   | Alias | Description                                                                  |
| ------------------------ | ----- | ---------------------------------------------------------------------------- |
| `--template <source>`    | `-t`  | Template source: a directory path or git URL (omit → the repo the CLI ships) |
| `--admin-email <email>`  | —     | Bootstrap superadmin email (guided mode prompts for it)                      |
| `--admin-name <name>`    | —     | Bootstrap superadmin display name (default: `Administrator`)                 |
| `--admin-password <pwd>` | —     | Bootstrap superadmin password, min 8 chars (generated if omitted)            |
| `--skip-install`         | —     | Don't run `pnpm install` after scaffolding                                   |
| `--yes`                  | `-y`  | Non-interactive — overwrite an existing directory                            |

Build artifacts (`node_modules`, `dist`, `.turbo`, `.wrangler`, `.git`) are excluded.
The root `package.json` is renamed to the project name and `clients/registry.json`
starts empty.

**Bootstrap superadmin:** guided mode (TTY) prompts for admin **email**, **display name**
and **password** (with confirmation). The values are written to `apps/api/.dev.vars`
(`ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_NAME`) plus a fresh `JWT_SECRET`, and
`wrangler.jsonc` `vars.ADMIN_USERNAME` is kept in sync — so the first `pnpm dev`
creates that user as the Administrator (superadmin). A strong password is generated
and printed when none is provided. Credentials are also written to the git-ignored
`.env.local` so `headless module create` / `headless menu` log in immediately.

Next: `cd my-saas && pnpm dev`, then log in with the chosen credentials.

---

## `module` — Module Generation (Strapi/Frappe-style)

The starter template ships **no business modules** — you scaffold them. Templates
live in `packages/cli/templates` and the CLI prompts for the module details
(Strapi/Frappe-style `cli generate`):

### `module create` — Scaffold a Full Module

Guided wizard that creates **entity collections via the API** + **frontend plugin**
(nav manifest + entityMap) + **optional microservice worker**. The frontend
sidebar is DB-driven, so the module is registered via `POST /api/modules`
(what the frontend dock reads through `GET /api/modules`) — there is no
`plugins.ts` barrel file to edit.

```bash
headless module create                          # interactive wizard (recommended)
headless module create --template accounting    # non-interactive (scriptable)
headless module create --template hrm --worker  # + microservice worker
```

| Option            | Alias | Description                                                          |
| ----------------- | ----- | -------------------------------------------------------------------- |
| `--template <id>` | `-t`  | Use a built-in template (`hrm`, `accounting`) — skips all prompts    |
| `--worker`        | `-w`  | Also scaffold a plugin worker microservice under `apps/plugin-<id>/` |

**What it creates:**

```
the client app/src/plugins/<id>/
├── manifest.ts          ← nav items + entityMap (reference — the DB is the source of truth)
└── plugin.tsx           ← self-contained React component + meta (no registry imports)
Module registered in the backend (POST /api/modules → sidebar dock)
apps/plugin-<id>/             ← (--worker only) Hono microservice + wrangler.jsonc
```

**Templates** ship with enterprise-grade fields (m2o relations, currency, selects):

| Template     | Entities                                   | Highlights                              |
| ------------ | ------------------------------------------ | --------------------------------------- |
| `hrm`        | departments, designations, leave-types     | parent m2o, is_paid, max days           |
| `accounting` | account, journal-entry, customer, supplier | account_type select, parent_account m2o |

> Entities are created through the backend API (`POST /api/entities`), so field validation runs server-side. Existing collections are skipped gracefully.

> Also available: `headless create` — the unified wizard (plugin / hook / worker / collection).

---

## `collection` — API-First Collection Management

Collections (tables) are created through the **REST API** for scriptable,
API-first table creation (`POST /api/entities`). For visual editing, the
**Studio's App workbench has a schema designer** (create collections, add
fields from a 40-type catalog, field inspector) that uses the same validated
API under the hood:

```bash
# Starter templates (production-grade field sets)
headless collection create Blog --template blog
headless collection create Products --template products
headless collection create CRM --template crm
headless collection create Inventory --template inventory
headless collection create Projects --template projects

# Or define fields inline: name:type[:required] (repeatable)
headless collection create Customers \
  --field full_name:text:required \
  --field email:email \
  --field balance:currency \
  --description "Customer accounts"

headless collection list                # every collection
headless collection delete blog --force # DESTRUCTIVE — drops the table
```

| `create` options              | Description                                                  |
| ----------------------------- | ------------------------------------------------------------ |
| `--field <spec>` / `-f`       | Field as `name:type[:required]` — repeatable                 |
| `--template <id>` / `-t`      | Starter template: `blog, products, crm, inventory, projects` |
| `--slug <slug>` / `-s`        | Collection slug (default: derived from name)                 |
| `--description <text>` / `-d` | Collection description                                       |

Field types accepted: `text, longtext, text_editor, number, integer, currency,
percent, boolean, datetime, timestamp, select, tags, email, url, phone, color,
rating, json, slug, uuid, file, markdown, code`.

Created collections appear in the admin UI **Content** tab automatically with
full CRUD pages, search, filters, and validation.

---

## `menu` — Module Menu Trees

Menus live in the DB (`_module_menus`) as a `Module → Group → Item` hierarchy and are
rendered by the admin sidebar. Build them from the CLI without touching code:

```bash
headless menu list              # guided — pick a module → show its menu tree
headless menu list <module>     # non-interactive (e.g. headless menu list sales)
headless menu add               # guided: module → parent → label → type → target
headless menu remove            # guided — pick an item to delete (children cascade)
```

`menu add` item types:

| Type     | Purpose                               | Example target     |
| -------- | ------------------------------------- | ------------------ |
| `link`   | Navigates to a route/URL              | `/sales/customers` |
| `group`  | Section header that holds child items | —                  |
| `action` | Triggers a server action              | —                  |

> Requires a running API (default `http://localhost:8788`) and admin credentials —
> `MMBIX_ADMIN_EMAIL` / `MMBIX_ADMIN_PASSWORD` env (set automatically by `headless init`
> in the project's `.env.local`).

---

## `plugin` — Plugin Management

### `plugin create`

```bash
headless plugin create            # backend plugin (manifest + hooks + services)
headless plugin create --frontend # frontend module plugin
```

| Option       | Alias | Description                                            |
| ------------ | ----- | ------------------------------------------------------ |
| `--frontend` | `-f`  | Generate a frontend module plugin (instead of backend) |

Prompts for ID, display name, description, worker group, and sample hook events. Generates:

```
apps/api/src/plugins/<id>/
├── manifest.ts       ← PluginManifest (single source of truth)
├── plugin.ts         ← Plugin registration + hooks + routes
└── services/         ← Business logic directory
```

### `plugin list`

```bash
headless plugin list
```

Lists all plugins. Plugins with a `manifest.ts` show name, worker group, and description; plugins without show `(no manifest)`.

### `plugin info <id>`

```bash
headless plugin info accounting
```

Dumps the full `manifest.ts`, `plugin.ts`, and the services directory listing.

---

## `worker` — Domain Worker Management

### `worker create`

Scaffolds a full worker application under `apps/` with service bindings to the API, D1, and R2. Prompts for the worker name, display name, description, assigned plugins, and port.

### `worker list`

```bash
headless worker list
```

Lists all worker applications. Detects **both** conventions:

- `<name>-worker` (worker-app format)
- `plugin-<name>` (module-create convention, e.g. `plugin-hrm`)

### `worker assign`

Assigns an unassigned backend plugin to an existing worker: copies the plugin into the worker's `src/plugins/`, registers the factory import, and adds the service binding.

### `worker info [name]`

```bash
headless worker info hrm
```

Shows `package.json`, `wrangler.jsonc`, and the worker entry point (`src/index.ts` or `worker/index.ts`). Resolves both `<name>-worker` and `plugin-<name>` layouts.

---

## `hook:add` — Lifecycle Hooks

```bash
headless hook:add
```

Interactive wizard that injects a lifecycle hook into an existing plugin. Prompts for plugin, collection, event (`validate`, `before_insert`, `after_insert`, `before_update`, `after_update`, `before_delete`, `after_delete`, `after_restore`, `on_change` — code hooks; `after_delete` / `after_restore` are fire-and-forget and cannot abort), priority, timeout, and description.

---

## `client` — Software Factory Onboarding

Onboards a new company/client onto the factory: generates the resource naming map, saves it in `clients/registry.json` + `clients/<prefix>/.env` (git-ignored), and deploys an **isolated** stack (own D1, own R2, own secrets) to Cloudflare.

```bash
headless client add                          # interactive wizard
headless client add --company "Acme" -y      # non-interactive
headless client list                         # all registered clients
headless client status acme                  # naming map for a client
headless client status                       # guided — pick a client
headless client deploy acme                  # api → frontend
headless client deploy                       # guided — pick client + workers (multiselect)
headless client deploy acme --target api     # one target only
headless client deploy acme --prod           # IS_DEV=false + strong password policy
headless client destroy acme                 # teardown: workers + D1 + R2 + registry
headless client destroy acme -y              # non-interactive teardown (CI)
```

| `add` options                    | Description                                    |
| -------------------------------- | ---------------------------------------------- |
| `--company <name>`               | Company name (required for non-interactive)    |
| `--prefix <prefix>`              | Client prefix (default: auto from company)     |
| `--strategy <shared\|dedicated>` | Account strategy (default: `shared`)           |
| `--account <id>`                 | Cloudflare account ID (saved to client `.env`) |
| `--domain <domain>`              | Primary app domain (optional)                  |

**Naming convention** (prefix is the tenant key):

| Resource        | Name                                |
| --------------- | ----------------------------------- |
| API worker      | `{prefix}-cms`                      |
| Frontend worker | `{prefix}-frontend`                 |
| D1              | `{prefix}-cms-db`                   |
| R2              | `{prefix}-cms-media`                |
| KV              | `{prefix}-cms-kv`                   |
| DB tables       | `{prefix}_*` (e.g. `acme_articles`) |

**`deploy` does the provisioning automatically:**

1. Creates the client's D1 database (`wrangler d1 create`) and R2 bucket if missing, and binds the workers to **their own** D1 (multi-tenant isolation — never the factory DB).
2. Generates per-client `wrangler.<prefix>.jsonc` configs (wrangler has no `${VAR}` interpolation) and deploys with `--config`.
3. Generates a strong `ADMIN_PASSWORD` + `JWT_SECRET`, sets them via `wrangler secret put`, and saves them to `clients/<prefix>/.env` (git-ignored).
4. Deploys in order: api → frontend.

**`--prod` flag (production hardening):** sets `IS_DEV=false` in the generated worker configs (disables `dev-token` auth, enables real rate limits) and enforces a strong generated password (≥16 chars). Without `--prod`, clients deploy in dev mode.

**`headless client destroy <prefix>` — clean teardown:**

```bash
headless client destroy acme          # guided confirm
headless client destroy acme -y       # non-interactive (CI)
```

Deletes the client's workers (`acme-cms`, `acme-frontend`), its D1 database and R2 bucket, removes the registry entry and `clients/acme/` folder.

> ⚠️ Client credentials are **generated per client** — log in as the deployment's `ADMIN_USERNAME` (factory default `dev@mmbics.com`) with the password from `clients/<prefix>/.env`. Never reuse the factory dev password for clients.

---

## `deploy` — Deploy to Cloudflare

```bash
headless deploy                        # deploy all (api + workers + frontend)
headless deploy --target api           # deploy API only
headless deploy --target frontend      # build then deploy frontend
headless deploy --target plugin-hrm    # deploy a specific worker
headless deploy --dry-run              # show what would be deployed
```

| Option            | Description                                                 |
| ----------------- | ----------------------------------------------------------- |
| `--target <name>` | `api`, `frontend`, `all` (default), or a plugin/worker name |
| `--dry-run`       | Preview deployment commands without executing               |

Deploys in order: API → workers → frontend (frontend runs `npm run build` first). Prints a summary table at the end with ✅/❌ per target.

---

## `status` — Service Health Check

```bash
headless status                         # check all services
headless status --timeout 5000          # longer timeout
```

| Option                 | Description                                                                 |
| ---------------------- | --------------------------------------------------------------------------- |
| `--api-url <url>`      | API base URL (default from `.headlessrc`, fallback `http://localhost:8788`) |
| `--frontend-url <url>` | Frontend URL (default: `http://localhost:5173`)                             |
| `--timeout <ms>`       | Timeout per service in ms (default: `3000`)                                 |

Checks all services and displays a table:

```
◆ Checking service health

  Service             Status    Detail
  ──────────────────  ────────  ──────────────────────
  API                 ● up      HTTP 200 | v0.8.0 | ok
  Frontend            ● up      HTTP 200
  D1 (via API)        ● up      HTTP 200
  Worker: plugin-hrm  ● up      HTTP 200 | v0.1.0 | ok
```

Worker ports are auto-detected from `wrangler.jsonc` or `package.json` dev script. Exits code 1 if any service is down.

---

## `logs` — Live Worker Logs

```bash
headless logs api            # tail API worker logs
headless logs frontend       # tail frontend logs
headless logs hrm            # tail a plugin worker
headless logs                # defaults to API
```

Wraps `npx wrangler tail` with live streaming. Resolves both `plugin-<name>` and `<name>-worker` conventions.

---

## `db` — Database Operations

### Schema & Introspection

```bash
headless db collections                # all collections + row counts
headless db schema <slug>              # field types, required, default, validation
headless db stats                      # DB size, page count, collection count
headless db er-diagram                 # Mermaid ER diagram (stdout by default)
headless db er-diagram --output docs/er.md --format mermaid --collections hrm,accounting
```

| `er-diagram` options    | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `--output <file>`       | Save to file (default: stdout)                      |
| `--format <type>`       | `mermaid` \| `ascii` \| `json` (default: `mermaid`) |
| `--collections <slugs>` | Filter to specific collections (comma-separated)    |

### Schema Snapshots & Diff (IaC)

```bash
headless db schema:export snapshot.json   # export current schema
headless db diff                          # auto-detects latest snapshot
headless db diff snapshot.json            # diff against a specific snapshot
headless db watch --interval 10 --once    # CI/CD drift check (exit code reflects drift)
```

| `watch` options        | Description                         |
| ---------------------- | ----------------------------------- |
| `--interval <seconds>` | Polling interval (default: `10`)    |
| `--snapshot <file>`    | Compare against a specific snapshot |
| `--once`               | Check once and exit (for CI/CD)     |

### Data

```bash
headless db query "SELECT COUNT(*) FROM cms_employees"   # read-only by default
headless db query --write "UPDATE ..."                   # explicit write
headless db export employees                             # CSV to stdout
headless db export employees --output employees.csv      # CSV to file
headless db export employees --fields name,email,salary  # specific columns
headless db import employees employees.csv               # import CSV (skip on conflict)
headless db import employees employees.csv --on-conflict overwrite  # overwrite by id
```

| `query` options | Description                                                            |
| --------------- | ---------------------------------------------------------------------- |
| `--write`       | Allow write operations (queries are read-only by default)              |
| `--remote`      | Run against the deployed D1 database instead of the local miniflare DB |

| `export` options         | Description                     |
| ------------------------ | ------------------------------- |
| `--output <file>` / `-o` | Write to file (default: stdout) |
| `--fields <fields>`      | Comma-separated column names    |

| `import` options       | Description                               |
| ---------------------- | ----------------------------------------- |
| `--stdin`              | Read CSV from stdin instead of file       |
| `--on-conflict <mode>` | `skip` (default), `overwrite`, or `error` |

### Migrations

```bash
headless db migrate:status          # applied vs pending
headless db migrate:dry-run         # show SQL without executing
headless db migrate                 # run pending migrations
headless db migrate --dry-run       # preview only
headless db migrate:rollback        # rollback guidance
```

> Migrations are **code-based** (defined in `packages/core/src/db/migrations.ts`) and auto-run
> at worker cold start — there is no `migrate:create` (no dead `.sql` files are written).

### Backup & Restore

```bash
headless db backup                  # → backup-<timestamp>.json (schema + all rows + system tables)
headless db backup:download         # pull backup from the API endpoint
headless db restore --dry-run file.json   # preview what would be restored
headless db restore --confirm file.json   # destructive restore (idempotent)
```

| `restore` options | Description                               |
| ----------------- | ----------------------------------------- |
| `--confirm`       | Confirm the destructive restore operation |
| `--dry-run`       | Preview without executing                 |

> **Restore is idempotent** — it deletes conflicting collections first, recreates schemas with correct field types (unwraps `schema_json` → `fields`, strips system fields), then imports rows with `on_conflict: overwrite`.
>
> ⚠️ `db restore` only recreates **collections**. System tables (users/RBAC/audit, e.g. `_users`, `_roles`, `_role_permissions`, `_audit_log`) are captured in the backup JSON under `system_tables` but restored separately from the scheduled backup's SQL dump:
>
> ```bash
> npx wrangler d1 import DB --file backups/<date>/<stamp>.sql
> ```

### Seed (DANGEROUS)

```bash
headless db seed --confirm
```

> ⚠️ **Destructive**: drops ALL tables and re-runs migrations. The starter template ships with **no demo data** — after a seed the DB is a clean slate. Requires `--confirm`. Always run `headless db backup` first.

### Monitoring

```bash
headless db advisor             # performance findings
headless db advisor --json      # findings as JSON
headless db advisor --fix       # auto-fix simple issues (missing indexes)
```

---

## `config` — Configuration & Profiles

```bash
headless config show              # active profile, API URL, token
headless config init              # interactive .headlessrc wizard
headless config profile add       # add a named profile
headless config profile remove    # remove a profile
headless config profile switch    # switch the active profile
headless config telemetry status  # telemetry status + stats
headless config telemetry on      # enable telemetry
headless config telemetry off     # disable telemetry
```

**Config resolution order:** env `HEADLESS_API_URL` / `MMBIX_API_URL` → project `.headlessrc` → user `~/.headlessrc` → default `http://localhost:8788`.

---

## `dev` — API Dev Server

```bash
headless dev              # wraps `wrangler dev` (port from .headlessrc apiUrl, default 8788)
headless dev --port 8788
```

| Option          | Alias | Description                                                             |
| --------------- | ----- | ----------------------------------------------------------------------- |
| `--port <port>` | `-p`  | Port to listen on (default: the `.headlessrc` apiUrl port, else `8788`) |

> The API worker is pinned to **8788** via `apps/api/package.json` (`pnpm dev`), so the CLI reads that port from the project's `.headlessrc` (`apiUrl`) and falls back to 8788 when unset.

---

## `shell` — Interactive SQL REPL

```bash
headless shell                     # uses config API URL + dev-token
headless shell -u http://localhost:8788 -t dev-token
```

| Option            | Alias | Description                                                                |
| ----------------- | ----- | -------------------------------------------------------------------------- |
| `--url <url>`     | `-u`  | API base URL (default: `.headlessrc` apiUrl, else `http://localhost:8788`) |
| `--token <token>` | `-t`  | Auth token (default: `dev-token`)                                          |

---

## `completion` — Shell Tab-Completion

```bash
headless completion install              # auto-detect shell
headless completion install --shell zsh  # force shell
headless completion generate             # output script (pipe to shell rc)
```

| Option            | Alias | Description                       |
| ----------------- | ----- | --------------------------------- |
| `--shell <shell>` | `-s`  | Shell type: `bash`, `zsh`, `fish` |

---

## `create` — Guided Wizard

```bash
headless create
```

Unified wizard for scaffolding a **plugin**, **hook**, **worker**, or **collection** — useful when you don't remember subcommand flags.

---

## Exit Codes

| Code | Meaning                                         |
| ---- | ----------------------------------------------- |
| `0`  | Success                                         |
| `1`  | Command failed (validation, network, TTY, etc.) |
| `2`  | TypeScript / build failure (CI contexts)        |

## Troubleshooting

| Symptom                            | Fix                                                                   |
| ---------------------------------- | --------------------------------------------------------------------- |
| `Cannot connect to the API`        | Is `pnpm dev` running? Check `headless config show` → API URL         |
| CLI hits the wrong API port        | Set `.headlessrc` `apiUrl` or `HEADLESS_API_URL` (default is `:8788`) |
| `headless: command not found`      | `cd packages/cli && pnpm link --global`                               |
| TTY error in scripts               | Use non-interactive flags: `--template`, `--confirm`, `--dry-run`     |
| Stale dev servers / port conflicts | `pnpm dev:clean` then `pnpm dev`                                      |
