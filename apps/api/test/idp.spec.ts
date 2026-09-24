/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * IDP domain-module (/api/idp) — the Studio's operate + govern surface.
 *
 * The test env (wrangler.testco.jsonc) ships `DOMAIN_MODULES=hr,idp,mro`, so
 * these routes are live here exactly as they are in production (env.prod now
 * also includes `idp`). Scenarios follow the real governance path:
 *
 *   reads     — catalog / scorecard / templates / usage are authenticated reads
 *   RBAC      — promotion + generic transitions are admin-only (a viewer 403s)
 *   lifecycle — record a deployment, promote draft→review→promoted→live, and
 *               assert the append-only audit history
 *   lineage   — reaching `live` captures the module manifest
 *   errors    — a missing deployment is a 404, not a 500
 */

const BASE_URL = 'http://localhost';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface Envelope {
	success?: boolean;
	error?: string;
	code?: string;
	data?: unknown;
}

async function call(path: string, init: RequestInit = {}, token = 'dev-token'): Promise<{ status: number; body: Envelope }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
	});
	return { status: res.status, body: ((await res.json().catch(() => null)) ?? {}) as Envelope };
}

describe('IDP module (/api/idp)', () => {
	let moduleId = '';
	let environmentId = '';
	let deploymentId = '';
	let viewerToken = '';

	beforeAll(async () => {
		// A REAL module to deploy — the catalog and the live manifest both read
		// the system `_modules` table, so a fabricated id would fail at `live`.
		const moduleRes = await call('/api/modules', {
			method: 'POST',
			body: JSON.stringify({ name: 'IDP Test App', slug: 'idp_test_app' }),
		});
		expect(moduleRes.status).toBe(201);
		moduleId = String((moduleRes.body.data as { id: string }).id);

		// A deploy target.
		const envRes = await call('/api/idp/environments', {
			method: 'POST',
			body: JSON.stringify({ name: 'Production', slug: 'prod', kind: 'prod' }),
		});
		expect(envRes.status).toBe(201);
		environmentId = String((envRes.body.data as { id: string }).id);

		// A non-admin session, to prove governance writes are admin-gated.
		const userRes = await call('/api/users', {
			method: 'POST',
			body: JSON.stringify({ email: 'idp-viewer@test.local', password: 'viewer-pass', full_name: 'IDP Viewer' }),
		});
		expect(userRes.status).toBe(201);
		const login = await SELF.fetch(`${BASE_URL}/api/auth/login`, {
			method: 'POST',
			headers: JSON_HEADERS,
			body: JSON.stringify({ email: 'idp-viewer@test.local', password: 'viewer-pass' }),
		});
		expect(login.status).toBe(200);
		const loginBody = (await login.json()) as Envelope;
		viewerToken = String((loginBody.data as { token: string }).token);
	});

	it('rejects unauthenticated access', async () => {
		const res = await SELF.fetch(`${BASE_URL}/api/idp/catalog`);
		expect(res.status).toBe(401);
	});

	it('serves the catalog, scorecard, templates and usage to an authenticated caller', async () => {
		const catalog = await call('/api/idp/catalog');
		expect(catalog.status).toBe(200);
		expect(Array.isArray(catalog.body.data)).toBe(true);

		const scorecard = await call('/api/idp/scorecard');
		expect(scorecard.status).toBe(200);
		expect(scorecard.body.data).toHaveProperty('total');
		expect(scorecard.body.data).toHaveProperty('owned_and_live');

		const templates = await call('/api/idp/templates');
		expect(templates.status).toBe(200);
		expect(Array.isArray(templates.body.data)).toBe(true);

		const usage = await call('/api/idp/usage?days=30');
		expect(usage.status).toBe(200);
		expect(usage.body.data).toHaveProperty('totals');
	});

	it('records a deployment and surfaces it in the deployments list', async () => {
		const created = await call('/api/idp/deployments', {
			method: 'POST',
			body: JSON.stringify({ module_id: moduleId, environment_id: environmentId, version: '1.0.0' }),
		});
		expect(created.status).toBe(201);
		deploymentId = String((created.body.data as { id: string }).id);

		const list = await call('/api/idp/deployments');
		expect(list.status).toBe(200);
		const rows = list.body.data as Array<{ id: string; status: string }>;
		expect(rows.some((d) => d.id === deploymentId)).toBe(true);
		expect(rows.find((d) => d.id === deploymentId)?.status).toBe('draft');
	});

	it('forbids a non-admin from promoting, transitioning, or creating environments', async () => {
		const promote = await call(`/api/idp/deployments/${deploymentId}/promote`, { method: 'POST' }, viewerToken);
		expect(promote.status).toBe(403);
		expect(promote.body.code).toBe('FORBIDDEN');

		const transition = await call(
			`/api/idp/deployments/${deploymentId}/transition`,
			{ method: 'POST', body: JSON.stringify({ to_state: 'review' }) },
			viewerToken,
		);
		expect(transition.status).toBe(403);

		const createEnv = await call(
			'/api/idp/environments',
			{ method: 'POST', body: JSON.stringify({ name: 'Staging', slug: 'staging', kind: 'staging' }) },
			viewerToken,
		);
		expect(createEnv.status).toBe(403);
	});

	it('promotes draft → review → promoted → live and appends an audit history', async () => {
		const steps = ['review', 'promoted', 'live'];
		for (const expected of steps) {
			const res = await call(`/api/idp/deployments/${deploymentId}/promote`, { method: 'POST' });
			expect(res.status).toBe(200);
			expect((res.body.data as { state: string }).state).toBe(expected);
		}

		// The final transition captured the module manifest (data lineage).
		const list = await call('/api/idp/deployments');
		const row = (list.body.data as Array<{ id: string; status: string; manifest_json: string | null }>).find((d) => d.id === deploymentId);
		expect(row?.status).toBe('live');
		expect(row?.manifest_json).toBeTruthy();

		// Every step is audited (append-only workflow history).
		const history = await call(`/api/idp/deployments/${deploymentId}/history`);
		expect(history.status).toBe(200);
		expect((history.body.data as unknown[]).length).toBeGreaterThanOrEqual(3);
	});

	it('treats promotion at a terminal state as an idempotent no-op', async () => {
		const res = await call(`/api/idp/deployments/${deploymentId}/promote`, { method: 'POST' });
		expect(res.status).toBe(200);
		const data = res.body.data as { state: string; terminal: boolean };
		expect(data.state).toBe('live');
		expect(data.terminal).toBe(true);
	});

	it('returns 404 (not 500) for a missing deployment', async () => {
		const plan = await call('/api/idp/deployments/does-not-exist/plan', { method: 'POST' });
		expect(plan.status).toBe(404);
		expect(plan.body.code).toBe('NOT_FOUND');

		const promote = await call('/api/idp/deployments/does-not-exist/promote', { method: 'POST' });
		expect(promote.status).toBe(404);
	});

	it('refuses to fabricate an empty-field snapshot from a corrupt collection schema', async () => {
		// The "current state" side of the plan diff is built from `_entity_schemas`. A
		// malformed `schema_json` must fail LOUDLY: cleaning it to `[]` would make the
		// differ report EVERY field as removed — a confident lie that, on the apply
		// path, is what decides the breaking-change gate. The error must also NAME the
		// collection, or the corrupt row stays invisible.
		const slug = 'idp_snapshot_probe';
		const created = await call('/api/collections', {
			method: 'POST',
			body: JSON.stringify({ name: 'IDP Snapshot Probe', slug, fields: [{ name: 'title', type: 'text', required: false }] }),
		});
		expect(created.status).toBe(201);
		const collectionId = String((created.body.data as { id: string }).id);

		// A deployment whose PINNED snapshot is well-formed, so `plan` gets past the
		// snapshot parse and reaches the live-state build under test.
		const dep = await call('/api/idp/deployments', {
			method: 'POST',
			body: JSON.stringify({
				module_id: moduleId,
				environment_id: environmentId,
				version: '9.9.9',
				snapshot_json: JSON.stringify({
					version: '9.9.9',
					timestamp: new Date().toISOString(),
					checksum: '',
					collections: [],
					roles: [],
					permissions: [],
					webhooks: [],
					plugins: [],
				}),
			}),
		});
		expect(dep.status).toBe(201);
		const probeDeployment = String((dep.body.data as { id: string }).id);

		// Baseline — with every stored schema readable, the plan succeeds.
		expect((await call(`/api/idp/deployments/${probeDeployment}/plan`, { method: 'POST' })).status).toBe(200);

		// Corrupt ONE stored schema, exactly as a bad import/migration would.
		await env.DB.prepare('UPDATE _entity_schemas SET schema_json = ? WHERE id = ?').bind('{ not json', collectionId).run();

		const plan = await call(`/api/idp/deployments/${probeDeployment}/plan`, { method: 'POST' });
		expect(plan.status).toBe(500);
		expect(String(plan.body.error), 'the error names the corrupt collection').toContain(slug);
		// It must NOT have produced a diff claiming every field vanished.
		expect(plan.body.data).toBeUndefined();

		// Restore, so the corrupt row cannot leak into another test.
		await env.DB.prepare('UPDATE _entity_schemas SET schema_json = ? WHERE id = ?')
			.bind(JSON.stringify({ fields: [{ name: 'title', type: 'text' }] }), collectionId)
			.run();
		expect((await call(`/api/idp/deployments/${probeDeployment}/plan`, { method: 'POST' })).status).toBe(200);
	});

	it('gates the IDP read surfaces on a grant — deny-by-default, per collection, never a write', async () => {
		// The IDP read routes are gated with `canRead(<collection>)`, i.e. the same
		// `PermissionEvaluator.checkBusiness` every entity route uses. Nothing is seeded,
		// so a role without a grant sees nothing — this pins that the gate is real
		// (rather than an accident of the admin bypass) and that a grant opens EXACTLY
		// the collection it names, with governance writes still admin-only.
		const uniq = crypto.randomUUID();
		const roleId = await call('/api/users/roles', {
			method: 'POST',
			body: JSON.stringify({ name: `idp-reader-${uniq}`, description: 'test' }),
		}).then((r) => {
			expect(r.status).toBe(201);
			return String((r.body.data as { id: string }).id);
		});

		const email = `idp-reader-${uniq}@test.local`;
		const created = await call('/api/users', {
			method: 'POST',
			body: JSON.stringify({ email, password: 'idp-reader-pass', full_name: 'IDP Reader', role_id: roleId }),
		});
		expect(created.status).toBe(201);

		const login = await SELF.fetch(`${BASE_URL}/api/auth/login`, {
			method: 'POST',
			headers: JSON_HEADERS,
			body: JSON.stringify({ email, password: 'idp-reader-pass' }),
		});
		expect(login.status).toBe(200);
		const loginBody = (await login.json()) as Envelope;
		const readerToken = String((loginBody.data as { token: string }).token);

		// Deny-by-default — the role carries no grant on `idp_deployment`.
		const denied = await call('/api/idp/deployments', {}, readerToken);
		expect(denied.status).toBe(403);
		expect(denied.body.code).toBe('FORBIDDEN');

		// Grant read on the ONE collection that route needs, through the real admin path.
		const grant = await call('/api/users/permissions', {
			method: 'POST',
			body: JSON.stringify({ role_id: roleId, collection_slug: 'idp_deployment', can_read: true }),
		});
		expect(grant.status).toBe(201);

		// Exactly that route opens…
		expect((await call('/api/idp/deployments', {}, readerToken)).status).toBe(200);
		// …and a route needing a DIFFERENT collection stays denied (grants do not leak).
		expect((await call('/api/idp/ownership', {}, readerToken)).status).toBe(403);
		// Governance writes are admin-only regardless of the read grant.
		expect((await call(`/api/idp/deployments/${deploymentId}/promote`, { method: 'POST' }, readerToken)).status).toBe(403);
	});

	it('reflects an ownership assignment in the catalog', async () => {
		const ownerId = 'user-idp-owner';
		const assigned = await call('/api/idp/ownership', {
			method: 'POST',
			body: JSON.stringify({ module_id: moduleId, owner_id: ownerId, role: 'owner' }),
		});
		expect(assigned.status).toBe(201);

		const catalog = await call('/api/idp/catalog');
		const entry = (catalog.body.data as Array<{ id: string; owner: string | null; owner_role: string | null }>).find(
			(c) => c.id === moduleId,
		);
		expect(entry?.owner).toBe(ownerId);
		expect(entry?.owner_role).toBe('owner');
	});
});
