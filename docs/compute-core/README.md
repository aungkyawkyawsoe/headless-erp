# Compute & Core — `packages/compute` + `packages/core`

The reusable engine layer — **headless, tree-shaken, import-what-you-use**.
Pure functions and the safe rule engine that every declarative surface plugs
into. No Cloudflare APIs, no IO — runs in the API worker, plugin workers,
miniapp BFF, Studio (browser) and the CLI.

| Doc                                             | What It Covers                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| [Compute Functions](compute-functions.md)       | The 150-function reference — 13 groups, sub-path exports, tree-shaking |
| [Expression Evaluator](expression-evaluator.md) | The safe rule engine — syntax, registry, determinism, complexity caps  |

## How they fit together

```
declarative data (guards · rules · linkage · formulas · decision tables · KPIs)
        │  expression string
        ▼
Expression Evaluator (packages/core)  ──calls──▶  @mmbix/compute (150 pure fns)
        │  scope { doc, user, from, to }
        ▼
your business logic — no eval, deterministic, replayable
```

## Package layout

| Package            | Responsibility                                                                          |
| ------------------ | --------------------------------------------------------------------------------------- |
| `packages/compute` | Pure function library — one group per file, registered via `registerComputeFunctions()` |
| `packages/core`    | D1 client, QueryBuilder, entity engine, expression evaluator, CacheLayer                |
