# R2 Data Catalog (Iceberg) — Serverless Data Lake + R2 SQL

> **Open beta.** Read-only analytics over Apache Iceberg tables stored in the same
> R2 bucket that already holds media + nightly backups. The idea: **your backup
> bucket is also your data warehouse** — no separate warehouse/BI subscription.
>
> Env-gated. Off by default (`ENABLE_R2_LAKE=false`). Skipped cleanly when off.

## What this unlocks

- **Distributed, serverless analytics** on large datasets that would otherwise be
  slow (or CPU-expensive) as live D1 `GROUP BY`.
- **Cost ≈ $0 extra** at low volume. R2 SQL bills by bytes scanned — so the
  money-saving rule is: always `WHERE` (partition) filter, select only the
  columns you need, and `LIMIT`.
- **Your existing R2 backup/archive objects can become Iceberg tables** queryable
  with standard SQL (`GROUP BY`, window functions, `approx_*`, `ROLLUP`, joins).

## Console surface (admin-only, `apps/api`)

| Route                                       | Purpose                                                      |
| ------------------------------------------- | ------------------------------------------------------------ |
| `GET /api/r2sql/namespaces`                 | List namespaces (databases) in the catalog                   |
| `GET /api/r2sql/describe/:namespace/:table` | Column schema for a table                                    |
| `POST /api/r2sql/query`                     | **Safe** aggregate query (name-safe, no raw SQL passthrough) |

The query route does **not** forward arbitrary SQL (injection-safe): it accepts a
whitelisted shape `{ table, fields?, where?, groupBy?, limit? }` and builds a
validated, read-only statement (LIMIT capped at 10,000).

## Enable it

```bash
# One-shot bring-up that enables the catalog + prints the Manual step
node apps/api/scripts/r2lake-init.mjs        # add --dry-run to preview

# Or step-by-step:
# 1. Enable the R2 Data Catalog on the bucket (once)
#    The bucket name is `R2_BUCKET` in infra/env.prod (today: mff-sys-media).
npx wrangler r2 bucket catalog enable mff-sys-media
#    → notes the "Warehouse" name + "Catalog URI"

# 2. Create a Cloudflare API token in the dashboard with:
#    - R2 Data Catalog (read-only)
#    - R2 Storage (Admin read/write)
#    - R2 SQL (read-only)

# 3. Set the secret + flip the flag
npx wrangler secret put R2_SQL_TOKEN
#   vars (wrangler.jsonc): ENABLE_R2_LAKE=true, R2_ACCOUNT_ID, R2_BUCKET
```

Send data into an Iceberg table via Cloudflare Pipelines
(`POST https://{stream}.ingest.cloudflare.com`) or the R2 Data Catalog REST
API, then query it from the worker or ad-hoc:

```bash
WRANGLER_R2_SQL_AUTH_TOKEN=$R2_SQL_TOKEN npx wrangler r2 sql query \
  "<WAREHOUSE>" "SELECT region, SUM(total) AS s FROM default.sales WHERE ts >= '2026-01-01' GROUP BY region LIMIT 100"
```

## Cost discipline (the zero-waste rules)

1. Always filter by time/partition in `WHERE` — narrows bytes scanned.
2. Project explicit columns (avoid `SELECT *`).
3. `LIMIT` everything; use `approx_distinct` / `approx_percentile_cont` for big
   cardinalities (they are far cheaper than exact `COUNT(DISTINCT)`).
4. Enable **compaction** in R2 Data Catalog to merge small files (fewer files
   scanned per query).

## Notes

- R2 SQL is **read-only** — no `INSERT/UPDATE/DELETE/DDL`. Writes go through
  Pipelines / the catalog. D1 remains the transactional source of truth.
- `OFFSET` is unsupported; use cursor-style `ORDER BY ... WHERE > last`.
- Feature is beta — keep it config-gated and fall back to D1 reports when
  `ENABLE_R2_LAKE !== "true"`.

## Code

- `apps/api/src/services/r2sql.service.ts` — thin, dependency-free R2 SQL client
  (injectable `fetch` for tests).
- `apps/api/src/routes/r2sql.ts` — admin-only, name-safe query surface.
- Tests: `apps/api/test/r2sql.spec.ts`.
