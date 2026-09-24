# Schema Snapshot (IaC)

Infrastructure as Code for your data models. Export the full schema to JSON, diff it against another environment, and apply changes.

## Endpoints

| Method | Path                    | Permission | Description                                       |
| ------ | ----------------------- | ---------- | ------------------------------------------------- |
| GET    | `/api/snapshot/export`  | admin      | Export full schema                                |
| POST   | `/api/snapshot/apply`   | admin      | Apply a snapshot                                  |
| POST   | `/api/snapshot/diff`    | admin      | Diff current DB vs snapshot                       |
| POST   | `/api/snapshot/diff-v2` | admin      | **v0.7** Deep diff with breaking-change detection |

## Export

`GET /api/snapshot/export`

```bash
curl http://localhost:8788/api/snapshot/export -H 'Authorization: Bearer dev-token' > snapshot.json
```

**Response:** `{ success: true, data: { version, generated_at, collections: [...], relations: [...] } }`

## Diff

`POST /api/snapshot/diff` — compare current DB state against an uploaded snapshot.

```bash
curl -X POST http://localhost:8788/api/snapshot/diff \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d @snapshot.json
```

**Response:**

```json
{
	"success": true,
	"data": {
		"added": ["new_collection"],
		"existing": ["products"],
		"missing_in_snapshot": ["old_collection"],
		"details": [{ "slug": "products", "status": "changed", "fields_added": ["price"], "fields_removed": [], "fields_changed": [] }]
	},
	"meta": { "db_collections": 10, "snapshot_collections": 9, "added": 1, "changed": 1, "missing": 1 }
}
```

## Diff v2 — Breaking-Change Detection (v0.7)

`POST /api/snapshot/diff-v2` — compares the current DB state against a full snapshot (collections, roles, permissions, webhooks) and reports **breaking changes** that would make a safe apply impossible.

```bash
curl -X POST http://localhost:8788/api/snapshot/diff-v2 \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"collections": [{"slug": "products", "schema_json": "...", "name": "Products"}], "roles": [], "permissions": [], "webhooks": []}'
```

**Response:**

```json
{
	"success": true,
	"data": {
		"collectionsAdded": [],
		"collectionsRemoved": [],
		"collectionsModified": [
			{ "slug": "products", "fieldChanges": [{ "field": "price", "change": "type_changed", "oldValue": "integer", "newValue": "number" }] }
		],
		"rolesAdded": [],
		"rolesRemoved": [],
		"permissionsChanged": [],
		"summary": {
			"totalChanges": 1,
			"breakingChanges": ["products.price: type_changed (was integer, now number)"],
			"safeToApply": false
		}
	}
}
```

**Field change types:** `added` (safe), `removed` (⚠️ breaking — column would be dropped), `type_changed` (⚠️ breaking), `modified` (safe).

**Use in CI:** gate deploys on `summary.safeToApply === true`.

## Apply

`POST /api/snapshot/apply` — create collections from the snapshot.

```bash
curl -X POST http://localhost:8788/api/snapshot/apply \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d @snapshot.json
```

- Existing collections are **skipped** by default
- Add `?force=true` to drop & recreate existing collections (data loss!)

**Response:**

```json
{
	"success": true,
	"data": {
		"total": 9,
		"created": 1,
		"skipped": 8,
		"errors": 0,
		"results": [
			{ "slug": "products", "status": "skipped" },
			{ "slug": "new_collection", "status": "created" }
		]
	}
}
```

## CI/CD Workflow

```bash
# 1. On PR merge, export from staging
curl http://staging/api/snapshot/export -H 'Authorization: Bearer $TOKEN' > staging-snapshot.json

# 2. Diff against production
curl -X POST https://prod/api/snapshot/diff \
  -H 'Authorization: Bearer $TOKEN' -H 'Content-Type: application/json' \
  -d @staging-snapshot.json

# 3. Review the diff, then apply
curl -X POST https://prod/api/snapshot/apply \
  -H 'Authorization: Bearer $TOKEN' -H 'Content-Type: application/json' \
  -d @staging-snapshot.json
```

## Snapshot File Format

```json
{
	"version": "0.8.0",
	"generated_at": "2026-07-31T03:58:27.854Z",
	"collections": [
		{
			"name": "Products",
			"slug": "products",
			"table_name": "cms_products",
			"description": null,
			"naming_series": null,
			"fields": [{ "name": "title", "type": "text", "required": true }]
		}
	],
	"relations": [{ "source": "products", "field": "category", "target": "categories", "type": "m2o" }]
}
```

## Best Practices

1. Commit snapshots to Git alongside code
2. Run `diff` in CI to detect unexpected schema drift
3. Never use `?force=true` against production without a backup
4. Snapshots contain schema only — no data
