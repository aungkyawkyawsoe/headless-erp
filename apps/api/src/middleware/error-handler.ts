/**
 * Global Error Handler Middleware
 *
 * Catches all thrown errors and returns consistent JSON error responses.
 * Supports our custom AppError hierarchy + generic Error fallback.
 *
 * Features:
 *   - Structured error response format
 *   - Stack traces in development only
 *   - Request ID tracking (via X-Request-Id or auto-generated)
 *   - Error logging with structured context
 */

import type { ErrorHandler, NotFoundHandler } from 'hono';
import { isAppError } from '@mmbix/utils';
import { getConfig } from '@mmbix/config';
import { constraintViolation } from '@mmbix/core';
import { fail } from '@/lib/api/response';

// ─── Safe Config Access ───────────────────────────────

/** Fallback config used when getConfig() throws (e.g. module-level error before initConfig ran). */
function safeConfig(): { isDev: boolean } {
	try {
		return getConfig();
	} catch {
		return { isDev: false };
	}
}

// ─── Error Response Shape ──────────────────────────────

export interface ErrorResponseBody {
	success: false;
	error: string;
	code?: string;
	details?: unknown;
	request_id?: string;
}

// ─── R2 Error Archive Retention ─────────────────────────

/** Archived error objects older than this many days are deleted (best-effort). */
const ERROR_ARCHIVE_RETENTION_DAYS = 30;

/**
 * Prune `errors/<YYYY-MM-DD>/` folders older than ERROR_ARCHIVE_RETENTION_DAYS.
 * Best-effort + non-blocking: failures are swallowed so error responses are never affected.
 */
async function pruneArchivedErrors(bucket: R2Bucket): Promise<void> {
	try {
		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - ERROR_ARCHIVE_RETENTION_DAYS);
		const cutoffKey = cutoff.toISOString().slice(0, 10);
		const listed = await bucket.list({ prefix: 'errors/', delimiter: '/' });
		for (const folder of listed.delimitedPrefixes ?? []) {
			const folderDate = folder.replace(/^errors\//, '').replace(/\/$/, '');
			if (folderDate && folderDate < cutoffKey) {
				const inner = await bucket.list({ prefix: folder });
				for (const obj of inner.objects) await bucket.delete(obj.key);
			}
		}
	} catch {
		/* retention is best-effort */
	}
}

// ─── Error Handler ─────────────────────────────────────

/**
 * Global error handler middleware.
 * Register via: `app.onError(errorHandler)`
 */
