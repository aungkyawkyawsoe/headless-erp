# Directus → D1 Employee Sync

One-way, REST-based employee directory sync from an external HR system
(**Directus** as the reference implementation) into the engine's
`hrm_employees` collection on Cloudflare D1.

**Recommended approach.** The sender (Directus) is kept *dumb*: its lifecycle
hooks (`items.create` / `items.update` / `items.delete`) fire raw payloads at
two thin, purpose-built `apps/api` endpoints. All sync semantics — external-id
mapping, idempotency, stale-event ordering, master-lookup resolution, soft
delete, field ownership — live **inside `apps/api`**, where they are enforced
once for every caller instead of re-implemented inside a Directus flow.

No new authentication scheme is introduced: the endpoints are authenticated by
the **same `Authorization: Bearer <token>`** as every other `/api/*` route —
a login JWT, or a **machine API key** (`mmk_…`, minted via
`POST /api/api-keys`) for server-to-server use.

## Who owns which fields

Directus is the source of truth for **identity/HR master** fields. The D1 side
owns **operational** fields. The sync endpoint enforces this split server-side
(deny-by-default): a field not in the whitelist is rejected with `400`, never
silently dropped.

| Directus field   | `hrm_employees` column | Notes                                                        |
| ---------------- | ---------------------- | ------------------------------------------------------------ |
| `eid`            | `eid`                  | Unique employee code — the business idempotency key          |
| `full_name`      | `name_en`              |                                                              |
| `name_mm`        | `name_mm`              |                                                              |
| `gender`         | `gender`               |                                                              |
| `dob`            | `dob`                  |                                                              |
| `doj`            | `doj`                  |                                                              |
| `is_active`      | `active`               | `true`/`false` → active/suspended (see [Delete semantics](#delete-semantics)) |
| `department`     | `department` (m2o)     | **Name** is sent; the endpoint resolves to `hrm_departments.id` (find-or-create) |
| `designation`    | `designation` (m2o)    | **Name** is sent; the endpoint resolves to `hrm_designations.id` (find-or-create) |
| `telegram_id`    | `etg_id`               | Telegram link — revokes/grants the mini-app session gate     |
| `role`           | —                      | **Rejected (400).** Never writable from a sync — would be privilege escalation |
| anything else    | —                      | **Rejected (400).** Unknown fields are an error, not noise   |

> **Why `role` is blocked.** The Telegram login grants whatever role the
> directory row carries (`hrm_employees.role`, see `telegram-gate.service.ts`).
> If a sync could set `role: "Administrator"`, whoever controls the Directus
> account controls every admin session. The endpoint refuses the field outright
> (poka-yoke), so no caller, flow, or future hook can introduce the hole.

## Endpoints

| Method | Path                     | Auth      | Description                                       |
| ------ | ------------------------ | --------- | ------------------------------------------------- |
| POST   | `/api/sync/employees`    | Bearer    | Process one create / update / delete event        |
| POST   | `/api/sync/employees/full` | Bearer  | Full-roster reconcile (webhook-loss backstop)     |

The route lives under `/api/sync/*` and is **not** gated by the generic
`/api/entities/*` idempotency middleware — the sync endpoint brings its own
dedup (below).

## Authentication & least privilege

Mint a dedicated machine key for Directus (admin, one time) and scope it to a
role that can only touch the directory:

```bash
curl -X POST http://localhost:8788/api/api-keys \
  -H 'Authorization: Bearer <admin-token>' -H 'Content-Type: application/json' \
  -d '{
    "name": "directus-employee-sync",
    "user_id": "<service-user-id>"
  }'
# → { "id": "...", "key": "mmk_...", ... }   ← key shown exactly once
```

The key's role needs, **at most**:

- `read` + `create` + `write` on `hrm_employees`
- `read` + `create` on `hrm_departments` and `hrm_designations` (master resolve)

Prefer a service account with a **dedicated least-privilege role** over the
`Administrator` role. Put `mmk_…` in the Directus server's environment
(`DIRECTUS_SYNC_SECRET` / `MFF_API_KEY`), never in source control.

## Single event

`POST /api/sync/employees`

```bash
curl -X POST https://<worker>/api/sync/employees \
  -H 'Authorization: Bearer mmk_...' -H 'Content-Type: application/json' \
  -d '{
    "event": "update",
    "external_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "source_updated_at": "2026-09-23T08:00:00Z",
    "delivery_id": "550e8400-e29b-41d4-a716-446655440000",
    "payload": {
      "eid": "MFF-011",
      "full_name": "U Aung Aung",
      "name_mm": "ဦးအောင်အောင်",
      "gender": "male",
      "dob": "1990-01-01",
      "doj": "2020-05-01",
      "is_active": true,
      "department": "Operation (YGN)",
      "designation": "Driver",
      "telegram_id": "123456789"
    }
  }'
```

**Request fields:**

| Field                | Required | Description |
| -------------------- | -------- | ----------- |
| `event`              | ✅       | `create` \| `update` \| `delete` |
| `external_id`        | ✅       | The Directus employee UUID — the stable sync key |
| `source_updated_at`  | ✅       | ISO-8601 timestamp of the source change (ordering watermark) |
| `delivery_id`        | ✅       | Unique id per webhook attempt (replay dedup) |
| `payload`            | ✅       | Whitelisted employee fields (see table above) |

`create` and `update` are treated identically (upsert): the endpoint matches
`external_id` → existing row, updates it, else creates it. `delete` soft-deletes
(see below). `eid` is used as the fallback identity key when no `external_id`
mapping exists yet — it makes a re-sent `create` idempotent.

**Responses:**

| Status | Body | Meaning |
| ------ | ---- | ------- |
| `202`  | `{ "synced": true, "action": "created" \| "updated" \| "unchanged" \| "deactivated", "row_id": "…" }` | Applied. `unchanged` = payload produced no diff |
| `200`  | `{ "synced": false, "action": "replay" \| "stale", "row_id": "…" }` | Duplicate delivery or older-than-last event — **no-op**, idempotent |
| `400`  | `{ "error": { "code": "VALIDATION_ERROR", … } }` | Missing field, unknown/`role` field, bad shape |
| `401`  | — | Missing / invalid bearer |
| `403`  | `{ "error": { "code": "FORBIDDEN", … } }` | Token lacks the required permission |
| `413`  | — | Body exceeds the size cap |

**Delete example:**

```bash
curl -X POST https://<worker>/api/sync/employees \
  -H 'Authorization: Bearer mmk_...' -H 'Content-Type: application/json' \
  -d '{
    "event": "delete",
    "external_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "source_updated_at": "2026-09-23T09:00:00Z",
    "delivery_id": "9c1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6e",
    "payload": {}
  }'
# → 202 { "synced": true, "action": "deactivated", "row_id": "…" }
```

## Idempotency & ordering

Two independent guards, both server-side:

1. **Replay dedup** — `delivery_id` seen before returns `200 {"action":"replay"}`
   with no write (Directus / network retries cannot double-apply).
2. **Stale-event guard** — a `source_updated_at` older than the last applied
   event for the same `external_id` returns `200 {"action":"stale"}` and does
   **not** overwrite newer data (out-of-order webhook delivery is ignored).

Both are recorded in `_sync_log`, which is also the audit trail / lineage for
every row change.

## Delete semantics

A `delete` event never hard-deletes: `hrm_employees` rows are referenced by
attendance, leave, and MRO foreign keys. The endpoint maps:

- **`event: "delete"`** → soft delete (`deleted_at = now`). The row disappears
  from every read; the Telegram gate (`deleted_at IS NULL`) revokes the session.
- **`is_active: false`** in a payload → `active = false`. The row stays visible,
  but the gate treats it as suspended (a temporary leave still revokes login).

The choice is deliberate and must be decided once: `deleted_at` = terminated /
removed from lists; `active = false` = suspended. Re-hiring a soft-deleted
employee re-creates a row from the next sync (the `external_id` mapping is
re-derived from `eid`).

## Full-roster reconcile (backstop)

Webhooks can be lost (Directus down, network drop, deploy window). A scheduled
full push — a Directus Flow on a timer, or a local cron — reconciles drift:

```bash
curl -X POST https://<worker>/api/sync/employees/full \
  -H 'Authorization: Bearer mmk_...' -H 'Content-Type: application/json' \
  -d '{
    "items": [
      {
        "external_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
        "source_updated_at": "2026-09-23T08:00:00Z",
        "payload": { "eid": "MFF-011", "full_name": "U Aung Aung", "is_active": true }
      }
    ],
    "tombstones": [ "7a1deb4d-…", "…" ]
  }'
```

- **`items`** — each entry is upserted with the same guards as the single event
  (bounded to **1000** items per request; more ⇒ paginate).
- **`tombstones`** — `external_id`s that exist in D1 but are absent from the
  snapshot. They are **deactivated** (`active = false`), never hard-deleted, so
  a partially-sent roster cannot wipe people.

**Response `202`:**

```json
{
  "synced": true,
  "received": 150,
  "created": 2,
  "updated": 10,
  "unchanged": 130,
  "deactivated": 3,
  "replays": 4,
  "stale": 1
}
```

This is the **self-healing** half of the design: the realtime webhook gives
low-latency updates, the snapshot gives eventual correctness.

## Directus side (reference)

### Option 1 — Flow (no code)

`Settings → Flows → Create`:

- **Trigger:** Event Hook → `items.create` + `items.update` (+ `items.delete`),
  collection = `employees`.
- **Operation:** Webhook / Request URL → `POST https://<worker>/api/sync/employees`
- **Headers:** `Authorization: Bearer <mmk_key>`, `Content-Type: application/json`
- **Body:** a hand-built JSON mapping Directus fields into the documented
  payload (Directus template strings: `{{ $trigger.key }}`,
  `{{ $trigger.payload }}`, `{{ $now }}`).

### Option 2 — Custom hook extension

```js
// extensions/hooks/employee-sync/src/index.js
export default ({ action }) => {
  const BASE = process.env.MFF_SYNC_URL;
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MFF_API_KEY}` };

  const push = (event, key, payload) =>
    fetch(`${BASE}/api/sync/employees`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        event,
        external_id: key,
        source_updated_at: new Date().toISOString(),
        delivery_id: crypto.randomUUID(),
        payload,
      }),
    });

  action('items.create', async ({ collection, key, payload }) => {
    if (collection === 'employees') await push('create', key, payload);
  });
  action('items.update', async ({ collection, keys, payload }) => {
    if (collection === 'employees') for (const k of keys) await push('update', k, payload);
  });
  action('items.delete', async ({ collection, keys }) => {
    if (collection === 'employees') for (const k of keys) await push('delete', k, {});
  });
};
```

Use `action` hooks (not `filter`): the DB write is already committed, the sync
never blocks the Directus transaction, and a failed push does not roll back the
source change.

## Errors

| Status | Code | When |
| ------ | ---- | ---- |
| 400    | `VALIDATION_ERROR` | Missing `event`/`external_id`, empty payload on create, unknown field, `role` present |
| 400    | `VALIDATION_ERROR` | `department`/`designation` name resolves to neither an existing row nor a creatable one |
| 401    | `UNAUTHORIZED`     | Missing/invalid bearer |
| 403    | `FORBIDDEN`        | Token lacks `create`/`write` on `hrm_employees` |
| 413    | `PAYLOAD_TOO_LARGE`| Body exceeds the middleware size cap |

All error codes are the canonical `ERROR_CODES` contract
(`@mmbix/types/contract.ts`); clients read them, never hardcode strings.