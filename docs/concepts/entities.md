# Entities

Entities (collections) are the core data model. A collection defines a table + fields + system fields.

## Collection Schema

```json
{
	"name": "Products",
	"slug": "products",
	"description": "Product catalog",
	"fields": [
		{ "name": "title", "type": "text", "required": true },
		{ "name": "price", "type": "currency" },
		{ "name": "status", "type": "select", "options": ["active", "archived"], "default": "active" }
	],
	"naming_series": "PRD-",
	"is_singleton": false,
	"icon": "package",
	"color": "#4CAF50",
	"hidden": false
}
```

| Property               | Type    | Description                                                                                                                              |
| ---------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                 | string  | Display name (required)                                                                                                                  |
| `slug`                 | string  | URL identifier; auto-generated from name if omitted                                                                                      |
| `description`          | string  | Optional description                                                                                                                     |
| `fields`               | array   | Field definitions (see [Field Types](field-types.md))                                                                                    |
| `naming_series`        | string  | Auto-number pattern: `"INV-"` → `INV-00001`; trailing `#`s set the counter width, `"INV-####"` → `INV-0001`. Empty/null → no auto-number |
| `is_singleton`         | boolean | Only 1 record allowed (settings, profile)                                                                                                |
| `icon`                 | string  | Lucide icon name for admin UI                                                                                                            |
| `color`                | string  | Hex color for admin UI                                                                                                                   |
| `hidden`               | boolean | Hide from navigation                                                                                                                     |
| `sort_field`           | string  | Field name for manual drag-drop ordering                                                                                                 |
| `system_field_options` | object  | Toggle system fields (see below)                                                                                                         |

## System Fields

Every collection gets these automatic columns:

| Field                       | Type      | Description                                                                               |
| --------------------------- | --------- | ----------------------------------------------------------------------------------------- |
| `id`                        | uuid      | Primary key (auto-generated)                                                              |
| `doc_status`                | text      | `draft` → `submitted` → `approved` → `cancelled`                                          |
| `display_number`            | text      | Auto-numbered ID from `naming_series` (`"INV-"` → `INV-00001`, `"INV-####"` → `INV-0001`) |
| `_owner`                    | text      | User ID who created the record                                                            |
| `_meta`                     | json      | Extra non-schema fields (stored as JSON)                                                  |
| `created_by` / `updated_by` | text      | User IDs                                                                                  |
| `created_at` / `updated_at` | timestamp | Audit timestamps                                                                          |
| `deleted_at` / `deleted_by` | text      | Soft-delete markers                                                                       |

### Disabling System Fields

```json
{
	"system_field_options": {
		"doc_status": false,
		"display_number": false,
		"created_by": false,
		"updated_by": false,
		"deleted_at": false,
		"deleted_by": false,
		"_owner": false
	}
}
```

## Collection Lifecycle

1. **Create** — `POST /api/collections` → creates table + registers in `_entity_schemas`
2. **Update schema** — `PUT /api/collections/:slug` → auto-generates DDL via EntityMigrator and keeps the physical table in sync with `schema_json` (add/drop columns + indexes; rebuild on type/nullability changes)
3. **Delete** — `DELETE /api/collections/:slug` → drops table + removes registration

## Auto-Migration on Schema Change

`PUT /api/collections/:slug` diffs the old vs new field list and keeps the
physical D1 table in sync with `schema_json` (workerd/D1 ships a modern SQLite
≥ 3.35, so `ALTER TABLE … DROP/RENAME` are available):

- `ADD COLUMN` for new fields (including **stored** computed fields —
  `formula` + `store: true` — typed by `result_type`)
- `DROP COLUMN` for fields removed from the schema (dropping an indexed column
  drops its indexes first)
- `CREATE INDEX` / `CREATE UNIQUE INDEX` / `CREATE COMPOSITE INDEX` for new
  index/unique/composite declarations; `DROP INDEX` when the flag is removed.
  A `unique` field is enforced by a **partial** index
  (`uidx_<table>_<col>` … `WHERE deleted_at IS NULL`) so the rule is the same
  one the engine's pre-check uses — unique among LIVE rows only.
- **Table rebuild** for changes SQLite cannot apply in place — column type or
  `required` (nullability) changes, and dropping a column whose uniqueness is
  expressed as a legacy inline `UNIQUE` constraint (an undeletable auto-index).
  Surviving columns' data is copied to a rebuilt table in one atomic D1 batch;
  engine indexes (`deleted_id` cursor, `singleton`) and declared composite
  indexes are recreated, and every unique field gets its canonical partial index.
- Skips virtual fields (`o2m`, `m2m`, `table`, and non-stored `formula`)
- Skips operations that would fail idempotently (e.g. duplicate column,
  column already gone)

> If the DDL fails (e.g. a new `unique` index hits duplicate values), the PUT
> returns 400 and `schema_json` is left untouched — the schema never silently
> diverges from the physical table.
>
> Field renames are not tracked (no stable field identity in `schema_json`); a
> rename is a delete + add, so the old column's data is dropped.

## Example: Create Collection with Formula Fields

Virtual (computed on read) + stored (real column, recomputed on write,
filterable/sortable) + lookup (aggregate over child rows):

```json
{
	"name": "Invoices",
	"fields": [
		{ "name": "qty", "type": "integer", "required": true },
		{ "name": "rate", "type": "currency", "required": true },
		{ "name": "total", "type": "formula", "formula": "qty * rate", "formula_type": "expression" },
		{ "name": "grand_total", "type": "formula", "formula": "total * 1.1", "store": true },
		{ "name": "items", "type": "table", "related_collection": "invoice_items" },
		{ "name": "items_total", "type": "formula", "formula": "SUM(items.amount)", "store": true }
	],
	"naming_series": "INV-"
}
```

Stored formulas are engine-owned (clients can never write them), recompute in
dependency order on every create/update, cascade-recalc when a child row in
another collection changes, and child-table payloads in the SAME request are
included (pass-2 recompute). See
[Field Types — Computed](field-types.md#computed) and
[Computed Fields — Enterprise Reference](../backend-plugins/computed-fields.md)
for the full reference.
