# Migrations & Schema Rollback

How schema change is defined, reviewed, applied, and (truthfully) how it is undone.
Migrations here are **forward-only** — read the [Rollback](#rollback-forward-only)
section before planning an undo.

## The migration set

Two declaration surfaces feed the **same** `_migrations` ledger, keyed by `name`:

| Source                      | Declared in                                         | Applied by                     | Statement execution                           |
| --------------------------- | --------------------------------------------------- | ------------------------------ | --------------------------------------------- |
| Core schema (system tables) | `packages/core/src/db/migrations.ts` (`MIGRATIONS`) | `MigrationRunner.runPending()` | `db.batch()` (one atomic batch per migration) |
| Plugins & domain modules    | `migrations: [...]` on a `Plugin` / module manifest | `PluginMigrationService`       | `db.run()` per statement                      |

Both are **idempotent at the ledger level**: a migration whose `name` is already in
`_migrations` is skipped, each applies exactly once, the per-isolate guard re-runs
after a wiped database, and plugin `ALTER TABLE … ADD COLUMN` is probed with
`PRAGMA table_info` (SQLite has no `ADD COLUMN IF NOT EXISTS`).

> **Statement granularity.** Core migrations run as one atomic `db.batch()`; plugin
> migrations run one prepared statement at a time (`db.run`). A **multi-line single
> statement is valid** through both. The `db.exec()`-splits-on-newlines rule
> (AGENTS.md) applies to ad-hoc DDL callers, **not** to the migration set — the CI
> dry-run below enforces _one statement per entry_ (a stray `;` is the real bug).

## Reviewing a change (the dry-runs)

Nothing writes schema without a diff first:

| Mechanism                    | What it gives you                                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/snapshot/diff-v2` | Deep diff vs a full snapshot with **breaking-change** detection (`removed`, `type_changed`) and `summary.safeToApply` — gate deploys on it ([Schema Snapshot](schema-snapshot.md)) |
| MCP `plan_manifest`          | A **diff that never writes** — the plan; `apply_manifest` is the only schema writer (admin + write-scope, idempotent) ([MCP](../backend-api/mcp.md))                               |
| Studio form-layout save      | Calls `reviewSchemaChange` — exports the live snapshot, diffs only the edited collection, confirms on breaking changes                                                             |
| `EntityMigrator.diff()`      | Plans the DDL for one collection: in-place `ALTER` when safe, else a full **table rebuild** with data copy (`apply()`)                                                             |

## CI dry-run — `pnpm check:migrations`

A database-free guard (`scripts/check-migrations.mjs`) that statically reads the
migration set and fails on a malformed entry, so the failure lands in CI instead of
on the next worker cold start:

1. **Numbered** — every migration name is `<3 digits>_<slug>`.
2. **Unique** — no duplicate name anywhere in the set (`_migrations` is keyed by
   name; a duplicate either double-applies in one run or silently no-ops).
3. **One statement per entry** — a `sql` value that carries two statements is
   rejected (D1 refuses a multi-statement prepared statement).

The script also self-tests its verifier on every run, so it is proven to reject each
malformed shape rather than merely trusted. Wired into the `quality` CI job.

```bash
pnpm check:migrations
```

## Rollback (forward-only)

**There is no per-migration `down()`.** Both `Migration` (core) and
`PluginMigration` (plugins) declare only `up`. The design deliberately chose a
**snapshot rollback** over authoring reverse-DDL `down` functions, because undoing a
data-shaping migration in reverse is where silent data loss lives (see
`packages/cli/src/commands/db.ts` → `rollbackMigration`).

The real, supported undo paths, most precise first:

| Path                                                | Command / route                                                                      | Scope & caveats                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Snapshot-rollback** (recommended, last migration) | `headless db migrate:rollback` — takes a fresh `db backup`, then `db restore`s to it | Reverts **collections** to their state at backup time. System tables are not restored by `db restore` (below). |
| **Preview a restore**                               | `headless db restore --dry-run <file>`                                               | Shows what would be recreated; touches nothing                                                                 |
| **Restore a backup**                                | `headless db restore --confirm <file>`                                               | Destructive but idempotent; recreates collections/schemas + rows                                               |
| **System tables** (users / RBAC / audit)            | `npx wrangler d1 import DB --file backups/<date>/<stamp>.sql`                        | `db restore` only recreates collections; the nightly R2 backup's SQL dump carries the system tables            |
| **D1 Time Travel** (platform)                       | `npx wrangler d1 time-travel restore <db> --timestamp=…`                             | Free, always-on, ~30-day point-in-time restore — first line for recent accidents                               |
| **GitOps (per deployment)**                         | `POST /api/idp/deployments/:id/rollback` (admin)                                     | Re-applies the **previous live snapshot** for the same module + environment (`draft → live` workflow)          |

What is **not** a rollback:

- Editing a migration that already applied — the ledger records `name`, not a
  checksum of its SQL, so an already-applied migration never re-runs. Fix forward
  with a **new numbered migration**.
- `POST /api/snapshot/apply?force=true` — this **drops and recreates** collections
  (data loss), for a from-scratch rebuild, not an undo.

### The safe pattern

```bash
headless db backup                       # 1. take a rollback point (JSON)
headless db migrate:dry-run              # 2. see what is pending
# 3. let the worker cold-start apply it (or `headless db migrate`)
headless db migrate:rollback             # 4a. undo → fresh backup + restore to it
# 4b. or restore the nightly R2 dump for the system tables:
#     npx wrangler d1 import DB --file backups/<date>/<stamp>.sql
```

> Backups are encrypted with `BACKUP_ENCRYPTION_KEY`; in production the nightly R2
> backup **fails closed** rather than write plaintext PII, so set that secret.
