# Infra SSOT — one env file drives every Cloudflare resource

Every Cloudflare resource this monorepo talks to (worker names, D1, R2, queues,
analytics dataset, custom domain, account, non-secret vars) is declared in **one
committed env file per environment**. The wrangler configs are **generated**
from it — never hand-edit them.

| Source of truth (edit this) | Generates (do not edit)                                  |
| --------------------------- | -------------------------------------------------------- |
| `infra/env.prod`            | `apps/api/wrangler.jsonc` · `apps/studio/wrangler.jsonc` |
| `infra/env.testco`          | `apps/api/wrangler.testco.jsonc` (test-only, isolated)   |

```text
infra/env.prod ──┐
                 ├─► scripts/gen-wrangler.mjs ──► apps/api/wrangler.jsonc
infra/env.testco ┘                              └─► apps/studio/wrangler.jsonc
```

```bash
pnpm gen:infra     # regenerate all configs after editing an env file
pnpm check:infra   # drift gate — fails if committed configs ≠ env files
```

`check:infra` runs in CI (`deploy.yml` → quality job) and in `pnpm check`, so a
hand-edit to any wrangler config (or a forgotten `gen:infra` after a rename)
fails the build. Code that must know a name at runtime reads a `vars` value that
the generator emits from the same env file (e.g. `EVENT_QUEUE_NAME` for the
`queue()` dispatch in `apps/api/src/index.ts`); operational scripts
(`scripts/pull-remote-data.sh`, `d1-export-via-api.mjs`, `sync-r2-to-local.mjs`,
`push-local-d1.mjs`, `push-local-r2.mjs`)
load the env file directly. There are no hardcoded account ids / bucket names /
queue names left in code or scripts — `apps/api/src/routes/r2sql.ts` fails loud
instead of falling back to a hardcoded bucket.

## ⚠️ Secrets never live here

`infra/env.*` is committed, so it holds **no secrets**. `ADMIN_PASSWORD`,
`JWT_SECRET`, `BACKUP_ENCRYPTION_KEY`, `TELEGRAM_BOT_TOKEN`, `R2_SQL_TOKEN`,
`ENCRYPTION_KEY` are set on the worker with `wrangler secret put` (see
`apps/api/wrangler.jsonc` header) and locally in git-ignored
`apps/api/.dev.vars`. The prod config contains **no** credential vars — the API
fails closed in production until the secrets exist. Never add a credential to
`infra/env.prod`: `pnpm check:infra` guards the generated config, and the config
is the deploy artifact.

## Naming: one prefix, `mff-sys`

The client prefix is **`mff-sys`** (hyphens). R2 bucket + queue names forbid
underscores (`^[a-z0-9-]+$`), so the prefix is hyphenated **everywhere** for one
consistent identity. The Workers Analytics Engine dataset is the exception — it
**requires** underscores → `mff_sys_api_requests`.

## Resource map (account `4893d057…`, prod)

Everything below is **created and live** on the account, and the generated
configs point at it:

| Kind                                        | Name                                                                                              | Status                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| API worker                                  | `mff-sys-api`                                                                                     | ✅ deployed (2026-09-20, v`6b74e697`)                |
| Mini App worker                             | `mff-sys-miniapp`                                                                                 | ✅ deployed (2026-09-20, v`ed2845d5`)                |
| Studio worker                               | `mff-sys-studio`                                                                                  | ⏳ not yet deployed (config generated)               |
| Custom domain `app.mfflogistics.com`        | → `mff-sys-miniapp`                                                                               | ✅ moved (old `mff-erp-bot-app` detached)            |
| Custom domain `erp-studio.mfflogistics.com` | → `mff-sys-studio`                                                                                | ⏳ not yet attached                                  |
| D1                                          | `mff-sys-db` (`8d19c262-…`)                                                                       | ✅ created — schema self-bootstraps on first request |
| D1                                          | `mff-sys-studio-db`                                                                               | ⏳ not yet created — see Studio runbook below        |
| R2                                          | `mff-sys-media`                                                                                   | ✅ created (apac)                                    |
| Queue                                       | `mff-sys-webhook-delivery` (+ `-dlq`)                                                             | ✅ created, consumer on `mff-sys-api`                |
| Queue                                       | `mff-sys-events` (+ `-dlq`)                                                                       | ✅ created, consumer on `mff-sys-api`                |
| Analytics dataset                           | `mff_sys_api_requests`                                                                            | auto-creates on first write                          |
| Secrets on `mff-sys-api`                    | `ADMIN_PASSWORD` · `JWT_SECRET` · `BACKUP_ENCRYPTION_KEY` · `R2_SQL_TOKEN` · `TELEGRAM_BOT_TOKEN` | ✅ set via `wrangler secret put`                     |

