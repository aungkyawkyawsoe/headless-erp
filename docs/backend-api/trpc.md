# tRPC Layer (Type-Safe RPC)

The API also exposes a tRPC endpoint at `/trpc/*` — end-to-end type-safe RPC with full authentication. This is a Headless differentiator: TypeScript types flow from the server router to the client with zero codegen.

## Endpoint

```
POST /trpc/<procedure>
```

- Content-Type: `application/json`
- Body: tRPC JSON format: `{"json": <input>}`
- Auth: `Authorization: Bearer <token>` (same as REST)

## Procedures

### Auth

| Procedure    | Type     | Description                       |
| ------------ | -------- | --------------------------------- |
| `auth.login` | mutation | Login with email/password → token |
| `auth.me`    | query    | Current user                      |

### Entity

| Procedure             | Type     | Description                                                                      |
| --------------------- | -------- | -------------------------------------------------------------------------------- |
| `entity.collections`  | query    | List collections (admin)                                                         |
| `entity.createSchema` | mutation | Create collection (admin)                                                        |
| `entity.list`         | query    | List items — filter/sort/search/aggregate + `fields` (Directus-style projection) |
| `entity.get`          | query    | Get item — optional `fields` (lean by default, same rules as REST)               |
| `entity.create`       | mutation | Create item                                                                      |
| `entity.update`       | mutation | Update item                                                                      |
| `entity.softDelete`   | mutation | Soft delete                                                                      |
| `entity.restore`      | mutation | Restore                                                                          |
| `entity.hardDelete`   | mutation | Hard delete (admin)                                                              |

### Modules

| Procedure                                                                        | Type     | Description        |
| -------------------------------------------------------------------------------- | -------- | ------------------ |
| `module.list` / `module.detail`                                                  | query    | List / get module  |
| `module.create` / `module.update` / `module.delete`                              | mutation | Manage modules     |
| `module.listCollections` / `module.attachCollection` / `module.detachCollection` | —        | Module collections |

### Users, Roles, Permissions

| Procedure                                                    | Type | Description             |
| ------------------------------------------------------------ | ---- | ----------------------- |
| `users.list` / `users.get` / `users.create` / `users.update` | —    | User management (admin) |
| `roles.list` / `roles.create`                                | —    | Role management         |
| `permissions.set` / `permissions.get`                        | —    | Collection permissions  |

### Integrations

| Procedure                                         | Type     | Description               |
| ------------------------------------------------- | -------- | ------------------------- |
| `webhooks.list` / `create` / `update` / `delete`  | —        | Webhook CRUD              |
| `bulk.execute`                                    | mutation | Bulk create/update/delete |
| `audit.document` / `audit.collection`             | query    | Audit history             |
| `export.schema` / `export.data` / `export.import` | —        | Export/import             |
| `report.dashboard` / `report.generate`            | query    | Reports                   |

    | `scheduler.list` / `create` / `update` / `delete` / `run` | —        | Scheduled jobs            |

| `search.query` / `search.build` | — | Global search + unified index rebuild |
| `seed.status` | query | Seed status (dev) |

## Example Requests

### Query (login)

```bash
curl -X POST http://localhost:8788/trpc/auth.login \
  -H 'Content-Type: application/json' \
  -d '{"json": {"email": "admin", "password": "admin"}}'
```

### Query (list items)

```bash
curl -X POST http://localhost:8788/trpc/entity.list \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-token' \
  -d '{"json": {"collection": "products", "limit": 20}}'
```

### Query (list items, projected)

```bash
curl -X POST http://localhost:8788/trpc/entity.list \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-token' \
  -d '{"json": {"collection": "products", "limit": 20, "fields": "category.name,title"}}'
```

### Query (get item)

```bash
# Lean by default; pass `fields` to expand relations (same syntax as REST).
curl -X POST http://localhost:8788/trpc/entity.get \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-token' \
  -d '{"json": {"collection": "products", "id": "<id>", "fields": "*.*"}}'
```

### Mutation (create item)

```bash
curl -X POST http://localhost:8788/trpc/entity.create \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-token' \
  -d '{"json": {"collection": "products", "data": {"title": "Widget"}}}'
```

## Client Usage (Type-Safe)

```ts
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@mmbix/api/src/trpc/router';

const client = createTRPCClient<AppRouter>({
	links: [httpBatchLink({ url: 'https://api.example.com/trpc' })],
});

// Fully type-checked — autocomplete + compile-time errors
const items = await client.entity.list.query({ collection: 'products', fields: 'category.name,title' });
const detail = await client.entity.get.query({ collection: 'products', id: '<id>', fields: '*.*' });
await client.entity.create.mutate({ collection: 'products', data: { title: 'Widget' } });
```

The `AppRouter` type is defined in the API worker's tRPC router (`apps/api/src/trpc/router.ts`, exported from `@mmbix/api/src/trpc/router`) — import it from there for end-to-end type safety. (`@mmbix/types` no longer declares it.)

## Auth Context

Tokens are verified with the same JWT/`dev-token` logic as the REST API. Invalid tokens result in a tRPC `UNAUTHORIZED` error.

## When to Use tRPC vs REST

| Use Case                                  | Choose                 |
| ----------------------------------------- | ---------------------- |
| Type-safe client (React/Vue app)          | **tRPC**               |
| curl / scripts / third-party integrations | REST                   |
| Public API for external consumers         | REST + OpenAPI         |
| Internal admin tooling                    | tRPC (faster to build) |
