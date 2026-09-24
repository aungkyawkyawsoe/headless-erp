/**
 * Tenants Plugin
 *
 * Enables multi-tenant isolation.
 * All entity data is scoped to a tenant via tenant_id column.
 *
 * Routes:
 *   GET    /api/tenants          → List tenants
 *   POST   /api/tenants          → Create tenant
 *   GET    /api/tenants/:id      → Get tenant
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { Repository } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import { ConflictError } from '@mmbix/utils';
import { tenantMiddleware } from './middleware';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success } from '@/lib/api/response';

export interface Tenant {
	id: string;
	name: string;
	slug: string;
	is_active: boolean;
	created_at: string;
}

export function tenantPlugin(): Plugin {
	return {
		id: 'tenants',
		name: 'Multi-Tenancy',
		version: '1.0.0',
		register(_ctx: PluginContext): PluginRegistration {
			type TenantEnv = {
				Bindings: { DB: D1Database; ADMIN_PASSWORD: string };
				Variables: { auth: import('@/lib/services/auth.service').AuthContext };
			};
			const app = new Hono<TenantEnv>();
			app.use('*', requireAuth);

			const getDb = (c: Context) => new D1Client((c.env as Record<string, unknown>).DB as D1Database);
			const getRepo = (c: Context) => new Repository<Tenant>(getDb(c), '_tenants');

			app.get('/', async (c) => success(c, await getRepo(c).findAll()));
			app.post('/', requireAdmin, async (c) => {
				const body = await c.req.json();
				const slug = body.slug || body.name.toLowerCase().replace(/[^a-z0-9]/g, '_');

				// Check for duplicate slug
				const existing = await getDb(c).first(QueryBuilder.from('_tenants').select('id').where('slug', slug).toSelect());
				if (existing) throw new ConflictError(`A tenant with slug "${slug}" already exists`);

				try {
					const tenant = await getRepo(c).create({
						id: crypto.randomUUID(),
						name: body.name,
						slug,
						is_active: true,
					} as Partial<Tenant>);
					return success(c, tenant, 201);
				} catch (err) {
					if (err instanceof Error && err.message.includes('UNIQUE')) {
						throw new ConflictError(`A tenant with slug "${slug}" already exists`);
					}
					throw err;
				}
			});
			app.get('/:id', async (c) => success(c, await getRepo(c).findById(c.req.param('id'))));

			return {
				routes: [{ path: '/api/tenants', handler: app as unknown as Hono }],
				middleware: [{ path: '/api/*', handler: tenantMiddleware }],
			};
		},
	};
}
