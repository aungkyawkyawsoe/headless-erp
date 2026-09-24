# Data Lineage — Field-Level Audit

**"Where did this value come from, who set it, when?"** — per-field change
history, answerable per document (or per field). Enterprise-grade lineage
(SOX-style auditability) without per-collection schema changes.

## How it works

When a collection opts in (`audit_enabled: true` at creation — the same toggle
as the snapshot audit log), every create/update writes **one row per field**
into `_field_audit`:

```
id | collection_slug | document_id | field | value_from | value_to | by_user | source | created_at
```

`source` tags which pipeline stage wrote the value:

| source            | Meaning                                                               |
| ----------------- | --------------------------------------------------------------------- |
| `create`          | Field set at insert                                                   |
| `update`          | Field changed by an entity update                                     |
| `workflow`        | Set via a workflow transition (`state_field` / `doc_status_map` sync) |
| `decision_table`  | Set/computed by a business rule                                       |
| `hook` / `plugin` | Set by the hook spine / marketplace chain                             |

Combined with the workflow history (`_workflow_history`), the decision-rule
audit (`_decision_rule_audit`) and the snapshot audit log, this gives the full
**lineage graph**: rule fired → field computed → workflow moved → value
synced — every step attributable.

## Reading lineage

```bash
curl -H 'Authorization: Bearer dev-token' \
  'http://localhost:8788/api/audit/fields/invoices/<doc-id>'           # whole doc
curl -H 'Authorization: Bearer dev-token' \
  'http://localhost:8788/api/audit/fields/invoices/<doc-id>?field=amount'  # one field
```

```json
{
	"success": true,
	"data": [
		{
			"field": "amount",
			"value_from": null,
			"value_to": "500",
			"by_user": "u_123",
			"source": "create",
			"created_at": "2026-08-25T02:11:00Z"
		},
		{
			"field": "amount",
			"value_from": "500",
			"value_to": "900",
			"by_user": "u_123",
			"source": "update",
			"created_at": "2026-08-25T09:40:00Z"
		},
		{
			"field": "amount",
			"value_from": "900",
			"value_to": "1050",
			"by_user": "u_123",
			"source": "decision_table",
			"created_at": "2026-08-25T09:41:00Z"
		}
	]
}
```

## Opt-in, zero cost otherwise

Collections without `audit_enabled` pay nothing — no rows, no joins, no
overhead. Enable it at creation:

```bash
curl -X POST http://localhost:8788/api/entities \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{
    "name": "Invoices",
    "slug": "invoices",
    "audit_enabled": true,
    "fields": [ { "name": "amount", "type": "number" } ]
  }'
```

### Zero-waste snapshot mode (`snapshot_mode`)

By default, opting into audit stores **full before/after document snapshots** on
every write (`snapshot_mode: 'full'`) — simple, but write-amplified on documents
that change often. For write-heavy collections, choose the zero-waste `delta`
mode: only the compact per-field delta is stored on each write (plus ONE baseline
snapshot at create), and version history / diffs are reconstructed **on demand**
from the field lineage:

```bash
curl -X POST http://localhost:8788/api/entities \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{
    "name": "Ledger",
    "slug": "ledger",
    "audit_enabled": true,
    "snapshot_mode": "delta",   # 'full' (default) | 'delta' (zero-waste) | 'none'
    "fields": [ { "name": "amount", "type": "number" } ]
  }'
```

`GET /api/audit/:collection/:id` and `GET /api/audit/:collection/:id/diff` behave
identically in both modes (snapshots are materialized in the response); `delta`
just stops copying full documents into the ledger on every write.

## Files

| File                                                       | Responsibility                                         |
| ---------------------------------------------------------- | ------------------------------------------------------ |
| `apps/api/src/lib/services/field-audit.service.ts`         | Change-log writer (create diff / update diff, batched) |
| `apps/api/src/plugins/field-audit/plugin.ts`               | Migration `025_field_audit` + lineage route            |
| `apps/api/src/lib/services/collection-mutation.service.ts` | Pipeline wiring (gated on `audit_enabled`)             |
