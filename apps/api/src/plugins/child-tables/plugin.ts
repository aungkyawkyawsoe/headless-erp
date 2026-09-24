/**
 * Child Tables Plugin
 *
 * Provides ChildTableService that hooks into entity CRUD.
 * The entity route handler uses this service to auto-resolve
 * child table records (parent_id based) during read/write.
 *
 * Usage in entity CRUD:
 *   import { childService } from './plugins/child-tables/service'
 *   const ct = new ChildTableService(db)
 *   ct.resolveChildren(parentIds, schemaFields)
 *   ct.extractChildData(body, schemaFields)
 *
 * Migration: adds parent_id system field awareness
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono } from 'hono';
import { D1Client } from '@mmbix/core';
import { ChildTableService } from './service';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';
import { findCollectionRow } from '@/lib/services/schema-lookup';

export function childTablePlugin(): Plugin {
	return {
		id: 'child-tables',
		name: 'Child Tables (Composite Documents)',
		version: '1.0.0',
		register(_ctx: PluginContext): PluginRegistration {
			type ChildTableEnv = {
				Bindings: { DB: D1Database; ADMIN_PASSWORD: string };
				Variables: { auth: import('@/lib/services/auth.service').AuthContext };
			};
			const app = new Hono<ChildTableEnv>();
			app.use('*', requireAuth);
			app.use('*', requireAdmin);

			// GET /api/child-tables/:collection/:id → resolves children
			app.get('/:collection/:id', async (c) => {
				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				const ct = new ChildTableService(db);
				const { collection, id } = c.req.param();

				// Get schema fields for this collection
				const schema = await findCollectionRow(db, collection);
				if (!schema) return fail(c, 'Not found', 404);

				let _fields: Array<{ name: string; type: string; related_collection?: string }> = [];
				try {
					const p = JSON.parse(schema.schema_json);
					if (p.fields) _fields = p.fields;
				} catch {}

				const resolved = await ct.resolveChildren([id], _fields as import('@mmbix/types').FieldDefinition[]);
				const children: Record<string, Record<string, unknown>[]> = {};
				for (const r of resolved) children[r.fieldName] = r.children;

				return success(c, children);
			});

			// POST /api/child-tables/:collection/:parent/create → create child items
			app.post('/:collection/:parent/create', async (c) => {
				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				const ct = new ChildTableService(db);
				const { collection, parent: parentId } = c.req.param();
				const body = await c.req.json();
				const { field, items } = body;

				if (!field || !items) return fail(c, 'field and items required', 400);

				// Validate field is table type — and resolve the CHILD collection from
				// the field's own `related_collection`. Passing the PARENT slug here
				// (the old shape) inserted the child rows into the PARENT table.
				const schema = await findCollectionRow(db, collection);
				if (!schema) return fail(c, 'Collection not found', 404);

				let fields: Array<{ name: string; type: string; related_collection?: string }> = [];
				try {
					fields = (JSON.parse(schema.schema_json).fields ?? []) as typeof fields;
				} catch {}
				const tableField = fields.find((f) => f.name === field && f.type === 'table' && f.related_collection);
				if (!tableField?.related_collection) return fail(c, `"${field}" is not a table field on "${collection}"`, 400);

				await ct.createChildren(parentId, { [field]: items }, { [field]: tableField.related_collection });
				return success(c, { created: items.length }, 201);
			});

			return { routes: [{ path: '/api/child-tables', handler: app as unknown as Hono }] };
		},
	};
}
