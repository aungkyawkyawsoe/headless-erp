/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { sha256Hex } from '@/lib/services/api-key.service';
import { mcpScopeAllows } from '@/plugins/mcp/plugin';

/**
 * Inbound MCP — least privilege.
 *
 * The surface is a JSON-RPC port over POST /api/mcp. Writes ARE shipped, but only
 * through the governed manifest path, and authorization is enforced on TWO axes:
 *   - key SCOPE (a read key is refused a mutating tool; an unclassified tool is
 *     denied by default — see the `mcpScopeAllows` unit tests), and
 *   - collection RBAC (every collection-scoped tool passes through the same
 *     permission check the REST `businessGuard` applies).
 */

const BASE_URL = 'http://localhost';
const AUTH = { Authorization: 'Bearer dev-token' };
const AUTH_JSON = { 'Content-Type': 'application/json', ...AUTH };

interface Rpc<T> {
	status: number;
	body: { jsonrpc?: string; id?: unknown; result?: T; error?: { code: number; message: string } };
}

async function rpc<T>(method: string, params?: Record<string, unknown>, id: number | string = 1): Promise<Rpc<T>> {
	const res = await SELF.fetch(`${BASE_URL}/api/mcp`, {
		method: 'POST',
		headers: AUTH_JSON,
		body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
	});
	return { status: res.status, body: (await res.json().catch(() => ({}))) as Rpc<T>['body'] };
}

