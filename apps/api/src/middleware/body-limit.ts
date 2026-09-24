/**
 * Body Size Limit Middleware
 *
 * Limits request body size to prevent abuse.
 * Content-Length fast path, plus a streaming check for bodies with NO
 * Content-Length header (chunked/streamed uploads would otherwise bypass the
 * limit entirely): `maxSize` applies to all requests; `multipartMaxSize` (when
 * provided) replaces it for multipart/form-data requests so file uploads get
 * their own (larger) ceiling.
 *
 * Usage:
 *   app.use('/api/*', bodySizeLimit({ maxSize: 10 * 1024 * 1024, multipartMaxSize: 50 * 1024 * 1024 }))
 */

import { createMiddleware } from 'hono/factory';
import type { MiddlewareHandler } from 'hono';
import { PayloadTooLargeError } from '@mmbix/utils';

export function bodySizeLimit(options: { maxSize: number; multipartMaxSize?: number }): MiddlewareHandler {
	return createMiddleware(async (c, next) => {
		const isMultipart = (c.req.header('Content-Type') || '').includes('multipart/form-data');
		const effectiveMax = isMultipart && options.multipartMaxSize !== undefined ? options.multipartMaxSize : options.maxSize;
		const contentLength = parseInt(c.req.header('Content-Length') || '0');
		if (contentLength > effectiveMax) {
			throw new PayloadTooLargeError(`Request body too large. Maximum: ${Math.round(effectiveMax / 1024 / 1024)}MB`);
		}
		// No (or zero) Content-Length + a body → chunked/streamed encoding: the
		// header check above can't see the real size, so stream-count the bytes.
		// Reads the CLONED body — the original stream stays intact for the
		// downstream handler — and cancels the reader the moment the cap is hit
		// so an oversized upload is never fully drained.
		if (contentLength === 0 && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
			const body = c.req.raw.clone().body;
			if (body) {
				const reader = body.getReader();
				let total = 0;
				try {
					for (;;) {
						const { done, value } = await reader.read();
						if (done) break;
						total += value?.byteLength ?? 0;
						if (total > effectiveMax) {
							await reader.cancel();
							throw new PayloadTooLargeError(`Request body too large. Maximum: ${Math.round(effectiveMax / 1024 / 1024)}MB`);
						}
					}
				} finally {
					reader.releaseLock();
				}
			}
		}
		await next();
	});
}
