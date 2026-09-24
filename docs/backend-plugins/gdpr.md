# GDPR Erasure — right-to-erasure with an audit trail

`gdpr.erase()` finds every record whose **PII field** matches a subject across
your collections and either **anonymizes** the value or **deletes** the row —
with a dry-run mode and a permanent audit log (`_gdpr_requests`) for
compliance. Collection → table resolution goes through `_entity_schemas`, so
you always target the real physical tables.

| Mode                  | What happens                                   |
| --------------------- | ---------------------------------------------- |
| `anonymize` (default) | `SET <piiField> = '[redacted]'` on every match |
| `delete`              | `DELETE` every matching row                    |
| `dryRun: true`        | Reports matches, touches nothing               |

## Routes

| Route                    | Purpose                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `POST /api/gdpr/erasure` | `{ subject, piiField, collections?, mode?, dryRun? }` → `{ requestId, matched, actions }` |
| `GET /api/gdpr/requests` | Audit log (`?limit=`)                                                                     |

```bash
# Find what would match (dry run first — always!)
curl -X POST http://localhost:8788/api/gdpr/erasure -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"subject":"user@example.com","piiField":"email","dryRun":true}'

# Execute: anonymize the email in every collection that has it
curl -X POST http://localhost:8788/api/gdpr/erasure -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"subject":"user@example.com","piiField":"email","mode":"anonymize"}'

# Full deletion, scoped to two collections
curl -X POST http://localhost:8788/api/gdpr/erasure -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"subject":"user@example.com","piiField":"email","mode":"delete","collections":["users","profiles"]}'

# Compliance audit
curl http://localhost:8788/api/gdpr/requests -H "Authorization: Bearer dev-token"
```

## In code

```ts
import { GdpRService } from '@mmbix/gdpr';

const gdpr = new GdpRService(new D1Client(env.DB));
const result = await gdpr.erase({ subject: 'user@example.com', piiField: 'email', mode: 'anonymize' });
// { requestId, matched, actions: [{ collection, table, action, count }] }
```

## Enterprise guardrails

- **Safe identifiers only** — collection slugs, tables and PII fields pass a
  strict `[a-zA-Z_][a-zA-Z0-9_]{0,63}` allow-list; payloads can never inject SQL.
- **Fail-soft per collection** — one collection error is recorded in `actions`
  (`action: 'error'`), the rest still process, and the request is still audited.
- **Every request is logged** — subject, mode, targets, counts, and per-action
  results land in `_gdpr_requests` before the response returns.
- **Dry-run by default in your workflow** — always preview before executing.

## Tests

`apps/api/test/gdpr.spec.ts` — anonymize/delete/dry-run behavior, unsafe
identifier rejection, HTTP routes, audit log writes.
