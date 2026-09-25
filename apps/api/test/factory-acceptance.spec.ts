/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * FACTORY ACCEPTANCE — "can it build anything?"
 *
 * One end-to-end scenario that builds a small procurement app THROUGH THE MCP
 * CONTROL PLANE and then exercises every capability domain:
 *   meta · schema (+evolution) · pages · governance · automation · analytics ·
 *   data · ops · generation · idempotency · scoped keys.
 *
 * This is the capability contract: if these pass, the factory can be driven by
 * an agent to build and operate an app.
 */

const BASE = 'http://localhost';
const AUTH = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json', ...AUTH };

interface Rpc<T> {
	status: number;
	body: { result?: T; error?: { code: number; message: string } };
}
async function rpc<T>(method: string, params?: Record<string, unknown>, headers: Record<string, string> = JSON_HEADERS): Promise<Rpc<T>> {
	const res = await SELF.fetch(`${BASE}/api/mcp`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	});
	return { status: res.status, body: (await res.json().catch(() => ({}))) as Rpc<T>['body'] };
}
async function tool<T = unknown>(name: string, args: Record<string, unknown>, headers = JSON_HEADERS): Promise<T> {
	const res = await rpc<{ content: Array<{ text: string }>; isError?: boolean }>('tools/call', { name, arguments: args }, headers);
	if (res.body.error) throw new Error(`RPC ${res.body.error.code}: ${res.body.error.message}`);
	const result = res.body.result!;
	const text = result.content?.[0]?.text;
	if (result.isError) throw new Error(text ?? `${name} failed`);
	return (text ? JSON.parse(text) : result) as T;
}
async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; data?: T }> {
	const res = await SELF.fetch(`${BASE}${path}`, { ...init, headers: { ...JSON_HEADERS, ...(init?.headers ?? {}) } });
	const body = (await res.json().catch(() => ({}))) as { data?: T };
	return { status: res.status, data: body.data };
}

const KEY_USER = '00000000-0000-4000-8000-00000000acce';

const APP = {
	version: 1,
	collections: [
		{ slug: 'acc_supplier', name: 'Acc Supplier', fields: [{ name: 'name', type: 'text', required: true }] },
		{
			slug: 'acc_purchase_order',
			name: 'Acc Purchase Order',
			fields: [
				{ name: 'code', type: 'text', required: true },
				{ name: 'total', type: 'currency' },
				{ name: 'supplier', type: 'm2o', related_collection: 'acc_supplier' },
				{ name: 'status', type: 'select', options: ['draft', 'approved'] },
			],
			policies: {
				search: { mode: 'prefix', fields: ['code'] },
				integrity: { enabled: true, limit: 10, rules: [{ type: 'duplicate', fields: ['code'] }] },
			},
		},
		{
			slug: 'acc_purchase_order_line',
			name: 'Acc PO Line',
			fields: [
				{ name: 'amount', type: 'currency' },
				{ name: 'order_ref', type: 'm2o', related_collection: 'acc_purchase_order' },
			],
		},
	],
	pages: [
		{
			path: '/acc-orders',
			title: 'Purchase Orders',
			blocks: [{ id: 'row', type: 'row', layout: { order: 0 }, config: {}, children: [] }],
		},
	],
	roles: [{ name: 'Acc Clerk', description: 'acceptance role' }],
	permissions: [{ role: 'Acc Clerk', collection: 'acc_purchase_order', can_read: true, can_write: true, can_create: true }],
	workflows: [
		{
			name: 'Acc PO Approval',
			collection: 'acc_purchase_order',
			initial: 'draft',
			states: ['draft', 'approved'],
			transitions: [{ id: 'approve', from: 'draft', to: 'approved' }],
		},
	],
	kpis: [{ name: 'Acc Order Count', collection: 'acc_purchase_order', agg: 'count' }],
	serverFunctions: [{ name: 'Acc Stamp', collection: 'acc_purchase_order', trigger_event: 'after_insert' }],
	apiKeys: [{ name: 'acc-agent-read', user_id: KEY_USER, scope: 'read' }],
};

