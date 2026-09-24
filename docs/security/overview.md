# Security Overview

Defense-in-depth strategy covering authentication, authorization, injection defense, and rate limiting.

## Authentication

| Mechanism          | Where                           | Status          |
| ------------------ | ------------------------------- | --------------- |
| JWT (HS256)        | All `/api/*` routes             | Default         |
| Dev token          | `IS_DEV=true` only              | Dev convenience |
| External providers | Clerk / Auth0 / Supabase / OIDC | v0.7, opt-in    |

All routes require `Authorization: Bearer <token>`. Missing/invalid → `401 UNAUTHORIZED`.

## Authorization (RBAC)

Two layers:

1. **File-based system guards** — admin-only operations (users, roles, permissions, webhooks, scheduler, reports). Immutable roles (`Administrator`, `System`).
2. **DB-based business permissions** — collection CRUD via `_role_permissions`, with:
   - Row-level filters (`row_filters`) — injected as WHERE clauses
   - Field-level restrictions (`field_restrictions`) — stripped from responses
   - Status permissions (`can_submit`, `can_approve`)

### DDL Protection (v0.8+)

Schema mutation endpoints (`POST /api/collections`, `PUT /api/collections/:slug`, `DELETE /api/collections/:slug`) require **admin** access (`requireAdmin`). Regular users with business permissions can only perform data CRUD — they cannot create tables, add columns, or drop collections.

In production, schema changes should go through Infrastructure-as-Code (IaC) pipeline using [Schema Snapshot](../backend-plugins/schema-snapshot.md) rather than runtime API calls.

See [Users, Roles & Permissions](../backend-api/users-roles-permissions.md).

## SQL Injection Defense

- **All** queries use parameterized bindings via the custom QueryBuilder
- Table/column names pass through `sanitizeIdentifier` (regex: `^[a-zA-Z_][a-zA-Z0-9_]*$`)
- Identifiers are never interpolated from user input
- D1 errors are sanitized in production — internal stack traces never leak

## Rate Limiting (v2)

Role-aware tiers, in-memory sliding window:

| Tier           | Limit            |
| -------------- | ---------------- |
| Anonymous      | 100 req/min      |
| Authenticated  | 300 req/min      |
| Admin          | 1000 req/min     |
| Login endpoint | 5 req/min (prod) |
| Bulk endpoint  | 10 req/min       |

Over limit → `429 RATE_LIMIT_EXCEEDED`. (Dev mode raises anonymous/authenticated tiers to 10000/min.)

## Password Security

- PBKDF2 key derivation (SHA-256, 100k iterations) — replaced SHA-256
- Admin password validated for strength in production (min 8 chars, mixed case, digits)

## JWT Security

- HS256 via Web Crypto
- 24h expiry
- Secret: `JWT_SECRET` (falls back to `ADMIN_PASSWORD`) — use a dedicated secret in production

## Body & Input Limits

- Max request body: 10 MB
- CORS is intentionally permissive (auth is carried in the `Authorization` header, never cookies) — no `DOMAIN` restriction is enforced
- CSV import protects against formula injection (`=`, `+`, `-`, `@` prefix escaping)

## API Versioning

> The API versioning middleware (`X-API-Version`) was removed as dead code — no
> route ever read the negotiated version. All routes are version `1`; send
> `X-API-Version` only if you need future compatibility with a re-added version.

## Field Encryption

Mark fields `"encrypted": true` for AES-256-GCM at-rest encryption. See [Field Encryption](../backend-plugins/field-encryption.md).

## Webhook Security

- Optional HMAC-SHA256 signatures (`X-Webhook-Signature` header)
- Receivers verify authenticity with the shared secret
- **SSRF Protection:** webhook URLs are validated at create/update time:
  - Blocks internal hosts (`localhost`, `127.0.0.1`, `0.0.0.0`, `169.254.169.254`)
  - Blocks private IP ranges in production (10.x, 172.16-31.x, 192.168.x)
  - Requires HTTPS in production

## Production Checklist

- [ ] Confirm `IS_DEV` is **not** set in production vars (it lives only in local `.dev.vars`)
- [ ] `wrangler secret put ADMIN_PASSWORD` — strong, unique password (never commit to git)
- [ ] `wrangler secret put JWT_SECRET` — dedicated JWT signing secret (do not reuse ADMIN_PASSWORD)
- [ ] `ENCRYPTION_KEY` set if using encrypted fields
- [ ] RBAC roles + permissions configured (deny by default)
- [ ] Webhook secrets set for all subscriptions
- [ ] Schema changes via IaC (Schema Snapshot), not runtime API
- [ ] Review admin user list — remove default dev account
