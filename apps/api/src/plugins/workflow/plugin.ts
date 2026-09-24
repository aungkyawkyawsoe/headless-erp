/**
 * Declarative Workflow Engine — plugin
 *
 * A general-purpose, declarative state machine (JSON definition, no code):
 *   GET    /api/workflows                → list workflows (?collection=slug)
 *   POST   /api/workflows                → create/upsert a workflow (validated)
 *   GET    /api/workflows/:id            → get one workflow
 *   PUT    /api/workflows/:id            → update definition (version bumps)
 *   DELETE /api/workflows/:id            → remove workflow (+ states/history)
 *   POST   /api/workflows/:id/transition → perform a state transition
 *   POST   /api/workflows/:id/bulk-transition → transition many documents
 *   GET    /api/workflows/:id/states/:collection/:documentId → current state
 *   GET    /api/workflows/:id/history/:collection/:documentId → transition audit
 *
 * Guards run through the safe expression evaluator (workerd-safe — no eval).
 * `on_transition.trigger_plugins` invoke marketplace plugins. The hook spine
 * fires `workflow_transition` (pre-commit, can abort) and
 * `workflow_transition_after` (post-commit, fire-and-forget).
 *
 * Bundle impact: ~6KB
 */

import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { ValidationError } from '@mmbix/utils';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { WorkflowService } from './service';
import { WorkflowEngine } from './engine';
import type { WorkflowDefinition } from './types';
import { success, fail } from '@/lib/api/response';

