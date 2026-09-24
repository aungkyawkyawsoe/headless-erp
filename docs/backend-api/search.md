# Search

One unified multi-entity search system — **global search** — backed by a single FTS5 index (`_search_index`) with a LIKE fallback.

## Search Everything

`GET /api/search/global?q=keyword`

```bash
curl "http://localhost:8788/api/search/global?q=widget" -H 'Authorization: Bearer dev-token'
```

**Response:**

```json
{
	"success": true,
	"data": [
		{
			"collection": "products",
			"collection_label": "Products",
			"id": "545a77f8-...",
			"title": "Widget",
			"snippet": "<mark>Widget</mark>",
			"fields": { "id": "...", "title": "Widget", "price": 12.5 },
			"score": 0.97
		}
	],
	"meta": { "total": 1, "collection_counts": { "products": 1 }, "query": "widget" }
}
```

## Search Specific Collections

`GET /api/search/global?q=keyword&collections=a,b`

```bash
curl "http://localhost:8788/api/search/global?q=widget&collections=products,articles" \
  -H 'Authorization: Bearer dev-token'
```

## Query Parameters

| Param         | Default | Description            |
| ------------- | ------- | ---------------------- |
| `q`           | —       | Search term (required) |
| `collections` | all     | Comma-separated slugs  |
| `limit`       | 25      | Max results (max 100)  |

> **Pagination:** the FTS5 path is cursor-paginated — pass `?cursor=` (opaque, from the previous page's `meta.next_cursor`) to continue; the cursor is a keyset over FTS5 `rank` + `rowid`, and `meta` carries `has_more` / `next_cursor` (`next_cursor` is `null` on the last page). The LIKE fallback remains single-page.

## Rebuild the Unified Index (Admin)

`POST /api/search/global-index`

```bash
curl -X POST http://localhost:8788/api/search/global-index -H 'Authorization: Bearer dev-token'
```

**Response:**

```json
{ "success": true, "data": { "indexed_count": 11, "message": "Global search index rebuilt" } }
```

## Permissions

Results are filtered to collections the user has `read` permission on. Admins see everything.

## Indexing Notes

- Text fields (`text`, `longtext`, `slug`, …) are indexed; system fields are excluded
- The index uses a content table (`_search_content`) + FTS5 virtual table (`_search_index`)
- Index rebuilds are **bounded and batched** — collections are harvested in cursor-paginated pages and inserted in 25-row chunks (D1's 100-bound-param limit), so large tables don't blow memory/CPU
- D1 FTS5 does **not** accept a bound parameter for `MATCH` — the match expression is inlined as an escaped literal (non-ASCII and `'` are neutralized before inlining); collection filters and `LIMIT` stay bound
- Rebuild on demand after bulk data changes: `POST /api/search/global-index`

> **Legacy v1 removed:** the old per-collection search (`GET /api/search`, `POST /api/search/build`, `_fts_*` tables) was replaced by this unified implementation. Clients using v1 should switch to `/api/search/global`.
