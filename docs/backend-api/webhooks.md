# Webhooks

Receive HTTP notifications when collection events occur. Webhooks are HMAC-signed so receivers can verify authenticity.

## Endpoints

| Method | Path                | Permission          | Description    |
| ------ | ------------------- | ------------------- | -------------- |
| GET    | `/api/webhooks`     | auth                | List webhooks  |
| POST   | `/api/webhooks`     | write on collection | Create webhook |
| PUT    | `/api/webhooks/:id` | write on collection | Update webhook |
| DELETE | `/api/webhooks/:id` | write on collection | Delete webhook |

## Create Webhook

`POST /api/webhooks`

```bash
curl -X POST http://localhost:8788/api/webhooks \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{
    "name": "Product Created Notifier",
    "url": "https://hooks.example.com/products",
    "collection_slug": "products",
    "events": ["create", "update", "delete"],
    "secret": "shared-hmac-secret"
  }'
```

**Request fields:**

| Field             | Required | Description                             |
| ----------------- | -------- | --------------------------------------- |
| `name`            | ✅       | Webhook name                            |
| `url`             | ✅       | Destination URL                         |
| `collection_slug` | ✅       | Target collection                       |
| `events`          | ✅       | Array: `create` \| `update` \| `delete` |
| `secret`          | ❌       | HMAC signing secret                     |
| `enabled`         | ❌       | Default `true`                          |

**Response `201`:** Webhook record with generated `id`.

## List Webhooks

`GET /api/webhooks`

- Admins: all webhooks
- Non-admins: only webhooks for collections they have `write` permission on

## Update / Delete

```bash
# Update
curl -X PUT http://localhost:8788/api/webhooks/<id> \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"url": "https://hooks.example.com/new", "events": ["create"], "enabled": false}'

# Delete
curl -X DELETE http://localhost:8788/api/webhooks/<id> -H 'Authorization: Bearer dev-token'
```

## Delivery

When an event fires (create/update/delete), the webhook receives a `POST` with:

```json
{
	"event": "create",
	"collection": "products",
	"document_id": "545a77f8-...",
	"data": { "id": "545a77f8-...", "title": "Widget", "price": 9.99 },
	"timestamp": "2026-07-31T03:54:11.746Z"
}
```

## HMAC Signature

When a `secret` is configured, the request includes:

- Header `X-Webhook-Signature`: `sha256=<hex digest>`
- Digest computed over the raw request body with HMAC-SHA256

Receiver verification example (Node.js):

```js
import crypto from 'node:crypto';

function verify(reqBody, signature, secret) {
	const expected = crypto.createHmac('sha256', secret).update(reqBody).digest('hex');
	return `sha256=${expected}` === signature;
}
```

## Errors

| Status | When                                              |
| ------ | ------------------------------------------------- |
| 400    | Missing `collection_slug`                         |
| 403    | No write permission on the collection (non-admin) |
| 404    | Webhook not found                                 |
