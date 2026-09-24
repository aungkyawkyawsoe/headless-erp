# Relations

Relationships between collections. Four types supported: M2O, O2M, M2M, M2A.

## M2O (Many-to-One)

A field on a record pointing to another record. Stored as a UUID foreign key column.

```json
{
	"name": "Products",
	"fields": [
		{ "name": "title", "type": "text", "required": true },
		{ "name": "category", "type": "m2o", "related_collection": "categories" }
	]
}
```

```bash
# Create a product referencing a category
curl -X POST http://localhost:8788/api/entities/products \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"title": "Widget", "category": "<category-id>"}'

# Read with the related object expanded (default: m2o is resolved)
curl http://localhost:8788/api/entities/products/<id> -H 'Authorization: Bearer dev-token'
# → { ..., "category": {"id": "...", "name": "Gadgets"} }
```

## O2M (One-to-Many)

Virtual field on the parent. No column — children reference the parent via an M2O field.

```json
{
	"name": "Categories",
	"fields": [
		{ "name": "name", "type": "text", "required": true },
		{ "name": "products", "type": "o2m", "related_collection": "products", "foreign_key": "category" }
	]
}
```

Reading a category returns its products:

```json
{
	"id": "...",
	"name": "Gadgets",
	"products": [{ "id": "...", "title": "Widget" }]
}
```

## M2M (Many-to-Many)

Virtual field. A junction table `{collection}_{field}_m2m` is created automatically.

```json
{
	"name": "Products",
	"fields": [
		{ "name": "title", "type": "text" },
		{ "name": "tags", "type": "m2m", "related_collection": "tags" }
	]
}
```

```bash
# Set tags on create
curl -X POST http://localhost:8788/api/entities/products \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"title": "Widget", "tags": ["<tag-id-1>", "<tag-id-2>"]}'
```

Reading a product returns the related objects in the `tags` field (junction rows are batched — no N+1):

```json
{
	"id": "...",
	"title": "Widget",
	"tags": [
		{ "id": "...", "name": "sale" },
		{ "id": "...", "name": "premium" }
	]
}
```

Updating `tags` replaces the whole set atomically with the parent update (single D1 batch).

## M2A (Many-to-Any / Polymorphic)

A field that can reference records from _multiple_ collections. Creates two columns: `{name}_type` + `{name}_id`.

```json
{
	"name": "Comments",
	"fields": [
		{ "name": "body", "type": "text", "required": true },
		{ "name": "reference", "type": "m2a", "related_collections": ["articles", "products"] }
	]
}
```

```bash
curl -X POST http://localhost:8788/api/entities/comments \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"body": "Nice!", "reference_type": "articles", "reference_id": "<article-id>"}'
```

## Nested Filters (M2O)

Filter items by fields in a related collection using dot notation. Works for **multi-hop** paths too:

```bash
# Products whose category name is "Gadgets"
curl "http://localhost:8788/api/entities/products?filter%5Bcategory.name%5D%5B_eq%5D=Gadgets" \
  -H 'Authorization: Bearer dev-token'

# Multi-hop: orders whose customer's country name is "Myanmar"
curl "http://localhost:8788/api/entities/orders?filter%5Bcustomer.country.name%5D%5B_eq%5D=Myanmar" \
  -H 'Authorization: Bearer dev-token'

# Bracketed form (single hop): same as filter[category.name][_eq]
curl "http://localhost:8788/api/entities/products?filter%5Bcategory%5D%5Bname%5D%5B_eq%5D=Gadgets" \
  -H 'Authorization: Bearer dev-token'
```

Nested filters are translated to `IN` subqueries (`WHERE category IN (SELECT id FROM cms_categories WHERE name = ?)`), so they compose with cursor pagination. Invalid paths are ignored (no error).

## Nested Sort (M2O)

Sort by a related collection field — single or multi-hop:

```bash
# Sort products by category name
curl "http://localhost:8788/api/entities/products?sort=category.name" \
  -H 'Authorization: Bearer dev-token'

# Multi-hop: sort orders by customer's country name (descending)
curl "http://localhost:8788/api/entities/orders?sort=-customer.country.name" \
  -H 'Authorization: Bearer dev-token'
```

Nested sorts use correlated subqueries; equal sort keys fall back to the database order.

## Cascade Delete vs RESTRICT (M2O)

The `cascade_delete` flag on an m2o field decides what happens to a parent's
children when the parent is deleted. Three states — the flag's presence matters:

| Flag     | On parent delete                                                                               |
| -------- | ---------------------------------------------------------------------------------------------- |
| `true`   | **Cascade** — child records are deleted with the parent                                        |
| `false`  | **RESTRICT** — the delete is refused (`409 CONFLICT`) while live children reference the parent |
| _absent_ | **Permissive** (legacy) — no cascade and no guard; the reference is left dangling              |

Use `true` for owned children (an order's lines), `false` for masters that must
not be retired while in use (suppliers, item groups), and leave it absent
only for legacy relations that predate the guard.

### `cascade_delete: true` — cascade

```json
{ "name": "category", "type": "m2o", "related_collection": "categories", "cascade_delete": true }
```

- **Soft delete** (`DELETE /api/entities/:collection/:id`) cascades soft-deletes (sets `deleted_at`) to child records.
- **Hard delete** (`DELETE ... /force`) cascades hard-deletes and also cleans up M2M junction rows.
- The cascade walks the relation graph breadth-first with a visited set, so chains (`A → B → C`) work and cycles are impossible.
- Self-referencing cascade delete is blocked at schema creation to prevent infinite loops.

### `cascade_delete: false` — RESTRICT

```json
{ "name": "supplier", "type": "m2o", "required": false, "related_collection": "suppliers", "cascade_delete": false }
```

A soft delete is refused with **`409 CONFLICT`** while any live child row still
points at the parent:

```json
{
	"success": false,
	"error": "Cannot delete this record — it is still referenced by 3 record(s) in \"MRO Item Model\". Remove or reassign those records first.",
	"code": "CONFLICT"
}
```

- The guard is memoized on the schema-array identity (same WeakMap pattern as the
  cascade map), so a collection with no inbound RESTRICT field pays one map lookup
  and zero queries.
- It runs **before** delete hooks — a refused delete has no side effects.
- Only an **explicit** `false` opts in. An absent flag stays permissive, so existing
  relations are unaffected.
- The admin-only `DELETE ... /force` **bypasses** RESTRICT for a deliberate purge.
- Clients should surface the server message as-is: it names the exact collection
  still holding references (the client app's masters edit pages do this inline).
