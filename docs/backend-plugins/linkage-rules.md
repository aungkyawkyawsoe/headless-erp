# Field Linkage Rules (v0.7)

Make forms smart: automatically show/hide fields, set values, and calculate totals based on other field values. All rules are declared in the schema — no code needed.

## Features

| Rule            | What It Does                                 |
| --------------- | -------------------------------------------- |
| `visible_when`  | Show field only when a condition is true     |
| `readonly_when` | Make field readonly when a condition is true |
| `required_when` | Make field required when a condition is true |
| `linkages`      | Auto-set, clear, or calculate other fields   |

## Example Schema

```json
{
	"name": "Invoices",
	"fields": [
		{
			"name": "status",
			"type": "select",
			"options": ["draft", "approved", "rejected"],
			"linkages": [
				{
					"target": "approved_date",
					"action": "set_value",
					"value": "$NOW",
					"condition": { "field": "status", "op": "eq", "value": "approved" }
				}
			]
		},
		{
			"name": "rejection_reason",
			"type": "text",
			"visible_when": { "field": "status", "op": "eq", "value": "rejected" },
			"required_when": { "field": "status", "op": "eq", "value": "rejected" }
		},
		{
			"name": "qty",
			"type": "integer",
			"linkages": [{ "target": "total", "action": "calculate", "expression": "qty * rate" }]
		},
		{
			"name": "rate",
			"type": "currency",
			"linkages": [{ "target": "total", "action": "calculate", "expression": "qty * rate" }]
		},
		{
			"name": "total",
			"type": "currency",
			"readonly_when": { "field": "status", "op": "neq", "value": "draft" }
		}
	]
}
```

## Field Definition Options

### `visible_when` / `readonly_when` / `required_when`

```json
{ "field": "status", "op": "eq", "value": "approved" }
```

**Condition operators:**

| Op                          | Meaning                 |
| --------------------------- | ----------------------- |
| `eq` / `neq`                | Equals / not equals     |
| `in` / `nin`                | In array / not in array |
| `gt` / `gte` / `lt` / `lte` | Numeric comparisons     |
| `contains`                  | String contains         |
| `starts_with`               | String starts with      |
| `is_empty` / `is_not_empty` | Empty / non-empty       |

### `linkages`

```json
{
	"target": "field_name",
	"action": "set_value",
	"value": "value-to-set",
	"condition": { "field": "...", "op": "...", "value": "..." }
}
```

**Actions:**

| Action        | Description                                 |
| ------------- | ------------------------------------------- |
| `set_value`   | Set target to `value`                       |
| `clear`       | Remove target value                         |
| `calculate`   | Compute target from `expression`            |
| `set_options` | Dynamically change a select field's options |

**Expression scope** includes all data fields plus helpers: `NOW()`, `TODAY()`, `UUID()`, `Math`, `parseInt`, `parseFloat`. Expressions are evaluated by the [safe expression engine](default-expressions.md#supported-expression-syntax) — arithmetic, comparisons, logical operators, and whitelisted functions. No `eval`/`new Function` (workerd-compatible).

**`set_value` value resolution:** literal values are used as-is, `$NOW`/`$TODAY`/`$UUID`/`$TIMESTAMP` resolve to dynamic values, and `=expr` evaluates an expression.

## How It Works

1. On create/update, the LinkageEngine evaluates all rules against the submitted data
2. Field values are modified (set/clear/calculate) before the DB write
3. UI hints (`visible`, `readonly`, `required`) are returned in the response as `_hints`

**Example response with hints:**

```json
{
	"success": true,
	"data": {
		"id": "...",
		"status": "approved",
		"approved_date": "2026-07-31T03:54:11.746Z",
		"total": 500,
		"_hints": [
			{ "field": "rejection_reason", "visible": false },
			{ "field": "total", "readonly": true }
		]
	}
}
```

Frontend uses `_hints` to show/hide/disable/require fields without duplicate logic.

## When to Use

- **Auto-fill**: `approved_by` when status = approved
- **Conditional forms**: show "rejection reason" only when rejected
- **Calculated totals**: `total = qty * rate`
- **Field locking**: prevent edits after submission

> **Linkage `calculate` vs formula fields** — linkage runs at write time on the
> submitted row (same-row fields only). When you need the value **computed on
> read**, **stored into a filterable/sortable real column**, or **aggregated
> over child rows** (`SUM(items.amount)`, `COUNT(items)`), use a
> [`formula` field](../concepts/field-types.md#computed) instead — virtual by
> default, or `store: true` to materialize.