export function workflowPlugin(): Plugin {
	return {
		id: 'workflow',
		name: 'Declarative Workflow Engine (state machines as data)',
		version: '1.0.0',
		migrations: [
			{
				name: '019_workflows',
				up: [
					{
						sql: `CREATE TABLE IF NOT EXISTS _workflows (
							id TEXT PRIMARY KEY,
							name TEXT NOT NULL,
							collection_slug TEXT NOT NULL UNIQUE,
							definition_json TEXT NOT NULL,
							enabled INTEGER NOT NULL DEFAULT 1,
							version INTEGER NOT NULL DEFAULT 1,
							created_at TEXT NOT NULL,
							updated_at TEXT NOT NULL
						)`,
						bindings: [],
					},
					{
						sql: `CREATE TABLE IF NOT EXISTS _workflow_states (
							collection_slug TEXT NOT NULL,
							document_id TEXT NOT NULL,
							state TEXT NOT NULL,
							updated_at TEXT NOT NULL,
							PRIMARY KEY (collection_slug, document_id)
						)`,
						bindings: [],
					},
					{
						sql: `CREATE TABLE IF NOT EXISTS _workflow_history (
							id TEXT PRIMARY KEY,
							workflow_id TEXT,
							collection_slug TEXT NOT NULL,
							document_id TEXT NOT NULL,
							from_state TEXT,
							to_state TEXT NOT NULL,
							by_user TEXT,
							by_email TEXT,
							comment TEXT,
							created_at TEXT NOT NULL
						)`,
						bindings: [],
					},
				],
			},
			{
				// Separate migration so existing databases (019 already applied) still
				// get the audit-trail index — CREATE INDEX IF NOT EXISTS is idempotent.
				name: '021_workflow_history_index',
				up: [
					{
						sql: `CREATE INDEX IF NOT EXISTS idx_workflow_history_doc ON _workflow_history (collection_slug, document_id)`,
						bindings: [],
					},
				],
			},
		],
		register(_ctx: PluginContext): PluginRegistration {
			const app = new Hono<{
				Bindings: { DB: D1Database };
				Variables: { auth: import('@/lib/services/auth.service').AuthContext };
			}>();

			app.use('*', requireAuth);

			const getDb = (c: Context) => new D1Client((c.env as { DB: D1Database }).DB as D1Database);
			const svc = (c: Context) => new WorkflowService(getDb(c));
			const engine = (c: Context) => new WorkflowEngine(getDb(c), svc(c));

			// ─── List ─────────────────────────────────────
			app.get('/', async (c) => {
				const list = await svc(c).list(c.req.query('collection') || undefined);
				return success(c, list);
			});

			// ─── Create / upsert (one workflow per collection) ──
			app.post('/', requireAdmin, async (c) => {
				const body = (await c.req.json()) as WorkflowDefinition & { id?: string };
				const errors = new WorkflowEngine(new D1Client(c.env.DB), svc(c)).validateDefinition(body);
				if (errors.length > 0) throw new ValidationError(`Invalid workflow: ${errors.join('; ')}`);
				const saved = await svc(c).upsert(body, body.id);
				const row = await svc(c).get(saved.id);
				return success(c, { ...row, version: saved.version }, 201);
			});

			// ─── Get one ──────────────────────────────────
			app.get('/:id', async (c) => {
				const row = await svc(c).get(c.req.param('id'));
				if (!row) return fail(c, 'Workflow not found', 404);
				return success(c, row);
			});

			// ─── Update definition ────────────────────────
			app.put('/:id', requireAdmin, async (c) => {
				const existing = await svc(c).get(c.req.param('id'));
				if (!existing) return fail(c, 'Workflow not found', 404);
				const body = (await c.req.json()) as Partial<WorkflowDefinition>;
				if (body.collection && body.collection !== existing.definition.collection) {
					// Moving a workflow to another collection would orphan every recorded
					// state — reject instead of silently breaking the audit trail.
					return fail(c, 'Cannot change workflow collection — create a new workflow for the target collection', 400);
				}
				const next: WorkflowDefinition = {
					...existing.definition,
					...body,
					collection: body.collection ?? existing.definition.collection,
				};
				const errors = new WorkflowEngine(new D1Client(c.env.DB), svc(c)).validateDefinition(next);
				if (errors.length > 0) throw new ValidationError(`Invalid workflow: ${errors.join('; ')}`);
				const saved = await svc(c).upsert(next, existing.id);
				const row = await svc(c).get(saved.id);
				return success(c, { ...row, version: saved.version });
			});

			// ─── Delete ───────────────────────────────────
			app.delete('/:id', requireAdmin, async (c) => {
				await svc(c).remove(c.req.param('id'));
				return success(c, { deleted: true });
			});

			// ─── Transition ───────────────────────────────
			app.post('/:id/transition', async (c) => {
				const auth = c.get('auth');
				const workflow = await svc(c).get(c.req.param('id'));
				if (!workflow) return fail(c, 'Workflow not found', 404);
				const body = (await c.req.json()) as { document_id?: string; to_state?: string; comment?: string };
				if (!body.document_id || !body.to_state) {
					return fail(c, 'document_id and to_state are required', 400);
				}
				const result = await engine(c).transition(workflow, workflow.definition.collection, body.document_id, body.to_state, auth, {
					comment: body.comment,
				});
				return success(c, result);
			});

			// ─── Bulk transition (ERP batch approval / dispatch) ──
			app.post('/:id/bulk-transition', async (c) => {
				const auth = c.get('auth');
				const workflow = await svc(c).get(c.req.param('id'));
				if (!workflow) return fail(c, 'Workflow not found', 404);
				const body = (await c.req.json()) as { document_ids?: string[]; to_state?: string; comment?: string };
				const ids = Array.isArray(body.document_ids) ? body.document_ids : [];
				if (ids.length === 0 || !body.to_state) {
					return fail(c, 'document_ids (non-empty) and to_state are required', 400);
				}
				const eng = engine(c);
				const results: Array<Record<string, unknown>> = [];
				for (const documentId of ids) {
					try {
						const r = await eng.transition(workflow, workflow.definition.collection, documentId, body.to_state, auth, {
							comment: body.comment,
						});
						results.push({ document_id: documentId, success: true, from: r.from, to: r.to });
					} catch (err) {
						results.push({
							document_id: documentId,
							success: false,
							error: err instanceof Error ? err.message : String(err),
						});
					}
				}
				const succeeded = results.filter((r) => r.success).length;
				return success(c, { total: ids.length, succeeded, failed: ids.length - succeeded, results });
			});

			// ─── Current state ────────────────────────────
			app.get('/:id/states/:collection/:documentId', async (c) => {
				const workflow = await svc(c).get(c.req.param('id'));
				if (!workflow) return fail(c, 'Workflow not found', 404);
				const state = await svc(c).getState(c.req.param('collection'), c.req.param('documentId'));
				return success(c, { state: state ?? workflow.definition.initial, initial: workflow.definition.initial });
			});

			// ─── Transition history (audit) ───────────────
			app.get('/:id/history/:collection/:documentId', async (c) => {
				const history = await svc(c).getHistory(c.req.param('collection'), c.req.param('documentId'));
				return success(c, history);
			});

			return { routes: [{ path: '/api/workflows', handler: app as unknown as Hono }] };
		},
	};
}
