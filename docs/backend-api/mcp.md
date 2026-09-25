# MCP — Factory Control Plane

> One MCP endpoint (`POST /api/mcp`) that lets an AI agent **build and operate** the factory. Few tools, a
> capability registry, and one governed write primitive — the **Manifest**. See the full design:
> `docs/superpowers/specs/2026-09-25-mcp-factory-control-plane-design.md`.

## Why few tools

Standing context is the cost driver. ~150 MCP tools ≈ 30k tokens injected **every turn**; the control plane
ships **15 tools (~1k tokens)** plus on-demand knowledge:

| Tier | What                                               | Cost                      |
| ---- | -------------------------------------------------- | ------------------------- |
| 0    | **Skill** (`docs/skills/factory-builder/SKILL.md`) | loaded only when relevant |
| 1    | **MCP verbs + `factory://capabilities` resource**  | ~800 standing tokens      |
| 2    | **SDK / OpenAPI** (agent runs code)                | per call                  |

## Tools

| Tool                                          | Class     | Scope       | Purpose                                                                 |
| --------------------------------------------- | --------- | ----------- | ----------------------------------------------------------------------- |
| `search_capabilities` · `describe_capability` | read      | any         | discover the capability catalog                                         |
| `list_collections` · `describe_collection`    | read      | any         | inspect the schema                                                      |
| `plan_manifest`                               | read      | any         | diff a manifest — **writes nothing**                                    |
| `apply_manifest`                              | **write** | write/admin | the only write — the 11 manifest keys (schema → UI → governance → jobs) |
| `validate_fields`                             | read      | any         | dry-run a field list against the 41-type SSOT (the apply validator)     |
| `list_handlers`                               | read      | any         | the scheduler handler types a `schedules[]` entry may reference         |
| `query`                                       | read      | any         | bounded multi-collection read (`requests[]`)                            |
| `mutate`                                      | **write** | write/admin | batched data writes (`create`/`update`/`delete`/`import`)               |
| `get_audit`                                   | read      | any         | a collection's audit trail, or one document's history                   |
| `get_operations`                              | read      | any         | index-advisor telemetry                                                 |
| `run_integrity`                               | read      | any         | run a collection's declared integrity rules                             |
| `propose_schema`                              | write     | write/admin | design DNA / prompt → a **draft** proposal (no schema)                  |
| `submit_for_review` · `promote`               | write     | write/admin | advance the generation gate                                             |
| `apply_patch`                                 | write     | write/admin | persist structural ops to a page                                        |

Resources: `factory://capabilities` (the registry), `factory://guide` (a short builder guide), `factory://blocks`
(the page block vocabulary).

## The Manifest (the write primitive)

`plan_manifest` diffs; `apply_manifest` applies. Collections are **created when missing**, and an existing
collection **acquires only the fields it lacks** (schema evolution through the same `EntityMigrator` the
Studio uses); pages are **upserted by `module + path`** and skipped when byte-identical; roles are created once
then skipped; permissions/workflows are upserted (idempotent); menu items are skipped when present and require
an existing module. Per-item failures are isolated — one bad entry never aborts the batch.

```jsonc
{
	"version": 1,
	"collections": [
		{
			"slug": "supplier_invoice",
			"name": "Supplier Invoice",
			"fields": [
				{ "name": "invoice_no", "type": "text", "required": true },
				{ "name": "amount", "type": "currency" },
			],
		},
	],
	"pages": [{ "path": "/supplier-invoices", "title": "Supplier Invoices", "blocks": [/* BLOCK_REGISTRY */] }],
	"roles": [{ "name": "Invoice Clerk", "description": "handles invoices" }],
	"permissions": [{ "role": "Invoice Clerk", "collection": "supplier_invoice", "can_read": true, "can_write": true }],
	"workflows": [
		{
			"name": "Invoice Approval",
			"collection": "supplier_invoice",
			"initial": "draft",
			"states": ["draft", "approved"],
			"transitions": [{ "id": "approve", "from": "draft", "to": "approved" }],
		},
	],
	"menus": [{ "module": "finance", "label": "Invoices", "type": "action", "target": "supplier_invoice" }],
	"kpis": [{ "name": "Order Count", "collection": "supplier_invoice", "agg": "count" }],
	"serverFunctions": [{ "name": "Stamp Invoice", "collection": "supplier_invoice", "trigger_event": "after_insert", "rules": [] }],
	"apiKeys": [{ "name": "agent-read", "user_id": "<user-id>", "scope": "read" }],
	"schedules": [
		{
			"name": "nightly-invoice-rollup",
			"type": "query.rollup",
			"cron": "0 3 * * *",
			"timezone": "Asia/Yangon",
			"payload": { "collection": "supplier_invoice", "measures": [{ "op": "sum", "field": "amount" }] },
		},
	],
	"reports": [{ "name": "Invoice Register", "collection": "supplier_invoice", "format": "csv" }],
}
```

