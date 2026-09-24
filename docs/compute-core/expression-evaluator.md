# Expression Evaluator — Safe Rule Engine (`packages/core`)

> The **safe expression evaluator** is the rule engine behind every declarative
> surface: workflow guards, server-function rules, linkage `calculate`, formula
> fields, decision-table `compute` actions, default expressions. Workerd-safe —
> **no `eval`, no `new Function()`** (both are disallowed on the Workers
> runtime). Untrusted rule data can only call functions from an explicit
> registry and read fields from a provided scope object — nothing else.

## Syntax

| Feature        | Example                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| Arithmetic     | `doc.qty * doc.rate + 10`                                               |
| Comparison     | `doc.total > 1000` · `status == 'approved'` · `5 != 6` (loose equality) |
| Logic          | `a && b` · `a                                                           |     | b`·`!a` |
| Member access  | `doc.customer.name`                                                     |
| Function calls | `NPV(0.08, doc.cashflows)` · `Math.abs(PMT(...))`                       |
| Array literals | `IN(doc.status, ['new', 'approved'])`                                   |
| Literals       | `'text'` `"text"` `123` `true` `false` `null`                           |

The evaluation scope is a plain object — workflow guards get
`{ doc, user, from, to }`, decision-table compute gets `{ doc }`.

## What is callable?

1. **Registry functions** — built-ins (`NOW` `TODAY` `UUID` `TIMESTAMP`
   `parseInt` `parseFloat` `String` `Number` `Boolean`) plus the aggregate
   built-ins for computed-field lookups (`SUM` `COUNT` `MIN` `MAX` `AVG` — see
   [Lookups](#lookups-aggregates-over-child-relations)) plus everything
   `@mmbix/compute` registers (150 functions — see
   [Compute Functions](compute-functions.md)) and anything else that calls
   `registerFunction(name, fn)`.
2. **Deterministic `Math.*` allowlist** — `abs ceil floor round max min pow sqrt
sign trunc exp log log10 log2 sin cos tan …` (never `Math.random` /
   `Math.constructor` — non-determinism and live-Function leaks are rejected).

Anything else — `process.exit(1)`, `evil()`, `Math.random()`,
`Math.constructor('...')` — throws `Unknown function`. **Fails closed.**

## Lookups — aggregates over child relations

Formula fields can compute over related rows. The relation's rows are fetched
once (batched) and exposed to the evaluator as a **lookup scope** — member
access returns the value array, so the aggregate built-ins work naturally:

| Example                            | Meaning                                         |
| ---------------------------------- | ----------------------------------------------- |
| `SUM(items.amount)`                | Sum a child field over o2m/m2m/child-table rows |
| `COUNT(items)` / `COUNT(items.id)` | Count children                                  |
| `MIN(items.price)` / `MAX(...)`    | Min / max over children                         |
| `AVG(items.rating)`                | Average over children                           |
| `related.name`                     | Fetch a field from the m2o target row           |

Aggregate semantics are SQL-like: null/undefined/non-numeric entries are
ignored by numeric aggregates; empty input yields `null` (`SUM` → `0`, `COUNT`
→ `0`). See [Field Types — Computed](../concepts/field-types.md#computed) for
the field schema (`formula`, `store`, `result_type`).

## Determinism guarantees

- Functions must be **pure + deterministic** (no I/O, no `Math.random`) —
  this is what makes guards replayable, default-value caching safe, and audit
  trails trustworthy.
- `==` is loose (JS semantics: `5 == '5'` → true, `null == undefined` → true).

## Complexity caps (Big-O bound)

Rule data is untrusted input — a pathological expression must not burn CPU:

| Cap                   | Limit                  |
| --------------------- | ---------------------- |
| Max expression length | **2,048 chars**        |
| Max tokens            | **256**                |
| Max nesting depth     | **100** (parser guard) |

Save-time surfaces (workflow `validateDefinition`, decision-table `validate`)
call `validateExpressionComplexity(expr)` so a bad rule is rejected with 400
**at install time**; the evaluator also enforces the caps at eval time
(defense in depth).

## Public API (`@mmbix/core`)

| Export                                            | Purpose                                        |
| ------------------------------------------------- | ---------------------------------------------- |
| `evaluateExpression(expr, scope)`                 | Evaluate → value (throws on syntax/unknown fn) |
| `evaluateBoolean(expr, scope)`                    | Evaluate → boolean (conditions/guards)         |
| `evaluateNumber(expr, scope)`                     | Evaluate → number (non-numeric → 0)            |
| `registerFunction(name, fn)`                      | Extension point (`@mmbix/compute` uses this)   |
| `listRegisteredFunctions()`                       | Introspection — all callable names             |
| `validateExpressionComplexity(expr)`              | Fail-fast save-time validation                 |
| `MAX_EXPRESSION_LENGTH` / `MAX_EXPRESSION_TOKENS` | The caps                                       |

## Code layout

| Path                                               | Responsibility                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/core/src/entity/expression/tokenizer.ts` | String → tokens                                                         |
| `packages/core/src/entity/expression/parser.ts`    | Recursive-descent parser + evaluator + complexity guard                 |
| `packages/core/src/entity/expression/registry.ts`  | Function registry (single source of truth)                              |
| `packages/core/src/entity/expression/index.ts`     | Public API                                                              |
| `packages/core/src/entity/computed.ts`             | Computed-field helpers (lookup refs, lookup scope, topo-sort, coercion) |

## See also

- [Compute Functions](compute-functions.md) — the 150-function library
- [Workflows & Marketplace](../backend-plugins/workflows-marketplace.md) — guards in action
