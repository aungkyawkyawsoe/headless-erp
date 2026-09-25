/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '@/lib/services/api-key.service';

/**
 * MCP factory control plane:
 *   - capability registry discovery (tools + resources),
 *   - `plan_manifest` never writes,
 *   - `apply_manifest` is the only write and is idempotent,
 *   - a read-scoped key may plan but never apply,
 *   - `query` reads back what was built.
 */

const BASE_URL = 'http://localhost';
const AUTH = { Authorization: 'Bearer dev-token' };
const AUTH_JSON = { 'Content-Type': 'application/json', ...AUTH };

interface Rpc<T> {
	status: number;
	body: { result?: T; error?: { code: number; message: string } };
}
async function rpc<T>(method: string, params?: Record<string, unknown>, headers: Record<string, string> = AUTH_JSON): Promise<Rpc<T>> {
	const res = await SELF.fetch(`${BASE_URL}/api/mcp`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	});
	return { status: res.status, body: (await res.json().catch(() => ({}))) as Rpc<T>['body'] };
}

const MANIFEST = {
	version: 1,
	collections: [
		{
			slug: 'man_orders',
			name: 'Man Orders',
			fields: [
				{ name: 'code', type: 'text', required: true },
				{ name: 'total', type: 'currency' },
			],
		},
	],
	pages: [{ path: '/man', title: 'Man', blocks: [{ id: 'row', type: 'row', layout: { order: 0 }, config: {}, children: [] }] }],
};

interface Plan {
	actions: Array<{ kind: string; target: string }>;
	summary: { create: number; update: number; skip: number };
}
async function tool<T = { content: Array<{ text: string }> }>(name: string, args: Record<string, unknown>, headers = AUTH_JSON) {
	return rpc<T>('tools/call', { name, arguments: args }, headers);
}
function payload<T>(res: Rpc<{ content: Array<{ text: string }> }>): T {
	return JSON.parse(res.body.result!.content[0].text) as T;
}