### The 11 keys

| Key               | What it declares                              | Idempotency                                             |
| ----------------- | --------------------------------------------- | ------------------------------------------------------- |
| `collections`     | schema + policies (m2o, cache, integrity)     | created once; later applies add **missing** fields only |
| `pages`           | a page + its blocks                           | upserted by `module + path`, skipped when identical     |
| `roles`           | a role                                        | created once, then skipped                              |
| `permissions`     | a role × collection grant                     | replaced                                                |
| `workflows`       | states + transitions + doc-status map         | upserted by collection                                  |
| `menus`           | a menu item (needs an existing module)        | skipped when present                                    |
| `kpis`            | a materialized aggregate                      | upserted by name                                        |
| `serverFunctions` | a declarative hook (rules, never code)        | created once, then skipped                              |
| `apiKeys`         | a scoped machine key                          | created once (secret surfaced once)                     |
| `schedules`       | a recurring job over a **registered handler** | re-armed by derived id (never duplicated)               |
| `reports`         | a saved on-demand export                      | upserted by derived id                                  |

### Jobs and reports — what is real

- **`schedules`** writes a `_scheduler_tasks` row and arms the `SchedulerDO`; if arming is unavailable the
  every-10-minute `reconcile` watchdog picks it up, so a declared job still runs. The **work is code**: `type`
  must be a handler from `list_handlers` (`query.rollup`, `aggregate.delta`, `notify.digest`, `entity.transition`,
  `entity.expire`, `http.request`, `escalation.ladder`, `lake.export`, …). An unregistered type is refused by
  the plan **and** by apply, and writes no row — a typo must never become a task that silently never runs.
  `cron`/`repeat_ms` (recurring) and `run_now` (once, immediately) are mutually exclusive; a one-shot that
  already fired is **skipped** on replay, because a retryable write would run the job twice.
- **Seeing a job** — `get_operations { domain: 'jobs' }` returns each task's status, cadence, next run,
  `run_count` and `last_error` (payload omitted; it is operator data, not telemetry). The Studio's admin
  **Operations** tab renders the same list with a Run now / retry affordance. A job that stopped is never
  silent.
- **`reports`** stores a named definition in `_report_schedules`, materialized on demand by
  `POST /api/scheduled-reports/schedule/:id/generate` (the declared `format` decides json vs csv). It offers no
  `cron` and no aggregate/grouping: nothing dispatches that column, and the export route returns the collection
  as-is — so promising either would be a lie. Aggregated analytics live on `kpis` (which really does
  materialize values); scheduled delivery composes `schedules` with a handler.

An `apiKeys` entry provisions a scoped machine key; its **plaintext is returned once** in the apply result
(`results[].secret`). It is the only place a secret is ever surfaced.

```bash
# plan (no write)
curl -s localhost:8788/api/mcp -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"plan_manifest","arguments":{"manifest":{...}}}}'

# apply (governed)
curl -s localhost:8788/api/mcp -H 'Authorization: Bearer <write-key>' -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"apply_manifest","arguments":{"manifest":{...}}}}'
```

## Capability registry

`apps/api/src/plugins/mcp/capabilities.ts` is the SSOT: one descriptor per capability
`{ id, domain, class, summary, params, available }`. Every entry is now `available: true` — a capability is
only advertised once a verb really reaches it, and it was `false` for `schema.field.validate`,
`automation.schedule.define` and `analytics.report.define` until `validate_fields`, `list_handlers` and the
`schedules`/`reports` keys shipped. New power is a new **manifest key + registry entry + skill section**, not a
new tool.

## Security

- **Scopes** — `read` keys may call read tools only; a mutating tool returns `-32002`. `apply_manifest`
  additionally requires an **admin** session.
- **Determinism** — identifiers sanitized, field types validated against the 41-type SSOT, bounds on
  collections/fields/pages.
- **Audit** — writes go through the same services the REST/Studio paths use (change envelope, cache
  invalidation, `created_by`).
- The server never executes agent code; the agent runs code against the REST/OpenAPI surface.

## Tests

`apps/api/test/mcp-inbound.spec.ts` (catalog, gate tools, scope, `apply_patch`) ·
`apps/api/test/mcp-manifest.spec.ts` (discovery, plan-never-writes, idempotent apply, scoped denial) ·
`apps/api/test/factory-schedule-report.spec.ts` (handler registry, armed schedule, refused handler type,
dropped cron, saved report materialized on demand, field dry-run) ·
`apps/api/test/factory-jobs.spec.ts` (a declared job really executes and materializes its rollup, a spent
one-shot is not re-fired, `run_now`+cron is refused, a broken payload surfaces `last_error`) ·
`apps/studio/src/components/admin/operations-tab.spec.tsx` (a failed job's error is on screen; Run now
targets the right id) ·
`apps/api/test/factory-acceptance.spec.ts` (the end-to-end "can it build an app" contract — 13 checks across
every capability domain).
