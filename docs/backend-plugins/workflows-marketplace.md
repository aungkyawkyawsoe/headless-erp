# Declarative Workflows + Plugin Marketplace

Two enterprise power-ups built on the same **event spine** (`plugin-hooks.ts`):

1. **Declarative Workflow Engine** — state machines as JSON data (no code, no eval).
2. **Plugin Marketplace** — database-driven interceptors that run inside the
   entity pipeline (Odoo/SAP-style `before_*` chains), with two execution
   homes: native (in-worker TS) and binding (separate worker via a service
   binding). No worker-platform dependency.

Both are hot-reloadable: they are **data**, so installing / editing / disabling
via REST takes effect immediately — no deploy.

---

## 1. Declarative Workflow Engine

A workflow is a JSON state machine attached to one collection. State lives in a
**side table** (`_workflow_states` + `_workflow_history`), so any collection can
adopt a workflow without schema changes — custom states don't conflict with the
built-in `doc_status` machine.

### Install (create/upsert)

```bash
curl -X POST http://localhost:8788/api/workflows \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{
    "name": "Shipment Lifecycle",
    "collection": "shipments",
    "initial": "packed",
    "state_field": "wf_state",
    "states": ["packed", "in_transit", "delivered", "failed"],
    "transitions": [
      { "id": "ship",    "from": "packed",     "to": "in_transit",
        "guard": "doc.verified == true" },
      { "id": "deliver", "from": "in_transit", "to": "delivered",
        "roles": ["Logistics"] },
      { "id": "fail",    "from": "in_transit", "to": "failed" }
    ],
    "doc_status_map": { "in_transit": "submitted", "delivered": "approved" }
  }'
```

