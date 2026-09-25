/**
 * Tenants Plugin — a tenant REGISTRY, not a tenancy ENFORCEMENT.
 *
 * Routes:
 *   GET    /api/tenants          → List tenants
 *   POST   /api/tenants          → Create tenant
 *   GET    /api/tenants/:id      → Get tenant
 *
 * ⚠️ TRUTH IN ADVERTISING: this plugin manages the `_tenants` table only. It does
 * NOT scope entity data to a tenant — there is no `tenant_id` column on engine
 * collections and nothing filters by one. (The previous header claimed "all
 * entity data is scoped to a tenant", and a middleware read a client-supplied
 * `X-Tenant-Id` into `c.get('tenant')` that NO code ever read: a false security
 * control, which is worse than none, because it reads as isolation that does not
 * exist.) Both were removed. Real row-level tenancy is a per-collection row-filter
 * concern (`row_filters` + an `actor_fields`-style assignment) enforced by the
 * engine — implement it THERE, not as a header one middleware trusts.
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { Repository } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import { ConflictError } from '@mmbix/utils';
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

			// No global middleware: a client-supplied `X-Tenant-Id` must never be the
			// basis of a data-access decision (see the header note above).
			return {
				routes: [{ path: '/api/tenants', handler: app as unknown as Hono }],
			};
		},
	};
}
