/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * IDP governance — audit trail, policy-as-data scorecard, and the workflow
 * SSOT guarantee on the GitOps apply path.
 *
 * Pins the three Phase-1/2 additions:
 *   audit     — every governance write appends exactly one `idp_audit` row
 *   policies  — per-module rule violations + summary, deny-by-default read gate
 *   SSOT      — `apply` moves `_workflow_states` AND `status` together (the
 *               dual-writer drift where `status='live'` while the workflow
 *               still read `draft` can no longer happen)
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

/** A minimal, well-formed snapshot that creates nothing — applied with force. */
function emptySnapshot(version: string): string {
	return JSON.stringify({
		version,
		timestamp: new Date().toISOString(),
		checksum: '',
		collections: [],
		roles: [],
		permissions: [],
		webhooks: [],
		plugins: [],
	});
}

describe('IDP governance (/api/idp)', () => {
	let moduleId = '';
	let environmentId = '';
	let deploymentId = '';

	beforeAll(async () => {
		const moduleRes = await call('/api/modules', {
			method: 'POST',
			body: JSON.stringify({ name: 'IDP Gov App', slug: 'idp_gov_app' }),
		});
		expect(moduleRes.status).toBe(201);
		moduleId = String((moduleRes.body.data as { id: string }).id);

		const envRes = await call('/api/idp/environments', {
			method: 'POST',
			body: JSON.stringify({ name: 'Governance Prod', slug: 'gov-prod', kind: 'prod' }),
		});
		expect(envRes.status).toBe(201);
		environmentId = String((envRes.body.data as { id: string }).id);

		const depRes = await call('/api/idp/deployments', {
			method: 'POST',
			body: JSON.stringify({
				module_id: moduleId,
				environment_id: environmentId,
				version: '1.0.0',
				snapshot_json: emptySnapshot('1.0.0'),
			}),
		});
		expect(depRes.status).toBe(201);
		deploymentId = String((depRes.body.data as { id: string }).id);
	});

	it('records an audit row for every governance write, newest first', async () => {
		// The env + deployment were created in beforeAll — both must be audited.
		const audit = await call('/api/idp/audit');
		expect(audit.status).toBe(200);
		const rows = audit.body.data as Array<{ action: string; entity: string; entity_id: string; actor_email: string | null }>;
		expect(Array.isArray(rows)).toBe(true);

		const envRow = rows.find((r) => r.action === 'environment.create' && r.entity_id === environmentId);
		expect(envRow, 'the environment create was audited').toBeTruthy();
		expect(envRow?.entity).toBe('idp_environment');

		const depRow = rows.find((r) => r.action === 'deployment.create' && r.entity_id === deploymentId);
		expect(depRow, 'the deployment create was audited').toBeTruthy();
		expect(depRow?.entity).toBe('idp_deployment');
	});

	it('evaluates the policy scorecard and flags an unowned, never-live module', async () => {
		const res = await call('/api/idp/policies');
		expect(res.status).toBe(200);
		const data = res.body.data as {
			rules: Array<{ id: string }>;
			modules: Array<{ id: string; status: string; violations: string[] }>;
			summary: { total: number; rules: Array<{ id: string; pass_pct: number }> };
		};
		expect(data.rules.map((r) => r.id)).toEqual(['has_owner', 'live_deployment', 'multi_env', 'release_record', 'golden_path']);
		const entry = data.modules.find((m) => m.id === moduleId);
		expect(entry, 'the test module is in the policy report').toBeTruthy();
		expect(entry?.status).toBe('fail');
		expect(entry?.violations).toContain('has_owner');
		expect(entry?.violations).toContain('live_deployment');
		// A module with no live deployment also cannot satisfy multi_env.
		expect(entry?.violations).toContain('multi_env');
		expect(data.summary.total).toBeGreaterThanOrEqual(1);
		expect(data.summary.rules.some((r) => r.id === 'has_owner')).toBe(true);
	});

	it('keeps _workflow_states and status in lock-step on apply (SSOT)', async () => {
		// Force past the breaking-change gate (an empty snapshot removes every
		// live collection). The apply must move BOTH the workflow side table and
		// the denormalized `status` column — the drift this path used to cause.
		const applied = await call(`/api/idp/deployments/${deploymentId}/apply`, {
			method: 'POST',
			body: JSON.stringify({ force: true }),
		});
		expect(applied.status).toBe(200);
		expect((applied.body.data as { applied: boolean }).applied).toBe(true);

		// The denormalized column the catalog reads.
		const list = await call('/api/idp/deployments');
		const row = (list.body.data as Array<{ id: string; status: string; manifest_json: string | null }>).find((d) => d.id === deploymentId);
		expect(row?.status).toBe('live');
		expect(row?.manifest_json).toBeTruthy();

		// The authoritative workflow side table must agree — no invisible drift.
		const state = await env.DB.prepare('SELECT state FROM _workflow_states WHERE collection_slug = ? AND document_id = ?')
			.bind('idp_deployment', deploymentId)
			.first<{ state: string }>();
		expect(state?.state, 'the workflow side table moved with the column').toBe('live');

		// And the apply itself was audited (not the idempotent no-op).
		const audit = await call('/api/idp/audit');
		const rows = audit.body.data as Array<{ action: string; entity_id: string }>;
		expect(rows.some((r) => r.action === 'deployment.apply' && r.entity_id === deploymentId)).toBe(true);
	});

	it('reflects the applied state in the policy report', async () => {
		const res = await call('/api/idp/policies');
		const data = res.body.data as { modules: Array<{ id: string; violations: string[] }> };
		const entry = data.modules.find((m) => m.id === moduleId)!;
		expect(entry.violations).not.toContain('live_deployment');
		expect(entry.violations).not.toContain('release_record');
		// Still no owner and not from a template.
		expect(entry.violations).toContain('has_owner');
	});

	it('denies the audit read to a caller with no grant on idp_audit', async () => {
		const uniq = crypto.randomUUID();
		const roleId = await call('/api/users/roles', {
			method: 'POST',
			body: JSON.stringify({ name: `idp-gov-${uniq}`, description: 'test' }),
		}).then((r) => String((r.body.data as { id: string }).id));
		const email = `idp-gov-${uniq}@test.local`;
		await call('/api/users', {
			method: 'POST',
			body: JSON.stringify({ email, password: 'gov-pass', full_name: 'Gov', role_id: roleId }),
		});
		const login = await SELF.fetch(`${BASE_URL}/api/auth/login`, {
			method: 'POST',
			headers: JSON_HEADERS,
			body: JSON.stringify({ email, password: 'gov-pass' }),
		});
		expect(login.status).toBe(200);
		const loginBody = (await login.json()) as Envelope;
		const readerToken = String((loginBody.data as { token: string }).token);

		const denied = await call('/api/idp/audit', {}, readerToken);
		expect(denied.status).toBe(403);
		expect(denied.body.code).toBe('FORBIDDEN');
	});
});
