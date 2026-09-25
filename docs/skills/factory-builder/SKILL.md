---
name: factory-builder
description: >-
  Build anything on the headless entity factory through its MCP control plane —
  collections, fields, policies, pages — using the Manifest primitive. Use when
  a user asks to create/modify an app, data model, backend, or UI on this factory,
  or when working through the /api/mcp server (plan_manifest / apply_manifest).
---

# Factory Builder

You are building on a **headless entity factory** (Cloudflare Workers + D1). The
factory already has an entity engine, a page/block renderer, RBAC, workflows and
policies. **You compose those capabilities — you do not write new services.**

## The one rule: build with a Manifest

Do **not** call one tool per field. Express the whole build as a **manifest** and
let the factory plan + apply it:

1. `search_capabilities` / read `factory://capabilities` — discover what exists.
2. `plan_manifest { manifest }` — a diff. **Writes nothing.** Show it to the human.
3. `apply_manifest { manifest }` — the **only** write. Admin + `write`/`admin` key
   scope required. Idempotent: replay skips what already exists/unchanged.

## Manifest shape

```jsonc
{
	"version": 1,
	"collections": [
		{
			"slug": "supplier_invoice", // identifier: [a-z_][a-z0-9_]*
			"name": "Supplier Invoice",
			"naming_series": "SINV-", // optional auto-number (SINV-00001)
			"fields": [
				{ "name": "invoice_no", "type": "text", "required": true, "unique": true },
				{ "name": "amount", "type": "currency" },
				{ "name": "due_date", "type": "date" },
				{ "name": "status", "type": "select", "options": ["draft", "posted"] },
				{ "name": "supplier", "type": "m2o", "related_collection": "supplier" },
			],
			"policies": { "search": { "mode": "prefix", "fields": ["invoice_no"] } },
		},
	],
	"pages": [
		{
			"path": "/supplier-invoices",
			"title": "Supplier Invoices",
			"blocks": [
				{
					"id": "row1",
					"type": "row",
					"layout": { "order": 0 },
					"config": {},
					"children": [
						{
							"id": "t1",
							"type": "table",
							"layout": { "order": 0, "colSpan": 4 },
							"config": { "collection": "supplier_invoice", "limit": 20 },
						},
					],
				},
			],
		},
	],
	"roles": [{ "name": "Invoice Clerk", "description": "handles invoices" }],
	"permissions": [{ "role": "Invoice Clerk", "collection": "supplier_invoice", "can_read": true, "can_write": true, "can_create": true }],
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
}
```

## Rules that keep you correct

- **Field types** are a closed catalog of 41 (`@mmbix/utils` `VALID_FIELD_TYPES`).
  An unknown type is **dropped with a warning** — never invented. Read
  `factory://capabilities` or `describe_collection` before guessing.
- **Identifiers** are sanitized (`^[a-z_][a-z0-9_]*$`). Prefer snake_case slugs.
- **Relations**: `m2o` requires `related_collection` to already exist. Create the
  parent collection first (order `collections` parent-before-child).
- **A field is required unless you set `"required": false`.** YAGNI: default to
  optional unless the domain demands otherwise.
- **Pages are upserted by `module + path`.** A page with identical blocks is
  skipped on replay.
- **Never guess a page's block vocabulary.** Blocks come from `BLOCK_REGISTRY`;
  `table`/`list`/`kpi`/`chart` take a `config.collection`.

## The workflow

```
prompt → design collections + fields (+ pages)
       → plan_manifest   (show the human the diff)
       → human approves
       → apply_manifest  (idempotent)
       → query           (verify rows)
```

When the human only wants a suggestion, stop at `plan_manifest` (or use
`propose_schema` for a design-DNA-driven proposal). **Applying without approval is
a violation of the factory's human-gate rule.**

## When the manifest is not enough

The manifest covers the common build path. For long-tail actions not yet in the
registry (`available: false`), use the factory's REST API / `@mmbix/sdk` directly
(the OpenAPI surface), run from your own environment. The server never executes
your code.

## Reuse map

| Need                                        | Capability                                                         |
| ------------------------------------------- | ------------------------------------------------------------------ |
| Collections / fields                        | `schema.manifest.apply` (existing collections gain missing fields) |
| Policies (cache, search, writes, integrity) | collection `policies` in the manifest                              |
| Pages / menus                               | `pages.manifest.apply` · `pages.menu.create` (module must exist)   |
| Roles / permissions                         | `governance.role.create` · `governance.permission.grant`           |
| Workflows                                   | `automation.workflow.define`                                       |
| Server functions (declarative hooks)        | `automation.serverFunction.define` (manifest `serverFunctions`)    |
| KPIs                                        | `analytics.kpi.define` (manifest `kpis`)                           |
| Provision an agent key                      | manifest `apiKeys` (plaintext returned once)                       |
| Reads                                       | `query`                                                            |
| Data writes                                 | `mutate` (create/update/delete/import)                             |
| Audit                                       | `get_audit`                                                        |
| Design → schema proposal                    | `generation.schema.propose`                                        |
| Gate a proposal                             | `generation.proposal.gate`                                         |
