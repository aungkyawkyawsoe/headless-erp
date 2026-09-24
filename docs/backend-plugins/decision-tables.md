# Decision Tables — Data-Driven Business Rules

Drools-style **business rules as data** (no code, no deploy). A decision table is
a JSON list of rules; on every create/update the entity pipeline evaluates the
enabled tables for the collection and applies the first matching rule (or every
matching rule in `mode: 'all'`).

| Concept   | Meaning                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------- |
| Condition | `{ field, op, value }` — ops: `eq neq gt gte lt lte in not_in contains matches empty not_empty` |
| Action    | `set` (static assignment), `compute` (safe evaluator expression), `abort` (reject the write)    |
| Priority  | Lower number runs first (Drools salience). Default 100                                          |
| Mode      | `first_match` (default — first matching rule wins) or `all` (every match applies)               |

Rules are hot-reloadable: install / edit / disable via REST, takes effect on the
next write — no deploy.

---

## Install

```bash
curl -X POST http://localhost:8788/api/decision-tables \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{
    "name": "Credit Policy",
    "collection": "sales_orders",
    "mode": "first_match",
    "rules": [
      { "id": "premium_high", "name": "Premium high-value needs approval",
        "priority": 10,
        "conditions": [
          { "field": "customer_grade", "op": "eq", "value": "premium" },
          { "field": "amount", "op": "gt", "value": 1000 }
        ],
        "actions": {
          "set": { "approval_required": true },
          "compute": [{ "field": "credit_limit", "expression": "doc.amount * 1.5" }]
        } },
      { "id": "blocked", "name": "Blocked customers are rejected",
        "priority": 5,
        "conditions": [{ "field": "customer_grade", "op": "eq", "value": "blocked" }],
        "actions": { "abort": "Blocked customers cannot order" } }
    ]
  }'
```

- `compute` expressions run through the safe evaluator (no eval) — **all 150+
  `@mmbix/compute` functions are available**: `doc.amount * 1.5`,
  `TAX(doc.amount, doc.tax_rate)`, `CONVERT(doc.total, 'USD', 'MMK', doc.rates)`.
- Rules are validated at save time: ops, fields, regexes and compute
  expressions must be valid — a broken rule can never surface mid-request.

## How it runs in the pipeline

```
POST /api/entities/sales_orders
  → required-field check → server functions validate
  → hook spine before_insert (TS) → marketplace chain (native/binding)
  → DECISION TABLES  ← set / compute / abort apply here
  → constraint validation → column extraction → INSERT
```

On **update** the full merged document (`existing + payload`) is evaluated — a
rule keyed on `customer_grade` still fires when the user only changed `amount` —
and only the delta is written back.

Every fired rule is recorded in `_decision_rule_audit` (append-only lineage:
which table, which rule, which actions, by whom, when).

## Routes

| Method | Path                                | Notes                                                              |
| ------ | ----------------------------------- | ------------------------------------------------------------------ |
| GET    | `/api/decision-tables`              | List (`?collection=slug`)                                          |
| POST   | `/api/decision-tables`              | Create / upsert (validated) — admin                                |
| GET    | `/api/decision-tables/:id`          | Get one                                                            |
| PUT    | `/api/decision-tables/:id`          | Update (version bumps) — admin                                     |
| DELETE | `/api/decision-tables/:id`          | Remove — admin                                                     |
| POST   | `/api/decision-tables/:id/evaluate` | Dry-run against a sample doc — returns fired rules + resulting doc |

## Example scenarios

- **Pricing**: `amount > 5000 && region == 'eu'` → `compute discount = IF(doc.amount > 10000, 0.15, 0.08)`
- **Approval routing**: `amount > 100000` → `set approval_level = 'director'` (workflow guards then key on it)
- **Compliance**: `country == 'US' && revenue > 1000000` → `abort` with a message
- **Defaults**: `type == 'expense'` → `compute amount = BREAKEVEN(doc.fixed, doc.margin)` (any compute function)

> Combine with **workflows**: a rule sets a field, a workflow guard reads it —
> two declarative layers, zero code.
