# Build an app end-to-end — the "boom" runbook

A single, copy-paste walkthrough: **design → schema + UI → hardened app → deploy**.
Two ways to drive it — **the agent (MCP)** or **the Studio (human)**. Read §1–§6 once and you can ship.

> **Model:** the factory is a _builder_; the design tool is a _source_.
> `Stitch (design) ──▶ agent ──(DesignDNA)──▶ Factory MCP ──▶ live app (collections + pages)`

---

## 0. What you get at the end

| Artifact                                                   | Created by                                      |
| ---------------------------------------------------------- | ----------------------------------------------- |
| Collections, fields, relations, policies                   | generation gate **apply** (or `apply_manifest`) |
| Pages + blocks (the UI)                                    | the **same** apply (design → blocks)            |
| Roles, permissions, menus                                  | manifest keys                                   |
| Workflows, server functions, KPIs, reports, jobs, API keys | manifest keys                                   |
| Live data + audit trail                                    | the engine, on every write                      |

---

## 1. Prerequisites

- Node ≥ 20 + `pnpm` installed
- Repo checked out, deps installed: `pnpm install`
- `opencode` (for the agent path) — or a browser (for the Studio path)
- Optional: a Cloudflare account + `wrangler login` (only for §11 deploy)

---

## 2. Start the factory

```bash
pnpm dev
```

That runs **two** processes (via turbo):

| Process                       | URL                     | What it is                                     |
| ----------------------------- | ----------------------- | ---------------------------------------------- |
| `@mmbix/api` (`wrangler dev`) | `http://localhost:8788` | the engine **+ the Factory MCP** at `/api/mcp` |
| `@mmbix/studio` (`vite`)      | `http://localhost:5174` | the visual Studio                              |

**Studio login** comes from `apps/api/.dev.vars` (`ADMIN_USERNAME` / `ADMIN_PASSWORD`; the default is
`dev@mmbics.com` / `dev-password-for-local-only`). `dev-token` only works while `IS_DEV=true` — that is
**local-only**, never production.

Sanity check:

```bash
curl -s localhost:8788/api/collections -H 'Authorization: Bearer dev-token' | head -c 200
```

---

## 3. Connect the MCP servers (one time)

Two servers, two jobs:

| MCP                   | Job                                 | Where it is configured                                   |
| --------------------- | ----------------------------------- | -------------------------------------------------------- |
| **Factory API (MCP)** | build/operate (schema, pages, data) | project `opencode.json` (`Bearer dev-token`, local-only) |
| **Stitch MCP**        | design source (UI mockups)          | global `~/.config/opencode/opencode.json`                |

The Factory entry is already in the repo's `opencode.json`. Stitch needs an API key — keep it in the **global**
config (never commit a key):

```jsonc
// ~/.config/opencode/opencode.json  (mode 0600, outside the repo)
{
	"$schema": "https://opencode.ai/config.json",
	"mcp": {
		"stitch": {
			"type": "remote",
			"url": "https://stitch.googleapis.com/mcp",
			"enabled": true,
			"headers": { "X-Goog-Api-Key": "<your-stitch-api-key>" },
		},
	},
}
```

> Config is loaded **once at startup**. After editing it, **quit and restart opencode** or the new MCP will
> not appear.

Verify from a terminal (no restart needed):

```bash
curl -s https://stitch.googleapis.com/mcp \
  -H "X-Goog-Api-Key: $STITCH_KEY" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
```

---

## 4. Get a design (Stitch) — or skip to a prompt

Stitch's real chain (verified against the hosted server):

```
list_projects → get_project {name} → list_screens {projectId} → get_screen {name}
```

A screen is `{ name, title, deviceType, width, height, htmlCode, screenshot }`, where **`htmlCode` is a file
reference, not markup**:

- fetch `htmlCode.downloadUrl` → the HTML (`mimeType: text/html`)
- open `screenshot.downloadUrl` → the rendered image

Read both. The HTML is a styled mockup, so **judgment** compiles it into the fixture (a regex adds little).

**No design?** Use a one-line prompt instead — `propose_schema` accepts `prompt` and normalizes it
deterministically (no LLM needed):

```
Invoices with number, amount: currency, due date, and a paid flag
```

---

## 5. Propose the app (schema **and** UI) — one call

Before you compose UI, read the block vocabulary so every block type is real:

- MCP resource **`factory://blocks`** → every block's `defaults` (how to configure it), `allowedChildren`, and
  `container` flag. An unknown `type` is **dropped with a warning** at write time, never rendered.

Then propose. **Agent** (natural language is fine — it picks the tools):

> "Read `factory://blocks`, then propose an app from this design: build the `Purchase Order` collection with
> `code`, `total: currency`, a relation to `supplier`, and a page with a form + a table. Show me the fields
> and pages before applying."

