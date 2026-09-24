# Headless CLI

**Version:** 0.8.0 · **Package:** `@mmbix/cli` · **Binary:** `headless`

The Headless CLI is the developer gateway to the MMBix entity engine. It scaffolds **modules** (entities + frontend plugin + optional microservice worker), manages **plugins** and **domain workers**, performs **database operations** (schema, data, migrations, backup/restore), and ships enterprise DX features (profiles, JSON output, dry-run, shell completion).

> ✅ This documentation is verified against the actual CLI (`headless --help` on every command).

---

## 📚 Contents

| Guide                                 | Description                                          |
| ------------------------------------- | ---------------------------------------------------- |
| [Quick Start](#quick-start-5-minutes) | From zero to a running module                        |
| [Installation](#installation)         | Build, link, and run the CLI                         |
| [Global Flags](#global-flags)         | Flags available on every command                     |
| [Command Reference](commands.md)      | Full command tree with verified options              |
| [Guides](guides.md)                   | Module creation, backup/restore, migrations, workers |
| [Typegen](typegen.md)                 | `mmbix-typegen` — SDK schema → types + Zod           |

---

## Quick Start (5 Minutes)

```bash
# 1. Install & link the CLI globally
cd packages/cli
node build.js
pnpm link --global

# 2. Start the API + frontend dev servers (monorepo root)
cd ../..
pnpm dev           # API → :8788, Frontend → :5173, plugin workers → :8789+

# 3. Point the CLI at your API (already configured in this repo via .headlessrc)
headless config show
#   API URL  http://localhost:8788

# 4. Inspect the database
headless db collections          # 56 collections
headless db schema employees     # 18 fields, m2o relations
headless db stats

# 5. Scaffold a business module (Strapi/Frappe-style — templates in packages/cli)
headless module create                        # interactive wizard
headless module create --template accounting  # non-interactive from template
headless module create --template hrm --worker # + microservice worker

# 5b. Or create collections directly (API-first)
headless collection create Blog --template blog

# 6. Verify module entities resolve
headless db collections
```

**How module registration works:** `module create` creates the entity
collections via `POST /api/entities`, writes a self-contained mini app plugin
under `apps/tgapp/src/plugins/<id>/`, and registers the module in the
backend (`POST /api/modules`). The mini app sidebar dock is **DB-driven** — it
reads `GET /api/modules`, so a scaffolded module appears there without editing
any barrel file.

**Credentials (local dev):** `dev@mmbics.com` / `dev-password-for-local-only`

**Project env auto-load:** the CLI reads `.env.local` (then `.env`) from the project
root on every command — `headless init` writes `MMBIX_ADMIN_EMAIL` /
`MMBIX_ADMIN_PASSWORD` there, so `module create`, `menu`, `db` etc. log in
automatically. `MMBIX_API_URL` overrides the API base (default `http://localhost:8788`);
`MMBIX_TOKEN` / `HEADLESS_TOKEN` short-circuits login with a raw bearer token.

**`db` commands query the local miniflare D1 by default** (the same state `wrangler dev`
uses). Pass `--remote` (e.g. `headless db query <sql> --remote`) to run against the
deployed D1 database.

**Client deployments (software factory):** each client gets a **generated** `ADMIN_PASSWORD` + `JWT_SECRET` saved in `clients/<prefix>/.env` (git-ignored) — see [`client`](commands.md#client--software-factory-onboarding).

---

## Installation

```bash
# Build the CLI bundle
cd packages/cli
node build.js                 # → bin/cli.js

# Global binary (recommended — `headless` works from anywhere)
pnpm link --global

# Or run without installing
node packages/cli/bin/cli.js --help
npx tsx packages/cli/bin/cli.ts --help   # dev mode
```

### Configuration

The CLI resolves its API endpoint from, in order:

1. Environment variable `HEADLESS_API_URL` / `MMBIX_API_URL`
2. Project `.headlessrc` (or `~/.headlessrc`) — `apiUrl` under the active profile
3. Default `http://localhost:8788`

This repo ships a ready-made `.headlessrc` pointing at the local API:

```jsonc
{
	"profile": "dev",
	"apiUrl": "http://localhost:8788",
	"profiles": {
		"dev": {
			"apiUrl": "http://localhost:8788",
			"description": "Local dev — API worker on port 8788",
		},
	},
}
```

---

## 🚀 Starter Template (`headless init`)

This repo doubles as a **starter template**: a clean, production-ready monorepo
(API worker + frontend admin UI on `@mmbix/design-system` + core engine) with
**no business modules pre-installed** — like a fresh Frappe bench.

```bash
# Scaffold a fresh project from the template
headless init my-saas          # nested project (or `headless init .` to initialize THIS folder in place)
headless init my-saas --skip-install          # don't run pnpm install
headless init my-saas --template <git-url>    # from a tagged template release

# The CLI runs from the repo itself via `npx headless …` — no global install
# needed. `pnpm cli:link` is optional (makes a global `headless` command).

# In a fresh clone, initialize the current directory in place — no nested project:
headless init          # inside the cloned repo → personalizes THIS folder
headless init .        # same, explicit

# Guided mode asks for the D1 database name + bootstrap superadmin
# (email, name, password). Everything is auto-configured into the project:
#   apps/api/.dev.vars          → ADMIN_*/JWT_SECRET (git-ignored)
#   apps/api/wrangler.jsonc     → worker name, D1 database_name + placeholder
#                                ids, R2 bucket, queues, analytics dataset
#   apps/tgapp/wrangler.jsonc → worker name + API service binding
#   .env.local                  → CLI login defaults (MMBIX_*)
# Non-interactive (CI):
headless init . --db-name my-saas-db --admin-email admin@acme.com --admin-name "Acme Admin" --admin-password 'Strong#Pass123'

pnpm dev            # API :8788 · miniapp :5175
# login with the email/password you chose (or printed at the end of init)
```

What you get:

- Full monorepo: `apps/api`, `apps/tgapp`, `packages/*`
- Auth, users/roles, media, saved views, search, reports, audit
- Full API documentation in `docs/` — start with the [API README](../README.md) and the [collection engine architecture](../concepts/architecture.md) (facade + collaborators, read/write pipelines, performance patterns)
- No demo data — the database starts as a clean slate (`db seed` only resets it)
- Multi-tenant client onboarding (`headless client add`)
- No business modules — scaffold what you need:

```bash
headless module create       # guided — entities + frontend plugin (Strapi/Frappe-style)
headless collection create Blog --template blog   # API-first collection + templates
headless menu add            # guided — build the module sidebar menu
```

---

## Global Flags

| Flag                   | Alias | Description                                                       |
| ---------------------- | ----- | ----------------------------------------------------------------- |
| `--profile <name>`     | `-p`  | Select an environment profile from `.headlessrc` (default: `dev`) |
| `--json`               | —     | Machine-readable JSON output (pipe to `jq`)                       |
| `--dry-run`            | —     | Preview operations without executing them                         |
| `--yes`                | `-y`  | Skip confirmation prompts (scripts / CI)                          |
| `--verbose`            | —     | Show debug output                                                 |
| `--no-color`           | —     | Disable ANSI colors                                               |
| `--telemetry`          | —     | Opt-in anonymous usage telemetry                                  |
| `--no-telemetry`       | —     | Explicitly disable telemetry                                      |
| `--no-update-notifier` | —     | Disable background update checks                                  |
| `--version`            | `-V`  | Show CLI version                                                  |
| `--help`               | `-h`  | Show help                                                         |

**Example — JSON output piped to jq:**

```bash
headless --json db collections | jq '.[].slug'
```

---

## 🎯 Guided Mode (default)

Every command that takes an argument falls back to an **interactive guided flow** when the argument is omitted **and** you're in a real terminal (TTY):

```bash
headless client deploy          # → pick a client → pick workers (multiselect)
headless client status          # → pick a client
headless deploy                 # → pick what to deploy (multiselect)
headless logs                   # → pick which worker to tail
headless plugin info            # → pick a plugin
headless worker info            # → pick a worker
headless db restore backup.json # → confirm before destructive restore
headless db migrate             # → confirm before applying
```

Prompt types: ✍️ **text** (type input) · 🔘 **select** (arrow keys) · ☑️ **multiselect** (space to toggle, enter to confirm) · ✅ **confirm** (yes/no).

> In scripts/CI (no TTY) these same commands keep their non-interactive behavior: they print a usage hint instead of prompting — so automation is never blocked.

---

## Command Tree (verified)

```
headless
├── init [name|.]             Scaffold a fresh project from the starter template (like create-next-app)
│                            omit name or use "." to initialize the current directory in place
│                           (-t, --template <path|git-url> · --db-name <name> · --admin-email · --admin-name · --admin-password · --skip-install · -y)
├── create                 Guided step-by-step wizard (plugin / hook / worker / collection)
├── module                 Scaffold business modules (Strapi/Frappe-style — templates in packages/cli)
│   └── create             Guided: entities via API + frontend plugin + optional worker
│       -t, --template <id>  Use a built-in template (hrm, accounting) — non-interactive
│       -w, --worker         Also scaffold a plugin worker microservice
├── menu                   Manage module menu trees (Module → Group → Item)
│   ├── list [module]      Show a module's menu tree (guided without an argument)
│   ├── add                Add a menu item (module → parent → label → type → target)
│   └── remove [id]        Remove a menu item (children cascade)
├── collection            API-first collection (table) lifecycle — the Studio's App
│                        workbench also has a visual schema designer (create
│                        collections + fields without REST)
│   ├── create <name>      POST /api/entities — --field name:type[:required] or --template <id>
│   ├── list               List collections
│   └── delete <slug>      DESTRUCTIVE — drops the table (--force to skip confirm)
├── plugin                 Manage plugins
│   ├── create             Interactive plugin scaffold (-f, --frontend for a frontend module)
│   ├── list               List all plugins with manifest info
│   └── info <id>          Show plugin details (manifest, plugin.ts, services/)
├── worker                 Manage domain workers
│   ├── create             Scaffold a full worker app under apps/
│   ├── list               List worker applications (detects both <name>-worker and plugin-<name>)
│   ├── assign             Assign an unassigned plugin to an existing worker
│   └── info [name]        Show worker details
├── hook:add               Interactive lifecycle-hook injection wizard
├── db                     Database operations
│   ├── collections        List all collections with row counts
│   ├── schema <slug>      Show detailed field definitions for a collection
│   ├── schema:export [f]  Export current schema → JSON snapshot
│   ├── diff [file]        Colored schema diff vs snapshot (auto-detects latest)
│   ├── backup             Full backup (schema + all collections → JSON)
│   ├── backup:download    Download backup from API endpoint
│   ├── restore <file>     Restore from backup (destructive) — --confirm / --dry-run
│   ├── migrate            Run pending D1 migrations (--dry-run to preview)
│   ├── migrate:status     Applied vs pending migrations
│   ├── migrate:create <n> Create a timestamped migration file
│   ├── migrate:dry-run    Show SQL for pending migrations without executing
│   ├── migrate:rollback   Rollback guidance for the last applied migration
│   ├── query <sql>        Read-only SQL (--write to allow writes)
│   ├── stats              DB size, page count, collection counts
	│   ├── seed               Reset DB to clean slate (⚠ DESTRUCTIVE — requires --confirm)
│   ├── shell              Interactive SQL REPL
│   ├── watch              Watch schema for drift (--interval / --snapshot / --once)
│   ├── advisor            Performance analysis (--json / --fix)
│   └── er-diagram         Mermaid/ASCII/JSON ER diagram (--output / --format / --collections)
├── config                 CLI configuration
│   ├── init               Interactive .headlessrc wizard
│   ├── show               Show current configuration
│   ├── profile            Manage named profiles (add / remove / switch)
│   └── telemetry          Manage telemetry (on / off / status)
├── completion             Shell tab-completion
│   ├── install            Auto-detect + install (-s, --shell bash|zsh|fish)
│   └── generate           Output completion script to stdout
├── translate              i18n Translations management
│   ├── scan               Scan entities → discover translatable keys
│   ├── export             Export translations (CSV to stdout or --output)
│   ├── import <file>      Import CSV translations (--overwrite / --stdin)
│   ├── status             Translation coverage per module per language
│   └── build              Compile D1 translations → R2 bundles
├── shell                  Standalone SQL REPL (-u URL / -t token)
├── dev                    Start the API dev server (wraps wrangler dev, -p port)
├── deploy                 Deploy API/workers/frontend to Cloudflare (--target / --dry-run)
├── client                 Software factory — manage client (company) deployments
│   ├── add                Onboard a client (company → prefix → resources → save)
│   ├── list               List all registered clients
│   ├── status [prefix]    Show a client's resource naming map (guided without prefix)
│   └── deploy [prefix]    Provision D1/R2/secrets + deploy (--target; guided without prefix)
├── status                 Health-check all services (API, frontend, D1, workers)
└── logs [worker]          Stream live logs (wraps wrangler tail)
```

See [commands.md](commands.md) for the full reference and [guides.md](guides.md) for step-by-step workflows.
