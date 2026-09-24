# Factory Blueprint — MECE Capability Map

> "We are not building a car — we are building a factory." Every business
> application (CRM, MES, ERP, HR, …) is **assembled from declarative data**,
> never written as code. The platform is the assembly line.

The capabilities partition into **mutually exclusive, collectively exhaustive**
(MECE) buckets. If a problem doesn't fit a bucket, it belongs in the engine —
not in an app.

| #   | Bucket           | What it covers                                                                                                                                                                       | Status |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1   | **Data**         | Collections, 40 field types, relations (M2O/O2M/M2M/M2A), schema as contract                                                                                                         | ✅     |
| 2   | **Behavior**     | Declarative workflows (state machines), decision tables (business rules), linkage rules, server functions (declarative hooks)                                                        | ✅     |
| 3   | **Compute**      | 150 pure functions — financial, statistical, timeseries, probability, datetime, string, currency, tax, math, logic, array, pattern, conversion — usable in every declarative surface | ✅     |
| 4   | **Presentation** | Studio (schema designer + page canvas), views/widgets/blocks — design == runtime (`BlockView`)                                                                                       | ✅     |
| 5   | **Access**       | JWT auth, RBAC roles/permissions, row-level filters, business permissions (submit/approve), API keys                                                                                 | ✅     |
| 6   | **Integration**  | Marketplace plugins (native/binding), outbox (durable side-effects), webhooks, Queues, OpenAPI/SDK                                                                                   | ✅     |
| 7   | **Intelligence** | KPI registry + materialization, report engine, field-level data lineage, audit trails                                                                                                | ✅     |

## The assembly rule

```
Declarative data (JSON)  →  one engine  →  any application
```

A business module is **only**:

1. a collection (Data) with fields and relations,
2. a workflow + decision tables (Behavior) that enforce the process,
3. compute expressions (Compute) that calculate the numbers,
4. views/widgets (Presentation) that render it,
5. roles + permissions (Access) that gate it,
6. plugins/outbox (Integration) that reach outside it,
7. KPIs + lineage (Intelligence) that measure it.

## Invariants (do not regress)

- **Single source of truth** — schema lives in D1; compute functions live in
  `@mmbix/compute`; widget code lives in design-system files; types come from
  `@mmbix/api`'s `AppRouter`. One definition, one computation path.
- **No eval, ever** — all rules run through the safe expression evaluator
  (workerd-safe). The Studio may compile code in the browser; the worker never does.
- **Stateless + idempotent** — state lives in D1 side tables; transitions are
  optimistically locked; side-effects are durable + deduped via the outbox.
- **Determinism** — transitions are deterministic given `{ doc, user, from, to }`;
  compute functions are pure (no `Date.now`/`Math.random`); plugin side-effects
  are the only non-deterministic boundary (fail `skip`/`abort` by policy).
- **Big-O discipline** — keyset pagination (no OFFSET scans), batched relation
  resolution, complexity caps on expressions (2,048 chars / 256 tokens), bounded
  hook depth (3) and per-event budget (20).
- **MECE** — adding a capability means adding a bucket; overlapping buckets mean
  the engine got it wrong.
