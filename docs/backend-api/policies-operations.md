# Runtime Policies & Operations Telemetry — API Reference

The headless control plane: enable / configure / dispose engine behaviors per
collection at runtime via REST — **no code, no redeploy**. Plus admin observability
for the self-tuning index engine.

---

## Runtime Policies

All routes: **admin-only**, base `/api/collections/:slug/policies`.

| Method   | Path                                       | Purpose                                                                                                              |
| -------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/collections/:slug/policies`          | Current raw per-collection policy (`{}` if none)                                                                     |
| `GET`    | `/api/collections/:slug/policies/resolved` | Merged policy (env/engine defaults × collection)                                                                     |
| `GET`    | `/api/collections/:slug/policies/features` | Discoverable feature list: `["auto_index","cache","offline_reads","writes","search","actor_fields","audit","hooks"]` |
| `PUT`    | `/api/collections/:slug/policies`          | Partial-merge update — enable / configure                                                                            |
| `DELETE` | `/api/collections/:slug/policies/:feature` | Dispose one feature (reset to engine default)                                                                        |

### Policy shape

```jsonc
{
	"auto_index": { "enabled": true, "mode": "auto", "max_dynamic": 4 },
	"cache": { "enabled": true, "ttl_s": 60, "layer": "auto" },
	"offline_reads": { "enabled": false, "max_age_s": 86400 },
	"writes": {
		"mode": "service",
		"append_only": true,
		"frozen_fields": ["status", "approved_by", "executed_at"],
		"freeze_when": { "field": "doc_status", "values": ["confirmed"] },
		"confirmable": true,
	},
	"search": { "mode": "prefix", "fields": ["serial_no"] },
	"actor_fields": ["reported_by"],
	"audit": { "enabled": false },
	"hooks": { "enabled": true },
}
```

- Merge order: **env defaults ← global ← per-collection** (per-collection wins).
- `auto_index.mode`: `"auto"` applies DDL; `"propose"` recommends only (change management).
- `cache.layer`: `"auto"` (in-isolate CacheLayer) is authoritative today; `memory | cache_api | kv` reserved for cross-isolate tiers.
- `offline_reads.max_age_s`: must be a finite number ≥ 1 (anything else → `400`); it is floored to whole seconds. See [Headless Performance Engine](../backend-plugins/performance-engine.md#offline_reads--the-one-policy-that-leaves-the-server).
- `writes.mode`: `"any"` (default) or `"service"` — the latter locks the generic entity API out of a table whose only legitimate writer is a domain service (`403`); `writes.append_only: true` freezes a history table (no update / delete / restore). Both must be the declared value (`400` otherwise). See [MRO inventory](mro-inventory.md#write-locks-service-only--append-only).
- `writes.frozen_fields`: field names the generic entity API silently **strips** from a create/update body — workflow/state columns (`status`, `approved_by`, `executed_at`, …) that only the domain service may set. Stripping (not rejecting) keeps a read-only field echoed by a form working, and the column keeps its default / server value. Without it, a caller with `write` on the collection could forge an approval by PUTting the state fields.
- **A service-only child stays writable through its parent.** `mode: "service"` / `append_only` lock the collection against DIRECT REST writes (`/api/entities/<child>`). A `table`-field composite write is the sanctioned path for the MRO document shape — a generic draft header whose `lines` are child rows created in the same POST — and stays open; the parent's own `freeze_when` gates the document lifecycle. Do not move the child check onto the nested path: it would break every draft (`apps/api/test/write-path-assurance.spec.ts` pins both halves).
- **A composite write also drops the CHILD collection's cached reads.** The child rows land in the child collection's OWN table, so invalidating the parent slug alone left a reader keyed on the child collection (the document page's own line read, `filter[parent_id][_eq]=…`) serving the PRE-SAVE lines until the response cache's TTL — a draft could be saved and reopening it showed the old lines. `ChildTableService.createChildren` / `replaceChildren` therefore end by calling `invalidateCollectionReads(childSlug)`, which clears the child's cached reads and names it in the write's `meta.changed.collections` so clients drop it too (`apps/api/test/child-table-cache.spec.ts` pins it, proving the entry is genuinely live first with a raw-D1 mutation).
- `writes.freeze_when`: `{ field, values[] }` — a **state-conditional** freeze. Once `row[field]` is one of `values`, the generic entity API refuses update / delete / restore with `403` (checked on the already-cached schema, so zero extra reads). This is what makes a POSTED document immutable (`{ field: "doc_status", values: ["confirmed"] }`): a confirmed GRN, goods issue or transfer can never be silently rewritten. Declared with a missing/empty `field` or a non-`string[]`/empty `values` → `400`. `append_only` freezes a whole table; `freeze_when` freezes a row only once it reaches a terminal state — the complement you want for a status-machine header.
- `writes.confirmable`: opt-in to the **generic `draft → confirmed`** transition. `confirmed` is a posted state a domain service owns (MRO stock documents), so the engine's core `doc_status` machine deliberately refuses it from `/api/entities` by default — a plain REST write must never forge a posted document. A record whose only "workflow" is _edit → confirm_ sets `true` (paired with `freeze_when` on `doc_status=confirmed` for a server-enforced one-way lock). The vehicle maintenance log is the reference: `confirmable: true` + `freeze_when { field: "doc_status", values: ["confirmed"] }`, so a job stays editable while `draft` and is immutable once confirmed. Must be a boolean (`400` otherwise); never set it on a service-owned document.
- `search.mode`: `"contains"` (default, any collection — `LIKE '%term%'`, unindexed) or `"prefix"` (`LIKE 'term%'`, served by an ordinary index when `search.fields` names indexed columns). `"prefix"` is the type-ahead shape ERP list screens use; it applies **only** when at least one declared field is a real column, otherwise the read falls back to `"contains"`. `search.fields` is the list of columns the term matches (an array of non-empty names, `400` otherwise). Either way the term is **escaped**, so a literal `%`/`_` in the query matches its own bytes instead of every row.
- `actor_fields`: a list of field names the engine stamps with the **authenticated employee** on create (and refuses to let a non-admin reassign on update) — so a reporter/requester can never be forged. The HR provisioner (`apps/api/scripts/provision-hr-schema.mjs`) snapshots this on the rows that record WHO filed them: `hrm_attendances` (a punch) and the three request collections (`hrm_leaves` / `hrm_overtimes` / `hrm_early_leaves`) all declare `["employee"]`, so a forged `employee` in the body is overwritten and an identity with no directory row is refused `403`. Applied idempotently (greenfield create + `PUT /policies` reconcile).
- **A punch's TIME is server-owned.** `hrm_attendances` is written through the generic entity API only via `POST /api/hr/attendances/punch` (server-resolved identity + geo), and a compiled time-lock hook (`apps/api/src/domain-modules/hr/attendance-time-lock.ts`) re-stamps `check_in` / `check_out` with the **server clock on every write path** — so a client can never backdate its own punch. A trusted-root admin (`auth.is_admin`) is exempt, keeping a deliberate back-fill / correction possible.
- **Row filters (`_role_permissions.row_filters`) are the row-level gate, and they cover WRITES too.** Every update / delete / restore runs `checkRowFilterAccess`, so the Telegram role's self filter (`employee eq $CURRENT_USER.employee_id`, set by `ensureRoleRowFilters` in `apps/api/src/routes/auth-telegram.ts`) stops both reading another employee's punches/requests AND touching their rows. A single-table filter cannot express "self OR subordinate" (and a self filter would block an approver's WRITE), so the manager's cross-employee scope lives in the server feeds instead — `GET /api/hr/requests` (list + search) and `POST /api/hr/requests/:kind/:id/decide` — which read/write privileged and enforce the reporting line themselves.
- Passing `null` for a top-level feature via `PUT` **disposes** it (removes it from the policy → falls back to default).
- Unknown feature names → `400`.

**Studio UI**: every one of these is a toggle in the per-collection **Runtime Policies**
dialog (`PolicyPanel.tsx`) — reachable from the **Collections workbench** toolbar and
the **App workbench** toolbar. The UI is a thin wrapper: it GETs this endpoint,
renders switches, and `PUT`s the merged body, so there is no second source of truth.

### Examples

```bash
# Enable auto-index in propose mode + response cache (60s TTL)
curl -X PUT $API/collections/orders/policies \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"auto_index":{"enabled":true,"mode":"propose"},"cache":{"enabled":true,"ttl_s":60}}'

