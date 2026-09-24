# Authentication

## Login

`POST /api/auth/login`

Get a JWT token. In dev mode, login rate limits are skipped.

**Request:**

```json
{ "email": "admin", "password": "admin" }
```

**Response (`200`):**

```json
{
	"success": true,
	"data": {
		"token": "eyJqdGkiOiJlN2I4YzY5NS0...",
		"user": { "id": "59ed5c0a-...", "email": "admin", "full_name": "Administrator" }
	}
}
```

**Errors:**

| Status | Error                           |
| ------ | ------------------------------- |
| 400    | Missing email/password          |
| 401    | Invalid email or password       |
| 500    | `ADMIN_PASSWORD` not configured |

> The admin user's email is the value of `ADMIN_USERNAME` env var (default: `admin`).

> 🔒 **A `disabled` account is refused at login, indistinguishably from a wrong
> password.** `AuthService.login` rejects a row whose `status !== 'active'` with the
> SAME `401 Invalid email or password` as a bad password, so the response cannot be
> used to enumerate which accounts exist or are switched off. Disabling is therefore
> a real revocation on both sides: no token is minted, and any token already issued
> dies on its next request (`verifyToken` applies the same check). Re-enabling takes
> effect just as immediately. Set it with `PUT /api/users/:id`
> (`{"status": "disabled"}`) — see `users-roles-permissions.md`.

### The account acts as an employee (`_users.employee_id`)

A password account may be **linked to an employee** (`_users.employee_id`, set
with `PUT /api/users/:id` — see `users-roles-permissions.md`). The link is what a
web sign-in needs to be usable at all:

- **The token is minted WITH that employee** — `generateToken(user.id, secret,
user.employee_id)` — exactly as a Telegram login embeds its directory row. Every
  server-scoped action (punch, leave filing, custody moves, transfer decisions)
  resolves its actor from the signed token, so without the link the session could
  read but not act.
- **Sign-in is directory-gated.** The account may only sign in while the employee
  it names is LIVE in `hrm_employees` (not soft-deleted, not `active: false`). An
  unlinked account is unaffected — that is a legitimate shape (the bootstrap
  admin).
- **Revocation is per-request and immediate.** `verifyToken` →
  `_healActingEmployee` re-validates the link on EVERY request (one indexed point
  read, never cached, so a revoke never waits on a TTL) and refuses the bearer
  outright once the employee is gone. Offboarding therefore ends the web session
  exactly as removing an `etg_id` ends a Telegram one, and the next `GET
/api/auth/me` answers `401`.
- **The refusal message differs by where it happens, on purpose.** Before the
  password verified it is the generic `401 Invalid email or password` (no account
  enumeration); AFTER it — the only point a legitimate owner can reach — a dead
  link answers `401 Your account is no longer linked to an active employee —
contact HR to restore access`, which is actionable instead of a lie about the
  password.

## Telegram Mini App Login (approval-gated)

`POST /api/auth/telegram`

Exchanges the Telegram WebApp `initData` for access. The **employee directory**
(`hrm_employees.etg_id` — config-driven via `TELEGRAM_DIRECTORY_COLLECTION` /
`TELEGRAM_DIRECTORY_FIELD`) is the source of truth for approval:

- `etg_id` **exists** in the directory → `_users` row + Employee role provisioned, JWT issued (`approved`).
- `etg_id` **missing** → a `telegram_requests` row is upserted (the admin-visible approval queue) and the response is `pending` — **no token**. Admins approve by creating the employee record with that `etg_id`; the next login returns `approved`.

> **Revocation:** the directory gate is _live_ — removing the employee's `etg_id`
> (or deleting the row) revokes the session immediately. `GET /api/auth/me` then
> returns `401` for the still-valid JWT, so clients that check their session on
> load (the Telegram mini app does) log the user out; the next `POST
/api/auth/telegram` falls back to `pending`.

All logins (Telegram + email/password) resolve to the **single `_users` table** — one RBAC model. `telegram_requests` is an approval staging queue, not a user table.

> **Role grants are reconciled on login _and_ on every session check.** The
> configured Telegram role (`TELEGRAM_ROLE_NAME`, default `Employee`) owns the
> grants listed in `TELEGRAM_ROLE_COLLECTIONS`; both `POST /api/auth/telegram`
> and `GET /api/auth/me` re-apply them idempotently (shared
> `lib/services/telegram-role.service.ts`). The session check matters because the
> JWT is long-lived and the WebView keeps it — an already-signed-in employee
> never re-runs login, so a collection added to the list by a deploy would
> otherwise stay absent from that role's `_role_permissions` and the screen would
> sit in its read-error state forever (e.g. _"Couldn't read the stock
> balances"_ when `mro_inventory` was granted in config but never written for the
> existing session's role).

**Request:**

```json
{ "initData": "query_id=...&user=...&auth_date=...&hash=..." }
```

**Response — approved (`200`):**

```json
{
	"success": true,
	"data": {
		"status": "approved",
		"token": "eyJ...",
		"user": { "id": "...", "email": "tg-123@telegram.local", "full_name": "...", "role_id": "...", "role_name": "Employee" }
	}
}
```

**Response — pending (`200`, no token):**

```json
{
	"success": true,
	"data": { "status": "pending", "tg_id": "123", "full_name": "..." }
}
```

**Errors:**

| Status | Error                                              |
| ------ | -------------------------------------------------- |
| 400    | Missing `initData` / invalid user payload          |
| 401    | Bad initData signature / stale (`auth_date` > 24h) |
| 500    | `JWT_SECRET` / `TELEGRAM_BOT_TOKEN` not configured |

> Production requires the `TELEGRAM_BOT_TOKEN` secret (BotFather) — without it,
> every Telegram login fails validation (secure by default). `auth_date` older
> than 24h is rejected (replay protection).
>
> **Local dev without a token:** with `IS_DEV=true` and NO `TELEGRAM_BOT_TOKEN`
> (the default `.dev.vars`), the HMAC can't be verified (the token IS the
> secret), so the payload is trusted instead — both the plain-browser `body.user`
> dev fallback AND a real Telegram session's `initData` (user parsed from it;
> `auth_date` freshness still enforced). This is how the full approval-gate flow
> (pending → admin approves → approved) can be tested locally. Set the real token
> in `.dev.vars` to enforce real signature verification locally instead.

