# Server Functions (Hooks)

Run business logic automatically on collection lifecycle events using **declarative JSON rules** — safe, workerd-compatible, no code needed.

## Trigger Events

| Event           | When It Runs                         |
| --------------- | ------------------------------------ |
| `before_insert` | Before a record is created           |
| `after_insert`  | After a record is created            |
| `before_update` | Before a record is updated           |
| `after_update`  | After a record is updated            |
| `before_delete` | Before a record is soft-deleted      |
| `validate`      | During create/update validation      |
| `on_change`     | When a record's status/fields change |

This is the full declarative set. It is a strict **subset** of the pipeline's
lifecycle events: `after_delete` and `after_restore` are deliberately **not**
offerable to a rule, because a rule can only abort or mutate the document — and
both are moot once the row has already left (or re-entered) the live set. Those
two events exist for **code hooks** (`pluginHookRegistry`) only.

Both lists live in one place — `LIFECYCLE_EVENTS` and `DECLARATIVE_TRIGGER_EVENTS`
in `@mmbix/types` (`hooks.ts`) — and the `_server_functions` CHECK constraint is
generated from the declarative list, so the API, the DDL and the docs cannot drift
apart.

## Endpoints

| Method | Path                         | Description                             |
| ------ | ---------------------------- | --------------------------------------- |
| GET    | `/api/server-functions`      | List hooks (`?collection=slug` filters) |
| GET    | `/api/server-functions/:id`  | Get one                                 |
| POST   | `/api/server-functions`      | Create hook                             |
| PUT    | `/api/server-functions/:id`  | Update hook                             |
| DELETE | `/api/server-functions/:id`  | Delete hook                             |
| POST   | `/api/server-functions/test` | Test rules with sample data             |

All routes require admin.

---

## Create a Hook

```bash
curl -X POST http://localhost:8788/api/server-functions \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{
    "name": "Reject negative price",
    "collection_slug": "products",
    "trigger_event": "validate",
    "rules": [
      {
        "action": "abort",
        "when": {"field": "price", "op": "lt", "value": 0},
        "message": "Price cannot be negative",
        "field": "price"
      }
    ],
    "enabled": true
  }'
```

**Response `201`:** the created hook with `rules_text` (the JSON rules as a string).

## Rule Actions

| Action      | Fields                        | Description                                                     |
| ----------- | ----------------------------- | --------------------------------------------------------------- |
| `abort`     | `message`, `title?`, `field?` | Stop the operation with an error                                |
| `set`       | `target`, `value`             | Set a field (value can be `$NOW`, `$UUID`, `=expr`, or literal) |
| `clear`     | `target`                      | Remove a field                                                  |
| `calculate` | `target`, `expression`        | Compute a field from a safe expression                          |

## Rule Conditions (`when`)

| Op                          | Meaning                 |
| --------------------------- | ----------------------- |
| `eq` / `neq`                | Equals / not equals     |
| `in` / `nin`                | In array / not in array |
| `gt` / `gte` / `lt` / `lte` | Numeric comparisons     |
| `contains` / `starts_with`  | String matching         |
| `is_empty` / `is_not_empty` | Empty / non-empty       |

## Examples

**Validation — block negative totals:**

```json
{ "action": "abort", "when": { "field": "total", "op": "lt", "value": 0 }, "message": "Total cannot be negative", "field": "total" }
```

**Auto-calculate — total = qty × rate on create:**

```json
{ "action": "calculate", "target": "total", "expression": "qty * rate" }
```

**Auto-set — approved by / timestamp:**

```json
{"action": "set", "target": "approved_by", "value": "$CURRENT_USER"}
{"action": "set", "target": "approved_at", "value": "$NOW"}
```

**Conditional requirement:**

```json
{ "action": "abort", "when": { "field": "status", "op": "eq", "value": "approved" }, "message": "Email required", "field": "email" }
```

**Clear a field when status changes:**

```json
{ "action": "clear", "target": "rejection_reason" }
```

## Execution Semantics

- Multiple rules run in order; multiple `abort` results are returned
- `set` / `clear` / `calculate` mutate the document **before** the DB write
- Expressions use the [safe expression engine](default-expressions.md#supported-expression-syntax) — arithmetic, comparisons, logical operators, and whitelisted functions. No arbitrary code.

---

## Test a Hook

`POST /api/server-functions/test` — run rules with sample data:

```bash
curl -X POST http://localhost:8788/api/server-functions/test \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{
    "rules": [
      {"action": "calculate", "target": "total", "expression": "qty * rate"},
      {"action": "abort", "when": {"field": "total", "op": "gt", "value": 100}, "message": "Over limit"}
    ],
    "doc": {"qty": 50, "rate": 3},
    "collection_slug": "products"
  }'
```

**Response:** `{ success: true, result: [{ abort: true, message: "Over limit" }] }`

---

## ⚠️ Why Not JavaScript (`function_code`)?

The original design allowed user-written JavaScript executed via `new Function()`. **This is permanently disallowed on the Cloudflare Workers runtime**:

> _"For security reasons, the following are not allowed: `eval()`, `new Function`..."_ — Cloudflare Workers docs

Consequences:

- The API **rejects any request containing `function_code`** (create or update) with a clear `400` error pointing to the rules format
- Pre-existing legacy rows are kept in the DB (for reference) but are **never executed**
- The rules model covers the real-world use cases (validation, auto-fill, computed fields, conditional blocking) without any arbitrary code

### Migrating legacy rows

| JS Pattern                                        | Equivalent Rule                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `if (doc.x < 0) return {abort:true, error:"..."}` | `{"action":"abort","when":{"field":"x","op":"lt","value":0},"message":"..."}` |
| `doc.total = qty * rate`                          | `{"action":"calculate","target":"total","expression":"qty * rate"}`           |
| `doc.status = "draft"`                            | `{"action":"set","target":"status","value":"draft"}`                          |
| `delete doc.reason`                               | `{"action":"clear","target":"reason"}`                                        |
| Condition on another field                        | `"when": {"field": "status", "op": "eq", "value": "approved"}`                |

---

## Integration with Entities

Hooks are wired into the entity pipeline automatically:

- `validate` — runs during create/update, before persistence
- `before_insert` / `before_update` — mutate the document before write
- `after_insert` / `after_update` — fire after write (non-blocking)
- `before_delete` — can block soft-deletes
- `on_change` — fires on status/field changes

An `abort` result halts the operation with a `400 VALIDATION_ERROR` containing the rule's `message` and `field`.
