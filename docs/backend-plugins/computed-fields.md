# Computed Fields — Enterprise Reference

Computed fields (`type: "formula"`) turn derived values — totals, balances,
aging, status flags — into **first-class schema fields** with zero code. This is
the engine's answer to Odoo `compute` fields, Salesforce formula + rollup
fields, and Postgres generated columns — but declarative (data, not code) and
hot-reloadable via REST.

## The three modes

| Mode                | `store`           | Column                  | Recompute                            | Filter / sort / index   |
| ------------------- | ----------------- | ----------------------- | ------------------------------------ | ----------------------- |
| **Virtual**         | `false` (default) | none                    | on every read                        | ❌ (computed after SQL) |
| **Stored**          | `true`            | real (by `result_type`) | on every write to the row            | ✅                      |
| **Stored + lookup** | `true`            | real                    | on write **and cascade** (see below) | ✅                      |

```json
{
	"name": "total",
	"type": "formula",
	"formula": "qty * rate - IF(qty > 100, discount, 0)",
	"formula_type": "expression"
}
```

- `result_type`: `number` (default) · `string` · `boolean` · `json` → column
  type `REAL` / `TEXT` / `INTEGER` / `TEXT`.
- The safe expression evaluator powers the formula — no `eval`, workerd-safe.
  All 150 `@mmbix/compute` functions (financial, statistical, tax, currency…)
  plus `IF` / `COALESCE` / `SWITCH` / `ROUND` / `ROUNDUP` / `ROUNDDOWN` and the
  aggregate built-ins (`SUM` `COUNT` `MIN` `MAX` `AVG`) are callable.

## Lookups — aggregates over child rows

| Expression                         | Meaning                                             |
| ---------------------------------- | --------------------------------------------------- |
| `SUM(items.amount)`                | Sum a child field over o2m / m2m / child-table rows |
| `COUNT(items)` / `COUNT(items.id)` | Count children                                      |
| `MIN(items.price)` / `MAX(...)`    | Min / max over children                             |
| `AVG(items.rating)`                | Average over children                               |
| `related.name`                     | Field of the m2o target row                         |

SQL-like semantics: `null`/`undefined`/non-numeric entries are ignored by
numeric aggregates; empty input → `SUM` 0, `COUNT` 0, `AVG`/`MIN`/`MAX` null.
**Soft-deleted children never count** (o2m/m2m/child-table lookups filter
`deleted_at` — matching list semantics).

## Cascade recalc (the `depends` equivalent)

A stored formula that aggregates over **another collection** stays correct even
when that other collection changes directly:

- **Create / update / soft-delete / restore / hard-delete a child row** → every
  parent with a stored formula over that child (o2m FK, m2m junction, child-table
  `parent_id`, or m2o FK) recomputes **automatically, in the same request**.
- **Child-table payload in the SAME parent request** → pass-2 recompute after the
  children are written (one extra UPDATE).
- Recalcs are engine writes: only the stored columns change (`updated_at`,
  hooks, audit, webhooks are untouched) and they never re-enter the cascade
  (no recursion).

```bash
# Invoice with a stored SUM over its line items
curl -X POST http://localhost:8788/api/entities -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' -d '{
    "name": "Invoice Lines", "slug": "invoice_lines",
    "fields": [{ "name": "parent_id", "type": "text", "required": false },
               { "name": "amount", "type": "number", "required": false }]}'

curl -X POST http://localhost:8788/api/entities -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' -d '{
    "name": "Invoices", "slug": "invoices",
    "fields": [{ "name": "lines", "type": "table", "related_collection": "invoice_lines" },
               { "name": "lines_total", "type": "formula", "formula": "SUM(lines.amount)", "store": true }]}'

# One request: parent + children → lines_total written by the engine
curl -X POST http://localhost:8788/api/entities/invoices -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' -d '{"lines": [{ "amount": 100 }, { "amount": 250 }]}'
# → { ..., "lines_total": 350 }

# A line added LATER via its own collection cascades too
curl -X POST http://localhost:8788/api/entities/invoice_lines -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' -d '{"parent_id": "<invoice-id>", "amount": 75}'
# GET /api/entities/invoices/<invoice-id>?fields=lines_total  →  425
```

