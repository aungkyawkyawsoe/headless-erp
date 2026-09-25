# MCP Factory Control Plane — Design

> **Date:** 2026-09-25 · **Status:** IMPLEMENTED — registry + manifest (collections incl. field-add/evolution, pages, roles, permissions, workflows, menus, kpis, serverFunctions, apiKeys) + verbs (`query`/`mutate` incl. import/`get_audit`/`get_operations`/`run_integrity`/`plan`/`apply`/generation/`apply_patch`) + resources (`capabilities`/`guide`/`blocks`) + `headless init --addons`; tests green · **Scope:** factory core

## 0. TL;DR

Give an AI agent **god-level power over the factory** without paying god-level token cost. The winning shape is
**not** 150 MCP tools. It is three layers:

- **Tier 0 — Knowledge (MD Skill):** how to build on the factory, loaded **on demand**.
- **Tier 1 — MCP verbs (few):** `search_capabilities`, `describe_capability`, `plan_manifest`, `apply_manifest`, `query`.
- **Tier 2 — Execution (SDK/OpenAPI, code the agent runs):** the long tail, composed client-side.

The unifying primitive is the **Manifest**: a declarative description of what to build. `plan` returns a diff
and writes nothing; `apply` is the only write, human-gated, scoped, idempotent. **New power = a new manifest
key + a skill section — never a new tool.**

## 1. Goal & non-goals

**Goal.** An agent turns a prompt into a working vertical (collections, fields, policies, pages) by composing
existing factory services, under a human gate, at ~1 tool-schema worth of standing context.

**Non-goals.**

| Out of scope                               | Why                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| A tool per API endpoint                    | 150 tool schemas ≈ 30k standing tokens; kills tool selection                    |
| Server-side code execution (`eval`)        | Banned on workerd. The **agent** runs code; the server exposes a typed contract |
| A second schema/service implementation     | Reuse `SchemaService` / `PageService` / `CollectionService`                     |
| Unguarded writes                           | The human gate is the factory's identity                                        |
| Running external MCP `stdio` in the Worker | Impossible; the agent is the MCP client                                         |

## 2. Decisions (ADR)

| #      | Decision                                                                          | Why                                                      |
| ------ | --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **M1** | Manifest is the universal write primitive                                         | One contract → infinite capability, bounded tool surface |
| **M2** | `plan` (read) / `apply` (write) split on every mutation                           | Human gate + dry-run by construction                     |
| **M3** | Few **verbs**, not many nouns; capabilities live in a **registry**                | Token cost is per-tool-schema; registry is a resource    |
| **M4** | Knowledge in **MD skills**, not tool descriptions                                 | On-demand load; 37× cheaper than always-on schemas       |
| **M5** | Long tail = **code against SDK/OpenAPI**, run agent-side                          | `eval` is banned; no server execution needed             |
| **M6** | One MCP endpoint, **domain boundaries inside**; split to Workers only when proven | Mirrors the repo's plugin/two-gate model; YAGNI          |
| **M7** | Deny-by-default; `read` scope cannot call `apply`                                 | PoLP, reuse the scoped-key model                         |

## 3. Architecture

```
Tier 0  Skill (MD, on-demand)      docs/skills/factory-builder/SKILL.md
Tier 1  MCP verbs (/api/mcp)       search · describe · plan · apply · query
Tier 2  Execution (agent code)     @mmbix/sdk + OpenAPI + /api/query
────────────────────────────────────────────────────────────────────
        MANIFEST  { collections, pages, … } → plan | apply
────────────────────────────────────────────────────────────────────
        existing services  SchemaService · PageService · CollectionService
```

**Token budget (standing context):** ~5 tool schemas (~800 tokens) + on-demand skill. vs ~150 tools (~30k).

## 4. Contracts

### 4.1 Capability registry (SSOT)