| Field                                         | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `states` / `initial`                          | The machine's vocabulary and entry state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `transitions[].guard`                         | Safe expression (`packages/core` evaluator — no eval), scope `{ doc, user, from, to }` — e.g. `doc.total > 0 && to == 'approved'`. **Every function from `@mmbix/compute` is available** — 13 groups (financial NPV/IRR/PMT/RATE…, statistical MEAN/STDEV/RANK…, timeseries MOVING_AVERAGE/PERCENT_CHANGE…, probability NORMINV/CONFIDENCE/BINOMDIST…, datetime NET_WORKDAYS/DATEDIF…, string CONTAINS/CONCAT…, currency CONVERT, tax TAX_BRACKETS, math ROUND/MOD…, logic IF/COALESCE) — e.g. `Math.abs(PMT(0.015, 12, doc.loan)) < doc.payment && CONVERT(doc.total, 'USD', 'MMK', doc.rates) < doc.budget` |
| `transitions[].roles`                         | Role names allowed (admin always allowed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `transitions[].on_transition.trigger_plugins` | Marketplace plugin ids fired after commit — **durably, via the outbox** (survives crashes, deduped, retried with backoff, dead-lettered after 5 attempts)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `doc_status_map`                              | Optional sync to the built-in status machine when the hardcoded transitions permit (e.g. `in_transit → submitted`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `state_field`                                 | Optional text field on the collection that **mirrors the state onto the document** (e.g. `wf_state`) — visible in CRUD lists, filters and sorts                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Definitions are validated at save time (states exist, guards parse **and stay within
the expression complexity caps** — 2,048 chars / 256 tokens, ids unique,
transition targets exist) — bad definitions are rejected with 400 before they
can ever run. A workflow cannot be moved to another collection after install
(that would orphan every recorded state).

### Transition

```bash
curl -X POST http://localhost:8788/api/workflows/<id>/transition \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{ "document_id": "<doc-id>", "to_state": "in_transit", "comment": "ok" }'
```

- Unknown transitions → 400 (with the allowed targets listed)
- Guard failure → 400 · wrong role → 403
- **Concurrent transitions are rejected with 409** (optimistic lock on the
  side table — two requests can never double-move a document)
- Every move is recorded in `_workflow_history` (audit trail)
- The hook spine fires `workflow_transition` (pre-commit, can abort) and
  `workflow_transition_after` (post-commit, fire-and-forget) on the collection
- `on_transition.trigger_plugins` are enqueued into the **outbox** with a dedupe
  key (`wf:<workflow>:<doc>:<from>→<to>:<plugin>`) — the transition response
  includes `side_effects: [outbox-ids]`; the side-effects survive crashes and a
  retried transition can never fire them twice

### Bulk transition (ERP batch approval / dispatch)

```bash
curl -X POST http://localhost:8788/api/workflows/<id>/bulk-transition \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{ "document_ids": ["<doc-1>", "<doc-2>"], "to_state": "approved" }'
```

Returns per-document results — `{ total, succeeded, failed, results[] }` — so a
partially-failed batch tells you exactly which documents were rejected and why.

### Inspect

```bash
curl -H 'Authorization: Bearer dev-token' \
  'http://localhost:8788/api/workflows/<id>/states/shipments/<doc-id>'   # current state
curl -H 'Authorization: Bearer dev-token' \
  'http://localhost:8788/api/workflows/<id>/history/shipments/<doc-id>'  # audit trail
```

---

## 2. Plugin Marketplace

Plugins are registered in `_marketplace_plugins` (the database), declare the
lifecycle events they want (`manifest.hooks`), and are executed **inside the
entity pipeline** on every matching write — the returned document is what gets
persisted (interceptor semantics).

### Execution modes

| Mode      | Where the code runs                                      | Trust   |
| --------- | -------------------------------------------------------- | ------- |
| `native`  | In-process handler (`registerNativePlugin`, compiled TS) | trusted |
| `binding` | A separate worker via service binding `env.<NAME>`       | trusted |

No worker-platform dependency: the marketplace runs entirely on the core
worker + your own service bindings.

### Failure policy (per plugin, declarative)

| `manifest.on_error` | Behavior                                                                                 | Use when                                           |
| ------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `skip` (default)    | Log the error and continue with the doc unchanged — a broken plugin never blocks a write | non-critical enrichments (tax, labels)             |
| `abort`             | Reject the write with the plugin's error (fail-closed)                                   | critical business rules (credit check, compliance) |

Binding calls are bounded by `manifest.fetch_timeout_ms` (default 5000) with a
**real AbortController** — a stuck remote worker is cancelled, it doesn't just
time out while still burning CPU.

### Hook-spine safety (hard limits, not recommendations)

- **Reentrancy depth ≤ 3** — a hook that writes again (after_insert → update →
  before_update) is rejected past the cap instead of recursing forever
- **≤ 20 hooks per event** — noisy events can't starve a request
- **Per-hook timeout (default 5s)** — timeouts and errors are logged, never fatal

```bash
curl -X POST http://localhost:8788/api/marketplace/plugins \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{
    "id": "credit-gate", "name": "Credit Gate", "version": "1.0.0",
    "manifest": { "hooks": ["invoices.before_insert"], "execution_mode": "binding",
                   "binding_name": "CREDIT_WORKER", "on_error": "abort", "fetch_timeout_ms": 3000 }
  }'
```

### Install a native interceptor

```ts
// src/plugins/<your-plugin>/service.ts (compiled into the worker)
import { registerNativePlugin } from '@/plugins/marketplace/native-handlers';
registerNativePlugin('tax-calc', async (doc, { collection, event }) => {
	if (typeof doc.total === 'number') return { ...doc, tax: Math.round(doc.total * 0.1) };
	return doc;
});
```

```bash
curl -X POST http://localhost:8788/api/marketplace/plugins \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{
    "id": "tax-calc", "name": "Tax Calculator", "version": "1.0.0",
    "manifest": { "hooks": ["invoices.before_insert"], "execution_mode": "native" }
  }'
```

Now every `POST /api/entities/invoices` runs the interceptor; the returned doc
(including `tax`) is what lands in the database. Disable it with
`PUT /api/marketplace/plugins/tax-calc { "enabled": false }` — no deploy.

---

## 3. Compiled Hook Registration (`ctx.hooks.on`)

In-process plugins register compiled TypeScript hooks on the same spine
(see [§1](./workflow-examples.md)):

```ts
import type { Plugin, PluginContext } from '@mmbix/types';

export const plugin: Plugin = {
	id: 'invoice-hooks',
	register(ctx: PluginContext) {
		// Options-based registration — priority (lower = first) + timeout.
		ctx.hooks.on({
			collection: 'invoices',
			event: 'before_insert',
			priority: 40,
			handler: async (doc) => ({ ...doc, transformed: true }),
		});
	},
};
```

Handlers may return `void` (in-place mutation), `{ abort, error }` (reject), or
a new document (transform) — the same contract powers the hook spine.

---

## Files

| File                                                                          | Responsibility                                 |
| ----------------------------------------------------------------------------- | ---------------------------------------------- |
| `apps/api/src/plugins/workflow/{plugin,engine,service,types}.ts`              | Workflow engine                                |
| `apps/api/src/plugins/marketplace/{plugin,registry,chain,native-handlers}.ts` | Marketplace                                    |
| `apps/api/src/plugins/outbox/{plugin,service}.ts`                             | Durable side-effects + dead-letter queue       |
| `apps/api/src/plugins/decision-table/{plugin,service,types}.ts`               | Data-driven business rules (Drools-style)      |
| `apps/api/src/plugins/kpi/{plugin,service,scheduler}.ts`                      | KPI registry + materialized values             |
| `apps/api/src/core/plugin-hooks.ts`                                           | Transform-chain dispatch (`dispatchTransform`) |
| `apps/api/src/lib/services/collection-mutation.service.ts`                    | Pipeline wiring (transform + chain)            |

> ▶️ Want to see it end-to-end? [Workflows + Interceptors — Example-Driven Guide](workflow-examples.md)
> walks a complete Purchase Order approval scenario with copy-paste curl.
