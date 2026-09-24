# Field Types

All 39 supported field types with their D1 (SQLite) column mappings.

## Text Family

| Type          | SQL Column | Notes                                                                 |
| ------------- | ---------- | --------------------------------------------------------------------- |
| `text`        | TEXT       | Single-line string                                                    |
| `longtext`    | TEXT       | Multi-line string                                                     |
| `text_editor` | TEXT       | Rich text (HTML)                                                      |
| `code`        | TEXT       | Code block                                                            |
| `markdown`    | TEXT       | Markdown content                                                      |
| `signature`   | TEXT       | Signature data (base64 image)                                         |
| `password`    | TEXT       | Stored as-is; hash at application level                               |
| `slug`        | TEXT       | Auto-generated from `source` field: `"Hello World"` → `"hello-world"` |
| `phone`       | TEXT       | Phone number                                                          |
| `email`       | TEXT       | Email address                                                         |
| `url`         | TEXT       | URL                                                                   |
| `icon`        | TEXT       | Icon name                                                             |
| `uuid`        | TEXT       | UUID v4 — auto-generated if omitted                                   |

## Numeric Family

| Type       | SQL Column | Notes              |
| ---------- | ---------- | ------------------ |
| `integer`  | INTEGER    | Whole numbers      |
| `bigint`   | INTEGER    | Large integers     |
| `number`   | REAL       | Decimal numbers    |
| `currency` | REAL       | Money values       |
| `percent`  | REAL       | Percentage         |
| `rating`   | REAL       | Rating value       |
| `duration` | INTEGER    | Duration (seconds) |
| `progress` | INTEGER    | 0–100 progress     |

## Boolean & Date

| Type        | SQL Column | Notes        |
| ----------- | ---------- | ------------ |
| `boolean`   | INTEGER    | 0/1          |
| `timestamp` | TEXT       | ISO datetime |
| `datetime`  | TEXT       | ISO datetime |
| `time`      | TEXT       | Time string  |

## Structured Data

| Type       | SQL Column | Notes                        |
| ---------- | ---------- | ---------------------------- |
| `json`     | TEXT       | JSON string (parsed on read) |
| `csv`      | TEXT       | JSON array stored as text    |
| `location` | TEXT       | JSON `{lat, lng}`            |
| `tags`     | TEXT       | JSON array of strings        |
| `color`    | TEXT       | Hex color                    |
| `select`   | TEXT       | Single choice from `options` |
| `file`     | TEXT       | File key from R2             |

## Relations

| Type    | SQL Column | Notes                                          |
| ------- | ---------- | ---------------------------------------------- |
| `m2o`   | TEXT       | Foreign key (UUID of related record)           |
| `o2m`   | —          | Virtual — one-to-many, no column               |
| `m2m`   | —          | Virtual — junction table created automatically |
| `m2a`   | TEXT × 2   | Two columns: `{name}_type` + `{name}_id`       |
| `table` | —          | Virtual — child table                          |

See [Relations](relations.md) for details.

## Computed

| Type      | SQL Column | Notes                                                                      |
| --------- | ---------- | -------------------------------------------------------------------------- |
| `formula` | —          | Virtual by default — computed at query time. `store: true` materializes it |
|           |            | into a REAL column (recomputed on every write) so it becomes filterable /  |
|           |            | sortable / indexable. Result type via `result_type` (default `number`).    |

```json
{
	"name": "total",
	"type": "formula",
	"formula": "qty * rate",
	"formula_type": "expression"
}
```

**Stored computed field** (real column — filterable, sortable, indexable):

```json
{
	"name": "grand_total",
	"type": "formula",
	"formula": "total * 1.1",
	"store": true,
	"result_type": "number"
}
```

**Lookups — aggregates over child relations** (`formula_type` may be
`expression` or `lookup`; lookups work in both):

```json
{
	"name": "line_total",
	"type": "formula",
	"formula": "SUM(items.amount)",
	"store": true
}
```