describe('MCP factory control plane', () => {
	it('discovers capabilities via search + resources', async () => {
		const search = await tool('search_capabilities', { available_only: true });
		const { capabilities } = payload<{ capabilities: Array<{ id: string; class: string }> }>(search);
		expect(capabilities.some((c) => c.id === 'schema.manifest.apply')).toBe(true);
		expect(capabilities.every((c) => c.class !== undefined)).toBe(true);

		const list = await rpc<{ resources: Array<{ uri: string }> }>('resources/list');
		expect(list.body.result!.resources.map((r) => r.uri)).toContain('factory://capabilities');
		const read = await rpc<{ contents: Array<{ text: string }> }>('resources/read', { uri: 'factory://capabilities' });
		expect(JSON.parse(read.body.result!.contents[0].text).length).toBeGreaterThan(5);

		const desc = await tool('describe_capability', { id: 'data.query' });
		expect(payload<{ id: string }>(desc).id).toBe('data.query');
	});

	it('plan_manifest diffs without writing', async () => {
		const res = await tool<{ content: Array<{ text: string }> }>('plan_manifest', { manifest: MANIFEST });
		const plan = payload<Plan>(res);
		expect(plan.summary.create).toBe(2); // collection + page
		// Nothing was written.
		expect((await SELF.fetch(`${BASE_URL}/api/collections/man_orders`, { headers: AUTH })).status).toBe(404);
	});

	it('apply_manifest creates the collection + page, and replay is idempotent', async () => {
		const res = await tool<{ content: Array<{ text: string }> }>('apply_manifest', { manifest: MANIFEST });
		const applied = payload<{ results: Array<{ ok: boolean }> }>(res);
		expect(applied.results.every((r) => r.ok)).toBe(true);
		expect((await SELF.fetch(`${BASE_URL}/api/collections/man_orders`, { headers: AUTH })).status).toBe(200);

		// Replay — collection + identical page are skipped.
		const replay = await tool<{ content: Array<{ text: string }> }>('apply_manifest', { manifest: MANIFEST });
		expect(payload<{ plan: Plan }>(replay).plan.summary.skip).toBe(2);
	});

	it('query reads back built data', async () => {
		await SELF.fetch(`${BASE_URL}/api/entities/man_orders`, {
			method: 'POST',
			headers: AUTH_JSON,
			body: JSON.stringify({ code: 'A-1', total: 10 }),
		});
		const res = await tool('query', { requests: [{ collection: 'man_orders', params: { limit: 5 } }] });
		const { results } = payload<{ results: Array<{ collection: string; data?: unknown[] }> }>(res);
		expect(results[0].collection).toBe('man_orders');
		expect(Array.isArray(results[0].data)).toBe(true);
	});

	it('refuses apply_manifest to a read-scoped key, but allows plan_manifest', async () => {
		const userId = '00000000-0000-4000-8000-00000000cafe';
		const plain = 'mmk_readonly_manifest_test_0000000000';
		const hash = await sha256Hex(plain);
		await env.DB.prepare(
			"INSERT OR IGNORE INTO _users (id, email, full_name, password_hash, role_id, status) VALUES (?, ?, ?, 'x', NULL, 'active')",
		)
			.bind(userId, 'manifest-test@mmbix.local', 'Manifest Test')
			.run();
		await env.DB.prepare(
			"INSERT OR REPLACE INTO _api_keys (id, name, key_hash, user_id, role_id, scope, is_active, created_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, NULL, 'read', 1, ?, NULL, NULL)",
		)
			.bind('key-readonly-manifest', 'readonly-manifest', hash, userId, new Date().toISOString())
			.run();
		const ro = { 'Content-Type': 'application/json', Authorization: `Bearer ${plain}` };

		const plan = await tool('plan_manifest', { manifest: MANIFEST }, ro);
		expect(plan.body.error).toBeUndefined();

		const apply = await tool('apply_manifest', { manifest: MANIFEST }, ro);
		expect(apply.body.error?.code).toBe(-32002);
	});

	it('applies roles, permissions and workflows (P2 manifest keys)', async () => {
		const gov = {
			version: 1,
			roles: [{ name: 'Invoice Clerk', description: 'handles invoices' }],
			permissions: [{ role: 'Invoice Clerk', collection: 'man_orders', can_read: true, can_write: true }],
			workflows: [
				{
					name: 'Invoice Approval',
					collection: 'man_orders',
					initial: 'draft',
					states: ['draft', 'approved'],
					transitions: [{ id: 'approve', from: 'draft', to: 'approved' }],
				},
			],
		};
		const res = await tool<{ content: Array<{ text: string }> }>('apply_manifest', { manifest: gov });
		const applied = payload<{ results: Array<{ ok: boolean; error?: string }> }>(res);
		expect(
			applied.results.every((r) => r.ok),
			JSON.stringify(applied.results),
		).toBe(true);

		const roles = await SELF.fetch(`${BASE_URL}/api/users/roles`, { headers: AUTH });
		const roleList = (await roles.json()) as { data?: Array<{ name: string }> };
		expect((roleList.data ?? []).some((r) => r.name === 'Invoice Clerk')).toBe(true);

		const flows = await SELF.fetch(`${BASE_URL}/api/workflows`, { headers: AUTH });
		const flowList = (await flows.json()) as { data?: Array<{ collection_slug?: string; definition?: { collection?: string } }> };
		expect(JSON.stringify(flowList.data ?? [])).toContain('man_orders');

		// Replay: the role is skipped.
		const replay = await tool<{ content: Array<{ text: string }> }>('plan_manifest', { manifest: gov });
		const plan = payload<{ actions: Array<{ kind: string; target: string }> }>(replay);
		expect(plan.actions.some((a) => a.target === 'role:Invoice Clerk' && a.kind === 'skip')).toBe(true);
	});

	it('warns about a menu for a missing module without failing the plan', async () => {
		const res = await tool<{ content: Array<{ text: string }> }>('plan_manifest', {
			manifest: { version: 1, menus: [{ module: 'nope_module', label: 'X' }] },
		});
		const plan = payload<{ warnings: string[] }>(res);
		expect(plan.warnings.some((w) => w.includes('does not exist'))).toBe(true);
	});

	it('reads the audit trail', async () => {
		const res = await tool('get_audit', { collection: 'man_orders', limit: 10 });
		const data = payload<{ entries: unknown[] }>(res);
		expect(Array.isArray(data.entries)).toBe(true);
	});

	it('mutates data (create → update → delete) in one batched verb', async () => {
		const created = await tool('mutate', { requests: [{ op: 'create', collection: 'man_orders', body: { code: 'M-1', total: 5 } }] });
		const createdResult = payload<{ results: Array<{ id?: string; error?: string }> }>(created);
		expect(createdResult.results[0].error).toBeUndefined();
		const id = createdResult.results[0].id!;

		const updated = await tool('mutate', { requests: [{ op: 'update', collection: 'man_orders', id, body: { total: 9 } }] });
		expect(payload<{ results: Array<{ error?: string }> }>(updated).results[0].error).toBeUndefined();

		const deleted = await tool('mutate', { requests: [{ op: 'delete', collection: 'man_orders', id }] });
		expect(payload<{ results: Array<{ id?: string; error?: string }> }>(deleted).results[0].id).toBe(id);
	});

	it('defines KPIs via the manifest (analytics)', async () => {
		const res = await tool<{ content: Array<{ text: string }> }>('apply_manifest', {
			manifest: { version: 1, kpis: [{ name: 'Order Count', collection: 'man_orders', agg: 'count' }] },
		});
		const applied = payload<{ results: Array<{ ok: boolean; error?: string }> }>(res);
		expect(
			applied.results.every((r) => r.ok),
			JSON.stringify(applied.results),
		).toBe(true);

		const kpis = await SELF.fetch(`${BASE_URL}/api/kpis`, { headers: AUTH });
		const list = (await kpis.json()) as { data?: Array<{ name: string }> };
		expect((list.data ?? []).some((k) => k.name === 'Order Count')).toBe(true);
	});

	it('defines a server function and provisions a scoped machine key (setup)', async () => {
		const userId = '00000000-0000-4000-8000-00000000c0de';
		await env.DB.prepare(
			"INSERT OR IGNORE INTO _users (id, email, full_name, password_hash, role_id, status) VALUES (?, ?, ?, 'x', NULL, 'active')",
		)
			.bind(userId, 'setup-test@mmbix.local', 'Setup Test')
			.run();

		const manifest = {
			version: 1,
			serverFunctions: [
				{
					name: 'Stamp Order',
					collection: 'man_orders',
					trigger_event: 'after_insert',
					rules: [{ action: 'set', target: 'code', value: 'x' }],
				},
			],
			apiKeys: [{ name: 'agent-read', user_id: userId, scope: 'read' }],
		};
		const res = await tool<{ content: Array<{ text: string }> }>('apply_manifest', { manifest });
		const applied = payload<{ results: Array<{ target: string; ok: boolean; secret?: string; error?: string }> }>(res);
		expect(
			applied.results.every((r) => r.ok),
			JSON.stringify(applied.results),
		).toBe(true);
		// The api key plaintext is surfaced exactly once.
		const key = applied.results.find((r) => r.target === 'apiKey:agent-read');
		expect(key?.secret?.startsWith('mmk_')).toBe(true);

		// Replay: both are now skipped.
		const replay = await tool<{ content: Array<{ text: string }> }>('plan_manifest', { manifest });
		const plan = payload<{ actions: Array<{ kind: string; target: string }> }>(replay);
		expect(plan.actions.some((a) => a.target === 'serverFunction:Stamp Order' && a.kind === 'skip')).toBe(true);
		expect(plan.actions.some((a) => a.target === 'apiKey:agent-read' && a.kind === 'skip')).toBe(true);
	});

	it('reads ops telemetry and runs integrity checks', async () => {
		const ops = await tool('get_operations', {});
		expect(payload<{ mode: string }>(ops).mode).toBeTruthy();

		const integrity = await tool('run_integrity', { slug: 'man_orders' });
		expect(payload<{ enabled: boolean }>(integrity).enabled).toBe(false); // no rules declared
	});

	it('serves the page block vocabulary as a resource', async () => {
		const read = await rpc<{ contents: Array<{ text: string }> }>('resources/read', { uri: 'factory://blocks' });
		const blocks = JSON.parse(read.body.result!.contents[0].text) as Array<{ type: string; group: string }>;
		expect(blocks.length).toBeGreaterThan(10);
		expect(blocks.some((b) => b.type === 'table')).toBe(true);
	});

	it('adds fields to an existing collection (schema evolution)', async () => {
		const evolved = {
			version: 1,
			collections: [
				{
					slug: 'man_orders',
					name: 'Man Orders',
					fields: [
						{ name: 'code', type: 'text' },
						{ name: 'total', type: 'currency' },
						{ name: 'note', type: 'text' },
					],
				},
			],
		};
		const plan = payload<Plan>(await tool('plan_manifest', { manifest: evolved }));
		expect(plan.actions.find((a) => a.target === 'collection:man_orders')?.kind).toBe('update');

		const applied = payload<{ results: Array<{ ok: boolean; error?: string }> }>(await tool('apply_manifest', { manifest: evolved }));
		expect(
			applied.results.every((r) => r.ok),
			JSON.stringify(applied.results),
		).toBe(true);

		const info = (await (await SELF.fetch(`${BASE_URL}/api/collections/man_orders`, { headers: AUTH })).json()) as {
			data?: { schema_json: { fields: Array<{ name: string }> } };
		};
		expect(info.data?.schema_json.fields.some((f) => f.name === 'note')).toBe(true);

		// Replay: now a skip.
		const replan = payload<Plan>(await tool('plan_manifest', { manifest: evolved }));
		expect(replan.actions.find((a) => a.target === 'collection:man_orders')?.kind).toBe('skip');
	});

	it('bulk imports rows via mutate op import (CSV)', async () => {
		const csv = 'code,total\nI-1,1\nI-2,2';
		const res = await tool('mutate', { requests: [{ op: 'import', collection: 'man_orders', format: 'csv', data: csv }] });
		const row = payload<{ results: Array<{ imported?: number; errors?: unknown[] }> }>(res).results[0];
		expect(row.imported).toBe(2);
	});
});
