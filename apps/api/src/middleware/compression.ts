/**
 * Compression Middleware
 *
 * Automatically compresses responses > 1KB using gzip.
 * Respects client's Accept-Encoding header.
 *
 * Bundle impact: ~0.5KB (uses native CompressionStream)
 */

import { createMiddleware } from 'hono/factory';
import type { MiddlewareHandler } from 'hono';

export const compression: MiddlewareHandler = createMiddleware(async (c, next) => {
	await next();

	// Only compress API responses > 1KB
	const contentLength = parseInt(c.res.headers.get('Content-Length') || '0');
	const contentType = c.res.headers.get('Content-Type') || '';
	const acceptEncoding = c.req.header('Accept-Encoding') || '';

	const compressible = contentType.includes('json') || contentType.includes('text') || contentType.includes('csv');
	if (!compressible) return;

	// The body VARIES by Accept-Encoding (this response may be gzipped or served
	// identity), so announce it BEFORE the size gate: without `Vary`, a shared /
	// CDN cache can store the gzip body under the URL alone and serve it to a
	// client that never asked for gzip (it would render as binary garbage).
	const vary = c.res.headers.get('Vary');
	if (!vary) c.res.headers.set('Vary', 'Accept-Encoding');
	else if (!/accept-encoding/i.test(vary)) c.res.headers.set('Vary', `${vary}, Accept-Encoding`);

	if (contentLength < 1024) {
		return;
	}

	if (acceptEncoding.includes('gzip')) {
		const original = c.res.clone();
		const stream = new CompressionStream('gzip');
		const writer = stream.writable.getWriter();
		const reader = stream.readable.getReader();

		const body = await original.arrayBuffer();
		await writer.write(new Uint8Array(body));
		await writer.close();

		const chunks: Uint8Array[] = [];
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
		}
		// Merge compressed chunks and swap the response body — explicit
		// ArrayBuffer construction so the merged view types as ArrayBuffer-backed
		// (TS 7's Uint8Array<ArrayBufferLike> is not a valid BlobPart/BodyInit).
		const total = chunks.reduce((n, c) => n + c.length, 0);
		const compressed = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			compressed.set(chunk, offset);
			offset += chunk.length;
		}
		c.res.headers.set('Content-Encoding', 'gzip');
		c.res.headers.set('Content-Length', String(compressed.length));
		c.res = c.newResponse(compressed, c.res);
	}
});
