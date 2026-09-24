/**
 * OpenAPI Plugin
 *
 * Auto-generates OpenAPI 3.0 spec from entity schemas.
 * Serves the Scalar API Reference (via CDN) at /api/docs.
 *
 * Routes:
 *   GET /api/openapi.json  → OpenAPI specification (auth required)
 *   GET /api/docs           → Scalar API Reference HTML page (auth required)
 *
 * Both routes mount requireAuth — the schema is internal design info and must
 * not be disclosed to anonymous callers.
 *
 * Bundle impact: ~3KB | Zero dependencies
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono } from 'hono';
import { D1Client } from '@mmbix/core';
import { OpenAPIGenerator } from './generator';
import { findAllCollections } from '@/lib/services/schema-lookup';
import { requireAuth } from '@/routes/auth';

type OpenApiEnv = {
	Bindings: { DB: D1Database; ADMIN_USERNAME: string; ADMIN_PASSWORD: string; JWT_SECRET?: string; IS_DEV?: string };
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
};

export function openApiPlugin(baseUrl?: string): Plugin {
	return {
		id: 'openapi',
		name: 'OpenAPI / Scalar',
		version: '1.0.0',
		register(_ctx: PluginContext): PluginRegistration {
			const app = new Hono<OpenApiEnv>();
			const gen = new OpenAPIGenerator(baseUrl || '');

			// 🔒 Both the spec and the docs page require auth: the schema is
			// internal design info and must not be disclosed to anonymous callers.
			app.get('/openapi.json', requireAuth, async (c) => {
				const db = new D1Client(c.env.DB as D1Database);
				const collections = await findAllCollections(db);
				const spec = gen.generate(collections);
				return c.json(spec);
			});

			app.get('/docs', requireAuth, (c) => {
				const apiUrl = baseUrl || new URL(c.req.url).origin;
				return c.html(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>API Docs</title>
<!--
  CDN RISK: @scalar/api-reference is loaded from jsDelivr without version pinning or SRI.
  For production, pin a specific version (e.g. @scalar/api-reference@1.25.0) and add
  integrity + crossorigin. Generate SRI: https://www.srihash.org/ or use a pinned package.
-->
</head><body>
<script id="api-reference" data-url="${apiUrl}/openapi.json" data-theme="default"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body></html>`);
			});

			return { routes: [{ path: '/api', handler: app as unknown as Hono }] };
		},
	};
}
