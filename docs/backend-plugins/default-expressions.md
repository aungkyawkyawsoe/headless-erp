# Default Expressions (v0.7)

Dynamic default values for any field — no code needed.

## Named Variables

| Variable                | Resolves To                     |
| ----------------------- | ------------------------------- |
| `$NOW`                  | Current ISO datetime            |
| `$TODAY`                | Current date (`YYYY-MM-DD`)     |
| `$UUID`                 | Random UUID v4                  |
| `$TIMESTAMP`            | Unix timestamp (ms)             |
| `$USER_ID`              | Current user ID                 |
| `$USER_NAME`            | Current user name               |
| `$USER_EMAIL`           | Current user email              |
| `$ROLE_ID`              | Current role ID                 |
| `$ROLE_NAME`            | Current role name               |
| `$TENANT`               | Current tenant ID               |
| `$CURRENT_USER.<field>` | Any field from the auth context |

## Expressions

Prefix with `=` — evaluated by a **safe, workerd-compatible expression engine** (no `eval`/`new Function`):

| Expression                | Resolves To                       |
| ------------------------- | --------------------------------- |
| `=100 * 2`                | `200`                             |
| `=Math.max(10, 20)`       | `20`                              |
| `=NOW()`                  | Current ISO datetime              |
| `=TODAY()`                | Current date                      |
| `=UUID()`                 | Random UUID v4                    |
| `=qty * 2`                | Uses the `qty` value from context |
| `=price + 5`              | Arithmetic on context fields      |
| `=qty > 0 ? "yes" : "no"` | ⚠️ Not supported (no ternary)     |

### Supported Expression Syntax

| Category   | Supported                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Arithmetic | `+ - * / %` with parentheses, unary `-`                                                                                                                      |
| Comparison | `== != < <= > >=` (also `===`/`!==` treated as loose)                                                                                                        |
| Logical    | `&& \|\| !`                                                                                                                                                  |
| Functions  | `Math.min/max/abs/round/floor/ceil/pow/sqrt`, `NOW()`, `TODAY()`, `UUID()`, `TIMESTAMP()`, `parseInt()`, `parseFloat()`, `String()`, `Number()`, `Boolean()` |
| Literals   | numbers, `'strings'`, `"strings"`, `true`, `false`, `null`                                                                                                   |
| Field refs | identifier names from the current document/context                                                                                                           |

> **Not supported:** string concatenation with `+` (e.g. `=TODAY() + " days"`), ternary operators, arrays, and arbitrary JS. Use `=TODAY()` then add days in your frontend, or use a [linkage `set` rule](linkage-rules.md) with a calculated value.

## Example Schema

```json
{
	"name": "Invoices",
	"fields": [
		{ "name": "id_ref", "type": "uuid", "default": "$UUID" },
		{ "name": "created", "type": "timestamp", "default": "$NOW" },
		{ "name": "due_date", "type": "datetime", "default": "=TODAY()" },
		{ "name": "status", "type": "select", "options": ["draft", "approved"], "default": "draft" },
		{ "name": "created_by_user", "type": "text", "default": "$USER_ID" },
		{ "name": "invoice_date", "type": "date", "default": "=TODAY()" },
		{ "name": "total", "type": "currency", "default": "=qty * rate" }
	]
}
```

## Behavior

- Defaults apply **only when the field is omitted** from the request
- A provided value is never overridden
- Applied on `create` (via the Smart Collection Service pipeline)
- Works with the built-in `default` property — just use a string

## Without Context

When no user context is available (e.g. webhook-triggered creates), user-scoped variables resolve to `null`:

- `$USER_ID` → `null`
- `$CURRENT_USER.email` → `null`

## Security

Expressions are evaluated by a restricted parser — arbitrary code execution is impossible. Unknown functions throw, and unknown identifiers resolve to `undefined`. This is what makes them safe to store in schemas managed by non-admins.
