/**
 * IDP Routes — /api/idp
 *
 * The Internal Developer Platform surface. Read-oriented catalog for portal
 * consumers; admin-gated CRUD for environments / deployments / ownership.
 * Mirrors the hr/store domain-module pattern (Hono + requireAuth + success/fail).
 *
 *   GET  /api/idp/catalog            → catalog over _modules + ownership + deployments (read: idp_ownership, idp_deployment)
 *   GET  /api/idp/environments       → list environments (read: idp_environment)
 *   POST /api/idp/environments       → create environment (admin)
 *   PUT  /api/idp/environments/:id   → update environment (admin)
 *   DELETE /api/idp/environments/:id → delete environment (admin)
 *   GET  /api/idp/deployments        → list deployments (read: idp_deployment)
 *   POST /api/idp/deployments        → record a deployment (admin)
 *   POST /api/idp/deployments/:id/plan      → diff snapshot vs live DB (admin)
 *   POST /api/idp/deployments/:id/apply     → idempotent, gated migration (admin)
 *   POST /api/idp/deployments/:id/rollback  → re-apply previous live snapshot (admin)
 *   GET  /api/idp/ownership          → list ownership (read: idp_ownership)
 *   POST /api/idp/ownership          → assign ownership (admin)
 */

import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { requireAuth } from '@/routes/auth';
import { requireAdmin, requireCollectionRead } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';
import type { AuthContext } from '@mmbix/types';
import { SmartCollectionService } from '@/lib/services/smart-collection.service';
import { IdpError, IdpService } from './service';

type IdpBindings = {
	Bindings: { DB: D1Database; [key: string]: unknown };
	Variables: { auth: AuthContext };
};

const app = new Hono<IdpBindings>();
app.use('*', requireAuth);

/**
 * Every IDP route depends on its four `idp_*` entity collections existing.
 * Provision them here (idempotent + memoized once per isolate in `IdpService`)
 * rather than only on the catalog reads — otherwise the FIRST writer (create
 * environment / deployment / ownership) would hit a missing table and 500.
 */
app.use('*', async (c, next) => {
	await getService(c).ensureCollections();
	await next();
});

function getService(c: Context<IdpBindings>): IdpService {
	return new IdpService(new D1Client(c.env.DB));
}

function getSmart(c: Context<IdpBindings>): SmartCollectionService {
	return new SmartCollectionService(new D1Client(c.env.DB), c.get('auth'));
}

/**
 * Map a service failure to its canonical HTTP status. `IdpError` carries its own
 * status (404 for a missing deployment, 409 for a blocked/duplicate migration);
 * anything else falls back to the caller's status so unexpected faults stay 500.
 */
function idpFail(c: Context<IdpBindings>, err: unknown, fallback: number): Response {
	const status = err instanceof IdpError ? err.status : fallback;
	return fail(c, err instanceof Error ? err.message : 'IDP request failed', status);
}

// ─── Field whitelists ─────────────────────────────────────

/**
 * The CLIENT-settable fields of each IDP collection (declared in `./collections`).
 * Explicit rather than a `...body` spread because the engine writes every key it
 * is handed: a spread let a caller set ANY declared column — `idp_deployment`
 * `status` and `manifest_json` included, i.e. the workflow-mirrored state and the
 * release's record of truth — while any undeclared key was silently parked in
 * `_meta`. A whitelist also makes the exposed surface readable from the route.
 */
const ENVIRONMENT_FIELDS = ['name', 'slug', 'kind', 'url', 'is_default', 'git_ref'] as const;
const DEPLOYMENT_CREATE_FIELDS = ['module_id', 'environment_id', 'version', 'git_ref', 'snapshot_json'] as const;
const OWNERSHIP_FIELDS = ['module_id', 'owner_type', 'owner_id', 'role'] as const;

/**
 * Whitelist a request body down to `allowed`, preserving PARTIAL-update
 * semantics: a key the caller did not send is not added. (Filling defaults into
 * a PUT would null columns the caller never mentioned — `name`/`slug` are NOT
 * NULL, so a one-field edit would fail on the fields it never touched.)
 */
function pick(body: Record<string, unknown>, allowed: readonly string[]): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of allowed) if (key in body) out[key] = body[key];
	return out;
}

/**
 * Per-collection business gate for the IDP reads. `IdpService` reads the `idp_*`
 * tables through raw `db.all`, so it never passes the entity engine's RBAC —
 * without a guard ANY authenticated session sees every ownership row and
 * deployment. `requireCollectionRead` is the same check the generic entity route
 * applies (`PermissionEvaluator.checkBusiness(..., 'read')`, admin bypass
 * included); one call per collection the payload is assembled from.
 */
const canRead = (slug: string) => requireCollectionRead(() => slug);

// ─── Catalog ──────────────────────────────────────────────

