/**
 * Operations & Self-Tuning Telemetry — /api/operations
 *
 * Read-only admin observability for the headless engine's self-managed layers.
 *
 *   GET /api/operations/index-advisor — snapshot the self-tuning index advisor:
 *     - current mode (auto → applies DDL; propose → recommends only)
 *     - journal (every composite index the engine auto-created / proposed)
 *     - hot candidates (currently-observed multi-column shapes: filter columns
 *       plus the trailing ORDER BY column)
 *
 * This is telemetry, not a data endpoint — admin-only, never exposes row data.
 */

import { Hono } from 'hono';
import { getIndexAdvisor } from '@mmbix/core';
import { requireAuth } from './auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success } from '@/lib/api/response';
import type { AuthContext } from '@/lib/services/auth.service';

type OpsBindings = {
	Bindings: { DB: D1Database; [key: string]: unknown };
	Variables: { auth: AuthContext };
};

const app = new Hono<OpsBindings>();
app.use('*', requireAuth, requireAdmin);

app.get('/index-advisor', (c) => {
	return success(c, getIndexAdvisor().report());
});

export const operationsRoutes = app;
