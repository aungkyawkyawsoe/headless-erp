/**
 * Entity Routes — DATA plane (item CRUD with RBAC)
 *
 * The SCHEMA plane (collection metadata) lives in its own top-level namespace
 * (`/api/collections`, `/api/field-types` — see routes/collections.ts) so a
 * user-named collection (`detail`, `field-types`, `import`, …) can never be
 * shadowed by a schema route. Everything here is item data under a real slug:
 *
 *   POST   /api/entities/:collection/import          → Bulk create (create perm)
 *   GET    /api/entities/:collection                 → List items (read perm)
 *   POST   /api/entities/:collection                 → Create item (create perm)
 *   GET    /api/entities/:collection/:id             → Get item (read perm)
 *   PUT    /api/entities/:collection/:id             → Update item (write perm)
 *   DELETE /api/entities/:collection/:id             → Soft delete (delete perm)
 *   POST   /api/entities/:collection/:id/restore     → Restore from trash
 *   DELETE /api/entities/:collection/:id/force       → Hard delete (admin only)
 *   POST   /api/entities/:collection/:id/approve     → Approval decision
 *   POST   /api/entities/:collection/:id/reject      → Approval decision
 *   GET    /api/entities/:collection/:id/approvals   → Approval history
 *   POST   /api/entities/:collection/action/:action  → Declarative action
 *   POST   /api/entities/:collection/bulk/transition → Bulk status transition
 */

