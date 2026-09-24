# Backend API Reference

The complete REST + tRPC surface of `apps/api` (Hono worker on Cloudflare
Workers + D1 + R2). All routes under `/api/*` require
`Authorization: Bearer <token>`.

| Doc                                                      | What It Covers                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Authentication](authentication.md)                      | Login, JWT, RBAC, rate limits, dev token                                      |
| [Entities](entities.md)                                  | Collection + item CRUD, filters, pagination                                   |
| [Client SDK](sdk.md)                                     | `@mmbix/sdk` — typed client, typegen, offline queue, `@mmbix/sdk-react` hooks |
| [Bulk Operations](bulk-operations.md)                    | Batch create/update/delete + bulk transition                                  |
| [Users, Roles & Permissions](users-roles-permissions.md) | User management + RBAC                                                        |
| [Search](search.md)                                      | Global FTS5 search + unified index                                            |
| [Audit Trail](audit.md)                                  | History, diffs, v3 queries                                                    |
| [Reports](reports.md)                                    | Dashboard, grouped, pivot reports                                             |
| [Export / Import](export-import.md)                      | JSON/CSV export, JSON/CSV import                                              |
| [Media](media.md)                                        | File upload/serve via R2                                                      |
| [Webhooks](webhooks.md)                                  | HMAC-signed event notifications                                               |
| [Scheduler](scheduler.md)                                | Cron-based scheduled jobs                                                     |
| [Modules](modules.md)                                    | Module grouping, menus, views                                                 |
| [Saved Views](views.md)                                  | User presets for filters/sorts/columns                                        |
| [tRPC Layer](trpc.md)                                    | Type-safe RPC with end-to-end types                                           |
| [Runtime Policies & Ops](policies-operations.md)         | Per-collection feature toggles + index-advisor telemetry                      |
