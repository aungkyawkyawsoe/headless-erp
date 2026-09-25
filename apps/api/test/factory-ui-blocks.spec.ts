/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * FACTORY UI VOCABULARY — an agent must be able to learn how to configure a real
 * block, and an unknown block must be refused rather than written-and-ignored.
 *
 * Before this, `factory://blocks` was name-only and nothing validated a page's
 * blocks, so `{ type: 'not-a-block' }` was persisted and then rendered as
 * nothing — a silent no-op. These specs pin the fix at both seams.
 */

const BASE = 'http://localhost';
const JSON_HEADERS = { 'Content-Type': 'application/json', Authorization: 'Bearer dev-token' };

interface Rpc<T> {
	result?: T;
	error?: { code: number; message: string };
}
async function rpc<T>(method: string, params?: Record<string, unknown>): Promise<Rpc<T>> {
	const res = await SELF.fetch(`${BASE}/api/mcp`, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	});
	const body = (await res.json().catch(() => ({}))) as Rpc<T>;
	return body;
}
async function tool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
	const res = await rpc<{ content: Array<{ text: string }>; isError?: boolean }>('tools/call', { name, arguments: args });
	const result = res.result!;
	const text = result.content?.[0]?.text;
	if (result.isError) throw new Error(text ?? `${name} failed`);
	return (text ? JSON.parse(text) : result) as T;
}
async function api<T>(path: string): Promise<{ status: number; data?: T }> {
	const res = await SELF.fetch(`${BASE}${path}`, { headers: JSON_HEADERS });
	const body = (await res.json().catch(() => ({}))) as { data?: T };
	return { status: res.status, data: body.data };
}

interface VocabularyEntry {
	type: string;
	label: string;
	group: string;
	container: boolean;
	defaults: Record<string, unknown>;
	allowedChildren?: string[] | null;
}

describe('factory UI vocabulary', () => {
	it('factory://blocks carries DEFAULTS, not just names — so a block is configurable', async () => {
		const read = await rpc<{ contents: Array<{ text: string }> }>('resources/read', { uri: 'factory://blocks' });
		const blocks = JSON.parse(read.result!.contents[0].text) as VocabularyEntry[];
		expect(blocks.length).toBeGreaterThan(10);

		const table = blocks.find((b) => b.type === 'table');
		expect(table).toBeTruthy();
		// The config vocabulary is the point: without `defaults` an agent can name a
		// block but not fill it in.
		expect(Object.keys(table!.defaults).length).toBeGreaterThan(0);

		const row = blocks.find((b) => b.type === 'row');
		expect(row?.container).toBe(true);
		const tableNotContainer = table?.container;
		expect(tableNotContainer).toBe(false);
	});

	it('advertises the component-registry capability', async () => {
		const found = await tool<{ id: string; available: boolean }>('describe_capability', { id: 'pages.components.registry' });
		expect(found.available).toBe(true);

		const { capabilities } = await tool<{ capabilities: Array<{ id: string; available: boolean }> }>('search_capabilities', {});
		const ui = capabilities.filter((c) => c.id.startsWith('pages.'));
		expect(ui.length).toBeGreaterThanOrEqual(3);
		expect(ui.every((c) => c.available)).toBe(true);
	});
});

describe('factory block validation', () => {
	const manifest = {
		version: 1,
		collections: [{ slug: 'ui_widget', name: 'UI Widget', fields: [{ name: 'name', type: 'text' }] }],
		pages: [
			{
				path: '/ui-one',
				title: 'UI One',
				blocks: [
					{ id: 'k', type: 'kpi', layout: { order: 0 }, config: { label: 'Count', collection: 'ui_widget' } },
					{ id: 'bad', type: 'not-a-block', layout: { order: 1 }, config: {} },
				],
			},
		],
	};

	it('an unknown block type is dropped with a warning, and the page still builds', async () => {
		const applied = await tool<{ plan: { warnings: string[] }; results: Array<{ target: string; ok: boolean }> }>('apply_manifest', {
			manifest,
		});
		expect(applied.results.find((r) => r.target === 'page:-/ui-one')?.ok).toBe(true);
		expect(applied.plan.warnings.join(' ')).toContain('unknown type "not-a-block"');

		const pages = await api<Array<{ path: string; blocks: Array<{ type: string }> }>>('/api/pages');
		const page = (pages.data ?? []).find((p) => p.path === '/ui-one');
		// Only the real block was persisted — the unknown one never reached the DB.
		expect(page!.blocks).toHaveLength(1);
		expect(page!.blocks[0].type).toBe('kpi');
	});

	it('children on a non-container are dropped (table holds no blocks)', async () => {
		const applied = await tool<{ plan: { warnings: string[] } }>('apply_manifest', {
			manifest: {
				version: 1,
				pages: [
					{
						path: '/ui-two',
						title: 'UI Two',
						blocks: [
							{
								id: 't',
								type: 'table',
								layout: { order: 0 },
								config: {},
								children: [{ id: 'x', type: 'kpi', layout: { order: 0 }, config: {} }],
							},
						],
					},
				],
			},
		});
		expect(applied.plan.warnings.join(' ')).toContain('not a container');

		const pages = await api<Array<{ path: string; blocks: Array<{ children?: unknown[] }> }>>('/api/pages');
		const page = (pages.data ?? []).find((p) => p.path === '/ui-two');
		expect(page!.blocks[0].children).toBeUndefined();
	});

	it('apply_patch reports a block it dropped instead of persisting it', async () => {
		const pages = await api<Array<{ id: string; path: string }>>('/api/pages');
		const page = (pages.data ?? []).find((p) => p.path === '/ui-one');
		const patched = await tool<{ blocks: Array<{ type: string }>; warnings?: string[] }>('apply_patch', {
			page_id: page!.id,
			ops: [{ id: 'o1', op: 'ADD', parent: null, node: { id: 'ghost', type: 'nope', layout: { order: 9 }, config: {} } }],
		});
		expect(patched.warnings?.join(' ')).toContain('unknown type "nope"');
		expect(patched.blocks.some((b) => b.type === 'nope')).toBe(false);
	});
});