import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import { resolvePolicy } from '@mmbix/core';
import { SmartCollectionService } from '@/lib/services/smart-collection.service';
import { CollectionService } from '@/lib/services/collection.service';
import { WorkflowService } from '@/lib/services/workflow.service';
import { findCollectionRow } from '@/lib/services/schema-lookup';
import { requireAuth } from './auth';
import { businessGuard, requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';
import { csvToRecords } from '@/lib/csv';
import { QueryParser } from '@/lib/api/query-parser';
import { poolMap } from '@/lib/utils/pool';

type CmsBindings = {
	Bindings: { DB: D1Database; BUCKET: R2Bucket; ADMIN_PASSWORD: string; IS_DEV?: string };
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
};
const app = new Hono<CmsBindings>();
app.use('*', requireAuth);

// Small bounded write pool for bulk entity operations — preserves per-item
// result order + error isolation while keeping a few D1 write pipelines in
// flight (each item still runs the full create/update/delete pipeline).
const WRITE_CONCURRENCY = 4;

function getService(c: Context): SmartCollectionService {
	const auth = c.get('auth');
	// v0.7: SmartCollectionService adds linkage rules, default expressions, and
	// expression validation on top of the base CollectionService.
	return new SmartCollectionService(new D1Client(c.env.DB), auth);
}

/**
 * Offline-read policy → `X-Offline-Max-Age: <seconds>` on a successful read, so a
 * client MAY persist this body for offline use (header absent ⇒ do not persist).
 *
 * A header rather than an envelope `meta` key because it must cover list AND
 * detail reads uniformly (`getItem` has no `meta`), and because it keeps the
 * decision with the very response it governs: flipping the policy takes effect on
 * the next read — no discovery round trip, and no collection list to leak to
 * callers who could not read those collections anyway.
 */
async function advertiseOfflineRead(c: Context, svc: SmartCollectionService, slug: string): Promise<void> {
	try {
		const policy = resolvePolicy((await svc.getCollection(slug)).policies).offlineReads;
		if (policy.enabled) c.header('X-Offline-Max-Age', String(policy.maxAgeS));
	} catch {
		// Unknown collection — the handler's own error is the real answer.
	}
}

// ─── Item List (read permission) ────────────────────────

// POST /api/entities/:collection/import — bulk create from JSON array or CSV.
// Body: { format: 'json' | 'csv', data: string | object[] }. `data` accepts
// either a string (JSON-encoded array or CSV text) or a native JSON array
// (ergonomic shortcut). Each row runs the full pipeline (linkage, defaults,
// validation, row-filter) — row errors are reported without failing the batch.
app.post('/:collection/import', businessGuard('collection', 'create'), async (c) => {
	const svc = getService(c);
	await svc.ensureMigrations();
	const collection = c.req.param('collection');
	const body = (await c.req.json().catch(() => null)) as { format?: string; data?: string | unknown[] } | null;
	if (!body || body.data === undefined || body.data === null) return fail(c, 'data is required (JSON array or CSV text)', 400);
	const format = body.format === 'csv' ? 'csv' : 'json';
	let rows: Record<string, unknown>[];
	try {
		if (Array.isArray(body.data)) {
			if (format === 'csv') throw new Error('CSV format expects data as CSV text, not an array');
			rows = body.data as Record<string, unknown>[];
		} else if (typeof body.data === 'string') {
			if (!body.data.trim()) return fail(c, 'data is required (JSON array or CSV text)', 400);
			if (format === 'csv') {
				rows = csvToRecords(body.data);
			} else {
				const parsed: unknown = JSON.parse(body.data);
				if (!Array.isArray(parsed)) throw new Error('JSON data must be an array of objects');
				rows = parsed as Record<string, unknown>[];
			}
		} else {
			throw new Error('data must be a JSON array or a JSON/CSV string');
		}
	} catch (e) {
		return fail(c, e instanceof Error ? e.message : 'Parse failed', 400);
	}
	if (rows.length === 0) return fail(c, 'No rows to import', 400);
	if (rows.length > 5000) return fail(c, 'Max 5000 rows per import', 400);

	// Row creates pool at a small bounded concurrency — each row runs an
	// independent pipeline (linkage, defaults, validation, insert, hooks,
	// audit, recalc). EXCEPTION: when the collection declares a naming series,
	// display numbers are claimed in row order (INV-0001, INV-0002, …) —
	// parallelizing would shuffle which row receives which number, so naming-
	// series imports stay serial.
	let concurrency = WRITE_CONCURRENCY;
	try {
		const info = await svc.getCollection(collection);
		if (info.naming_series) concurrency = 1;
	} catch {
		// Unknown collection — every row fails per-row below, exactly as before.
	}

	// Per-item error isolation is preserved: each row's outcome is independent
	// and the errors list keeps row order. CSV rows are numbered including the
	// header (row 1 = header, matches spreadsheet numbering); JSON rows are
	// numbered from 1.
	const outcomes = await poolMap(rows, concurrency, async (row) => {
		try {
			// Pass the execution context so audit uses waitUntil (request-scoped, not
			// fire-and-forget) and webhooks fire for imported rows like any create.
			await svc.createItem(collection, row, c);
			return null;
		} catch (e) {
			return e instanceof Error ? e.message : 'Failed';
		}
	});
	const errors: Array<{ row: number; error: string }> = [];
	let imported = 0;
	for (let i = 0; i < outcomes.length; i++) {
		const outcome = outcomes[i];
		if (outcome === null) imported++;
		else errors.push({ row: format === 'csv' ? i + 2 : i + 1, error: outcome });
	}
	return success(c, { imported, errors });
});

app.get('/:collection', businessGuard('collection', 'read'), async (c) => {
	const svc = getService(c);
	await svc.ensureMigrations();
	const collection = c.req.param('collection');

	// Debug: return SQLite EXPLAIN QUERY PLAN — admin-only in production
	// to prevent exposing internal table names and query structure to readers.
	if (c.req.query('explain') === 'true') {
		const auth = c.get('auth');
		const isDev = (c.env.IS_DEV as string) === 'true';
		if (!auth.is_admin && !isDev) {
			return fail(c, 'Forbidden', 403, 'FORBIDDEN');
		}
		const info = await svc.getCollection(collection);
		const db = new D1Client(c.env.DB);
		const qb = QueryBuilder.from(info.table_name).whereNull('deleted_at').orderBy('created_at', 'desc').limit(20);
		const plan = await db.all<{ detail: string }>(qb.explain());
		return success(c, {
			table: info.table_name,
			slug: collection,
			plan: plan.map((p) => p.detail),
		});
	}

	const includeTrashed = c.req.query('trashed') === 'true';
	const result = await svc.listItems(collection, new URL(c.req.url), includeTrashed);
	await advertiseOfflineRead(c, svc, collection);
	if (result.meta.export_csv && result.data.length > 0) {
		const { toCsv } = await import('@/lib/services/export.service');
		const url = new URL(c.req.url);
		const fieldsParam = url.searchParams.get('fields');
		const fieldFilter = fieldsParam
			? fieldsParam
					.split(',')
					.map((f) => f.trim())
					.filter(Boolean)
			: undefined;

		const csv = toCsv(result.data, ['_meta', 'deleted_at', 'doc_status', '_owner', 'rowid'], fieldFilter);

		// Sanitize collection slug for Content-Disposition header — prevent CRLF injection
		const safeFilename = c.req.param('collection').replace(/[\r\n\\"]/g, '_');
		return c.newResponse(csv, 200, {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${safeFilename}.csv"`,
		});
	}
	return success(c, result.data, 200, result.meta);
});

// ─── Item CRUD (business permissions) ────────────────────

app.post('/:collection', businessGuard('collection', 'create'), async (c) => {
	const svc = getService(c);
	await svc.ensureMigrations();
	const item = await svc.createItem(c.req.param('collection'), await c.req.json(), c);
	return success(c, item, 201);
});

app.get('/:collection/:id', businessGuard('collection', 'read'), async (c) => {
	const svc = getService(c);
	await svc.ensureMigrations();
	// Detail reads follow the same ?fields= selection rules as list reads (lean
	// default; explicit dot/wildcard paths expand relations).
	const parsed = QueryParser.parse(new URL(c.req.url));
	const record = await svc.getItem(c.req.param('collection'), c.req.param('id'), parsed.fieldSelection, c.req.query('fields') ?? '');
	await advertiseOfflineRead(c, svc, c.req.param('collection'));
	return success(c, record);
});

app.put('/:collection/:id', businessGuard('collection', 'write'), async (c) => {
	const svc = getService(c);
	await svc.ensureMigrations();
	const collection = c.req.param('collection');
	const id = c.req.param('id');
	const body = (await c.req.json()) as Record<string, unknown>;

	// Approval workflow: a transition to `submitted` on a workflow-enabled
	// collection routes through the engine — it opens approval levels
	// (doc_status → pending_review) or falls through to a plain submit when no
	// level applies (threshold-aware). Field edits + submit = two requests.
	if (body.doc_status === 'submitted') {
		const workflowSvc = new WorkflowService(new D1Client(c.env.DB), c.get('auth'));
		if (await workflowSvc.getWorkflow(collection)) {
			return success(c, await workflowSvc.submit(collection, id, c));
		}
	}

	// Optimistic concurrency: the client echoes the `updated_at` it loaded in
	// If-Match; the service 409s when the record moved on (stale-write guard).
	const expectedUpdatedAt = c.req.header('If-Match')?.replace(/^"|"$/g, '') || null;
	return success(c, await svc.updateItem(collection, id, body, c, expectedUpdatedAt));
});

// ─── Approval Workflow (multi-level approvals) ──────────
//
// Enabled per collection via schema_json.workflow (Studio → App workbench →
// Workflow tab). Submit routes drafts into pending_review; the next pending
// level must be approved by a user whose role matches the level's role
// (admin bypasses). Decisions are recorded in _approvals + audit trail.

app.post('/:collection/:id/approve', businessGuard('collection', 'approve'), async (c) => {
	const db = new D1Client(c.env.DB);
	await new CollectionService(db, c.get('auth')).ensureMigrations();
	const svc = new WorkflowService(db, c.get('auth'));
	const body = (await c.req.json().catch(() => null)) as { comment?: string } | null;
	return success(c, await svc.approve(c.req.param('collection'), c.req.param('id'), body?.comment, c));
});

app.post('/:collection/:id/reject', businessGuard('collection', 'approve'), async (c) => {
	const db = new D1Client(c.env.DB);
	await new CollectionService(db, c.get('auth')).ensureMigrations();
	const svc = new WorkflowService(db, c.get('auth'));
	const body = (await c.req.json().catch(() => null)) as { comment?: string } | null;
	return success(c, await svc.reject(c.req.param('collection'), c.req.param('id'), body?.comment, c));
});

app.get('/:collection/:id/approvals', businessGuard('collection', 'read'), async (c) => {
	const db = new D1Client(c.env.DB);
	await new CollectionService(db, c.get('auth')).ensureMigrations();
	const svc = new WorkflowService(db, c.get('auth'));
	return success(c, await svc.getApprovals(c.req.param('collection'), c.req.param('id')));
});

// ─── Soft Delete (trash) ─────────────────────────────────

app.delete('/:collection/:id', businessGuard('collection', 'delete'), async (c) => {
	const svc = getService(c);
	await svc.ensureMigrations();
	const result = await svc.softDeleteItem(c.req.param('collection'), c.req.param('id'), c);
	return success(c, result);
});

// ─── Restore ─────────────────────────────────────────────

app.post('/:collection/:id/restore', businessGuard('collection', 'write'), async (c) => {
	const svc = getService(c);
	await svc.ensureMigrations();
	return success(c, await svc.restoreItem(c.req.param('collection'), c.req.param('id'), c));
});

// ─── Hard Delete (Admin Only) ────────────────────────────

app.delete('/:collection/:id/force', requireAdmin, async (c) => {
	const svc = getService(c);
	await svc.ensureMigrations();
	return success(c, await svc.hardDeleteItem(c.req.param('collection'), c.req.param('id'), c));
});
// ─── v0.7: Collection Actions (Custom Server-Side Buttons) ─
//
// Actions are DECLARATIVE — workerd disallows new Function()/eval, so
// arbitrary JS handlers are not supported. Instead, actions declare an
// operation (update / delete / webhook) with a payload.
//
// Schema:
//   "actions": { "custom": [
//     { "name": "mark_paid", "label": "Mark as Paid", "type": "single",
//       "action": "update", "data": { "status": "paid" } },
//     { "name": "archive", "label": "Archive", "type": "bulk",
//       "action": "update", "data": { "doc_status": "cancelled" } },
//     { "name": "notify", "label": "Notify", "type": "single",
//       "action": "webhook", "url": "https://hooks.example.com/notify" }
//   ] }

app.post('/:collection/action/:action', businessGuard('collection', 'write'), async (c) => {
	const svc = getService(c);
	await svc.ensureMigrations();
	const collection = c.req.param('collection');
	const actionName = c.req.param('action');
	const body = await c.req.json<{ ids?: string[]; data?: Record<string, unknown> }>();
	const db = new D1Client(c.env.DB);
	const entity = await findCollectionRow(db, collection);
	if (!entity) return fail(c, 'Collection not found', 404);
	let schema: Record<string, unknown>;
	try {
		schema = JSON.parse(entity.schema_json);
	} catch {
		return fail(c, 'Invalid schema', 500, 'INVALID_SCHEMA');
	}
	const actions = (schema.actions as Record<string, unknown> | undefined)?.custom as
		| Array<{
				name: string;
				label?: string;
				type?: 'single' | 'bulk';
				action: 'update' | 'delete' | 'webhook';
				data?: Record<string, unknown>;
				url?: string;
				confirm?: string;
		  }>
		| undefined;
	const action = actions?.find((a) => a.name === actionName);
	if (!action) return fail(c, `Action "${actionName}" not found`, 404);

	const ids = body.ids || [];
	const extraData = body.data || {};
	const results: Array<{ id?: string; status: string; error?: string }> = [];

	try {
		switch (action.action) {
			case 'update': {
				// Merge action's static data with per-request data, then update each record
				const update = { ...(action.data || {}), ...extraData };
				// Distinct rows update independently and pool; the SAME id listed twice
				// must keep serial last-write-wins semantics (racing updates on one row
				// are not independent).
				const distinct = new Set(ids).size === ids.length;
				results.push(
					...(await poolMap(ids, distinct ? WRITE_CONCURRENCY : 1, async (id) => {
						try {
							await svc.updateItem(collection, id, update, c);
							return { id, status: 'updated' };
						} catch (err) {
							return { id, status: 'error', error: err instanceof Error ? err.message : 'Update failed' };
						}
					})),
				);
				break;
			}

			case 'delete': {
				// Same duplicate-id rule as update — one row deleted twice must behave
				// exactly like the serial path.
				const distinct = new Set(ids).size === ids.length;
				results.push(
					...(await poolMap(ids, distinct ? WRITE_CONCURRENCY : 1, async (id) => {
						try {
							await svc.softDeleteItem(collection, id, c);
							return { id, status: 'deleted' };
						} catch (err) {
							return { id, status: 'error', error: err instanceof Error ? err.message : 'Delete failed' };
						}
					})),
				);
				break;
			}

			case 'webhook': {
				// Fire a webhook with the selected record IDs and payload
				const url = action.url || (extraData.url as string);
				if (!url) return fail(c, 'Action requires a webhook URL', 400, 'INVALID_SCHEMA');
				const payload = { event: `action.${action.name}`, collection, ids, data: extraData, timestamp: new Date().toISOString() };
				const res = await fetch(url, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
				results.push({ status: res.ok ? 'notified' : 'webhook_failed', error: res.ok ? undefined : `HTTP ${res.status}` });
				break;
			}

			default:
				return fail(c, `Unsupported action type: ${(action as { action: string }).action}`, 400, 'INVALID_SCHEMA');
		}

		return success(c, { action: actionName, processed: results.length, results });
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Action failed', 500, 'ACTION_ERROR');
	}
});

// ─── v0.7: Bulk Status Transition ────────────────────────

app.post('/:collection/bulk/transition', businessGuard('collection', 'write'), async (c) => {
	const svc = getService(c);
	await svc.ensureMigrations();
	const collection = c.req.param('collection');
	const { ids, to_status } = await c.req.json<{ ids: string[]; to_status: string }>();
	if (!ids || !Array.isArray(ids) || ids.length === 0) return fail(c, 'ids array required', 400);
	if (!to_status) return fail(c, 'to_status required', 400);
	const results: Array<{ id: string; status: string; error?: string }> = [];
	// Distinct rows transition independently and pool; the SAME id twice must
	// keep serial semantics (two racing transitions on one row are not
	// independent — the second would read whatever the first left behind).
	const distinct = new Set(ids).size === ids.length;
	results.push(
		...(await poolMap(ids, distinct ? WRITE_CONCURRENCY : 1, async (id) => {
			try {
				await svc.updateItem(collection, id, { doc_status: to_status }, c);
				return { id, status: 'updated' };
			} catch (err) {
				return { id, status: 'error', error: err instanceof Error ? err.message : 'Unknown' };
			}
		})),
	);
	const ok = results.filter((r) => r.status === 'updated').length;
	const failed = results.filter((r) => r.status === 'error').length;
	return success(c, { total: ids.length, succeeded: ok, failed, results });
});

export { app as entityRoutes };
