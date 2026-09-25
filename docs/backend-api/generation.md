# Governed Generation — design → schema (propose · review · live)

> **One pipeline:** a `DesignDNA` (or a prompt-derived one) maps to a **SchemaProposal**, a human reviews
> the **visible inference**, and only then is a collection created. The pipeline **proposes**; the human
> gate **writes**. Nothing is ever auto-applied by default.

## TL;DR

- **Deterministic first.** `inferFields()` (rules) runs before any LLM; the LLM is only a fallback for the
  residue — and its output must still land on one of the **41 field types** (`packages/utils/src/field-types.ts`).
- **ONE codec.** `@mmbix/types/dsl` holds the columnar encoder, `PatchOp`s and the design contracts; the
  Studio's `meta-codec` is a thin re-export of it.
- **Human gate = state.** `draft → review → promoted → live` (`rejected` terminal), persisted in
  `_generation_proposals`, compare-and-set on every transition.
- **Deny-by-default.** The `generation` plugin is gated by `PLUGINS`; the per-collection policy defaults OFF.
- **MCP inbound, read-only.** `/api/mcp` exposes `list_collections` / `describe_collection` — no write tool.

## Endpoints

All routes require **auth + admin** (v1) and live under the `generation` plugin (disable via `PLUGINS=none`).

| Method + path                                     | Purpose                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `POST /api/generation/propose`                    | `{ collection: { name, slug }, dna }` → a **draft** proposal. Never writes a schema. |
| `GET /api/generation` · `GET /api/generation/:id` | list / read proposals                                                                |
| `POST /api/generation/:id/submit`                 | `draft → review`                                                                     |
| `POST /api/generation/:id/approve`                | `review → promoted`                                                                  |
| `POST /api/generation/:id/reject`                 | `draft\|review → rejected`                                                           |
| `POST /api/generation/:id/apply`                  | `promoted → live` — the **only** schema write (idempotent on replay)                 |
| `POST /api/generation/patch`                      | `{ tree, ops }` → the patched tree, **no persistence** (max 500 ops)                 |

```bash
# propose
curl -s localhost:8788/api/generation/propose -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' -d '{
  "collection": { "name": "Supplier Invoice", "slug": "supplier_invoice" },
  "dna": { "source": { "provider": "manual" }, "screens": [{ "id": "s1", "anatomy": "invoice",
    "components": [{ "kind": "form", "hints": [
      { "label": "Invoice Number" },
      { "label": "Amount", "sampleFormat": "currency" },
      { "label": "Issue Date" },
      { "label": "Is Paid" }
    ]}]}]}
}'
# → { status: "draft", proposal: { collection: { fields: [{ name: "amount", type: "currency",
#     inference: { confidence: 2, reason: "design declared currency format", source: "declared" } }, …] } } }

# gate
curl -sX POST localhost:8788/api/generation/<id>/submit  -H 'Authorization: Bearer dev-token'
curl -sX POST localhost:8788/api/generation/<id>/approve -H 'Authorization: Bearer dev-token'
curl -sX POST localhost:8788/api/generation/<id>/apply   -H 'Authorization: Bearer dev-token'
```

## `DesignDNA` — the design source's only payload

Poka-yoke: the shape **cannot carry markup**. It is bounded (≤50 screens, ≤200 components/screen, ≤50
hints/component, labels stripped of `<`/`>` and capped) by `normalizeDesignDNA()`.

```ts
interface DesignDNA {
	source: { provider: 'stitch' | 'figma' | 'manual'; projectId?; screenId? };
	tokens?: { palette?; fonts?; spacing? }; // compared, never written verbatim
	screens: Array<{
		id: string;
		anatomy: string;
		components: Array<{
			kind: string;
			label?: string;
			hints?: Array<{ label: string; sampleFormat?: 'currency' | 'date' | 'phone' | 'email' | 'text' | 'number' | 'boolean' }>;
		}>;
		relations?: Array<{ from: string; to: string; cardinality: 'one' | 'many'; label?: string }>;
	}>;
}
```

## Inference (deterministic, O(hints))

`packages/core/src/inference/field-inference.ts`:

- **declared** sample format outranks a rule → `confidence: 2`, `source: 'declared'`;
- an ordered **rules table** (label → type) → `confidence: 1`, `source: 'rule'`;
- no match → `text`, `confidence: 0` (the gate always has something to review);
- a type not in `VALID_FIELD_TYPES` is **dropped with a warning**, never invented;
- `inferRelations()` maps declared relations to `m2o`/`o2m` proposals.

