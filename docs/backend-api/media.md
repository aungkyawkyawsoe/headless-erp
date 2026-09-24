# Media

File upload and serving via Cloudflare R2.

## Endpoints

| Method | Path                | Permission | Description   |
| ------ | ------------------- | ---------- | ------------- |
| POST   | `/api/media/upload` | auth       | Upload a file |
| GET    | `/api/media/:key`   | public     | Serve a file  |

## Upload

`POST /api/media/upload` — multipart form with a `file` field.

```bash
curl -X POST http://localhost:8788/api/media/upload \
  -H 'Authorization: Bearer dev-token' \
  -F "file=@image.png"
```

**Response `201`:**

```json
{
	"success": true,
	"data": {
		"key": "a1b2c3d4-....png",
		"url": "/api/media/a1b2c3d4-....png",
		"filename": "image.png",
		"size": 15234,
		"mime_type": "image/png"
	}
}
```

**Errors:**

| Status | When                 |
| ------ | -------------------- |
| 400    | Missing `file` field |

## Serve

`GET /api/media/:key` — **public, no auth required** (media is shareable by URL).

```bash
curl http://localhost:8788/api/media/a1b2c3d4-....png
```

**Response headers:**

- `Content-Type` — from stored MIME type
- `Content-Length`
- `Cache-Control: public, max-age=31536000, immutable`
- `ETag`

**Errors:** `404` `{"success": false, "error": "Media not found"}` when key doesn't exist.

## Notes

- Uploads are stored in R2 under the `BUCKET` binding
- Metadata (filename, size, MIME, URL) is recorded in the `_media` table
- Maximum body size is 10 MB (global middleware limit)