**Or call the tool directly** (`propose_schema`). `dna` is the agent-normalized design; `prompt` is the shortcut:

```bash
curl -s localhost:8788/api/mcp \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"propose_schema","arguments":{
        "collection":{"name":"Purchase Order","slug":"po"},
        "prompt":"Purchase Order with code, total: currency, due date"}}}'
```

You get back a **draft** proposal: `fields` (each with a visible `inference.reason`) and `pages` (each design
component → a real block bound to the slug). **Nothing is written yet.**

---

## 6. Review the gate → apply

The human gate is a state, not a yes/no: `draft → review → promoted → live`.

```bash
ID=<proposal id from §5>

# optional: correct a field type; the next proposal LEARNS it
curl -s -X PATCH localhost:8788/api/generation/$ID/fields \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"fields":[{"name":"total","type":"currency"}]}'

# walk the gate (MCP tools: submit_for_review, promote, then apply)
curl -s -X POST localhost:8788/api/generation/$ID/submit  -H 'Authorization: Bearer dev-token'
curl -s -X POST localhost:8788/api/generation/$ID/approve -H 'Authorization: Bearer dev-token'
curl -s -X POST localhost:8788/api/generation/$ID/apply   -H 'Authorization: Bearer dev-token'
```

**`apply` is the only write.** It creates the **collection first, then upserts the page(s)** (idempotent — a
retry re-applies cleanly). `apply` requires the `promoted` state; applying twice is a no-op, not an error.

**Studio equivalent:** open `http://localhost:5174` → `/apps/<app>` → the **Generate** panel:
`prompt or DNA → Propose → review the per-field types → Submit for review → Approve → Apply (create app)`.
The panel shows each proposed page + its block types before you Apply.

---

## 7. Verify

```bash
# schema (fields live under schema_json)
curl -s localhost:8788/api/collections/po -H 'Authorization: Bearer dev-token' | head -c 400

# the UI the design produced
curl -s localhost:8788/api/pages -H 'Authorization: Bearer dev-token' | head -c 400

# read rows (bounded multi-collection read)
curl -s localhost:8788/api/query -X POST \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"requests":[{"collection":"po","params":{"limit":5}}]}'
```

Write a row (the generic data verb is `mutate` over MCP, or `POST /api/entities/po` over REST):

```bash
curl -s localhost:8788/api/mcp -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"mutate","arguments":{
        "requests":[{"op":"create","collection":"po","body":{"code":"PO-1","total":120}}]}}}'
```

---

## 8. Harden the app (one manifest)

The whole app is declarative. Pass **`app`** (the compact DSL — ~38% fewer tokens) or the full `manifest`:

```jsonc
// apply_manifest { app: { ... } }
{
	"v": 1,
	"cols": [
		{ "s": "supplier", "n": "Supplier", "f": ["name:text!", "email:email"] },
		{ "s": "po", "n": "Purchase Order", "f": ["code:text!", "total:cur", "supplier:m2o>supplier", "status:sel(draft,approved)"] },
	],
	"pages": [
		{ "p": "/orders", "t": "Orders", "b": [{ "id": "t1", "type": "table", "layout": { "order": 0 }, "config": { "collection": "po" } }] },
	],
	"roles": ["Clerk", { "n": "Manager", "d": "approves" }],
	"grants": [
		{ "r": "Clerk", "c": "po", "can": "rwc" },
		{ "r": "Manager", "c": "po", "can": "ra" },
	],
	"menus": [{ "m": "finance", "l": "Orders", "target": "po" }],
	"kpis": [{ "n": "PO Count", "c": "po", "agg": "count" }],
	// full-form keys pass through unchanged:
	"workflows": [
		{
			"name": "PO Approval",
			"collection": "po",
			"initial": "draft",
			"states": ["draft", "approved"],
			"transitions": [{ "id": "approve", "from": "draft", "to": "approved" }],
		},
	],
	"serverFunctions": [{ "name": "Stamp PO", "collection": "po", "trigger_event": "after_insert" }],
	"schedules": [
		{
			"name": "nightly-rollup",
			"type": "query.rollup",
			"cron": "0 3 * * *",
			"payload": { "collection": "po", "measures": [{ "op": "sum", "field": "total" }] },
		},
	],
	"reports": [{ "name": "PO Register", "collection": "po", "format": "csv" }],
	"apiKeys": [{ "name": "agent-read", "user_id": "<a user id>", "scope": "read" }],
}
```

```bash
# always plan first (writes NOTHING), then apply
curl -s localhost:8788/api/mcp -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"plan_manifest","arguments":{"app":{...}}}}'
```

Rules of thumb:

