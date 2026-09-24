/**
 * Scheduled Jobs Routes — with RBAC
 *
 * GET    /api/scheduler          → List all jobs (auth required)
 * POST   /api/scheduler          → Create a job (admin only)
 * PUT    /api/scheduler/:id      → Update a job (admin only)
 * DELETE /api/scheduler/:id      → Delete a job (admin only)
 * POST   /api/scheduler/run      → Run all due jobs (admin only)
 */

import { Hono, type Context } from 'hono';
import { D1Client, MigrationRunner } from '@mmbix/core';
import { ScheduledJobService } from '@/lib/services/scheduler.service';
import { requireAuth } from './auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';

const app = new Hono<{
	Bindings: { DB: D1Database; ADMIN_PASSWORD: string };
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
}>();
app.use('*', requireAuth);

// Ensure system tables exist (idempotent — runs pending migrations once)
app.use('*', async (c, next) => {
	await new MigrationRunner(new D1Client(c.env.DB)).runPending();
	await next();
});

const svc = (c: Context) => new ScheduledJobService(new D1Client(c.env.DB));

app.get('/', requireAdmin, async (c) => success(c, await svc(c).list()));
app.post('/', requireAdmin, async (c) => {
	const body = (await c.req.json()) as { name?: string; cron?: string; action?: string };
	if (!body.name?.trim()) return fail(c, 'name is required', 400);
	if (!body.cron?.trim()) return fail(c, 'cron expression is required', 400);
	if (!body.action?.trim()) return fail(c, 'action is required (cleanup | report | notify | sync)', 400);
	return success(c, await svc(c).create(body), 201);
});
app.put('/:id', requireAdmin, async (c) => success(c, await svc(c).update(c.req.param('id'), await c.req.json())));
app.delete('/:id', requireAdmin, async (c) => {
	await svc(c).delete(c.req.param('id'));
	return success(c, { deleted: true });
});
app.post('/run', requireAdmin, async (c) => success(c, await svc(c).runDueJobs()));

export { app as schedulerRoutes };