## Enterprise use cases

| Use case                  | Formula                                      | Mode           | Why stored                                         |
| ------------------------- | -------------------------------------------- | -------------- | -------------------------------------------------- |
| Invoice / PO totals       | `SUM(lines.amount)`                          | stored         | filter `total > 1000`, sort by total, report on it |
| Line total                | `qty * rate - IF(qty > 100, discount, 0)`    | stored         | displayed + aggregated                             |
| VAT / grand total (chain) | `total * 0.05` → `total + vat`               | stored         | dependency order resolved automatically            |
| Aging                     | `IF(paid, 0, daysBetween(due_date, NOW()))`  | virtual        | on-read freshness                                  |
| Overdue flag              | `due_date < NOW() && status != 'paid'`       | stored boolean | **filter** the overdue list in SQL                 |
| Stock balance             | `SUM(movements.qty)` where movements are o2m | stored         | dashboards read one number                         |
| Employee age              | `ageYears(dob, TODAY())`                     | virtual        | no storage needed                                  |
| Credit check              | `total - SUM(payments.amount)`               | stored         | guard `balance > credit_limit` in workflows        |
| Display name              | `concatOf(first_name, ' ', last_name)`       | stored string  | searchable + select-able                           |

## Error semantics

- An expression that throws (unknown function, syntax) yields `null` — a stored
  formula persists `null`, a virtual formula returns `null` on read. Use
  `IF`/`COALESCE` for defensive formulas: `IF(qty == 0, 0, total / qty)`.
- **Save-time validation rejects:** stored formula without expression,
  `formula_type: "sql"` (no raw SQL in the safe evaluator), invalid
  `result_type`, encrypted formula fields, over-long expressions (complexity
  caps), **unknown field/function references** (typos surface at save time,
  not read time — `totl * rate` → 400), invalid `precision`/`rounding`, and
  malformed inverse configurations.
- Existing rows hit by a new `store: true` column carry `NULL` until their next
  write (no backfill).

## Precision & rounding (enterprise totals)

Numeric formulas can round to a fixed number of decimals — the tax/invoice
case where `2.345` must store as `2.35` (half-up) or `2.34` (banker):

```json
{ "name": "net", "type": "formula", "formula": "gross * 1.1", "store": true, "precision": 2, "rounding": "half_up" }
```

| Option      | Values                                  | Default             | Meaning                                                                                               |
| ----------- | --------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| `precision` | 0–10                                    | unset (no rounding) | decimal places                                                                                        |
| `rounding`  | `half_up` · `half_even` · `up` · `down` | `half_up`           | `half_up` = half away from zero (Excel/invoices) · `half_even` = banker · `up`/`down` = ceiling/floor |

Applies to stored AND virtual formulas identically.

## Write-back (inverse)

A payload that includes a computed field can derive its source — the Odoo
`inverse` equivalent, declaratively. Field `total` (formula `qty * rate`) with
`inverse_formula: "total / rate"`, `inverse_target: "qty"` lets a client send
`{ rate: 100, total: 500 }` and the engine computes `qty = 5` **before
validation** (the derived source satisfies NOT NULL). When both are supplied,
the computed field is the authority. Runs on create + update.

## Debugging — `?formula_trace=true`

List reads accept `?formula_trace=true` (with `?fields=` that includes the
formulas) to attach `_formula_trace` per row — per computed field
`{ field, ok, value | error }` — so a formula that silently yields `null` can
be diagnosed. (`?explain=true` is the separate SQL-plan debugger.)

## Dependency auto-selection

A selected virtual formula automatically pulls its source columns into the
SELECT — `?fields=total` also fetches `qty` + `rate`, and chained formulas
(`grand_total = total * 1.1`) evaluate in dependency order. No under-fetching
for computed fields.

## Which tool? (linkage `calculate` vs formula)