Vars (feature flags) on `mff-sys-api`: `DOMAIN_MODULES=hr,idp,mro` ·
`RATE_LIMIT_DO/BACKUP_ENABLED/ANALYTICS_ENABLED/ENABLE_R2_LAKE=true` ·
`ADMIN_USERNAME=dev@mmbics.com`.

### D1 read replication (read latency on remote D1)

The API worker opens ONE D1 session per request (`apps/api/src/lib/d1-session.ts`)
and issues every query through the Sessions API, so reads can be served by the
replica nearest the user instead of always crossing to the primary's region.
`first-primary` keeps read-your-writes (the first query reads the primary).

The code side is shipped and safe to run either way, but a session only reaches a
replica once **read replication is ENABLED on the database**. Enable it once:

```sh
# via REST (D1:Edit token). Swap in the real account/database ids from env.prod.
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/d1/database/$D1_ID" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"read_replication": {"mode": "auto"}}'
```

Or: Dashboard → D1 → `mff-sys-db` → Settings → Enable Read Replication. Verify
with the same GET (expect `read_replication.mode: "auto"`) and watch
`meta.served_by_region` / `served_by_primary` on a D1 result.

## Studio (erp-studio.mfflogistics.com) — first deploy runbook

The Studio worker (`mff-sys-studio`) serves the built Studio SPA (Cloudflare
Assets) and re-implements the dev-only `/__studio/*` metadata routes
(`apps/studio/worker/index.ts`) against a dedicated D1 (`STUDIO_DB` binding,
`mff-sys-studio-db`) — a 1:1 port of the Vite plugin's table-driven routes.
`/api/*` + `/trpc/*` proxy to `mff-sys-api` through the private `API` service
binding; `/__studio` WRITES require the Studio admin session (verified via a
call back through `API` → `/api/auth/me` — the JWT secret never lives here).
`/sync-ds` + `/reset` are deliberately absent: they spawn node against the
LOCAL studio.db, so `ds_exports` is seeded into D1 at deploy time instead.

```bash
# 1. Create the Studio metadata D1 and paste its id into infra/env.prod
#    (STUDIO_D1_ID), then regenerate the config:
cd apps/api
npx wrangler d1 create mff-sys-studio-db          # returns the database_id
#   edit infra/env.prod STUDIO_D1_ID=… then:
pnpm gen:infra && pnpm check:infra

# 2. Build the SPA + seed the D1 with the committed studio.db metadata:
cd apps/studio
pnpm install                                  # once — adds wrangler devDep
pnpm build                                    # tsc -b && vite build → dist
pnpm db:d1-export                             # writes studio.db/d1-seed.sql
npx wrangler d1 execute mff-sys-studio-db --remote --file studio.db/d1-seed.sql

# 3. Deploy + attach the custom domain (Cloudflare manages the DNS record — the
#    mfflogistics.com zone is already on this account for app.mfflogistics.com):
pnpm deploy        # = build + `wrangler deploy`
#    Custom domain from the generated config; verify in the dashboard. Consider
#    Cloudflare Zero Trust Access on erp-studio.* (admin surface).

# 4. Smoke: open https://erp-studio.mfflogistics.com → login
#    (dev@mmbics.com / ADMIN_PASSWORD secret on mff-sys-api) → the page-builder
#    palette + Studio Admin tabs load (GET /__studio/meta) and an admin save
#    round-trips through D1.
```

Keeping prod metadata fresh: Studio Admin edits are LOCAL (studio.db, committed)
→ `pnpm db:dump-seed && pnpm db:build` → commit → re-run step 2's
`db:d1-export` + `wrangler d1 execute` to re-seed the prod D1 (design metadata
is small; a full replace is fine).

## Migration state (from the old `mff-erp-bot-*` / `tg-mff-*` names)

Renamed 2026-09-08 — **cutover complete**: the new stack is live and
`app.mfflogistics.com` is served by `mff-sys-miniapp` → `mff-sys-api`. The old
stack is still present on the account (orphaned) and is deleted once the
post-cutover smoke passes:

