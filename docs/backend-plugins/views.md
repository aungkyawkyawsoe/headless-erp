# Materialized Views — CQRS read models

Declarative read models: define a projection (`source` table or collection,
`columns`, optional `where` filters and `groupBy`), and `refresh` rebuilds the
snapshot table `_view_<name>` (DROP + CREATE AS SELECT in one batch). Read
models never slow down your write path, and dashboards/BI query a tiny
pre-aggregated table instead of scanning the source.

⚠️ **Path note:** `/api/views` is owned by the core _Saved Views_ feature (UI
filter presets). This plugin mounts at `/api/materialized-views`.

## Routes

| Route                                        | Purpose                                                |
| -------------------------------------------- | ------------------------------------------------------ |
| `GET /api/materialized-views`                | List views                                             |
| `POST /api/materialized-views`               | Create — `{ name, source, columns, where?, groupBy? }` |
| `POST /api/materialized-views/:name/refresh` | Rebuild `_view_<name>` → `{ rows, table }`             |
| `DELETE /api/materialized-views/:name`       | Drop the view + its table                              |

```bash
# Nightly sales totals by store (declarative)
curl -X POST http://localhost:8788/api/materialized-views -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"name":"store_totals","source":"orders","columns":["store_id","total"],"groupBy":"store_id"}'

# Refresh on demand
curl -X POST http://localhost:8788/api/materialized-views/store_totals/refresh \
  -H "Authorization: Bearer dev-token"
# → { "rows": 128, "table": "_view_store_totals" }
```

### Refresh on a cron — compose with the scheduler

The plugin registers the `view.refresh` scheduler handler, so read models can
refresh themselves every night without code:

```bash
curl -X POST http://localhost:8788/api/scheduler/tasks -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"type":"view.refresh","cron":"30 3 * * *","timezone":"Asia/Yangon","payload":{"view":"store_totals"}}'
```

## In code

```ts
import { ViewService } from '@mmbix/views';

const views = new ViewService(new D1Client(env.DB));
await views.create({
	name: 'open_invoices',
	source: 'invoices',
	columns: ['customer_id', 'amount'],
	where: [{ field: 'status', op: 'eq', value: 'open' }],
});
await views.refresh('open_invoices');
```

## Enterprise guardrails

- **Identifier allow-list everywhere** — view names, columns, source tables,
  where fields and `groupBy` all pass `[a-zA-Z_][a-zA-Z0-9_]{0,63}`; where
  _values_ are bound parameters. No SQL injection from payloads.
- **Atomic-ish rebuild** — DROP + CREATE run in a single D1 batch; a reader
  sees either the old snapshot or the new one, never a half-built table.
- **Collection slugs accepted** — `source` resolves through `_entity_schemas`
  to the physical table automatically.

## Tests

`apps/api/test/views.spec.ts` — create/refresh/query, grouped projections,
snapshot replacement, the `view.refresh` scheduler handler, HTTP routes,
unsafe-identifier rejection.