- **`!`** required, **`#`** unique, **`>target`** relation, **`(a,b,c)`** select options
- permission letters **`r`**ead **`w`**rite **`c`**reate **`d`**elete **`s`**ubmit **`a`**pprove
- `menus[].m` must be an **existing module**
- a job's `type` must come from **`list_handlers`** (an unregistered type is refused, and writes no row)
- `reports` are **on-demand exports** (no cron); aggregates belong in `kpis`

---

## 9. Policies (per collection)

Set the runtime behaviour without a redeploy — Studio **Policy panel** (App workbench + Collections workbench)
or:

```bash
curl -s -X PUT localhost:8788/api/collections/po/policies \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"policies":{"cache":{"enabled":true},"search":{"mode":"prefix","fields":["code"]},"offline_reads":{"enabled":false},"writes":{"append_only":false},"integrity":{"enabled":true,"limit":50,"rules":[{"type":"duplicate","fields":["code"]}]},"generation":{"enabled":true,"require_review":true},"design_source":{"provider":"none"}}}'
```

| Policy          | Effect                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `cache`         | per-collection response cache                                                                  |
| `offline_reads` | advertise `X-Offline-Max-Age` so a client may persist rows                                     |
| `writes`        | `service` (generic API 403) / `append_only` / `frozen_fields` / `freeze_when` / `actor_fields` |
| `search`        | `contains` (default) or index-backed `prefix`                                                  |
| `integrity`     | bounded data-quality rules (`GET /api/collections/:slug/integrity`)                            |
| `generation`    | the design→schema gate (off by default)                                                        |
| `design_source` | which design provider is accepted (`none` by default)                                          |

---

## 10. Shape the page (blocks)

**Manifest** — declare the page in `pages[].blocks` (see §8).
**Patch** — edit an existing page with structural ops (idempotent by id):

```bash
curl -s localhost:8788/api/mcp -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"apply_patch","arguments":{
        "page_id":"<page id>",
        "ops":[{"id":"o1","op":"ADD","parent":"t1","node":{"id":"k1","type":"kpi","layout":{"order":0},"config":{"label":"Total","collection":"po"}}}]}}}'
```

Ops: `ADD` · `MOVE` · `REMOVE` · `UPDATE` · `BIND` · `SPLIT`. Block types + defaults: **`factory://blocks`**.

In the Studio, the same page is edited on the **Page canvas** (`/apps/<app>`), blocks dragged from the palette.

---

## 11. Operate

| Need                      | Where                                                            |
| ------------------------- | ---------------------------------------------------------------- |
| Job health (`last_error`) | `get_operations { domain: 'jobs' }` · Studio **Operations** tab  |
| Run a job now             | `POST /api/scheduler/tasks/:id/run` · Operations tab **Run now** |
| Data-quality report       | `GET /api/collections/:slug/integrity`                           |
| Audit trail               | `get_audit` · `GET /api/audit`                                   |
| Index advisor             | `get_operations` (default)                                       |

---

## 12. Deploy (optional)

```bash
pnpm gen:infra          # regenerate wrangler configs from infra/env.prod (never edit them by hand)
pnpm check:infra        # CI parity check
pnpm test               # 15/15 tasks, api + studio + core + sdk + types
pnpm deploy:api
pnpm deploy:studio
```

Secrets (`wrangler secret put`) — never in `vars`:

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put BACKUP_ENCRYPTION_KEY   # hex 64; or the nightly R2 backup fails closed
```

---

## 13. Troubleshooting

| Symptom                                                                  | Cause / fix                                                                                         |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Stitch tools missing in opencode                                         | config not reloaded → **quit + restart opencode**                                                   |
| `Incompatible auth server: does not support dynamic client registration` | the key header was empty/unset → the request fell back to OAuth. Set the key.                       |
| `dev-token` rejected                                                     | you are not local / `IS_DEV` is off → use a real login or an API key                                |
| A block vanished after save                                              | its `type` is not in `factory://blocks` → it is dropped **with a warning** on purpose               |
| `no handler registered for type`                                         | the job's `type` is not in `list_handlers` → nothing was written                                    |
| `Apply requires the "promoted" state`                                    | run `submit` → `approve` first (review is required)                                                 |
| Pages look stale                                                         | a page write invalidates its reads; re-read, and pass `If-Match: <_schema_version>` on schema saves |

---

## 14. The whole thing in one prompt

Paste this into opencode once both MCP servers are loaded:

> Connect to **Stitch**, read project `<name>`, and for screen `<title>` produce a `DesignDNA` and POST it.
> Then: read `factory://blocks`, `propose_schema` a collection named **<Name>** (`<slug>`), show me the fields
> and pages, and wait for my go-ahead. After I approve, `submit_for_review` → `promote` → apply. Finally add a
> menu item, a Clerk role with read/write, a nightly `query.rollup` job, and verify by reading one page and
> one collection back.

That is the loop: **design → propose → review → apply → harden → verify.**