| Example                            | Meaning                                             |
| ---------------------------------- | --------------------------------------------------- |
| `SUM(items.amount)`                | Sum a child field over o2m / m2m / child-table rows |
| `COUNT(items)` / `COUNT(items.id)` | Count children                                      |
| `MIN(items.price)` / `MAX(...)`    | Min / max over children                             |
| `AVG(items.rating)`                | Average over children                               |
| `related.name`                     | Fetch a field from the m2o target row               |

Notes:

- Stored formulas are **engine-owned** — clients can never write them; they are
  recomputed on every create/update (in dependency order, so a stored formula
  may reference another stored formula).
- **Cascade recalc** — creating/updating/soft-deleting/restoring/hard-deleting a
  child row in ANOTHER collection automatically recomputes every parent stored
  formula that aggregates over it (o2m / m2m / child-table / m2o). Soft-deleted
  children are excluded from aggregates.
- Child-table payloads in the SAME request are included: the engine recomputes
  once after the children are written.
- Existing rows hit by a new `store: true` column carry `NULL` until their next
  write (no backfill).
- `formula_type: "sql"` is **not supported** (no raw SQL in the safe evaluator) —
  save-time validation rejects it.
- Formula fields cannot be `encrypted` — encrypt the source fields instead.
- Enterprise patterns (cascade recalc, decision guide, platform comparison):
  see [Computed Fields](../backend-plugins/computed-fields.md).

## Field Definition Properties

| Property               | Applies To  | Description                                                                          |
| ---------------------- | ----------- | ------------------------------------------------------------------------------------ |
| `name`                 | all         | Field name (required, unique)                                                        |
| `type`                 | all         | Field type (required)                                                                |
| `label`                | all         | Display label                                                                        |
| `required`             | all         | NOT NULL constraint                                                                  |
| `default`              | all         | Default value (see [Default Expressions](../backend-plugins/default-expressions.md)) |
| `source`               | slug        | Field to generate slug from                                                          |
| `related_collection`   | m2o/o2m/m2m | Related collection slug                                                              |
| `related_collections`  | m2a         | List of related collection slugs                                                     |
| `foreign_key`          | o2m         | FK field name                                                                        |
| `formula`              | formula     | Expression                                                                           |
| `formula_type`         | formula     | `expression` \| `lookup` (lookups = aggregates over child relations)                 |
| `store`                | formula     | Materialize into a real column (filterable/sortable), recomputed on write            |
| `result_type`          | formula     | `number` (default) \| `string` \| `boolean` \| `json` — column + SDK type            |
| `precision`            | formula     | Round numeric results to N decimals (0–10) — enterprise totals: 2                    |
| `rounding`             | formula     | `half_up` (default) \| `half_even` \| `up` \| `down` — used when `precision` is set  |
| `inverse_formula`      | formula     | Write-back: derive `inverse_target` when the payload includes this field             |
| `inverse_target`       | formula     | The plain field `inverse_formula` writes to (e.g. `qty` for `total / rate`)          |
| `unique`               | all         | UNIQUE constraint                                                                    |
| `index`                | all         | Create DB index                                                                      |
| `min` / `max`          | numeric     | Value range                                                                          |
| `max_length`           | text        | Max characters                                                                       |
| `options`              | select      | Choice list                                                                          |
| `placeholder` / `hint` | all         | UI hints                                                                             |
| `validation`           | all         | [Validation rules](../backend-plugins/field-validation.md)                           |
| `linkages`             | all         | [Linkage rules](../backend-plugins/linkage-rules.md)                                 |
| `visible_when`         | all         | Conditional visibility                                                               |
| `readonly_when`        | all         | Conditional readonly                                                                 |
| `required_when`        | all         | Conditional required                                                                 |
| `encrypted`            | all         | AES-256-GCM field encryption                                                         |

## Available Field Types Endpoint

```bash
curl http://localhost:8788/api/field-types -H 'Authorization: Bearer dev-token'
```

Returns every type with its config schema (for auto-generating field property editors in the admin UI).
