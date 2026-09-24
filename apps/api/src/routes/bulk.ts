/**
 * Bulk Operations — with RBAC
 *
 * POST   /api/bulk/:collection  → Bulk create/update/delete (business permission)
 */

import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { CollectionService } from '@/lib/services/collection.service';
import { PermissionEvaluator } from '@/lib/services/permission-evaluator';
import { requireAuth } from './auth';
import { success, fail } from '@/lib/api/response';
import { idempotencyMiddleware } from '@/plugins/idempotency/plugin';
import { poolMap } from '@/lib/utils/pool';

const app = new Hono<{
	Bindings: { DB: D1Database; ADMIN_PASSWORD: string };
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
}>();
app.use('*', requireAuth);
// Stripe-style Idempotency-Key support on bulk writes — a client retry
// (Workers/fetch auto-retry after network errors) can never duplicate rows.
app.use('/:collection', idempotencyMiddleware());

// Small bounded write pool for bulk entity operations — preserves per-item
// result order + error isolation while keeping a few D1 write pipelines in
// flight (each item still runs the full create/update/delete pipeline).
const WRITE_CONCURRENCY = 4;

function getService(c: Context): CollectionService {
	const auth = c.get('auth');
	return new CollectionService(new D1Client(c.env.DB), auth);
}

// ─── Bulk Operations (business permission: create/write/delete) ──

app.post('/:collection', async (c) => {
	const svc = getService(c);
	await svc.ensureMigrations();
	const collection = c.req.param('collection');
	const auth = c.get('auth');
	const body = await c.req.json();
	const { action, items } = body;

	if (!action || !['create', 'update', 'delete', 'restore'].includes(action)) {
		return fail(c, 'action must be "create", "update", "delete", or "restore"', 400);
	}
	if (!Array.isArray(items)) {
		return fail(c, 'items must be an array', 400);
	}
	if (items.length > 1000) {
		return fail(c, 'Max 1000 items per bulk request', 413);
	}

	// Map bulk action to permission action (restore is a write on the row).
	const permAction: 'create' | 'write' | 'delete' = action === 'create' ? 'create' : action === 'delete' ? 'delete' : 'write';
	if (!auth.is_admin) {
		const allowed = await PermissionEvaluator.checkBusiness(new D1Client(c.env.DB), auth, collection, permAction);
		if (!allowed) {
			return fail(c, `No ${permAction} permission on "${collection}"`, 403);
		}
	}

	const results: Array<Record<string, unknown>> = [];

	// Per-item writes pool at a small bounded concurrency — each item runs an
	// independent pipeline. Two cases are NOT independent and stay serial:
	//  - creates on a naming-series collection claim display numbers in row
	//    order — a pool would shuffle which item receives which number;
	//  - update/delete of the SAME id twice in one batch must keep serial
	//    last-write-wins semantics (racing writes on one row are not
	//    independent).
	let concurrency = WRITE_CONCURRENCY;
	if (action === 'create') {
		try {
			const info = await svc.getCollection(collection);
			if (info.naming_series) concurrency = 1;
		} catch {
			// Unknown collection — every item fails per-item below, unchanged.
		}
	} else {
		const ids = items.map((it: unknown) =>
			typeof it === 'string' ? it : (((it as Record<string, unknown> | null)?.id as string | undefined) ?? ''),
		);
		if (new Set(ids).size !== ids.length) concurrency = 1;
	}

	// Result order matches the input array (slot per item); per-item errors are
	// isolated exactly like the serial path. The id being processed is surfaced
	// on error entries so clients can match failures to their inputs (creates
	// may not have an id yet).
	const pooled = await poolMap<unknown, Record<string, unknown>>(items, concurrency, async (raw, index) => {
		const item = raw as Record<string, unknown>;
		let processingId: unknown = item?.id ?? undefined;
		try {
			if (action === 'create') {
				const created = await svc.createItem(collection, item, c);
				return { id: created.id, status: 'created' };
			} else if (action === 'update') {
				const { id, ...data } = item;
				processingId = id;
				if (!id) {
					return { status: 'error', error: 'Missing id for update' };
				}
				const updated = await svc.updateItem(collection, id as string, data, c);
				return { id: updated.id, status: 'updated' };
			} else if (action === 'restore') {
				const id = typeof raw === 'string' ? raw : item.id;
				processingId = id;
				if (!id) {
					return { status: 'error', error: 'Missing id for restore' };
				}
				const restored = await svc.restoreItem(collection, id as string, c);
				return { id: restored.id, status: 'restored' };
			}
			// delete
			const id = typeof raw === 'string' ? raw : item.id;
			processingId = id;
			if (!id) {
				return { status: 'error', error: 'Missing id for delete' };
			}
			const deleted = await svc.softDeleteItem(collection, id as string, c);
			return { id: deleted.id, status: 'deleted' };
		} catch (err) {
			console.error(`[bulk] ${action} failed on item index ${index}:`, err instanceof Error ? err.message : String(err));
			return {
				id: processingId,
				status: 'error',
				error: err instanceof Error ? err.message : 'Operation failed',
			};
		}
	});
	results.push(...pooled);

	return success(c, { action, processed: results.length, results });
});

export { app as bulkRoutes };
