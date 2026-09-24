/**
 * Entity Template Packs Plugin
 *
 * One-click creation of multiple entities from predefined templates.
 * Templates are static JSON files in packs/ — drop a file, add import, done.
 *
 *   GET  /api/templates       → List available templates
 *   POST /api/templates/:name → Apply template (creates all entities)
 *
 * Bundle impact: ~2KB + template JSON files (~500B each)
 */
import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono } from 'hono';
import { D1Client } from '@mmbix/core';
import { CollectionService } from '@/lib/services/collection.service';
import { getTemplate, listTemplates } from './registry';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';

export function templatePlugin(): Plugin {
	return {
		id: 'templates',
		name: 'Entity Template Packs',
		version: '1.1.0',
		register(_ctx: PluginContext): PluginRegistration {
			type TemplateEnv = {
				Bindings: { DB: D1Database; ADMIN_PASSWORD: string };
				Variables: { auth: import('@/lib/services/auth.service').AuthContext };
			};
			const app = new Hono<TemplateEnv>();
			app.use('*', requireAuth);
			app.use('*', requireAdmin);

			app.get('/', (c) => {
				return success(c, listTemplates());
			});

			app.post('/:name', async (c) => {
				const name = c.req.param('name');
				const template = getTemplate(name);
				if (!template)
					return fail(
						c,
						`Template "${name}" not found. Available: ${listTemplates()
							.map((t) => t.name)
							.join(', ')}`,
						404,
					);

				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				const svc = new CollectionService(db);
				const results: string[] = [];

				for (const entity of template.entities) {
					try {
						await svc.createCollection(entity as unknown as Parameters<typeof svc.createCollection>[0]);
						results.push(`✅ ${entity.name} (${entity.slug})`);
					} catch (err) {
						const msg = err instanceof Error ? err.message : 'Unknown error';
						if (msg.includes('already exists')) {
							results.push(`⏭️ ${entity.name} (skipped — exists)`);
						} else {
							results.push(`❌ ${entity.name}: ${msg}`);
						}
					}
				}

				return success(c, { template: template.name, created: results.filter((r) => r.startsWith('✅')).length, results });
			});

			return { routes: [{ path: '/api/templates', handler: app as unknown as Hono }] };
		},
	};
}
