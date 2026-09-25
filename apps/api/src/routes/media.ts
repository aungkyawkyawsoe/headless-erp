/**
 * Media Routes — with RBAC
 *
 * POST /api/media/upload        → Upload a file to R2 (auth required; `?visibility=private` opts in)
 * POST /api/media/presign       → Mint a single-use, user-bound delegated token (auth)
 * POST /api/media/upload/:token → Redeem that ONE token (no bearer — token IS the credential)
 * GET  /api/media               → List the library (auth; admin sees all, others own+public)
 * GET  /api/media/:key          → Serve a media file from R2 (optional auth; public = anonymous)
 *
 * Upload cap: ONE number from @mmbix/config upload.maxFileSize (env
 * UPLOAD_MAX_FILE_SIZE, default 50MB) — no hardcoded size here, so the body
 * limit middleware and the per-file check can never drift apart.
 */

import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { initConfig } from '@mmbix/config';
import { MediaService } from '@/lib/services/media.service';
import type { MediaActor, MediaVisibility } from '@/lib/services/media.service';
import { AuthService } from '@/lib/services/auth.service';
import { requireAuth } from './auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { resolveRateLimitTier } from '@/middleware/rate-limiter';
import { success, fail } from '@/lib/api/response';

// Signed one-time upload tokens (HMAC-SHA256, short-lived)
const UPLOAD_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

type MediaBindings = {
	Bindings: {
		DB: D1Database;
		BUCKET: R2Bucket;
		ADMIN_PASSWORD: string;
		JWT_SECRET?: string;
	};
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
};

const app = new Hono<MediaBindings>();

function getService(c: { env: { DB: D1Database; BUCKET: R2Bucket } }): MediaService {
	const db = new D1Client(c.env.DB);
	return new MediaService(db, c.env.BUCKET);
}

/** Effective per-file cap — @mmbix/config upload.maxFileSize (env UPLOAD_MAX_FILE_SIZE). */
function maxUpload(c: { env: MediaBindings['Bindings'] }): number {
	return initConfig(c.env as Record<string, unknown>).upload.maxFileSize;
}

/**
 * Resolve the caller's identity for the PUBLIC serve route — WITHOUT requiring a
 * bearer. Reuses the canonical bearer decoder the limiters already trust
 * (`resolveRateLimitTier`: the same dev-token + JWT rules), so a public asset
 * stays anonymous while a JWT/dev-token admin is still recognized. `c.get('auth')`
 * (populated for a valid JWT by the global pre-auth middleware) carries the user id
 * that ownership is compared against; `dev-token` has no row, but resolves as admin.
 */
async function mediaActor(c: Context<MediaBindings>): Promise<MediaActor> {
	const tier = await resolveRateLimitTier(c);
	const auth = c.get('auth') as { user_id?: string; is_admin?: boolean } | undefined;
	return {
		userId: auth?.user_id ?? null,
		isAdmin: tier === 'admin',
		authenticated: tier !== 'anonymous',
	};
}

/** `'private'` is opt-in; anything else (absent/invalid) defaults to public — non-breaking. */
function parseVisibility(raw: unknown): MediaVisibility {
	return raw === 'private' ? 'private' : 'public';
}

/** Requested visibility, from a multipart `visibility` field or the `?visibility=` query. */
function requestedVisibility(c: { req: { query: (k: string) => string | undefined } }, body?: Record<string, unknown>): MediaVisibility {
	const fromBody = body?.['visibility'];
	return parseVisibility(typeof fromBody === 'string' ? fromBody : c.req.query('visibility'));
}

/**
 * Derive the token signing secret (media-specific when set, else the JWT secret).
 *
 * 🔒 Fails closed: AuthService.resolveJwtSecret throws in production without an
 * explicit JWT_SECRET — the ADMIN_PASSWORD fallback is dev-only (anyone holding
 * the admin password could forge upload tokens). No hardcoded literal fallback.
 */
function tokenSecret(c: { env: { JWT_SECRET?: string; ADMIN_PASSWORD: string; MEDIA_UPLOAD_SECRET?: string; IS_DEV?: string } }): string {
	if (c.env.MEDIA_UPLOAD_SECRET) return c.env.MEDIA_UPLOAD_SECRET;
	return AuthService.resolveJwtSecret(c.env);
}

