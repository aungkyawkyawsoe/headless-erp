# OpenAPI / Scalar

Auto-generated OpenAPI 3.0 documentation for your entity schemas, rendered with
the [Scalar API Reference](https://scalar.com) UI.

## Endpoints

| Method | Path                | Description                        |
| ------ | ------------------- | ---------------------------------- |
| GET    | `/api/openapi.json` | OpenAPI 3.0.3 specification (JSON) |
| GET    | `/api/docs`         | Interactive Scalar API Reference   |

Both routes require `Authorization: Bearer <token>` — the schema is internal
design info and must not be disclosed to anonymous callers.

## OpenAPI Spec

`GET /api/openapi.json` — generated from all collection schemas. Each collection
gets its full data-plane surface:

- `GET /api/entities/:collection` — list items
- `POST /api/entities/:collection` — create item
- `GET /api/entities/:collection/:id` — get item
- `PUT /api/entities/:collection/:id` — update item
- `DELETE /api/entities/:collection/:id` — soft delete (trash)
- `POST /api/entities/:collection/import` — bulk create (JSON array or CSV)
- `POST /api/entities/:collection/bulk/transition` — bulk status transition
- `POST /api/entities/:collection/action/:action` — declarative collection action
- `POST /api/entities/:collection/:id/restore` — restore from trash
- `DELETE /api/entities/:collection/:id/force` — hard delete (admin only)
- `POST /api/entities/:collection/:id/approve` / `reject` — approval decisions
- `GET /api/entities/:collection/:id/approvals` — approval history

Shared paths are documented once (not per collection):

- `POST /api/bulk/:collection` — bulk create / update / delete (RBAC)
- `POST /api/query` — read batch (one view, one round trip)
- Schema plane: `/api/collections`, `/api/collections/:slug`, `/api/field-types`
- Search, users, me, media, audit, reports, webhooks, scheduler, views, modules

```json
{
  "openapi": "3.0.3",
  "info": {"title": "Entity Engine API", "version": "1.0.0"},
  "paths": {
    "/api/entities/articles": {"get": {"tags": ["articles"], ...}},
    "/api/bulk/{collection}": {"post": {"tags": ["Bulk"], ...}}
  }
}
```

## Scalar API Reference

`GET /api/docs` — serves the Scalar API Reference from jsDelivr CDN, pointed at
`/openapi.json`.

```bash
curl http://localhost:8788/api/docs
```

> **CDN note:** the `@scalar/api-reference` bundle is loaded from jsDelivr
> without SRI pinning. For production, pin a specific version and add integrity
> hashes.

## SDK code samples

Every operation carries an `x-codeSamples` entry (Redocly/Scalar standard)
labelled **`@mmbix/sdk`**. Scalar renders it as an extra tab alongside the
auto-generated HTTP / Dart / Python / etc. samples, so you can copy a ready-to-
run SDK snippet straight into your app.

```json
{
	"paths": {
		"/api/entities/articles": {
			"post": {
				"x-codeSamples": [
					{
						"lang": "JavaScript",
						"label": "@mmbix/sdk",
						"source": "const item = await client.items('articles').create({ ... });"
					}
				]
			}
		}
	}
}
```

CRUD operations use the fluent `client.items('<collection>')` API; bulk,
import, workflow, and other shared endpoints use `client.request(...)` or
`client.queryMany(...)`.

## Usage

1. Open `http://localhost:8788/api/docs` in a browser
2. Authorize with your Bearer token (Authorize button → `Bearer <token>`)
3. Explore and test endpoints interactively
