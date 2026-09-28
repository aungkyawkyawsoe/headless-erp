# Media

File upload and serving via Cloudflare R2.

## Endpoints

| Method | Path                       | Permission             | Description                                       |
| ------ | -------------------------- | ---------------------- | ------------------------------------------------- |
| POST   | `/api/media/upload`        | auth                   | Upload a file                                     |
| POST   | `/api/media/presign`       | auth                   | Mint a single-use delegated upload token (15 min) |
| POST   | `/api/media/upload/:token` | token only (no bearer) | Redeem that token — it IS the credential          |
| GET    | `/api/media`               | auth                   | List the library (admin: all; else own + public)  |
| GET    | `/api/media/:key`          | optional auth          | Serve a file (public = anonymous)                 |
| DELETE | `/api/media/:key`          | admin                  | Delete one asset (ref-guarded)                    |
| POST   | `/api/media/gc`            | admin                  | Remove every asset nothing references             |

## Upload

`POST /api/media/upload` — multipart form with a `file` field. An optional
`visibility` field (`private`) opts the asset out of anonymous serving;
anything else — absent, invalid — defaults to `public` (non-breaking).

```bash
curl -X POST http://localhost:8788/api/media/upload \
  -H 'Authorization: Bearer dev-token' \
  -F "file=@image.png" \
  -F "visibility=private"
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

**Validation — the declared type is checked, then the bytes are sniffed:**

- `file.type` (the multipart part's `Content-Type`) must be in the allowlist:
  `image/jpeg` `image/png` `image/gif` `image/webp` `image/avif`
  `application/pdf` `text/plain` `text/csv` `application/json`
  `video/mp4` `video/webm` `video/quicktime`
  `audio/mpeg` `audio/ogg` `audio/wav` `audio/webm`
  `application/zip` `application/gzip`.
  `image/svg+xml` is deliberately refused (stored-XSS — SVG can carry scripts).
- The magic bytes must MATCH the declared type (client MIME is untrusted); the
  text-ish types are additionally scanned for HTML/XML markup.
- Per-file cap = `upload.maxFileSize` (`UPLOAD_MAX_FILE_SIZE`, default 50 MB).

| Status | When                                                                 |
| ------ | -------------------------------------------------------------------- |
| 400    | Missing/empty `file` field, or bytes don't match the declared type   |
| 413    | File larger than the cap                                             |
| 415    | Declared MIME not in the allowlist (incl. the dedicated SVG refusal) |

## Delegated upload (presign → redeem)

For uploaders that never hold the app session (background isolate, upload
worker, kiosk):

1. An authenticated caller mints a token — `POST /api/media/presign`:

   ```json
   {
   	"success": true,
   	"data": {
   		"token": "nonce:1759000000000:user-1:6f3a…",
   		"expires_at": "2026-09-28T12:15:00.000Z",
   		"upload_url": "/api/media/upload/nonce:1759000000000:user-1:6f3a…",
   		"max_bytes": 52428800
   	}
   }
   ```

   The token is `nonce:expires:user_id:signature` — HMAC-SHA256 over the first
   three parts (key: `MEDIA_UPLOAD_SECRET`, else `JWT_SECRET`), TTL **15
   minutes**, and logged in `_media_upload_tokens` bound to the requesting user.

2. `POST` the file to `upload_url` **with no bearer** — the token IS the
   credential. Send the token RAW (colons unencoded): the route splits on `:`.
   The response body is the same `201` shape as the direct upload.

**Single-use by construction:** the redeem flips the ledger row's `used_at`
with a conditional `UPDATE … WHERE used_at IS NULL`, so exactly ONE request
wins (SQLite serializes the write). A replay answers `401 Upload token has
already been used`. The multipart payload is validated BEFORE the token is
burned, so a malformed upload does not waste the caller's one shot. Upload
provenance is the token's bound `user_id` — never a request field.

Every failure (invalid, expired, forged, replayed) is the same generic `401` —
the route never says which.

## List

`GET /api/media?limit=50&offset=0&mime=image` — newest first. An admin sees the
WHOLE library; everyone else sees only their own uploads plus every public
asset. `mime=image` narrows to images. Responds `{ data: [...] }`; invalid
pagination params → `400`.

## Serve

`GET /api/media/:key` — **auth is OPTIONAL by design**: a public asset is a
capability URL rendered as `<img src>`, and an `<img>` cannot carry a bearer, so
public assets serve anonymously exactly as before. A **private** asset requires
its uploader or an admin.

| Case                       | Response                      |
| -------------------------- | ----------------------------- |
| Public / owner / admin     | `200` + bytes                 |
| Private, no/invalid bearer | `401` Authentication required |
| Private, wrong user        | `403` Access denied           |
| Unknown key                | `404`                         |

**Response headers:**

- `Content-Type` — from stored MIME type; `Content-Length`
- `Cache-Control` — public: `public, max-age=31536000, immutable`;
  private: `private, no-store` (a shared cache must never hold it)
- `ETag`
- `X-Content-Type-Options: nosniff` — never let a browser sniff text-ish
  bytes into executable HTML

## Delete + GC (admin)

Both paths are **ref-guarded**: `_media_refs` tracks entity rows referencing an
asset (including a shared/gallery-picked image on another row), so an asset
still in use is never removed.

- `DELETE /api/media/:key` → `200 {deleted:true}` · `409` still referenced
  (remove it from the fields/records first) · `404` unknown key.
- `POST /api/media/gc` → `200 {removed:n}` — deletes every asset nothing
  references. Best-effort, safe per key.

## SDK

`@mmbix/sdk`'s `files` sub-API wraps all three upload paths — see
[sdk.md](./sdk.md) §3 _Files (media)_:

```ts
await client.files.upload(photoFile, { visibility: 'private' }); // bearer + 401 heal
const presigned = await client.files.presign(); // single-use token
await client.files.uploadWithToken(photoFile, presigned.token); // no bearer
```

The delegated path is self-authenticating in the SDK: no bearer is attached,
no 401 heal runs, and the token is redacted from every hook/log
(`/media/upload/<token>`).

## Notes

- Bodies: JSON routes are capped at 10 MB globally; multipart uploads use
  `upload.maxFileSize` (default 50 MB) — one number from `@mmbix/config`, so
  the body-limit middleware and the per-file check can never drift apart.
- Uploads are stored in R2 under the `BUCKET` binding; metadata (filename,
  size, MIME, URL) is recorded in the `_media` table with privacy provenance.
