/**
 * Media Routes — with RBAC
 *
 * POST /api/media/upload → Upload a file to R2 (auth required)
 * GET  /api/media/:key   → Serve a media file from R2 (public, no auth needed)
 *
 * Upload cap: ONE number from @mmbix/config upload.maxFileSize (env
 * UPLOAD_MAX_FILE_SIZE, default 50MB) — no hardcoded size here, so the body
 * limit middleware and the per-file check can never drift apart.
 */

import { Hono } from 'hono';
import { D1Client } from '@mmbix/core';
import { initConfig } from '@mmbix/config';
import { MediaService } from '@/lib/services/media.service';
import { AuthService } from '@/lib/services/auth.service';
import { requireAuth } from './auth';
import { requireAdmin } from '@/middleware/rbac-guard';
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

	const result = await service.upload(file);
	return success(c, result, 201);
});

// ── Signed one-time upload token ──────────────────────────
// POST /api/media/presign (auth) → { token, upload_url, expires_at }
// The token is a short-lived HMAC — the client can then POST the file to
// /api/media/upload/<token> WITHOUT the app bearer token (delegated uploads).

app.post('/presign', requireAuth, async (c) => {
	const secret = tokenSecret(c);
	const expiresAt = Date.now() + UPLOAD_TOKEN_TTL_MS;
	const nonce = crypto.randomUUID();
	const payload = `${nonce}:${expiresAt}`;
	const signature = await hmacSign(secret, payload);
	const token = `${payload}:${signature}`;

	return success(c, {
		token,
		expires_at: new Date(expiresAt).toISOString(),
		upload_url: `/api/media/upload/${token}`,
		max_bytes: maxUpload(c),
	});
});

// POST /api/media/upload/:token — delegated upload with a one-time token
app.post('/upload/:token', async (c) => {
	const raw = c.req.param('token');
	const parts = raw.split(':');
	if (parts.length !== 3) return fail(c, 'Invalid upload token', 401);

	const [nonce, expStr, sig] = parts;
	const expiresAt = Number(expStr);
	if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return fail(c, 'Upload token expired', 401);

	const secret = tokenSecret(c);
	const expected = await hmacSign(secret, `${nonce}:${expStr}`);
	if (sig !== expected) return fail(c, 'Invalid upload token', 401);

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

	const result = await service.upload(file);
	return success(c, result, 201);
});

// ── Library list ──────────────────────────────────────────
// GET /api/media?limit=&offset=&mime=image — authenticated list of `_media`
// assets (newest-first). The Studio media-library gallery browses what is
// already stored (R2 assets the client app displays), not just what this session
// uploads.

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

	const data = await service.list({ limit, offset, imageOnly });
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

// Serve is public (no auth — media can be shared by URL)
app.get('/:key', async (c) => {
	const key = c.req.param('key');
	const service = getService(c);

	const result = await service.serve(key);

	if (!result) {
		return fail(c, 'Media not found', 404);
	}

	return c.newResponse(result.body, 200, {
		'Content-Type': result.contentType,
		'Content-Length': String(result.contentLength),
		'Cache-Control': 'public, max-age=31536000, immutable',
		ETag: result.etag,
		// Defense in depth: never let a browser sniff the served bytes into
		// executable HTML even if the stored content-type is text-ish.
		'X-Content-Type-Options': 'nosniff',
	});
});

export { app as mediaRoutes };
