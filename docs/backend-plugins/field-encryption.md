# Field Encryption (v0.7)

Transparent AES-256-GCM encryption for sensitive fields. Mark a field `"encrypted": true` and its value is encrypted at rest in D1, decrypted on read.

## Configuration

Set an encryption key:

```bash
# Generate a strong random key
openssl rand -hex 32

# In wrangler.jsonc vars
"ENCRYPTION_KEY": "5f4dcc3b5aa765d61d8327deb882cf99e4a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5"
```

Key formats accepted:

- **64-char hex** (32 bytes) — used directly as AES-256 key
- Any other string — treated as a passphrase, derived via HKDF

> Use a dedicated `SECRET_KEY`/`ENCRYPTION_KEY` separate from `ADMIN_PASSWORD`.

## Schema

```json
{
	"name": "Customers",
	"fields": [
		{ "name": "name", "type": "text", "required": true },
		{ "name": "email", "type": "email", "encrypted": true },
		{ "name": "phone", "type": "phone", "encrypted": true },
		{ "name": "ssn", "type": "text", "encrypted": true }
	]
}
```

## How It Works

1. **Write** — value encrypted before insert/update: `v1:base64(iv):base64(ciphertext)`
2. **Read** — encrypted value detected by prefix, decrypted transparently
3. **Search** — encrypted fields are _not_ searchable (ciphertext is opaque)

## Storage Format

```
v1:9f86d081884c7d659a2feaa0c55ad015:3fec4fbb...
└─┴─version─┘└───────iv (12 bytes)────────┘└──ciphertext──┘
```

## Security Properties

| Property         | Value                                       |
| ---------------- | ------------------------------------------- |
| Algorithm        | AES-256-GCM (authenticated encryption)      |
| IV               | 12-byte random per encryption               |
| Key              | Web Crypto, derived once per isolate        |
| Encryption       | At rest (D1) only — TLS protects in transit |
| Tamper detection | GCM authentication tag                      |

## Limitations

- Encrypted fields cannot be filtered/sorted/aggregated in SQL
- No key rotation yet — changing `ENCRYPTION_KEY` invalidates existing data
- Requires `ENCRYPTION_KEY` env var; without it, encrypted fields store plaintext

## When to Use

- PII: emails, phone numbers, national IDs
- Payment tokens
- Internal notes / secrets
- Compliance: GDPR, HIPAA-style requirements