/** Live catalog — every module with owner + per-environment deployments. */
app.get('/catalog', canRead('idp_ownership'), canRead('idp_deployment'), async (c: Context<IdpBindings>) => {
	try {
		const svc = getService(c);
		await svc.ensureCollections();
		return success(c, await svc.catalog());
	} catch (err) {
		return idpFail(c, err, 500);
	}
});

// ─── Environments ─────────────────────────────────────────

app.get('/environments', canRead('idp_environment'), async (c: Context<IdpBindings>) => {
	try {
		const svc = getSmart(c);
		await svc.ensureMigrations();
		const url = new URL(`http://internal/idp_environment?limit=100&sort=name`);
		const result = await svc.listItems('idp_environment', url);
		return success(c, result.data);
	} catch (err) {
		return idpFail(c, err, 500);
	}
});

app.post('/environments', requireAdmin, async (c: Context<IdpBindings>) => {
	try {
		const svc = getSmart(c);
		await svc.ensureMigrations();
		const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
		if (!body || !body.name || !body.slug) return fail(c, 'name and slug are required', 422);
		const item = await svc.createItem('idp_environment', pick(body, ENVIRONMENT_FIELDS));
		return success(c, item, 201);
	} catch (err) {
		return idpFail(c, err, 500);
	}
});

app.put('/environments/:id', requireAdmin, async (c: Context<IdpBindings>) => {
	try {
		const id = c.req.param('id');
		if (!id) return fail(c, 'Environment id is required', 422);
		const svc = getSmart(c);
		await svc.ensureMigrations();
		const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
		const item = await svc.updateItem('idp_environment', id, pick(body ?? {}, ENVIRONMENT_FIELDS));
		return success(c, item);
	} catch (err) {
		return idpFail(c, err, 500);
	}
});

app.delete('/environments/:id', requireAdmin, async (c: Context<IdpBindings>) => {
	try {
		const id = c.req.param('id');
		if (!id) return fail(c, 'Environment id is required', 422);
		const svc = getSmart(c);
		await svc.ensureMigrations();
		await svc.softDeleteItem('idp_environment', id);
		return success(c, { deleted: true });
	} catch (err) {
		return idpFail(c, err, 500);
	}
});

// ─── Deployments ──────────────────────────────────────────

app.get('/deployments', canRead('idp_deployment'), async (c: Context<IdpBindings>) => {
	try {
		const svc = getSmart(c);
		await svc.ensureMigrations();
		const url = new URL(`http://internal/idp_deployment?limit=100&sort=-deployed_at`);
		const result = await svc.listItems('idp_deployment', url);
		return success(c, result.data);
	} catch (err) {
		return idpFail(c, err, 500);
	}
});

app.post('/deployments', requireAdmin, async (c: Context<IdpBindings>) => {
	try {
		const svc = getSmart(c);
		await svc.ensureMigrations();
		const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
		if (!body || !body.module_id || !body.environment_id) return fail(c, 'module_id and environment_id are required', 422);
		const auth = c.get('auth');
		// Provenance is SERVER-OWNED, never read from the body: `deployed_at` orders
		// the catalog AND selects the snapshot a rollback restores, so a caller-
		// supplied value could backdate a release or point a rollback at a different
		// snapshot, and `deployed_by` is the non-repudiation record of who shipped it.
		// `status` is not client-settable either — it mirrors `_workflow_states`,
		// which only promote/apply advance — so a deployment is always filed as the
		// workflow's initial state.
		const item = await svc.createItem('idp_deployment', {
			...pick(body, DEPLOYMENT_CREATE_FIELDS),
			status: 'draft',
			deployed_by: auth.email ?? null,
			deployed_at: new Date().toISOString(),
		});
		return success(c, item, 201);
	} catch (err) {
		return idpFail(c, err, 500);
	}
});

// ─── Phase 5: GitOps deploy (plan / apply / rollback) ──

/** Plan — diff the deployment's pinned snapshot against the live DB (read-only). */
// ADMIN, not a collection read: the payload IS the live schema (every collection,
// plus roles/webhooks), so `canRead('idp_deployment')` would leak the whole live
// schema to anyone holding read on one collection — and `apply`/`rollback`, the
// rest of the same GitOps step, are admin too.
app.post('/deployments/:id/plan', requireAdmin, async (c: Context<IdpBindings>) => {
	try {
		const id = c.req.param('id');
		if (!id) return fail(c, 'Deployment id is required', 422);
		return success(c, await getService(c).planDeployment(id));
	} catch (err) {
		return idpFail(c, err, 500);
	}
});

/** Apply — idempotent, gated migration of the deployment's snapshot to the DB. */
app.post('/deployments/:id/apply', requireAdmin, async (c: Context<IdpBindings>) => {
	try {
		const id = c.req.param('id');
		if (!id) return fail(c, 'Deployment id is required', 422);
		const body = (await c.req.json().catch(() => null)) as { force?: boolean } | null;
		return success(c, await getService(c).applyDeployment(id, c.get('auth'), body?.force === true));
	} catch (err) {
		return idpFail(c, err, 409);
	}
});

