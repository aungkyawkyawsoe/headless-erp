# KPI Registry + Materialization (BI-Ready Metrics)

**Single Version of the Truth for metrics.** A KPI is a declarative definition
(data, not code): an aggregate over a collection, an optional filter, an
optional group-by and an optional time period. The same definition drives
on-demand computation **and** nightly materialization — every dashboard reads
the same numbers, computed the same way. No duplicated ad-hoc logic, no
metric drift (this is the semantic layer SAP BusinessObjects / Oracle BI have —
here it's headless + declarative).

## Install

```bash
curl -X POST http://localhost:8788/api/kpis \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{
    "name": "Approved Revenue",
    "collection": "invoices",
    "agg": "sum",
    "field": "amount",
    "filter": [{ "field": "status", "op": "eq", "value": "approved" }],
    "period": "month",
    "schedule": "daily"
  }'
```

| Field      | Meaning                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| `agg`      | `sum` / `avg` / `count` / `min` / `max`                                  |
| `field`    | Aggregate target (unused for `count`)                                    |
| `filter`   | AND conditions — ops: `eq neq gt gte lt lte in` (pushed into SQL)        |
| `group_by` | Optional field → one materialized value per group (e.g. `status`)        |
| `period`   | `none` / `day` / `month` / `quarter` / `year` (rollup over `created_at`) |
| `schedule` | `manual` (default) or `daily` (recomputed by the nightly cron 03:30)     |

## Compute + read (the BI path)

```bash
# Materialize now (on-demand — one aggregate query, group-by pushed to D1)
curl -X POST http://localhost:8788/api/kpis/<id>/compute \
  -H 'Authorization: Bearer dev-token'

# Pre-computed values — O(log n) per KPI, ready for dashboards
curl -H 'Authorization: Bearer dev-token' \
  'http://localhost:8788/api/kpis/<id>/data?period_from=2026-01&period_to=2026-06'
```

```json
{
	"success": true,
	"data": {
		"kpi": "Approved Revenue",
		"definition": { "name": "Approved Revenue", "agg": "sum", "field": "amount", "period": "month" },
		"values": [
			{ "id": "…", "kpi_id": "…", "period_key": "2026-01", "group_key": "all", "value": 125000, "computed_at": "2026-08-25T00:30:00Z" },
			{ "id": "…", "kpi_id": "…", "period_key": "2026-02", "group_key": "all", "value": 142300, "computed_at": "2026-08-25T00:30:00Z" }
		]
	}
}
```

## How it works

1. `compute` runs **one aggregate query** (`SUM(amount) … GROUP BY strftime('%Y-%m', created_at)`) and upserts into `_kpi_values` — atomic batch, unique on `(kpi_id, period_key, group_key)`.
2. The nightly scheduled handler (`30 3 * * *`, see `wrangler.jsonc` crons) recomputes every KPI with `schedule: 'daily'`.
3. Dashboards / Studio widgets read `/data` — never the live tables — so renders are cheap and numbers are consistent (SVOT).
4. Grouped KPIs give per-group series (`group_key: 'approved'`, `'draft'` …) — pie/bar-ready.

> The KPI **definition** is the single source of truth; `_kpi_values` is a
> derived cache. Recompute anytime (`POST /:id/compute`) — definition + data
> can never drift because there is only one computation path.

## Routes

| Method | Path                    | Notes                                                   |
| ------ | ----------------------- | ------------------------------------------------------- |
| GET    | `/api/kpis`             | List (`?collection=slug`)                               |
| POST   | `/api/kpis`             | Create / upsert (validated) — admin                     |
| GET    | `/api/kpis/:id`         | Get one                                                 |
| PUT    | `/api/kpis/:id`         | Update (version bumps) — admin                          |
| DELETE | `/api/kpis/:id`         | Remove (values too) — admin                             |
| POST   | `/api/kpis/:id/compute` | Materialize now                                         |
| GET    | `/api/kpis/:id/data`    | Materialized values (`?period_from=&period_to=&limit=`) |

## Example scenarios

- **Finance**: monthly revenue (`sum(amount)` filtered `status=approved`), AR aging by `age_bucket` group
- **Operations**: orders per day (`count` with `period: 'day'`), fill rate by `warehouse`
- **HR**: headcount by `department` group, attrition = `count` filter `status=terminated`
- **BI composition**: several KPIs feed one Studio dashboard; each widget reads `/data` — same numbers everywhere
