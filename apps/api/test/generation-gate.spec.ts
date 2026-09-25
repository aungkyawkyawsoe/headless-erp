/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Governed generation — the pipeline PROPOSES, the human gate WRITES.
 *
 * Invariants pinned here:
 *   1. `propose` never creates a collection (no AI write path).
 *   2. `apply` is refused unless the proposal reached `promoted`.
 *   3. The full gate draft → review → promoted → live creates exactly one collection.
 *   4. Re-proposing the same DNA is idempotent while a proposal is open.
 *   5. Malformed DNA is rejected; inference is visible on every field.
 *   6. `patch` applies ops to a tree without writing anything.
 */

const BASE_URL = 'http://localhost';
const AUTH_JSON = { 'Content-Type': 'application/json', Authorization: 'Bearer dev-token' };

interface Res<T> {
	status: number;
	body: { success?: boolean; data?: T; error?: string; code?: string };
}

async function api<T>(path: string, init?: RequestInit): Promise<Res<T>> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, { ...init, headers: { ...AUTH_JSON, ...(init?.headers ?? {}) } });
	const body = (await res.json().catch(() => null)) as Res<T>['body'] | null;
	return { status: res.status, body: body ?? {} };
}

const DNA = {
	source: { provider: 'manual' as const },
	screens: [
		{
			id: 'supplier-invoice',
			anatomy: 'A supplier invoice form',
			components: [
				{
					kind: 'form',
					hints: [
						{ label: 'Invoice Number' },
						{ label: 'Amount', sampleFormat: 'currency' as const },
						{ label: 'Issue Date' },
						{ label: 'Is Paid' },
						{ label: 'Notes' },
					],
				},
			],
		},
	],
};

interface ProposalRecord {
	id: string;
	status: string;
	proposal: {
		collection: {
			slug: string;
			name: string;
			fields: Array<{ name: string; type: string; inference: { confidence: number; reason: string } }>;
		};
		warnings: Array<{ code: string }>;
	};
	applied_slug: string | null;
}

async function propose(slug: string): Promise<Res<ProposalRecord>> {
	return api<ProposalRecord>('/api/generation/propose', {
		method: 'POST',
		body: JSON.stringify({ collection: { name: 'Supplier Invoice', slug }, dna: DNA }),
	});
}

describe('governed generation gate', () => {
	it('propose maps DNA to a draft proposal with VISIBLE inference — and writes no schema', async () => {
		const res = await propose('gen_draft_only');
		expect(res.status).toBe(201);
		expect(res.body.data!.status).toBe('draft');

		const fields = res.body.data!.proposal.collection.fields;
		expect(fields.map((f) => f.type)).toContain('currency');
		expect(fields.every((f) => typeof f.inference.reason === 'string' && f.inference.reason.length > 0)).toBe(true);

		// The human gate has not run — no collection exists.
		const collection = await api('/api/collections/gen_draft_only');
		expect(collection.status).toBe(404);
	});

	it('refuses to apply a draft (review required)', async () => {
		const draft = await propose('gen_needs_review');
		const apply = await api(`/api/generation/${draft.body.data!.id}/apply`, { method: 'POST' });
		expect(apply.status).toBe(409);
		// Still no collection.
		expect((await api('/api/collections/gen_needs_review')).status).toBe(404);
	});

	it('walks draft → review → promoted → live and creates the collection once', async () => {
		const draft = await propose('gen_full_flow');
		const id = draft.body.data!.id;

		expect((await api(`/api/generation/${id}/submit`, { method: 'POST' })).body.data).toMatchObject({ status: 'review' });
		expect((await api(`/api/generation/${id}/approve`, { method: 'POST' })).body.data).toMatchObject({ status: 'promoted' });
		const live = await api<ProposalRecord>(`/api/generation/${id}/apply`, { method: 'POST' });
		expect(live.body.data).toMatchObject({ status: 'live', applied_slug: 'gen_full_flow' });

		// The schema now exists, and a replay of apply is a no-op (idempotent).
		expect((await api('/api/collections/gen_full_flow')).status).toBe(200);
		const replay = await api<ProposalRecord>(`/api/generation/${id}/apply`, { method: 'POST' });
		expect(replay.body.data!.applied_slug).toBe('gen_full_flow');
	});

	it('is idempotent — re-proposing identical DNA returns the SAME open proposal', async () => {
		const first = await propose('gen_idempotent');
		const second = await propose('gen_idempotent');
		expect(second.status).toBe(201);
		expect(second.body.data!.id).toBe(first.body.data!.id);
	});

	it('rejects malformed DNA with 400', async () => {
		const res = await api('/api/generation/propose', { method: 'POST', body: JSON.stringify({ dna: { nope: true } }) });
		expect(res.status).toBe(400);
	});

	it('applies patch ops to a tree without persisting anything', async () => {
		const tree = [{ id: 'row', type: 'row', children: [] }];
		const res = await api<{ tree: Array<{ id: string }> }>('/api/generation/patch', {
			method: 'POST',
			body: JSON.stringify({
				tree,
				ops: [{ id: 'o1', op: 'ADD', parent: 'row', node: { id: 'c1', type: 'column' } }],
			}),
		});
		expect(res.status).toBe(200);
		expect(res.body.data!.tree[0]).toMatchObject({ id: 'row' });
	});
});