| You need…                                             | Tool                                     |
| ----------------------------------------------------- | ---------------------------------------- |
| Set a field when another changes (auto-fill, clear)   | [Linkage rules](./linkage-rules.md)      |
| Conditional show/hide/readonly                        | [Linkage rules](./linkage-rules.md)      |
| A value **computed on read** (fresh, no storage)      | formula (virtual)                        |
| A value **filtered/sorted/indexed/aggregated in SQL** | formula (`store: true`)                  |
| An **aggregate over child rows** (totals, counts)     | formula + lookup (`SUM(items.amount)`)   |
| Values that must stay correct when children change    | formula (`store: true`) — cascade recalc |
| Complex multi-step logic with branching rules         | [Decision tables](./decision-tables.md)  |

## Comparison — how other platforms do it

| Capability                          | **This engine**             | Odoo (`compute`)        | Salesforce (formula/rollup) | Postgres generated cols   | SAP (BRFplus / calc views) |
| ----------------------------------- | --------------------------- | ----------------------- | --------------------------- | ------------------------- | -------------------------- |
| Declarative, no deploy              | ✅ REST, hot-reload         | ⚠️ Python module deploy | ✅ metadata                 | ✅ DDL                    | ✅ config                  |
| On-read (virtual)                   | ✅                          | ✅                      | ✅                          | ✅ (14+)                  | ✅                         |
| Stored column (filter/sort)         | ✅ `store: true`            | ✅ `store=True`         | ⚠️ rollup only              | ✅ `GENERATED ALWAYS AS`  | ⚠️ via views               |
| Aggregate over children             | ✅ `SUM(items.amount)`      | ✅ `depends` + search   | ✅ rollup (limited)         | ❌ (needs triggers/views) | ✅                         |
| Cascade recalc on child change      | ✅ automatic                | ✅ `depends` graph      | ⚠️ rollup latency           | ❌ manual                 | ⚠️ scheduled               |
| Conditional / rounding fns          | ✅ `IF` `SWITCH` `ROUND`…   | ✅ Python               | ✅ formula fns              | ❌ (CASE works)           | ✅ BRFplus                 |
| Fixed-decimal precision             | ✅ `precision` + `rounding` | ✅ `digits`/`rounding`  | ✅ scale                    | ✅                        | ✅                         |
| Write-back (edit computed → source) | ✅ `inverse_formula`        | ✅ `inverse` method     | ❌                          | ❌                        | ⚠️ actions                 |
| Save-time reference validation      | ✅ typos → 400              | ⚠️ runtime              | ✅                          | ✅                        | ✅                         |
| Formula evaluation trace            | ✅ `?formula_trace=true`    | ⚠️ logs                 | ⚠️                          | ❌                        | ✅ BRFplus trace           |
| Deterministic + auditable           | ✅ logic-as-data            | ⚠️ code                 | ✅                          | ✅                        | ✅                         |
| Runtime                             | edge, per-tenant            | monolith                | SaaS                        | your DB                   | on-prem/BTP                |

**Where this engine is ahead:** cascade recalc across collections is automatic
(PG needs triggers; Salesforce rollups are latency-bound), logic is data
(deploy-free, auditable), and `@mmbix/compute`'s 150 functions work in the same
language as the formula — plus fixed-decimal precision and declarative
write-back, which most platforms only reach with code.

**Where it still trails:** Odoo `inverse` methods are custom Python (our
`inverse_formula` covers the declarable subset); PG generated columns compute
inside the DB (no round-trip); deep cross-collection recalc chains (parent →
grandparent) and DB-level generated columns are roadmap items.

## See also

- [Field Types — Computed](../concepts/field-types.md) — schema reference
- [Expression Evaluator](../compute-core/expression-evaluator.md) — syntax + function registry
- [Compute Functions](../compute-core/compute-functions.md) — the 150-function library
- [Linkage Rules](./linkage-rules.md) — write-time field behavior
- [Decision Tables](./decision-tables.md) — branching business rules