export const errorHandler: ErrorHandler = async (err, c) => {
	const config = safeConfig();
	const requestId = c.res.headers.get('X-Request-Id') || crypto.randomUUID();

	// Determine status code and response shape
	let statusCode = 500;
	let body: ErrorResponseBody;

	if (isAppError(err)) {
		statusCode = err.statusCode;
		body = {
			success: false,
			error: err.message,
			code: err.code,
			// `field`/`details` can leak schema internals — only surfaced to dev.
			...(config.isDev && err.field !== undefined ? { field: err.field } : {}),
			...(config.isDev && err.details !== undefined ? { details: err.details } : {}),
			request_id: requestId,
		};
	} else if (err instanceof SyntaxError) {
		// JSON parse errors → 400 Bad Request
		statusCode = 400;
		body = {
			success: false,
			error: 'Invalid JSON in request body',
			code: 'INVALID_JSON',
			request_id: requestId,
		};
	} else if (err instanceof Error) {
		// A constraint violation is a CLIENT error, not a database outage. It can
		// still escape a batched write (a race past the engine's soft-delete-aware
		// uniqueness pre-check), so classify it with the SAME helper Repository uses
		// — never a second error-code map. D1 wraps the message, so check both the
		// error and its `.cause`.
		const violation = constraintViolation(err.message) ?? (err.cause instanceof Error ? constraintViolation(err.cause.message) : null);
		// D1 errors — never expose raw SQL internals
		// D1 errors have a .cause property wrapping the underlying error
		const isD1Error =
			err.message.startsWith('D1_') || (err.cause !== undefined && err.cause instanceof Error && err.cause.message.startsWith('D1_'));
		if (violation) {
			statusCode = violation.statusCode;
			body = {
				success: false,
				error: violation.message,
				code: violation.code,
				...(config.isDev && violation.field !== undefined ? { field: violation.field } : {}),
				request_id: requestId,
			};
		} else if (isD1Error) {
			statusCode = 502;
			body = {
				success: false,
				error: config.isDev ? `Database error: ${err.message.split(':')[0] || 'query failed'}` : 'Internal server error',
				code: 'DATABASE_ERROR',
				request_id: requestId,
			};
		} else {
			// Generic JavaScript error
			body = {
				success: false,
				error: config.isDev ? err.message : 'Internal server error',
				code: 'INTERNAL_ERROR',
				request_id: requestId,
			};
		}
	} else {
		// String or unknown throw
		body = {
			success: false,
			error: config.isDev ? String(err) : 'Internal server error',
			code: 'INTERNAL_ERROR',
			request_id: requestId,
		};
	}

	// Structured logging. 🔒 In production the raw `err.message` is NOT logged:
	// a D1 failure embeds SQL + bound values (PII), and the log stream is a second
	// sink besides the R2 archive below — which already drops it. Only `code`
	// (a canonical, safe contract value) and the request id correlate a prod
	// incident; full detail + stack stay when isDev.
	console.error(
		JSON.stringify({
			level: 'error',
			timestamp: new Date().toISOString(),
			request_id: requestId,
			status: statusCode,
			code: body.code,
			message: config.isDev ? (err instanceof Error ? err.message : String(err)) : body.code,
			...(config.isDev && err instanceof Error && err.stack ? { stack: err.stack.split('\n').slice(0, 5).join('\n') } : {}),
		}),
	);

	// R2 error persistence — server errors (5xx) get archived for post-mortems.
	// Fire-and-forget via waitUntil so it never blocks the response.
	// 🔒 The archived body is redacted: raw err.message can leak D1 internals in
	// production, so only the status + generic message + request id are stored
	// (full detail + stack are kept when isDev).
	if (statusCode >= 500) {
		try {
			const bucket = (c.env as Record<string, unknown> | undefined)?.BUCKET as R2Bucket | undefined;
			if (bucket) {
				const date = new Date().toISOString().slice(0, 10);
				const record = JSON.stringify(
					{
						time: new Date().toISOString(),
						request_id: requestId,
						status: statusCode,
						code: body.code,
						message: config.isDev ? (err instanceof Error ? err.message : String(err)) : 'Internal server error',
						method: c.req.method,
						path: c.req.path,
						...(config.isDev && err instanceof Error && err.stack ? { stack: err.stack.slice(0, 2000) } : {}),
					},
					null,
					2,
				);
				const put = bucket
					.put(`errors/${date}/${requestId}.json`, record, {
						httpMetadata: { contentType: 'application/json' },
					})
					// Best-effort retention: after the write, prune archived errors older
					// than 30 days (key date prefix `errors/YYYY-MM-DD/`). Never blocks/fails.
					.then(() => pruneArchivedErrors(bucket))
					.catch(() => {});
				if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(put);
				else void put;
			}
		} catch {
			/* error persistence is best-effort */
		}
	}

	return c.json(body, statusCode as 200 | 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 500 | 502);
};

// ─── 404 Handler ───────────────────────────────────────

/**
 * Handle routes that don't match any pattern.
 * Register via: `app.notFound(notFoundHandler)`
 */
export const notFoundHandler: NotFoundHandler = (c) => {
	return fail(c, `Route not found: ${c.req.method} ${c.req.path}`, 404, 'NOT_FOUND');
};
