# Reports

Generalized aggregation/reporting engine — one `ReportDefinition`, executed by
the backend, rendered by the admin UI and the Studio ("write once, run
anywhere"). Powered by `ReportEngine` v2 (`POST /api/reports/execute`).

**RBAC:** execution requires **read** permission on the collection (admin
bypasses); field restrictions are applied to dimensions/measures/filters.
Results are cached per (definition, role) for 15s (CacheLayer) — schema changes
invalidate them immediately.

## Endpoints

| Method | Path                               | Description                                     |
| ------ | ---------------------------------- | ----------------------------------------------- |
| POST   | `/api/reports/execute`             | **Report v2** — generalized execution           |
| POST   | `/api/reports/drilldown`           | Cell → underlying rows                          |
| GET    | `/api/reports/export`              | CSV / Excel (`.xlsx`) export                    |
| GET    | `/api/reports`                     | List saved reports (role + collection filtered) |
| POST   | `/api/reports`                     | Save a report definition                        |
| GET    | `/api/reports/:id`                 | One saved report                                |
| PUT    | `/api/reports/:id`                 | Update (admin or owner)                         |
| DELETE | `/api/reports/:id`                 | Delete (admin or owner)                         |
| POST   | `/api/reports/grouped`             | Grouped report (v1 compat)                      |
| GET    | `/api/reports/grouped/:collection` | Grouped report via URL params (v1 compat)       |
| POST   | `/api/reports/pivot`               | Pivot report (v1 compat)                        |
| GET    | `/api/reports/pivot/:collection`   | Pivot report via URL params (v1 compat)         |
| GET    | `/api/reports/dashboard`           | System-wide summary (admin)                     |
| POST   | `/api/reports/generate`            | Legacy custom report (admin, compat)            |

## Execute (v2) — the primary API

`POST /api/reports/execute`

```json
{
	"collection": "sales_orders",
	"rowDimensions": ["region"],
	"columnDimensions": ["status"],
	"measures": [{ "op": "sum", "field": "amount", "alias": "sum_amount" }],
	"filters": [{ "field": "status", "operator": "_neq", "value": "cancelled" }],
	"dateRange": { "field": "ordered_at", "from": "2026-01-01", "to": "2026-12-31" },
	"rowLimit": 10,
	"topNColumns": 5,
	"subtotals": true
}
```

### Dimensions

- **Plain field** — `"region"`, `"status"`…
- **Date bucket** — `"month(ordered_at)"`, `"week(ordered_at)"`,
  `"quarter(ordered_at)"`, `"year(created_at)"`, `"date(created_at)"`
  (bucket keys: `2026-03`, `2026-W09`, `Q1-2026`, `2026`, `2026-03-14`).
- **One m2o hop** — `"customer.country"` (LEFT JOIN auto-added; deeper paths
  are rejected by design).

### Measures

`op`: `count` (field `"*"`), `count_distinct`, `sum`, `avg`, `min`, `max`.
Multiple measures are supported; multi-measure pivots emit composite column
keys (`North|sum_amount`) that the UI splits into multi-level headers.

### Options

| Option           | Effect                                                      |
| ---------------- | ----------------------------------------------------------- |
| `rowLimit`       | Keep only the top-N row groups by their numeric total       |
| `topNColumns`    | Keep top-N pivot columns, drop the rest into an `Other` col |
| `subtotals`      | Insert subtotal rows at each row-dimension level break      |
| `includeTrashed` | Include soft-deleted rows                                   |

**Response:** `{ success: true, data: [...rows], columns: [...], meta: { collection, rowDimensions, columnDimensions, measures, totalRows, truncated? } }`

## Drill-down

`POST /api/reports/drilldown` — the underlying rows behind a pivot cell.

```json
{
	"collection": "sales_orders",
	"filters": [
		{ "field": "region", "operator": "_eq", "value": "North" },
		{ "field": "status", "operator": "_eq", "value": "paid" }
	],
	"limit": 50,
	"offset": 0
}
```

**Response:** `{ success: true, data: [...rows], meta: { total } }`

## Export

`GET /api/reports/export?collection=&format=csv|xlsx&def=<urlencoded ReportDefinition JSON>`

- `format=csv` → `text/csv` (RFC-4180 quoting).
- `format=xlsx` → a real Excel workbook (zero-dependency writer; numeric cells
  stay numeric).
- Legacy URL params (`rows=&cols=&value[op]=field` / `groupBy[]=&aggregate[op]=field`)
  are still accepted without `def`.

## Saved reports (`_reports`)

A `ReportDefinition` saved once, reusable anywhere (page blocks via
`reportId`, Studio picker, dashboards).

```bash
curl -X POST http://localhost:8788/api/reports \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer dev-token' \
  -d '{
    "name": "Sales by Region × Status",
    "collection": "sales_orders",
    "type": "pivot",
    "config": {
      "type": "pivot",
      "collection": "sales_orders",
      "rowDimensions": ["region"],
      "columnDimensions": ["status"],
      "measures": [{ "op": "sum", "field": "amount", "alias": "sum_amount" }],
      "layout": { "showTotals": true, "density": "comfortable", "striped": false, "stickyHeader": true }
    }
  }'
```

`roles` (optional JSON array) gates who may view the report; `null` = all
collection readers.

## Errors

| Status | When                                                                           |
| ------ | ------------------------------------------------------------------------------ |
| 400    | Missing `collection`/dimensions/measures, invalid aggregate op, bad `def` JSON |
| 403    | No read permission on the collection, or all fields restricted                 |
| 404    | Unknown collection / saved report                                              |

## See also

- [Reports route source](../../apps/api/src/routes/reports.ts) — REST surface
- [Report engine service](../../apps/api/src/services/report-engine.service.ts) — grouped + pivot execution