/** Rollback — re-apply the previous live snapshot for the same module+env. */
app.post('/deployments/:id/rollback', requireAdmin, async (c: Context<IdpBindings>) => {
	try {
		const id = c.req.param('id');
		if (!id) return fail(c, 'Deployment id is required', 422);
		return success(c, await getService(c).rollbackDeployment(id, c.get('auth')));
	} catch (err) {
		return idpFail(c, err, 409);
	}
});

// ─── Phase 3: Operate wiring — workflow + promote + audit ──

/** Generic workflow transition (submit / approve / reject / rollback). */
app.post('/deployments/:id/transition', requireAdmin, async (c: Context<IdpBindings>) => {
	try {
		const id = c.req.param('id');
		if (!id) return fail(c, 'Deployment id is required', 422);
		const body = (await c.req.json().catch(() => null)) as { to_state?: string } | null;
		if (!body?.to_state) return fail(c, 'to_state is required', 422);
		const result = await getService(c).transition(id, body.to_state, c.get('auth'));
		return success(c, result);
	} catch (err) {
		return idpFail(c, err, 409);
	}
});

/** Advance one step through the promotion chain; captures manifest + event at live. */
app.post('/deployments/:id/promote', requireAdmin, async (c: Context<IdpBindings>) => {
	try {
		const id = c.req.param('id');
		if (!id) return fail(c, 'Deployment id is required', 422);
		const result = await getService(c).promote(id, c.get('auth'));
		return success(c, result);
	} catch (err) {
		return idpFail(c, err, 409);
	}
});

/** Append-only audit trail for a deployment. */
app.get('/deployments/:id/history', canRead('idp_deployment'), async (c: Context<IdpBindings>) => {
	try {
		const id = c.req.param('id');
		if (!id) return fail(c, 'Deployment id is required', 422);
		return success(c, await getService(c).deploymentHistory(id));
	} catch (err) {
		return idpFail(c, err, 500);
	}
});

// ─── Phase 4: Govern + create ──────────────────────────────

/** Governance scorecard — MECE coverage metrics over the live catalog. */
// Assembled from ownership + deployments (over `_modules`, which is system data),
// the same two collections `/catalog` reads — so it takes the same two gates.
app.get('/scorecard', canRead('idp_ownership'), canRead('idp_deployment'), async (c: Context<IdpBindings>) => {
	try {
		const svc = getService(c);
		await svc.ensureCollections();
		return success(c, await svc.scorecard());
	} catch (err) {
		return idpFail(c, err, 500);
	}
});

/** Golden-path templates from the shared registry. */
app.get('/templates', async (c: Context<IdpBindings>) => {
	try {
		return success(c, await getService(c).listTemplates());
	} catch (err) {
		return idpFail(c, err, 500);
	}
});

/** Scaffold a module from a golden-path template (admin). */
app.post('/templates/:name/scaffold', requireAdmin, async (c: Context<IdpBindings>) => {
	try {
		const name = c.req.param('name');
		if (!name) return fail(c, 'Template name is required', 422);
		const body = (await c.req.json().catch(() => null)) as { name?: string; slug?: string; icon?: string } | null;
		const result = await getService(c).scaffoldModule(name, body ?? {}, c.get('auth'));
		return success(c, result, 201);
	} catch (err) {
		return idpFail(c, err, 500);
	}
});

/** Software-factory usage — activity series + totals + template adoption. */
app.get('/usage', canRead('idp_deployment'), canRead('idp_ownership'), canRead('idp_template_usage'), async (c: Context<IdpBindings>) => {
	try {
		const svc = getService(c);
		await svc.ensureCollections();
		const days = Math.min(Math.max(Number(c.req.query('days') ?? 30) || 30, 1), 365);
		return success(c, await svc.usage(days));
	} catch (err) {
		return idpFail(c, err, 500);
	}
});

// ─── Ownership ────────────────────────────────────────────

app.get('/ownership', canRead('idp_ownership'), async (c: Context<IdpBindings>) => {
	try {
		const svc = getSmart(c);
		await svc.ensureMigrations();
		const url = new URL(`http://internal/idp_ownership?limit=100&sort=module_id`);
		const result = await svc.listItems('idp_ownership', url);
		return success(c, result.data);
	} catch (err) {
		return idpFail(c, err, 500);
	}
});

app.post('/ownership', requireAdmin, async (c: Context<IdpBindings>) => {
	try {
		const svc = getSmart(c);
		await svc.ensureMigrations();
		const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
		if (!body || !body.module_id || !body.owner_id) return fail(c, 'module_id and owner_id are required', 422);
		const item = await svc.createItem('idp_ownership', {
			...pick(body, OWNERSHIP_FIELDS),
			owner_type: body.owner_type ?? 'user',
			role: body.role ?? 'viewer',
		});
		return success(c, item, 201);
	} catch (err) {
		return idpFail(c, err, 500);
	}
});

export const idpRoutes = app;
