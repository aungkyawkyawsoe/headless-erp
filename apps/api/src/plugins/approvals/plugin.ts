/**
 * Approvals Plugin
 *
 * Multi-level document approval hierarchy.
 * Routes:
 *   GET    /api/approvals/:collection/:id/config    → Get approval config
 *   POST   /api/approvals/:collection/:id/submit    → Submit for approval
 *   POST   /api/approvals/:collection/:id/approve   → Approve at next level
 *   POST   /api/approvals/:collection/:id/reject    → Reject document
 *   GET    /api/approvals/:collection/:id/history   → Approval history
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono } from 'hono';
import { D1Client } from '@mmbix/core';
import { ApprovalService } from './service';
import { CollectionService } from '@/lib/services/collection.service';
import { QueryBuilder } from '@mmbix/core';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { businessGuard } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';

export function approvalPlugin(): Plugin {
	return {
		id: 'approvals',
		name: 'Approval Hierarchy',
		version: '1.0.0',
		register(_ctx: PluginContext): PluginRegistration {
			type ApprovalsEnv = {
				Bindings: { DB: D1Database; JWT_SECRET?: string; ADMIN_PASSWORD: string };
				Variables: { auth: import('@/lib/services/auth.service').AuthContext };
			};
			const app = new Hono<ApprovalsEnv>();
			app.use('*', requireAuth);

			// GET /api/approvals/:collection/:id/config
			app.get('/:collection/:id/config', requireAdmin, async (c) => {
				const { collection } = c.req.param();
				const db = new D1Client(c.env.DB);
				const svc = new ApprovalService(db);

				const schema = await db.first<{ schema_json: string }>(
					QueryBuilder.from('_entity_schemas').select('schema_json').where('slug', collection).toSelect(),
				);
				if (!schema) return fail(c, 'Not found', 404);

				let configJson: string | null = null;
				try {
					const p = JSON.parse(schema.schema_json);
					configJson = p.approval_config || null;
				} catch {}
				const config = svc.parseApprovalConfig(configJson);

				return success(c, config);
			});

			// POST /api/approvals/:collection/:id/submit → submit for approval
			app.post('/:collection/:id/submit', businessGuard('collection', 'submit'), async (c) => {
				const { collection, id } = c.req.param();
				const db = new D1Client(c.env.DB);
				// Thread the SESSION auth: without it the facade's row-filter check and the
				// can_submit/can_approve gate both early-return (a service built with no auth
				// is the trusted-internal shape) — so this route could move a document the
				// caller cannot even see.
				const collService = new CollectionService(db, c.get('auth'));

				await collService.updateItem(collection, id, { doc_status: 'pending_review' });
				return success(c, { id, status: 'pending_review' });
			});

			// POST /api/approvals/:collection/:id/approve
			app.post('/:collection/:id/approve', businessGuard('collection', 'approve'), async (c) => {
				const auth = c.get('auth');

				const { collection, id } = c.req.param();
				const db = new D1Client(c.env.DB);
				const collService = new CollectionService(db, auth);
				const svc = new ApprovalService(db);

				const body = await c.req.json();
				const result = await svc.approve(auth, collection, id, body.level || 1, body.comment, body.amount);

				// Update doc_status
				await collService.updateItem(collection, id, { doc_status: result.newStatus });

				return success(c, { id, status: result.newStatus, next_level: result.nextLevel });
			});

			// POST /api/approvals/:collection/:id/reject
			app.post('/:collection/:id/reject', businessGuard('collection', 'write'), async (c) => {
				const auth = c.get('auth');

				const { collection, id } = c.req.param();
				const db = new D1Client(c.env.DB);
				const collService = new CollectionService(db, auth);
				const svc = new ApprovalService(db);

				const body = await c.req.json();
				const result = await svc.reject(auth, collection, id, body.comment);

				await collService.updateItem(collection, id, { doc_status: result.newStatus });
				return success(c, { id, status: result.newStatus });
			});

			// GET /api/approvals/:collection/:id/history
			app.get('/:collection/:id/history', requireAdmin, async (c) => {
				const { collection, id } = c.req.param();
				const db = new D1Client(c.env.DB);
				const svc = new ApprovalService(db);
				const history = await svc.getHistory(collection, id);
				return success(c, history);
			});

			return { routes: [{ path: '/api/approvals', handler: app as unknown as Hono }] };
		},
	};
}
