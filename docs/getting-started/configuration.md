# Configuration

All configuration happens via Cloudflare bindings (env vars) in `wrangler.jsonc` or the Cloudflare dashboard.

## Environment Variables

| Variable         | Required | Default          | Description                                                                                                          |
| ---------------- | -------- | ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ADMIN_USERNAME` | ✅       | —                | Admin login username. Also used as the initial admin user's email.                                                   |
| `ADMIN_PASSWORD` | ✅       | —                | Admin password. Also used as JWT signing secret fallback. Min 8 chars in production.                                 |
| `TABLE_PREFIX`   | ❌       | `cms_`           | Prefix for user collection tables (`cms_products`).                                                                  |
| `IS_DEV`         | ❌       | —                | When `"true"`, accepts `dev-token` and skips login rate limits.                                                      |
| `JWT_SECRET`     | ❌       | `ADMIN_PASSWORD` | JWT signing secret. Use a strong random value.                                                                       |
| `DOMAIN`         | ❌       | —                | ⚠️ No longer enforced — CORS is permissive for a headless API (auth is header-based). Kept for backward compat only. |
| `API_KEY`        | ❌       | —                | Optional API key for `X-API-Key` header auth.                                                                        |

## Example Production Config

```jsonc
{
	"vars": {
		"ADMIN_USERNAME": "admin",
		"ADMIN_PASSWORD": "S3cure-P@ssw0rd-2026",
		"JWT_SECRET": "a-very-long-random-secret-string-32chars+",
		"TABLE_PREFIX": "cms_",
	},
}
```

## Feature Flags (Code-Level)

Each feature is a route/plugin in `src/index.ts`. To disable a feature, comment out its import + registration line.

```ts
// apps/api/src/index.ts
import { savedViewRoutes } from './routes/views'; // Saved views
app.route('/api/views', savedViewRoutes);
```

| Feature                 | File                       | Enabled By Default |
| ----------------------- | -------------------------- | ------------------ |
| Entities CRUD           | `routes/entities.ts`       | ✅                 |
| Auth                    | `routes/auth.ts`           | ✅                 |
| Users/Roles/Permissions | `routes/users.ts`          | ✅                 |
| Webhooks                | `routes/webhooks.ts`       | ✅                 |
| Search                  | `routes/search.ts`         | ✅                 |
| Audit                   | `routes/audit.ts`          | ✅                 |
| Bulk operations         | `routes/bulk.ts`           | ✅                 |
| Export/Import           | `routes/export.ts`         | ✅                 |
| Reports                 | `routes/reports.ts`        | ✅                 |
| Scheduler               | `routes/scheduler.ts`      | ✅                 |
| Media                   | `routes/media.ts`          | ✅                 |
| Saved views             | `routes/views.ts`          | ✅                 |
| Modules                 | `routes/modules.ts`        | ✅                 |
| Seed data               | `routes/seed.ts`           | ✅                 |
| Approvals               | `plugins/approvals`        | ✅                 |
| Tenants                 | `plugins/tenants`          | ✅                 |
| Snapshots               | `plugins/snapshot`         | ✅                 |
| Server functions        | `plugins/server-functions` | ✅                 |
| Calendar triggers       | `plugins/calendar`         | ✅                 |
| Notifications           | `plugins/notifications`    | ✅                 |
| PDF                     | `plugins/pdf`              | ✅                 |
| OpenAPI                 | `plugins/openapi`          | ✅                 |
| Archive                 | `plugins/archive`          | ✅                 |
| Templates               | `plugins/templates`        | ✅                 |
| SDK                     | `plugins/sdk`              | ✅                 |

## Auth Providers (v0.7)

Optional environment variables for external auth providers. When set, the provider's tokens are verified in addition to the built-in JWT:

| Variable              | Provider               |
| --------------------- | ---------------------- |
| `CLERK_SECRET_KEY`    | Clerk                  |
| `AUTH0_DOMAIN`        | Auth0                  |
| `SUPABASE_JWT_SECRET` | Supabase               |
| `OIDC_ISSUER`         | Generic OpenID Connect |

```bash
# Example: Clerk
curl -X POST http://localhost:8788/api/entities/products \
  -H 'Authorization: Bearer <clerk-session-token>' \
  -H 'Content-Type: application/json' \
  -d '{"title": "Widget"}'
```