- Old workers `mff-erp-bot-api` / `mff-erp-bot-app` (no longer own the domain),
  D1 `tg-mff-d1` (0 tables — no business data), queues
  `tg-mff-webhook-delivery`/`tg-mff-events` (+DLQs), analytics dataset
  `tg_mff_api_requests`, empty bucket `headless-cms-media`.
- The old API worker was running on **plaintext committed vars**
  (`ADMIN_PASSWORD`, `JWT_SECRET` in git history) — the new `mff-sys-api` has
  proper secrets instead, and no backup encryption key was ever set on the old
  worker (nightly backup had been failing closed). All of that is fixed on the
  new stack.

## ✅ Post-cutover checklist (remaining)

Cutover executed 2026-09-08 (token set, `mff-sys-miniapp` deployed,
`app.mfflogistics.com` moved). Remaining:

```bash
cd apps/api

# 1. Smoke test from a browser/phone (this sandbox cannot reach the edge):
curl -s https://mff-sys-api.aklaks.workers.dev/api/health          # expect 200
curl -s https://app.mfflogistics.com/health                        # expect 200
#    Log in: POST /api/auth/login { username: dev@mmbics.com, password: <ADMIN_PASSWORD> }
#    — first login re-creates the admin row (deleted on D1 push for secret
#    self-heal) and re-creates any empty bootstrap tables. Then sanity-check
#    the pushed data, e.g. GET /api/entities/records?limit=5 and
#    /api/entities/vehicles?limit=5 (expect seeded rows, not empty).
#    Finally open the Mini App from Telegram (BotFather menu button) and sign
#    in with a real Telegram session — initData is validated against the
#    TELEGRAM_BOT_TOKEN secret now set on mff-sys-api.

# 2. Once the smoke passes, delete the OLD stack:
npx wrangler delete --name mff-erp-bot-api -y
npx wrangler delete --name mff-erp-bot-app -y
npx wrangler queues delete tg-mff-webhook-delivery -y   # + tg-mff-webhook-dlq
npx wrangler queues delete tg-mff-events -y             # + tg-mff-events-dlq
npx wrangler d1 delete tg-mff-d1 -y
npx wrangler r2 bucket delete headless-cms-media -y     # was always empty
#    Dashboard → Workers Analytics → delete the old `tg_mff_api_requests`
#    dataset (the new `mff_sys_api_requests` one auto-created on first write).
#    Keep old workers until smoke passes — they are the instant rollback path
#    (their configs live in git history before commit b893e59).
```

Rate-limit counters reset on the new worker (fine — transient). SchedulerDO
alarms self-heal: `SchedulerService.reconcile()` re-arms every cron run from D1.
`tg-mff-d1` has **0 tables** (`num_tables: 0`) so there was no data export/import
step; `tg-mff-r2` was never created on this account — nothing to copy.

### D1 data sync (local dev → remote `mff-sys-db`) — DONE 2026-09-08

Remote `mff-sys-db` now mirrors the local dev SQLite exactly: **96 tables,
981 rows, 107 indexes** (MRO inventory/transfers, vehicle-care, HR, media
metadata, roles/permissions, `_migrations`). `scripts/push-local-d1.mjs` drops
and recreates the remote schema from the local sqlite — re-run it whenever the
dev data is the source of truth:

```bash
# pick the populated local instance (not the newest empty one):
node scripts/push-local-d1.mjs --local-sqlite apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite --dry-run --drop-existing
node scripts/push-local-d1.mjs --local-sqlite <same path> --drop-existing
node scripts/push-local-d1.mjs --local-sqlite <same path> --verify
```

Notes:

- The D1 HTTP API takes **one SQL statement per request** (no batches) and soft-
  rate-limits bursty writers — the script runs one request at a time (concurrency 3) with exponential backoff on the transient `account is not valid` response.
- The imported `_users` admin row (`dev@mmbics.com`) is deliberately deleted on
  push: its hash was minted with the local `ADMIN_PASSWORD` pepper, so the next
  login re-creates it from the production secret (see `ensureAdminUser` in
  `apps/api/src/routes/auth.ts`). Telegram-identity users are unaffected.
- ⚠️ `/api/meta`/login calls can re-create empty bootstrap tables on the remote;
  if `--verify` reports new REMOTE-ONLY tables, re-run the push.

### R2 data sync (local dev → remote `mff-sys-media`) — DONE 2026-09-09