Same DNA + same name ⇒ byte-identical proposal (its JSON is the idempotency key).

## Prompt → DNA (no LLM)

`prompt-dna.ts` parses a plain-English prompt deterministically: the collection name is the text before
"with"; the rest splits on commas / "and" into field phrases, each optionally carrying a format
(`amount: currency`, `due date (date)`). Same prompt ⇒ same DNA ⇒ same proposal. This is the token-free
path for the common case; an LLM fallback stays behind `generation.allow_llm_fallback` (unused in v1).

```bash
curl -s localhost:8788/api/generation/propose -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{ "collection": { "name": "Invoices", "slug": "invoices" }, "prompt": "Invoices with invoice number, amount: currency, due date, is paid" }'
```

## Relations → `m2o`

A declared relation that implies a foreign key on THIS collection becomes a reviewable `m2o` field
(`many` pointing at us ⇒ we belong to `from`; `one` from us ⇒ we point at `to`). To keep apply safe, the
FK is **materialized only when the target collection already exists** — a not-yet-created parent is skipped
rather than failing the whole apply. Create parents first (or apply their proposals first).

## The learning loop

A review edit is a training signal. `PATCH /api/generation/:id/fields` changes a proposed field's type
while the proposal is `draft`/`review`; the change is recorded in `_generation_corrections` (keyed by field
name) and **overlaid on every future proposal** with that field name (`confidence: 2`, reason "learned from
prior human corrections"). Only SSOT-member types are accepted. This is the feedback loop that makes the
rules table better than a static guess over time.

## Runtime policy

The `generation` and `design_source` features are per-collection policies (defaults OFF / `none`),
settable via `PUT /api/collections/:slug/policies`:

```json
{
	"generation": { "enabled": false, "require_review": true, "max_fields_per_proposal": 40, "allow_llm_fallback": true },
	"design_source": { "provider": "none", "allowed_hosts": [] }
}
```

`require_review: false` is the only auto-apply path, and it is an explicit admin decision.

## DSL (`@mmbix/types/dsl`)

| Export                                           | Use                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `encodeColumns` / `decodeColumns`                | generic columnar codec (lossless, tolerant, deterministic)                     |
| `encodeMeta` / `decodeMeta`                      | the Studio metadata snapshot specialization (wire v2)                          |
| `applyOps(tree, ops)`                            | pure `ADD`/`MOVE`/`REMOVE`/`UPDATE`/`BIND`/`SPLIT`, idempotent by id, `O(ops)` |
| `DesignDNA` · `SchemaProposal` · `FieldProposal` | the generation contracts                                                       |

## MCP (inbound, scoped)

The MCP server also exposes the **factory control plane** (capability registry + the Manifest write
primitive). See **[MCP Control Plane](mcp.md)** for the full tool table, scopes and the manifest contract.

Generation tools on MCP: `propose_schema` (draft only), `submit_for_review`, `promote` (advance the gate),
`apply_patch` (page write). A schema write happens only through `apply_manifest`, under an admin + write
scope. The outbound design-source call is the **agent's** job — the Worker never runs `stdio`.

### Machine-key scopes

`POST /api/api-keys` accepts `scope: 'read' | 'write' | 'admin'` and **defaults to `read`**. A `read` key is
refused every mutating MCP tool (`-32002 Insufficient scope`) while reads still work; sessions (JWT /
dev-token) carry no scope and are already role-gated; a key created before scopes existed (null) resolves to
`admin` so the migration never breaks an integration.

## Tests

- `packages/types/src/dsl/__tests__/{codec,patch}.test.ts` — codec round-trip/tolerance, op purity.
- `packages/core/src/inference/__tests__/field-inference.test.ts` — rules, SSOT closure, determinism.
- `apps/api/test/generation-gate.spec.ts` — propose never writes; apply requires `promoted`; full gate; idempotency.
- `apps/api/test/generation-advanced.spec.ts` — prompt→DNA; relation→m2o materialization; learning loop.
- `apps/api/test/mcp-inbound.spec.ts` — tool catalog; JSON-RPC errors; gate tools; scope enforcement; `apply_patch`.
- `apps/api/test/design-source-stitch.spec.ts` — recorded-fixture adapter (no network).
- `apps/studio/src/lib/generation.spec.ts` — the action/state and summary logic.