describe('inbound MCP server', () => {
	beforeAll(async () => {
		await SELF.fetch(`${BASE_URL}/api/collections`, {
			method: 'POST',
			headers: AUTH_JSON,
			body: JSON.stringify({ name: 'Mcp Widget', slug: 'mcp_widget', fields: [{ name: 'title', type: 'text', required: false }] }),
		});
	});

	it('initializes with the protocol version and tools capability', async () => {
		const res = await rpc<{ protocolVersion: string; capabilities: { tools: unknown } }>('initialize');
		expect(res.status).toBe(200);
		expect(res.body.result!.protocolVersion).toBeTruthy();
		expect(res.body.result!.capabilities.tools).toBeDefined();
	});

	it('advertises the control-plane catalog; ad-hoc schema tools are absent (writes go through apply_manifest)', async () => {
		const res = await rpc<{ tools: Array<{ name: string }> }>('tools/list');
		const names = res.body.result!.tools.map((t) => t.name);
		for (const expected of [
			'list_collections',
			'describe_collection',
			'propose_schema',
			'submit_for_review',
			'promote',
			'apply_patch',
			'search_capabilities',
			'describe_capability',
			'plan_manifest',
			'apply_manifest',
			'query',
		]) {
			expect(names).toContain(expected);
		}
		// No one-call schema mutators — the governed path is plan_manifest → apply_manifest.
		for (const forbidden of ['create_collection', 'add_field', 'apply_schema', 'delete_collection']) {
			expect(names).not.toContain(forbidden);
		}
	});

	it('calls list_collections and returns the deployment catalog', async () => {
		const res = await rpc<{ content: Array<{ type: string; text: string }> }>('tools/call', {
			name: 'list_collections',
			arguments: {},
		});
		const payload = JSON.parse(res.body.result!.content[0].text) as Array<{ slug: string }>;
		expect(payload.some((c) => c.slug === 'mcp_widget')).toBe(true);
	});

	it('calls describe_collection with the collection’s fields', async () => {
		const res = await rpc<{ content: Array<{ text: string }> }>('tools/call', {
			name: 'describe_collection',
			arguments: { slug: 'mcp_widget' },
		});
		const payload = JSON.parse(res.body.result!.content[0].text) as { fields: Array<{ name: string; type: string }> };
		expect(payload.fields.some((f) => f.name === 'title' && f.type === 'text')).toBe(true);
	});

	it('answers an unknown method with a JSON-RPC error (HTTP 200)', async () => {
		const res = await rpc('does/not/exist');
		expect(res.status).toBe(200);
		expect(res.body.error?.code).toBe(-32601);
	});

	it('refuses an unknown tool', async () => {
		const res = await rpc('tools/call', { name: 'drop_tables', arguments: {} });
		expect(res.body.error?.code).toBe(-32601);
	});

	it('propose_schema creates a DRAFT proposal but writes no schema', async () => {
		const res = await rpc<{ content: Array<{ text: string }> }>('tools/call', {
			name: 'propose_schema',
			arguments: { collection: { name: 'Mcp Draft', slug: 'mcp_draft' }, prompt: 'Mcp drafts with title: text, amount: currency' },
		});
		const payload = JSON.parse(res.body.result!.content[0].text) as { id: string; status: string };
		expect(payload.status).toBe('draft');
		// The human gate has not run.
		expect((await SELF.fetch(`${BASE_URL}/api/collections/mcp_draft`, { headers: AUTH })).status).toBe(404);
	});

	it('drives the human gate via MCP state tools (submit → promote)', async () => {
		const proposed = await rpc<{ content: Array<{ text: string }> }>('tools/call', {
			name: 'propose_schema',
			arguments: { collection: { name: 'Mcp Gate', slug: 'mcp_gate' }, prompt: 'Mcp gate with code' },
		});
		const id = (JSON.parse(proposed.body.result!.content[0].text) as { id: string }).id;

		const submitted = await rpc<{ content: Array<{ text: string }> }>('tools/call', {
			name: 'submit_for_review',
			arguments: { proposal_id: id },
		});
		expect((JSON.parse(submitted.body.result!.content[0].text) as { status: string }).status).toBe('review');

		const promoted = await rpc<{ content: Array<{ text: string }> }>('tools/call', {
			name: 'promote',
			arguments: { proposal_id: id },
		});
		expect((JSON.parse(promoted.body.result!.content[0].text) as { status: string }).status).toBe('promoted');

		// Promoting is NOT applying — no collection exists.
		expect((await SELF.fetch(`${BASE_URL}/api/collections/mcp_gate`, { headers: AUTH })).status).toBe(404);
	});

	it('refuses a mutating tool to a read-scoped key, but allows reads', async () => {
		const userId = '00000000-0000-4000-8000-00000000beef';
		const plain = 'mmk_readonly_scope_test_0000000000000000';
		const hash = await sha256Hex(plain);
		await env.DB.prepare(
			"INSERT OR IGNORE INTO _users (id, email, full_name, password_hash, role_id, status) VALUES (?, ?, ?, 'x', NULL, 'active')",
		)
			.bind(userId, 'scope-test@mmbix.local', 'Scope Test')
			.run();
		await env.DB.prepare(
			"INSERT OR REPLACE INTO _api_keys (id, name, key_hash, user_id, role_id, scope, is_active, created_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, NULL, 'read', 1, ?, NULL, NULL)",
		)
			.bind('key-readonly', 'readonly', hash, userId, new Date().toISOString())
			.run();

		const roHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${plain}` };
		const read = await SELF.fetch(`${BASE_URL}/api/mcp`, {
			method: 'POST',
			headers: roHeaders,
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_collections', arguments: {} } }),
		});
		expect(((await read.json()) as { error?: unknown }).error).toBeUndefined();

		const write = await SELF.fetch(`${BASE_URL}/api/mcp`, {
			method: 'POST',
			headers: roHeaders,
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/call',
				params: { name: 'propose_schema', arguments: { prompt: 'x with a' } },
			}),
		});
		expect(((await write.json()) as { error?: { code: number } }).error?.code).toBe(-32002);
	});

	it('persists page patch ops via MCP apply_patch', async () => {
		const created = await SELF.fetch(`${BASE_URL}/api/pages`, {
			method: 'POST',
			headers: AUTH_JSON,
			body: JSON.stringify({
				path: '/mcp-patch',
				title: 'MCP Patch',
				blocks: [{ id: 'row', type: 'row', label: 'Row', layout: { order: 0 }, config: {}, children: [] }],
			}),
		});
		const page = (await created.json()) as { data?: { id: string } };
		expect(page.data?.id).toBeTruthy();

		const res = await rpc<{ content: Array<{ text: string }> }>('tools/call', {
			name: 'apply_patch',
			arguments: {
				page_id: page.data!.id,
				ops: [{ id: 'o1', op: 'ADD', parent: 'row', node: { id: 'c1', type: 'column', label: 'C', layout: { order: 0 }, config: {} } }],
			},
		});
		const out = JSON.parse(res.body.result!.content[0].text) as { blocks: Array<{ children?: unknown[] }> };
		expect(out.blocks[0].children).toHaveLength(1);
	});
});

describe('MCP tool-scope policy (PoLP, deny-by-default)', () => {
	it('allows a read tool to any scope', () => {
		expect(mcpScopeAllows('read', 'query')).toBe(true);
		expect(mcpScopeAllows(undefined, 'list_collections')).toBe(true);
	});

	it('refuses a mutating tool to a read or missing/empty scope', () => {
		expect(mcpScopeAllows('read', 'mutate')).toBe(false);
		expect(mcpScopeAllows('read', 'apply_manifest')).toBe(false);
		// null / '' is NOT a session — it is an un-scoped key, denied write.
		expect(mcpScopeAllows(null, 'mutate')).toBe(false);
		expect(mcpScopeAllows('', 'mutate')).toBe(false);
	});

	it('lets a session bearer (undefined scope) reach a write tool — the tool’s own RBAC then decides', () => {
		expect(mcpScopeAllows(undefined, 'mutate')).toBe(true);
	});

	it('denies an unclassified tool by default (a new write tool cannot ship readable)', () => {
		expect(mcpScopeAllows('admin', 'brand_new_tool')).toBe(false);
		expect(mcpScopeAllows(undefined, 'brand_new_tool')).toBe(false);
	});
});