```ts
export type CapabilityDomain = 'meta' | 'schema' | 'pages' | 'data' | 'governance' | 'automation' | 'analytics' | 'ops' | 'generation';
export type CapabilityClass = 'read' | 'plan' | 'apply';

export interface CapabilityDescriptor {
	id: string; // 'schema.collections.create'
	domain: CapabilityDomain;
	class: CapabilityClass;
	summary: string;
	/** Human/agent-readable param hint — intentionally short (token-cheap). */
	params?: string;
	/** Whether a P1 verb/route implements it today. */
	available: boolean;
}
```

### 4.2 Manifest (the write primitive)

```ts
export interface FactoryManifest {
	version: 1;
	collections?: Array<{
		slug: string;
		name?: string;
		naming_series?: string;
		fields: Array<{ name: string; type: string; required?: boolean; related_collection?: string; options?: string[]; unique?: boolean }>;
		policies?: CollectionPolicy;
	}>;
	pages?: Array<{ module?: string; path: string; title: string; blocks?: unknown[] }>;
}

export interface ManifestAction {
	kind: 'create' | 'update' | 'skip';
	target: string;
	detail: string;
}
export interface ManifestPlan {
	actions: ManifestAction[];
	summary: { create: number; update: number; skip: number };
}
```

`planManifest(db, manifest)` is read-only. `applyManifest(db, auth, manifest)` is idempotent: collections are
created when missing and **skipped** when present (P1); pages are upserted and skipped when byte-identical.

## 5. MCP surface

| Tool                  | Class     | Scope       | Purpose                                                |
| --------------------- | --------- | ----------- | ------------------------------------------------------ |
| `search_capabilities` | read      | any         | filter registry by `q`/`domain`/`class`                |
| `describe_capability` | read      | any         | one descriptor (never a 200-tool dump)                 |
| `plan_manifest`       | read      | any         | diff: what would be created/updated                    |
| `apply_manifest`      | **write** | write/admin | the only write; human gate                             |
| `query`               | read      | any         | bounded multi-collection read (`/api/query` semantics) |

Resources: `factory://capabilities` returns the registry (on-demand discovery).

## 6. Security / STRIDE

| Threat           | Mitigation                                                            |
| ---------------- | --------------------------------------------------------------------- |
| Spoofing         | `requireAuth` + scoped keys (`mcpScopeAllows`)                        |
| Tampering        | manifest validated against the field-type SSOT; identifiers sanitized |
| Repudiation      | actor + `_generation_proposals`-style history for applied manifests   |
| DoS              | action caps (collections/fields/pages), existing rate limits          |
| Elevation        | `apply` requires admin + write scope; `read` key gets `-32002`        |
| Prompt injection | the pipeline proposes/plans; only the admin-gated `apply` writes      |

## 7. Phases

| Phase  | Deliverable                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| **P1** | Registry + verbose SSOT; skills MD; `search/describe/plan/apply/query`; manifest for **collections + pages** |
| **P2** | Manifest keys: policies, roles/permissions, menus, workflows; `audit` verb; field-add-to-existing            |
| **P3** | Optional sandboxed `execute` (code-mode) for the long tail                                                   |

## 8. Tests

- `apps/api/test/mcp-manifest.spec.ts` — plan never writes; apply creates + is idempotent; scope denies a read key.
- Pure unit: registry lookup, manifest validation, plan summary.
- Existing `mcp-inbound.spec.ts` extended for the new tools.

## 9. Reuse map

| Need               | Artifact                                         |
| ------------------ | ------------------------------------------------ |
| Collections/fields | `SchemaService.createCollection`                 |
| Pages              | `PageService.save` (upsert by module+path)       |
| Reads              | `CollectionService.listItems`                    |
| Auth/scope         | `requireAuth`, `api_key_scope`, `mcpScopeAllows` |
| Field types        | `packages/utils/src/field-types.ts`              |
| Execution contract | `@mmbix/sdk`, `openapi` plugin, `/api/query`     |
| Knowledge          | `AGENTS.md` (always) + skills (on-demand)        |
| Gating precedent   | `PLUGINS` ∩ `_addons`                            |
