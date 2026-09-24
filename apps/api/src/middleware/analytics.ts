/**
 * Workers Analytics Engine middleware — per-request usage metrics.
 *
 * Writes one data point per /api/* request: client, route group, method,
 * status class, duration, and bytes. Backed by the ANALYTICS binding
 * (`analytics_engine_datasets` in wrangler.jsonc — dataset name comes from
 * `ANALYTICS_DATASET` in infra/env.prod).
 *
 * ⚠️ OFF by default — set ANALYTICS_ENABLED=true to activate.
 * Fail-open: analytics errors never break the request.
 */
import { createMiddleware } from 'hono/factory';
import type { MiddlewareHandler } from 'hono';

interface AnalyticsEnv {
	ANALYTICS?: {
		writeDataPoint: (point: { indexes: string[]; blobs: string[]; doubles: number[] }) => void;
	};
	ANALYTICS_ENABLED?: string;
}

/** Build a coarse route group from a path (keeps cardinality low). */
function routeGroup(pathname: string): string {
	const parts = pathname.split('/').filter(Boolean);
	if (parts.length === 0) return 'root';
	if (parts[0] !== 'api') return 'other';
	// /api/entities/... → entities
	if (parts.length >= 2) return parts[1];
	return 'api';
}

/**
 * Mount as `app.use('/api/*', apiAnalytics())`.
 * No-op unless ANALYTICS_ENABLED === "true" AND the ANALYTICS binding exists.
 */
export function apiAnalytics(): MiddlewareHandler {
	return createMiddleware(async (c, next) => {
		const env = (c.env ?? {}) as AnalyticsEnv;
		// Toggle: OFF by default — flip ANALYTICS_ENABLED=true to enable.
		if (env.ANALYTICS_ENABLED !== 'true' || !env.ANALYTICS) {
			await next();
			return;
		}

		const started = Date.now();
		await next();

		try {
			const url = new URL(c.req.url);
			const auth = c.get('auth') as { is_admin?: boolean; user_id?: string } | undefined;
			const clientId = (c.env as Record<string, unknown> | undefined)?.CLIENT_ID as string | undefined;
			env.ANALYTICS.writeDataPoint({
				indexes: [routeGroup(url.pathname), clientId || 'factory', auth?.is_admin ? 'admin' : auth?.user_id ? 'user' : 'anon'],
				blobs: [c.req.method, String(c.res.status), url.pathname],
				doubles: [Date.now() - started, started / 1000],
			});
		} catch {
			/* fail-open */
		}
	});
}