`scripts/push-local-r2.mjs` is the reverse of `sync-r2-to-local.mjs`: it reads
the local miniflare R2 store (metadata from
`.wrangler/state/v3/r2/miniflare-R2BucketObject/*.sqlite` `_mf_objects`, payloads
from `.wrangler/state/v3/r2/<bucket>/blobs/`) and uploads each object to the
remote bucket via `wrangler r2 object put --remote` (wrangler OAuth login — no
API token needed). Content-type/cache-control metadata is transferred;
miniflare `custom_metadata` is not (no wrangler-put flag for it).

```bash
node scripts/push-local-r2.mjs --dry-run          # list local objects to push
node scripts/push-local-r2.mjs                    # upsert (additive — prod-only
                                                  # objects like backups/errors
                                                  # are never deleted)
node scripts/push-local-r2.mjs --verify           # local ↔ remote key/size diff
```

Resume state lives in `.wrangler/r2-push-state-<bucket>.json`; re-runs skip
already-pushed objects (`--force` to re-push everything).

## Troubleshooting: intermittent “Invalid Telegram initData signature”

The HMAC verification (`validateInitData` in `apps/api/src/routes/auth-telegram.ts`)
is deterministic — the same initData string + the same token always give the same
answer. An error that appears SOMETIMES therefore means one of the three inputs
changes between launches. Every rejection now logs a structured line
(`[auth/telegram] initData verification failed: {reason, keys, auth_date_age_s,
token_bot_id}` — param NAMES only, never values) — watch it with
`npx wrangler tail mff-sys-api` (or Workers Logs) during a failing launch.

1. **Token vs. signing bot (the usual suspect).** `TELEGRAM_BOT_TOKEN` must
   belong to the SAME bot the user opens the Mini App from. The log line prints
   `token_bot_id` (the digits before `:` in the token) — compare it with the bot
   users actually launch from. A second/test bot whose menu button (or shared
   links) points at the same Mini App URL produces launches signed by the WRONG
   bot → signature mismatch for those launches only ("sometimes fails").
2. **Old stack still reachable.** The 2026-09-08 rename left
   `mff-erp-bot-api` / `mff-erp-bot-app` deployed (deletion is the last cutover
   step). Anyone still opening the OLD workers.dev URL lands on the old stack
   with its own token + database. Delete the orphans
   (`npx wrangler delete --name mff-erp-bot-api`, same for the miniapp worker)
   or make sure nothing points at them (BotFather config, pinned messages,
   home-screen shortcuts, group chat attachments).
3. **BotFather config.** The Menu Button / Web App URL must be
   `https://app.mfflogistics.com`. If the token was REGENERATED in BotFather,
   re-put the secret (`npx wrangler secret put TELEGRAM_BOT_TOKEN` on
   `mff-sys-api`) — a stale token makes EVERY login fail, not intermittent.
4. **One canonical URL.** `MINIAPP_WORKERS_DEV=true` also serves the miniapp at
   `https://mff-sys-miniapp.<subdomain>.workers.dev` — same worker, so the token
   is fine, but keep ONE canonical URL in BotFather so the launch sessions users
   share don't fork across addresses. Set `MINIAPP_WORKERS_DEV=false` +
   `pnpm gen:infra` + redeploy to pin the custom domain only.
5. **Client replay.** The mini app persists the launch session (sessionStorage)
   and replays it after a reload. A replayed string carries its ORIGINAL
   signature (valid ≤ 24h), so it can never cause this error by itself — but on
   a signature 401 the app now clears that cache so Retry re-reads only a LIVE
   session, and the error screen explains the old-link / different-bot cause.

## Renaming anything later (the pattern)

Changing a resource name is a **one-file edit + regenerate**, then a short
remote sequence (order matters — old code must keep working until the new
queue/worker exists):

1. Edit the `*_NAME` / `*_ID` / `WORKER_*` / `ANALYTICS_DATASET` keys in
   `infra/env.prod` (hyphens everywhere except the analytics dataset).
2. `pnpm gen:infra` and commit (config + env file together — CI enforces it).
3. Create the remote resources under the new names (`wrangler d1 create`,
   `r2 bucket create --location=apac`, `queues create` for each + `-dlq`).
4. Copy data **before** cutting over if the old resource holds anything:
   `wrangler d1 export/import` for D1, an R2 object copy loop for the bucket.
5. `wrangler secret put` the secrets on the **new** worker (they do not follow
   a rename).
6. Deploy API → smoke `/api/health` (authed) → deploy miniapp → move the custom
   domain → drain + delete old queues → delete old workers → delete old D1/R2.
7. Regenerate committed types (`npx wrangler types` in each app) if bindings
   changed shape; delete the old analytics dataset from the dashboard.