async function hmacSign(secret: string, payload: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
	return Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

// ── Delegated-token ledger (server-side half of a presign token) ──────────
// A stateless HMAC alone CANNOT be one-time: any holder of the URL could replay
// it for the token's whole TTL, and the signature says nothing about WHO asked.
// `_media_upload_tokens` records the nonce, the requesting `user_id` and the
// expiry; the redeem path flips `used_at` with a CONDITIONAL update, so exactly
// ONE request can win. Deny-by-default: an unknown/already-used nonce, or a
// nonce whose `user_id` differs from the token's, matches no row and is refused.
//
// Created lazily + idempotently HERE (single-line DDL — `db.exec()` splits on
// newlines) so the table travels with the route that owns it. Idempotent
// `IF NOT EXISTS`, so a retry — or a fresh test DB in a reused isolate — is safe.
const UPLOAD_TOKEN_DDL = [
	'CREATE TABLE IF NOT EXISTS _media_upload_tokens (nonce TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)',
	'CREATE INDEX IF NOT EXISTS idx_media_upload_tokens_expires ON _media_upload_tokens (expires_at)',
];

async function ensureUploadTokenStore(db: D1Client): Promise<void> {
	for (const sql of UPLOAD_TOKEN_DDL) await db.exec(sql);
}

/**
 * Atomically redeem a presign token's nonce for its bound user.
 *
 * Returns true ONLY for the single request that flips `used_at` from NULL — the
 * `used_at IS NULL` predicate in the UPDATE is what makes it single-use (SQLite
 * serializes the write, so a concurrent replay matches zero rows). A stale,
 * forged, unknown or already-redeemed nonce returns false and is refused.
 */
async function redeemUploadToken(db: D1Client, nonce: string, userId: string): Promise<boolean> {
	await ensureUploadTokenStore(db);
	const now = Date.now();
	const result = await db.run({
		sql: 'UPDATE _media_upload_tokens SET used_at = ? WHERE nonce = ? AND user_id = ? AND used_at IS NULL AND expires_at >= ?',
		bindings: [now, nonce, userId, now],
	});
	const changed = Number((result.meta as { changes?: number } | undefined)?.changes ?? 0);
	return changed === 1;
}

// Upload requires auth
app.post('/upload', requireAuth, async (c) => {
	const service = getService(c);
	await service.ensureMigrations();

	const body = await c.req.parseBody();
	const file = body['file'] as File;

	if (!file || !(file instanceof File)) {
		return fail(c, 'Missing file field. Send multipart/form-data with a "file" field.', 400);
	}
	const maxUploadBytes = maxUpload(c);
	if (file.size > maxUploadBytes) {
		return fail(c, `File too large. Max ${Math.round(maxUploadBytes / 1024 / 1024)}MB.`, 413);
	}

	const result = await service.upload(file, {
		uploadedBy: c.get('auth').user_id,
		visibility: requestedVisibility(c, body as Record<string, unknown>),
	});
	return success(c, result, 201);
});

// ── Signed single-use upload token ────────────────────────
// POST /api/media/presign (auth) → { token, upload_url, expires_at }
// The token is a short-lived HMAC bound to the requesting user id, paired with
// a server-side nonce row; the client can then POST the file to
// /api/media/upload/<token> WITHOUT the app bearer token (delegated uploads).
// The token can be redeemed exactly ONCE.

app.post('/presign', requireAuth, async (c) => {
	const auth = c.get('auth');
	const secret = tokenSecret(c);
	const db = new D1Client(c.env.DB);
	await ensureUploadTokenStore(db);

	const now = Date.now();
	// Bounded housekeeping: drop tokens that can no longer be redeemed (indexed
	// on expires_at), so the ledger cannot grow without limit.
	await db.run({ sql: 'DELETE FROM _media_upload_tokens WHERE expires_at < ?', bindings: [now] });

	const expiresAt = now + UPLOAD_TOKEN_TTL_MS;
	const nonce = crypto.randomUUID();
	const userId = auth.user_id;
	const payload = `${nonce}:${expiresAt}:${userId}`;
	const signature = await hmacSign(secret, payload);
	const token = `${payload}:${signature}`;

	await db.run({
		sql: 'INSERT INTO _media_upload_tokens (nonce, user_id, expires_at, used_at) VALUES (?, ?, ?, NULL)',
		bindings: [nonce, userId, expiresAt],
	});

	return success(c, {
		token,
		expires_at: new Date(expiresAt).toISOString(),
		upload_url: `/api/media/upload/${token}`,
		max_bytes: maxUpload(c),
	});
});

// POST /api/media/upload/:token — delegated upload with a single-use token
app.post('/upload/:token', async (c) => {
	const raw = c.req.param('token');
	const parts = raw.split(':');
	if (parts.length !== 4) return fail(c, 'Invalid upload token', 401, 'UNAUTHORIZED');

	const [nonce, expStr, userId, sig] = parts;
	const expiresAt = Number(expStr);
	if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return fail(c, 'Upload token expired', 401, 'UNAUTHORIZED');

	// Verify the HMAC over the user-bound payload BEFORE touching the ledger, so a
	// forged token can never consume (or probe) another caller's nonce.
	const secret = tokenSecret(c);
	const expected = await hmacSign(secret, `${nonce}:${expStr}:${userId}`);
	if (sig !== expected) return fail(c, 'Invalid upload token', 401, 'UNAUTHORIZED');

	// Validate the payload FIRST, then burn the token — a malformed/rejected body
	// does not waste the caller's one shot, while a valid one still consumes it.
	const body = await c.req.parseBody();
	const file = body['file'] as File;
	if (!file || !(file instanceof File)) {
		return fail(c, 'Missing file field. Send multipart/form-data with a "file" field.', 400);
	}
	const maxUploadBytes = maxUpload(c);
	if (file.size > maxUploadBytes) {
		return fail(c, `File too large. Max ${Math.round(maxUploadBytes / 1024 / 1024)}MB.`, 413);
	}

	// Single-use: exactly one redeem succeeds; a replay finds `used_at` set.
	const db = new D1Client(c.env.DB);
	if (!(await redeemUploadToken(db, nonce, userId))) {
		return fail(c, 'Upload token has already been used', 401, 'UNAUTHORIZED');
	}

	const service = getService(c);
	await service.ensureMigrations();

	// Provenance is the TOKEN's bound user (server-derived), never a request field.
	const result = await service.upload(file, {
		uploadedBy: userId,
		visibility: requestedVisibility(c, body as Record<string, unknown>),
	});
	return success(c, result, 201);
});

// ── Library list ──────────────────────────────────────────
// GET /api/media?limit=&offset=&mime=image — authenticated list of `_media`
// assets (newest-first). An ADMIN sees the whole library; a non-admin sees only
// their OWN uploads plus every PUBLIC asset — never another user's private file.

app.get('/', requireAuth, async (c) => {
	const service = getService(c);
	await service.ensureMigrations();

	const limit = Number(c.req.query('limit') ?? 50);
	const offset = Number(c.req.query('offset') ?? 0);
	const mime = c.req.query('mime');
	const imageOnly = mime === 'image';

	if (!Number.isFinite(limit) || limit < 1 || !Number.isFinite(offset) || offset < 0) {
		return fail(c, 'Invalid pagination params (limit > 0, offset >= 0)', 400);
	}

	const auth = c.get('auth');
	const data = await service.list({ limit, offset, imageOnly, viewerId: auth.user_id, isAdmin: auth.is_admin === true });
	return success(c, { data });
});

// ── Delete + GC (admin) ─────────────────────────────────────
// Media the engine registered against entity rows is tracked in `_media_refs`;
// both delete paths are REF-GUARDED so an asset still referenced by any record
// (including a shared / gallery-picked image on another row) is never removed.

// DELETE /api/media/:key — remove one asset when nothing references it.
app.delete('/:key', requireAuth, requireAdmin, async (c) => {
	const service = getService(c);
	await service.ensureMigrations();
	const key = c.req.param('key');
	const status = await service.deleteIfUnused(key);
	if (status === 'deleted') return success(c, { deleted: true });
	if (status === 'in_use') return fail(c, 'Media is still referenced by a record — remove it from the fields/records first', 409);
	return fail(c, 'Media not found', 404);
});

// POST /api/media/gc — remove every asset no entity row references. Best-effort;
// safe because it is ref-guarded per key.
app.post('/gc', requireAuth, requireAdmin, async (c) => {
	const service = getService(c);
	await service.ensureMigrations();
	const removed = await service.gcUnused();
	return success(c, { removed });
});

// Serve a media file from R2. PUBLIC assets stay PUBLIC by design (a capability
// URL): the stored value is a `/api/media/<key>` string that clients render as
// `<img src>`, and an `<img>` cannot send an Authorization header — so requiring a
// bearer for EVERY asset would break every client that displays stored media.
// Auth is therefore OPTIONAL here: `mediaActor` decodes a bearer if present (never
// required) and the decision lives on the asset's `visibility` — public serves
// anonymously exactly as before; private requires the caller (its uploader or an
// admin). An unknown key is still a plain 404.
app.get('/:key', async (c) => {
	const key = c.req.param('key');
	const service = getService(c);
	await service.ensureMigrations();

	const actor = await mediaActor(c);
	const result = await service.serve(key, actor);

	if (!result) {
		return fail(c, 'Media not found', 404);
	}

	// A private asset must NOT be marked publicly cacheable — a shared/CDN cache
	// would otherwise hand it to an unauthenticated caller. Public assets keep the
	// immutable capability-URL cache exactly as before (non-breaking).
	const isPrivate = result.visibility === 'private';
	return c.newResponse(result.body, 200, {
		'Content-Type': result.contentType,
		'Content-Length': String(result.contentLength),
		'Cache-Control': isPrivate ? 'private, no-store' : 'public, max-age=31536000, immutable',
		ETag: result.etag,
		// Defense in depth: never let a browser sniff the served bytes into
		// executable HTML even if the stored content-type is text-ish.
		'X-Content-Type-Options': 'nosniff',
	});
});

export { app as mediaRoutes };
