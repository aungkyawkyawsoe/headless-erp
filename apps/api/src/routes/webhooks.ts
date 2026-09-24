/**
 * Webhook Routes — with Collection-Level RBAC
 *
 * Admin bypass: Full access to all webhooks
 * Non-admin: Can manage webhooks only for collections they have "write" permission on
 *
 * GET    /api/webhooks          → List webhooks (filtered by permission)
 * POST   /api/webhooks          → Create webhook (write permission on target collection)
 * PUT    /api/webhooks/:id      → Update webhook (write permission on target collection)
 * DELETE /api/webhooks/:id      → Delete webhook (write permission on target collection)
 */

import { Hono, type Context } from 'hono';
import { D1Client, QueryBuilder } from '@mmbix/core';
import { WebhookService } from '@/lib/services/webhook.service';
import { validateWebhookUrl } from '@/lib/services/webhook.service';
import { PermissionEvaluator } from '@/lib/services/permission-evaluator';
import { requireAuth } from './auth';
import { success, fail } from '@/lib/api/response';

const app = new Hono<{
	Bindings: { DB: D1Database; ADMIN_PASSWORD: string; IS_DEV?: string };
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
}>();
app.use('*', requireAuth);

function getService(c: Context): WebhookService {
	return new WebhookService(new D1Client(c.env.DB));
}

function getDb(c: Context): D1Client {
	return new D1Client(c.env.DB);
}

// ─── List — filtered by permission for non-admins ──────

app.get('/', async (c) => {
	const auth = c.get('auth');
	const svc = getService(c);

	// Admin sees all
	if (auth.is_admin) {
		return success(c, await svc.list());
	}

	// Non-admin: filter to collections they have write access to
	// Pre-fetch all permissions in one query, then filter in-memory (O(1) DB call vs O(n))
	const allWebhooks = await svc.list();
	const db = getDb(c);
	const permRows = await db.all<{ collection_slug: string }>(
		QueryBuilder.from('_role_permissions').select('collection_slug').where('role_id', auth.role_id).where('can_write', true).toSelect(),
	);
	const allowedSlugs = new Set(permRows.map((r) => r.collection_slug));
	const filtered = allWebhooks.filter((wh) => allowedSlugs.has(wh.collection_slug));

	return success(c, filtered);
});

// ─── Create — requires write permission on target collection ──

app.post('/', async (c) => {
	const auth = c.get('auth');
	const body = await c.req.json();
	const collectionSlug: string = body.collection_slug || '';

	if (!collectionSlug) {
		return fail(c, 'collection_slug is required', 400);
	}

	// Non-admin: check write permission on target collection
	if (!auth.is_admin) {
		const db = getDb(c);
		const hasWrite = await PermissionEvaluator.checkBusiness(db, auth, collectionSlug, 'write');
		if (!hasWrite) {
			return fail(c, `No write permission on "${collectionSlug}"`, 403, 'FORBIDDEN');
		}
	}

	const svc = getService(c);

	// Validate documented shape: name, url, collection_slug, events[]
	if (!body.name?.trim()) return fail(c, 'name is required', 400);
	if (!body.url?.trim()) return fail(c, 'url is required', 400);
	if (!Array.isArray(body.events) || body.events.length === 0) {
		return fail(c, 'events array is required (create | update | delete)', 400);
	}

	// 🔒 SSRF Protection: validate webhook URL before storing
	try {
		const isDev = (c.env.IS_DEV as string) === 'true';
		body.url = validateWebhookUrl(body.url, isDev);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Invalid webhook URL', 400);
	}

	const webhook = await svc.create(body);
	return success(c, webhook, 201);
});

// ─── Update — requires write permission ─────────────────

app.put('/:id', async (c) => {
	const auth = c.get('auth');
	const svc = getService(c);
	const db = getDb(c);

	// Get existing webhook directly by ID
	const existing = await svc.getById(c.req.param('id'));
	if (!existing) {
		return fail(c, 'Webhook not found', 404);
	}

	// Non-admin: check write permission
	if (!auth.is_admin) {
		const hasWrite = await PermissionEvaluator.checkBusiness(db, auth, existing.collection_slug, 'write');
		if (!hasWrite) {
			return fail(c, `No write permission on "${existing.collection_slug}"`, 403, 'FORBIDDEN');
		}
	}

	const body = await c.req.json();

	// 🔒 SSRF Protection: validate URL if being updated
	if (typeof body.url === 'string' && body.url.trim()) {
		try {
			const isDev = (c.env.IS_DEV as string) === 'true';
			body.url = validateWebhookUrl(body.url, isDev);
		} catch (err) {
			return fail(c, err instanceof Error ? err.message : 'Invalid webhook URL', 400);
		}
	}

	return success(c, await svc.update(c.req.param('id'), body));
});

// ─── Delete — requires write permission ─────────────────

app.delete('/:id', async (c) => {
	const auth = c.get('auth');
	const svc = getService(c);
	const db = getDb(c);

	// Get existing webhook directly by ID
	const existing = await svc.getById(c.req.param('id'));
	if (!existing) {
		return fail(c, 'Webhook not found', 404);
	}

	// Non-admin: check write permission
	if (!auth.is_admin) {
		const hasWrite = await PermissionEvaluator.checkBusiness(db, auth, existing.collection_slug, 'write');
		if (!hasWrite) {
			return fail(c, `No write permission on "${existing.collection_slug}"`, 403, 'FORBIDDEN');
		}
	}

	await svc.delete(c.req.param('id'));
	return success(c, { deleted: true });
});

export { app as webhookRoutes };