## Using the Token

```bash
curl http://localhost:8788/api/entities \
  -H 'Authorization: Bearer <token>'
```

## Dev Token

When `IS_DEV=true`, the literal token `dev-token` bypasses verification:

```bash
curl http://localhost:8788/api/entities -H 'Authorization: Bearer dev-token'
```

This gives full admin access for local testing. **Never enable `IS_DEV` in production.**

## Current User

`GET /api/auth/me`

```bash
curl http://localhost:8788/api/auth/me -H 'Authorization: Bearer dev-token'
```

**Response:**

```json
{
	"success": true,
	"data": {
		"user_id": "00000000-0000-4000-8000-000000000000",
		"role_id": "",
		"role_name": "Administrator",
		"email": "dev",
		"is_admin": true
	}
}
```

> **Telegram sessions are directory-gated here too:** for a Telegram-provisioned
> session (email `tg-<id>@telegram.local`), `/auth/me` re-checks the directory
> and returns `401` once the employee's `tg_id` is removed — the signal the mini
> app uses to log out on reload.

## Role & permission freshness

A role, permission, or user-status change takes effect on the **next request** —
there is no cache window to wait out. Every cached authorization lookup
(`checkBusiness` / field restrictions / row filters, and the cached `user:` /
`role:` rows) is keyed by a version stamp derived from the data itself:
`MAX(updated_at)` across `_users` / `_roles` / `_role_permissions`. A write bumps
the data, so the next read misses the stale entry in **every** isolate — the
`CacheLayer` is per-isolate and Workers have no cross-isolate invalidation
channel.

The stamp is itself cached for ~1 second, so the worst-case propagation is ~1s
(and immediate for the isolate that served the write, which calls
`invalidateAuthzVersion()`). Signing in does **not** count as an authz write: the
`last_login` touch uses raw SQL so it never evicts these caches. The mini app also
re-reads `/auth/me` on resume (`refreshMe()`), so a change lands without a manual
reload.

Pinned by `apps/api/test/authz-freshness.spec.ts` (a grant / role swap written
directly to D1 is reflected by the very next gated read) +
`apps/api/test/auth-profile-freshness.spec.ts`.

## Unauthorized Response

All `/api/*` routes return this when no/invalid token:

```json
{ "success": false, "error": "Authentication required. Use Authorization: Bearer <token>", "code": "UNAUTHORIZED" }
```

Status: `401`.

## External Auth Providers (v0.7)

Headless acts as an OAuth **consumer** — it verifies tokens issued by external providers. No OAuth server runs inside the worker.

Supported (auto-detected):

- **Clerk** — requires `CLERK_SECRET_KEY`
- **Auth0** — requires `AUTH0_DOMAIN`
- **Supabase** — requires `SUPABASE_JWT_SECRET`
- **Generic OIDC** — requires `OIDC_ISSUER`

```bash
curl http://localhost:8788/api/entities \
  -H 'Authorization: Bearer <clerk-or-auth0-or-supabase-token>'
```

If the built-in JWT fails, each configured provider is tried in order until one succeeds.

## Rate Limits

| Tier          | Requests/min (production) | Applies To                               |
| ------------- | ------------------------- | ---------------------------------------- |
| Anonymous     | 100                       | Requests without a valid token           |
| Authenticated | 300                       | Requests with a valid token              |
| Admin         | 1000                      | Requests from admin users                |
| Login         | 5/min                     | `POST /api/auth/login` (production only) |
| Bulk          | 10/min                    | `POST /api/bulk/*`                       |

> In dev mode (`IS_DEV=true`), anonymous/authenticated tiers are raised to 10000/min to avoid interfering with local testing.

On limit exceeded: `429` with `{"success": false, "error": "Rate limit exceeded", "code": "RATE_LIMIT_EXCEEDED"}`. Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`.

## JWT Details

- Algorithm: HS256 (Web Crypto)
- Expiry: 24 hours
- Secret: `JWT_SECRET` env var, falling back to `ADMIN_PASSWORD`
- Payload: `{ jti, user_id, iat, exp, employee_id? }`

`employee_id` is present for a directory-provisioned (Telegram) session AND for a password session linked to an employee (`_users.employee_id`), and names the `hrm_employees` row that session acts as. It is signed into the token at login, so it is tamper-proof and costs no extra DB read to trust — this is what the MRO audit actor (`by_user` / `approved_by` / `issued_by`) and the `policies.actor_fields` stamp are bound to, instead of a client-supplied id. It is NOT taken on trust for the life of the token: `verifyToken` re-validates it against the live directory on every request and refuses the bearer when the employee is gone (see _The account acts as an employee_ above). Admin / unlinked password / external-provider sessions carry no `employee_id` (see `AuthContext` in `@mmbix/types`).
