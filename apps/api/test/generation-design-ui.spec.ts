/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildProposal } from '../src/plugins/generation/proposal';
import { designToBlocks } from '../src/plugins/generation/design-blocks';
import { normalizeDesignDNA } from '../src/plugins/generation/design-dna';
import type { DesignDNA } from '@mmbix/types';

/**
 * DESIGN → APP — the design no longer stops at schema.
 *
 * `inferFields` turned a design into a collection but nothing turned design
 * INTENT into a screen, so a proposal produced data with no UI. `designToBlocks`
 * compiles a design into real BLOCK_REGISTRY blocks bound to that collection,
 * and apply materializes them as a page. These specs pin the mapping, the
 * skip-with-warning contract, and the end-to-end gate.
 */

const BASE = 'http://localhost';
const JSON_HEADERS = { 'Content-Type': 'application/json', Authorization: 'Bearer dev-token' };

async function tool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
	const res = await SELF.fetch(`${BASE}/api/mcp`, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
	});
	const body = (await res.json().catch(() => ({}))) as { result?: { content: Array<{ text: string }>; isError?: boolean } };
	const result = body.result!;
	const text = result.content?.[0]?.text;
	if (result.isError) throw new Error(text ?? `${name} failed`);
	return (text ? JSON.parse(text) : result) as T;
}
async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; data?: T }> {
	const res = await SELF.fetch(`${BASE}${path}`, { ...init, headers: { ...JSON_HEADERS, ...(init?.headers ?? {}) } });
	const body = (await res.json().catch(() => ({}))) as { data?: T };
	return { status: res.status, data: body.data };
}

const DNA: DesignDNA = {
	source: { provider: 'stitch', projectId: 'p1' },
	screens: [
		{
			id: 'purchase-order',
			anatomy: 'Purchase Order\nHeader + line items',
			components: [
				{ kind: 'header', label: 'Purchase Order' },
				{ kind: 'stat-card', label: 'Total value' },
				{ kind: 'table', label: 'Line items', hints: [{ label: 'Amount', sampleFormat: 'currency' }] },
				{ kind: 'sparkles', label: 'AI insight' },
			],
		},
	],
};

describe('design → blocks compiler', () => {
	it('maps design components onto real blocks bound to the collection', () => {
		const { pages, warnings } = designToBlocks(DNA, { collection: 'purchase_order' });
		expect(pages).toHaveLength(1);
		const page = pages[0];
		expect(page.path).toBe('/purchase-order');
		expect(page.title).toBe('Purchase Order');
		// header → section-header, stat-card → kpi, table → table; ids are stable.
		expect(page.blocks.map((b) => b.type)).toEqual(['section-header', 'kpi', 'table']);
		expect(page.blocks.map((b) => b.id)).toEqual(['b0c0', 'b0c1', 'b0c2']);
		// Every data block is bound to the collection the proposal creates.
		expect((page.blocks[1].config as { collection: string }).collection).toBe('purchase_order');
		expect((page.blocks[2].config as { collection: string }).collection).toBe('purchase_order');
		// The design's label becomes the block title/label, from the block's own defaults.
		expect(page.blocks[2].config).toMatchObject({ title: 'Line items' });
		// An unmappable component is skipped WITH a reason, never invented.
		expect(warnings.map((w) => w.message).join(' ')).toContain('sparkles');
	});

	it('is deterministic — same design, same pages', () => {
		const a = designToBlocks(DNA, { collection: 'purchase_order' });
		const b = designToBlocks(DNA, { collection: 'purchase_order' });
		expect(JSON.stringify(a.pages)).toBe(JSON.stringify(b.pages));
	});

	it('buildProposal attaches the UI to the schema proposal', () => {
		const { proposal } = (() => {
			const parsed = normalizeDesignDNA(DNA);
			return { proposal: buildProposal({ collection: { slug: 'purchase_order' }, dna: parsed.dna! }, { maxFields: 40 }) };
		})();
		expect(proposal.collection.slug).toBe('purchase_order');
		expect(proposal.pages).toHaveLength(1);
		expect(proposal.pages![0].blocks.map((b) => b.type)).toEqual(['section-header', 'kpi', 'table']);
	});
});

describe('design → app through the generation gate', () => {
	it('apply creates the collection AND its page', async () => {
		const draft = await tool<{ id: string; status: string; pages: unknown[] }>('propose_schema', {
			collection: { name: 'Gen UI PO', slug: 'gen_ui_po' },
			prompt: 'Gen UI PO records with code, total: currency',
		});
		expect(draft.status).toBe('draft');
		// The prompt normalizes to a `form` design component → an entity-form block.
		expect(draft.pages).toHaveLength(1);

		await tool('submit_for_review', { proposal_id: draft.id });
		await tool('promote', { proposal_id: draft.id });
		const applied = await api<{ status: string }>(`/api/generation/${draft.id}/apply`, { method: 'POST' });
		expect(applied.status).toBe(200);

		// Schema landed...
		const schema = await api<{ slug: string }>('/api/collections/gen_ui_po');
		expect(schema.status).toBe(200);
		// ...and so did the UI, validated against the block registry.
		const pages = await api<Array<{ path: string; blocks: Array<{ type: string; config: Record<string, unknown> }> }>>('/api/pages');
		const page = (pages.data ?? []).find((p) => p.blocks.some((b) => b.type === 'entity-form' && b.config.collection === 'gen_ui_po'));
		expect(page?.blocks[0].type).toBe('entity-form');
		expect(page!.blocks[0].config.collection).toBe('gen_ui_po');
	});
});
