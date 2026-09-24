/**
 * Request Logging Middleware
 *
 * Provides structured request/response logging for observability.
 * Logs: method, path, status, duration, request_id
 *
 * Usage:
 *   app.use('*', requestLogger)
 */

import { createMiddleware } from 'hono/factory';

function log(level: 'info' | 'error', fields: Record<string, unknown>) {
	const message = JSON.stringify({ level, timestamp: new Date().toISOString(), ...fields });
	if (level === 'error') console.error(message);
	else console.info(message);
}

export const requestLogger = createMiddleware(async (c, next) => {
	const start = Date.now();
	const requestId = crypto.randomUUID();

	// Attach request ID to response
	c.res.headers.set('X-Request-Id', requestId);

	// Log request
	log('info', {
		request_id: requestId,
		method: c.req.method,
		// Pathname only — query-string VALUES (e.g. ?search=, ?filter[ssn][_eq]=…) can
		// carry PII and must never reach the logs, redacted or not.
		path: c.req.url ? new URL(c.req.url).pathname : c.req.path,
		type: 'request',
	});

	await next();

	// Log response
	const duration = Date.now() - start;
	const level: 'info' | 'error' = c.res.status >= 500 ? 'error' : 'info';
	log(level, {
		request_id: requestId,
		method: c.req.method,
		path: c.req.path,
		status: c.res.status,
		duration_ms: duration,
		type: 'response',
	});
});
