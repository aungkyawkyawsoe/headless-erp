# Modules

Group collections into modules for navigation/organization. Modules can have menus and views.

## Endpoints

| Method | Path                                       | Permission | Description                 |
| ------ | ------------------------------------------ | ---------- | --------------------------- |
| GET    | `/api/modules`                             | auth       | List modules                |
| GET    | `/api/modules/:slug`                       | auth       | Module detail + collections |
| POST   | `/api/modules`                             | admin      | Create module               |
| PUT    | `/api/modules/:slug`                       | admin      | Update module               |
| DELETE | `/api/modules/:slug`                       | admin      | Delete module               |
| GET    | `/api/modules/:slug/collections`           | auth       | Module collections          |
| POST   | `/api/modules/:slug/collections`           | admin      | Attach collection           |
| DELETE | `/api/modules/:slug/collections/:collSlug` | admin      | Detach collection           |
| GET    | `/api/modules/:slug/menus`                 | auth       | Menu tree                   |
| POST   | `/api/modules/:slug/menus`                 | admin      | Create menu item            |
| PUT    | `/api/modules/menus/:id`                   | admin      | Update menu item            |
| DELETE | `/api/modules/menus/:id`                   | admin      | Delete menu item            |
| GET    | `/api/modules/:slug/views`                 | auth       | Module views                |
| POST   | `/api/modules/:slug/views`                 | admin      | Create view                 |
| PUT    | `/api/modules/views/:id`                   | admin      | Update view                 |
| DELETE | `/api/modules/views/:id`                   | admin      | Delete view                 |

## Create a Module

`POST /api/modules`

```bash
curl -X POST http://localhost:8788/api/modules \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"name": "HR", "slug": "hr", "icon": "users", "description": "Human resources"}'
```

**Response `201`:** The module. Duplicate slugs return `409`.

## Attach a Collection

`POST /api/modules/:slug/collections`

```bash
curl -X POST http://localhost:8788/api/modules/hr/collections \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"collection_slug": "employees"}'
```

## List Modules

`GET /api/modules` — add `?all=true` to include inactive modules.

## Menus

Menus are hierarchical (via `parent_id`):

```bash
curl -X POST http://localhost:8788/api/modules/hr/menus \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"label": "Employees", "type": "collection", "target": "employees"}'
```

## Views

Views are per-module display configurations:

```bash
curl -X POST http://localhost:8788/api/modules/hr/views \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"collection_slug": "employees", "name": "Default Table", "type": "table", "config": {"columns": ["full_name", "department"]}}'
```

> **Note:** Saved user views (`/api/views`) are separate from module views. Module views are admin-defined layouts; `/api/views` are user presets.

## Errors

| Status | When                                                                 |
| ------ | -------------------------------------------------------------------- |
| 400    | Missing required fields (`name`, `slug`, `label`, `collection_slug`) |
| 404    | Module / collection not found                                        |
| 409    | Slug already exists                                                  |