# Disable auto-index for this collection
curl -X PUT $API/collections/orders/policies \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"auto_index":{"enabled":false}}'

# Dispose the cache feature (reset to default)
curl -X DELETE $API/collections/orders/policies/cache -H "Authorization: Bearer $TOKEN"

# Resolve the merged policy
curl $API/collections/orders/policies/resolved -H "Authorization: Bearer $TOKEN"
```

### What each feature controls

| Feature         | Engine gate                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| `auto_index`    | Self-tuning composite-index advisor — observation + apply/propose                                               |
| `cache`         | Headless response cache on `listItems`/`getItem` (auth-scoped, write-invalidated)                               |
| `offline_reads` | Advertises `X-Offline-Max-Age` so a client MAY persist the read body on-device                                  |
| `writes`        | Row lock: `service`-only / `append_only` / `frozen_fields` / `freeze_when` / generic `confirmable` on mutations |
| `search`        | How the global `?search=` term matches (`contains` vs index-backed `prefix`)                                    |
| `actor_fields`  | Creator-attribution fields stamped from the signed session on create                                            |
| `audit`         | `_audit_log` write toggle (also settable via the legacy `audit_enabled`)                                        |
| `hooks`         | Declarative server-hooks dispatch toggle                                                                        |

---

## Operations Telemetry (self-tuning index)

| Method | Path                            | Purpose                                                     |
| ------ | ------------------------------- | ----------------------------------------------------------- |
| `GET`  | `/api/operations/index-advisor` | **admin-only** — what the engine auto-created / recommended |

```jsonc
// GET /api/operations/index-advisor
{
  "mode": "auto",          // or "propose_only"
  "journal": [             // every auto-created (or proposed) composite index
    { "table": "cms_orders", "columns": ["status", "customer_id"], "signature": "status,customer_id", "createdAt": 1724... }
  ],
  "candidates": [          // currently-observed hot multi-column filter shapes
    { "table": "cms_orders", "filters": ["status", "customer_id"], "count": 42 }
  ]
}
```

---

## Related

- [Headless Performance Engine](../backend-plugins/performance-engine.md) — the full picture (self-tuning, response cache, cost stack)
- [Entities API](entities.md) — declaring `composite_indexes` / `status_machine` / `policies` on a collection