interface ApplyResult {
	plan: { summary: { create: number; update: number; skip: number } };
	results: Array<{ target: string; ok: boolean; error?: string; secret?: string }>;
}

let applyResult: ApplyResult;
let pageId = '';

describe('FACTORY ACCEPTANCE — build an app through the control plane', () => {
	beforeAll(async () => {
		// applyManifest runs core migrations — so the app is built first, then the
		// key owner is seeded (needed only when a scoped key is later used).
		applyResult = await tool<ApplyResult>('apply_manifest', { manifest: APP });
		await env.DB.prepare(
			"INSERT OR IGNORE INTO _users (id, email, full_name, password_hash, role_id, status) VALUES (?, ?, ?, 'x', NULL, 'active')",
		)
			.bind(KEY_USER, 'acceptance@mmbix.local', 'Acceptance')
			.run();
	});

	// ── META / DISCOVERY ─────────────────────────────────────
	it('meta: the capability registry and resources are discoverable', async () => {
		const { capabilities } = await tool<{ capabilities: Array<{ id: string; available: boolean }> }>('search_capabilities', {});
		expect(capabilities.length).toBeGreaterThan(20);
		expect(capabilities.some((c) => c.id === 'schema.manifest.apply' && c.available)).toBe(true);
		const list = await rpc<{ resources: Array<{ uri: string }> }>('resources/list');
		expect(list.body.result!.resources.map((r) => r.uri)).toEqual(
			expect.arrayContaining(['factory://capabilities', 'factory://guide', 'factory://blocks']),
		);
	});

	// ── SCHEMA (Brain) ───────────────────────────────────────
	it('schema: the manifest built collections, relations and policies (every item ok)', async () => {
		expect(
			applyResult.results.every((r) => r.ok),
			JSON.stringify(applyResult.results.filter((r) => !r.ok)),
		).toBe(true);
		expect(applyResult.plan.summary.create).toBeGreaterThanOrEqual(3); // supplier, order, line

		const po = await api<{
			schema_json: { fields: Array<{ name: string; type: string; related_collection?: string }>; policies?: unknown };
		}>('/api/collections/acc_purchase_order');
		expect(po.status).toBe(200);
		const supplier = po.data!.schema_json.fields.find((f) => f.name === 'supplier');
		expect(supplier).toMatchObject({ type: 'm2o', related_collection: 'acc_supplier' });
		expect(JSON.stringify(po.data!.schema_json.policies)).toContain('prefix');
	});

	it('schema: an existing collection acquires a new field (evolution), then replays as skip', async () => {
		const evolved = {
			version: 1,
			collections: [
				{
					slug: 'acc_supplier',
					fields: [
						{ name: 'name', type: 'text' },
						{ name: 'tax_id', type: 'text' },
					],
				},
			],
		};
		const plan = await tool<{ actions: Array<{ kind: string; target: string }> }>('plan_manifest', { manifest: evolved });
		expect(plan.actions.find((a) => a.target === 'collection:acc_supplier')?.kind).toBe('update');
		await tool('apply_manifest', { manifest: evolved });
		const got = await api<{ schema_json: { fields: Array<{ name: string }> } }>('/api/collections/acc_supplier');
		expect(got.data!.schema_json.fields.some((f) => f.name === 'tax_id')).toBe(true);

		const replan = await tool<{ actions: Array<{ kind: string; target: string }> }>('plan_manifest', { manifest: evolved });
		expect(replan.actions.find((a) => a.target === 'collection:acc_supplier')?.kind).toBe('skip');
	});

	// ── DATA ─────────────────────────────────────────────────
	it('data: create → update → query → import → delete all work (batched verb)', async () => {
		const supplier = await tool<{ results: Array<{ id?: string; error?: string }> }>('mutate', {
			requests: [{ op: 'create', collection: 'acc_supplier', body: { name: 'Acme' } }],
		});
		const supplierId = supplier.results[0].id!;
		expect(supplierId).toBeTruthy();

		const created = await tool<{ results: Array<{ id?: string; error?: string }> }>('mutate', {
			requests: [
				{ op: 'create', collection: 'acc_purchase_order', body: { code: 'PO-1', total: 100, supplier: supplierId, status: 'draft' } },
			],
		});
		expect(created.results[0].error).toBeUndefined();
		const poId = created.results[0].id!;

		const updated = await tool<{ results: Array<{ error?: string }> }>('mutate', {
			requests: [{ op: 'update', collection: 'acc_purchase_order', id: poId, body: { total: 250 } }],
		});
		expect(updated.results[0].error).toBeUndefined();

		const q = await tool<{ results: Array<{ data?: Array<{ total: number }> }> }>('query', {
			requests: [{ collection: 'acc_purchase_order', params: { limit: 5 } }],
		});
		expect(q.results[0].data?.some((r) => r.total === 250)).toBe(true);

		const imported = await tool<{ results: Array<{ imported?: number }> }>('mutate', {
			requests: [{ op: 'import', collection: 'acc_supplier', format: 'csv', data: 'name\nBeta\nGamma' }],
		});
		expect(imported.results[0].imported).toBe(2);

		const deleted = await tool<{ results: Array<{ id?: string }> }>('mutate', {
			requests: [{ op: 'delete', collection: 'acc_purchase_order', id: poId }],
		});
		expect(deleted.results[0].id).toBe(poId);
	});

	// ── PAGES (Face) ─────────────────────────────────────────
	it('pages: built from the manifest, then patched in place', async () => {
		const pages = await api<Array<{ id: string; path: string }>>('/api/pages');
		const page = (pages.data ?? []).find((p) => p.path === '/acc-orders');
		expect(page?.id).toBeTruthy();
		pageId = page!.id;

		const patched = await tool<{ blocks: Array<{ children?: unknown[] }> }>('apply_patch', {
			page_id: pageId,
			ops: [{ id: 'o1', op: 'ADD', parent: 'row', node: { id: 'c1', type: 'column', layout: { order: 0 }, config: {} } }],
		});
		expect(patched.blocks[0].children).toHaveLength(1);
	});

	// ── GOVERNANCE ───────────────────────────────────────────
	it('governance: roles + permissions applied, audit readable, api key provisioned', async () => {
		const roles = await api<Array<{ name: string }>>('/api/users/roles');
		expect((roles.data ?? []).some((r) => r.name === 'Acc Clerk')).toBe(true);

		const key = applyResult.results.find((r) => r.target === 'apiKey:acc-agent-read');
		expect(key?.ok).toBe(true);

		const audit = await tool<{ entries: unknown[] }>('get_audit', { collection: 'acc_purchase_order', limit: 10 });
		expect(Array.isArray(audit.entries)).toBe(true);
	});

	// ── AUTOMATION ───────────────────────────────────────────
	it('automation: the workflow and server function were defined', async () => {
		const flows = await api<Array<{ collection_slug?: string }>>('/api/workflows');
		expect(JSON.stringify(flows.data ?? [])).toContain('acc_purchase_order');
		const fns = await api<Array<{ name: string }>>('/api/server-functions');
		expect((fns.data ?? []).some((f) => f.name === 'Acc Stamp')).toBe(true);
	});

	// ── ANALYTICS ────────────────────────────────────────────
	it('analytics: the KPI was defined', async () => {
		const kpis = await api<Array<{ name: string }>>('/api/kpis');
		expect((kpis.data ?? []).some((k) => k.name === 'Acc Order Count')).toBe(true);
	});

	// ── OPS ──────────────────────────────────────────────────
	it('ops: telemetry reads and the integrity rule runs', async () => {
		const ops = await tool<{ mode: string }>('get_operations', {});
		expect(ops.mode).toBeTruthy();

		// Two rows with the same code → the `duplicate` integrity rule fires.
		await tool('mutate', {
			requests: [
				{ op: 'create', collection: 'acc_purchase_order', body: { code: 'DUP', total: 1 } },
				{ op: 'create', collection: 'acc_purchase_order', body: { code: 'DUP', total: 2 } },
			],
		});
		const integrity = await tool<{ enabled: boolean; violations: number }>('run_integrity', { slug: 'acc_purchase_order' });
		expect(integrity.enabled).toBe(true);
		expect(integrity.violations).toBeGreaterThan(0);
	});

	// ── GENERATION ───────────────────────────────────────────
	it('generation: prompt → proposal → human gate → live', async () => {
		const draft = await tool<{ id: string; status: string }>('propose_schema', {
			collection: { name: 'Acc Gen', slug: 'acc_gen' },
			prompt: 'Acc Gen records with title, amount: currency, due date',
		});
		expect(draft.status).toBe('draft');
		await tool('submit_for_review', { proposal_id: draft.id });
		await tool('promote', { proposal_id: draft.id });
		const applied = await api<{ id: string }>('/api/generation/' + draft.id + '/apply', { method: 'POST' });
		expect(applied.status).toBe(200);
		expect((await api('/api/collections/acc_gen')).status).toBe(200);
	});

	it('generation: a review edit is learned by the next proposal', async () => {
		const a = await tool<{ id: string; fields: Array<{ name: string; type: string }> }>('propose_schema', {
			collection: { name: 'Acc Learn A', slug: 'acc_learn_a' },
			prompt: 'Acc Learn A with reward',
		});
		expect(a.fields[0]).toMatchObject({ name: 'reward', type: 'text' });
		await api(`/api/generation/${a.id}/fields`, {
			method: 'PATCH',
			body: JSON.stringify({ fields: [{ name: 'reward', type: 'percent' }] }),
		});
		const b = await tool<{ fields: Array<{ name: string; type: string; inference: { reason: string } }> }>('propose_schema', {
			collection: { name: 'Acc Learn B', slug: 'acc_learn_b' },
			prompt: 'Acc Learn B with reward',
		});
		expect(b.fields[0].type).toBe('percent');
		expect(b.fields[0].inference.reason).toContain('learned');
	});

	// ── IDEMPOTENCY ──────────────────────────────────────────
	it('idempotency: replaying the whole manifest is a no-op', async () => {
		const replan = await tool<{ summary: { create: number; skip: number } }>('plan_manifest', { manifest: APP });
		expect(replan.summary.create).toBe(0);
		expect(replan.summary.skip).toBeGreaterThanOrEqual(3);
	});

	// ── SECURITY / SCOPES ────────────────────────────────────
	it('security: a read-scoped agent key can plan but cannot apply', async () => {
		// Fetch the plaintext of the key created in beforeAll via replay is impossible
		// (shown once); provision a fresh read key through the manifest instead.
		const seeded = await tool<{ results: Array<{ secret?: string; ok: boolean }> }>('apply_manifest', {
			manifest: { version: 1, apiKeys: [{ name: 'acc-agent-read-2', user_id: KEY_USER, scope: 'read' }] },
		});
		const secret = seeded.results.find((r) => r.secret)?.secret;
		expect(secret?.startsWith('mmk_')).toBe(true);
		const ro = { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` };

		const plan = await rpc('tools/call', { name: 'plan_manifest', arguments: { manifest: APP } }, ro);
		expect(plan.body.error).toBeUndefined();

		const apply = await rpc('tools/call', { name: 'apply_manifest', arguments: { manifest: APP } }, ro);
		expect(apply.body.error?.code).toBe(-32002);
	});
});
