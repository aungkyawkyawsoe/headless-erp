/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Generation — the rest of the pipeline:
 *   - prompt → DNA (deterministic; no LLM),
 *   - relation → m2o materialization on apply (when the target exists),
 *   - the learning loop (a review edit becomes a rule for the next proposal).
 */

const BASE_URL = 'http://localhost';
const AUTH = { Authorization: 'Bearer dev-token' };
const AUTH_JSON = { 'Content-Type': 'application/json', ...AUTH };

interface Res<T> {
	status: number;
	body: { success?: boolean; data?: T; error?: string; code?: string };
}

async function api<T>(path: string, init?: RequestInit): Promise<Res<T>> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, { ...init, headers: { ...AUTH_JSON, ...(init?.headers ?? {}) } });
	const body = (await res.json().catch(() => null)) as Res<T>['body'] | null;
	return { status: res.status, body: body ?? {} };
}

interface Record_ {
	id: string;
	status: string;
	proposal: {
		collection: { slug: string; fields: Array<{ name: string; type: string; related_collection?: string; inference: { reason: string } }> };
	};
}

async function propose(body: Record<string, unknown>): Promise<Res<Record_>> {
	return api<Record_>('/api/generation/propose', { method: 'POST', body: JSON.stringify(body) });
}

async function walkToLive(id: string): Promise<void> {
	expect((await api(`/api/generation/${id}/submit`, { method: 'POST' })).status).toBe(200);
	expect((await api(`/api/generation/${id}/approve`, { method: 'POST' })).status).toBe(200);
	expect((await api(`/api/generation/${id}/apply`, { method: 'POST' })).status).toBe(200);
}

async function createParent(slug: string): Promise<void> {
	const res = await api('/api/collections', {
		method: 'POST',
		body: JSON.stringify({ name: slug, slug, fields: [{ name: 'title', type: 'text', required: false }] }),
	});
	expect([201, 409]).toContain(res.status);
}

describe('generation — prompt, relations, learning', () => {
	it('maps a bare prompt to a proposal deterministically (no LLM)', async () => {
		const res = await propose({
			collection: { name: 'Invoices', slug: 'gen_prompt_invoice' },
			prompt: 'Invoices with invoice number, amount: currency, issue date, is paid',
		});
		expect(res.status).toBe(201);
		const types = res.body.data!.proposal.collection.fields.map((f) => f.type);
		expect(types).toContain('currency');
		expect(types).toContain('date');
		expect(types).toContain('boolean');
	});

	it('materializes a declared relation as an m2o field when the parent exists', async () => {
		await createParent('gen_parent');
		const dna = {
			source: { provider: 'manual' as const },
			screens: [
				{
					id: 'gen_child',
					anatomy: 'child rows',
					components: [{ kind: 'form', hints: [{ label: 'Row Label' }] }],
					relations: [{ from: 'gen_parent', to: 'gen_child', cardinality: 'many' as const }],
				},
			],
		};
		const draft = await propose({ collection: { name: 'Gen Child', slug: 'gen_child' }, dna });
		expect(draft.status).toBe(201);
		// The relation is visible on the proposal as an m2o before anything is written.
		const relationField = draft.body.data!.proposal.collection.fields.find((f) => f.type === 'm2o');
		expect(relationField).toMatchObject({ name: 'gen_parent', related_collection: 'gen_parent' });

		await walkToLive(draft.body.data!.id);
		const info = await api<{ schema_json: { fields: Array<{ name: string; type: string; related_collection?: string }> } }>(
			'/api/collections/gen_child',
		);
		const applied = info.body.data!.schema_json.fields.find((f) => f.name === 'gen_parent');
		expect(applied).toMatchObject({ type: 'm2o', related_collection: 'gen_parent' });
	});

	it('learns from a review edit and applies it to the next proposal', async () => {
		const a = await propose({ collection: { name: 'Learn A', slug: 'gen_learn_a' }, prompt: 'Learn A with reward' });
		expect(a.body.data!.proposal.collection.fields[0]).toMatchObject({ name: 'reward', type: 'text' });

		// A human corrects reward → percent during review.
		const edited = await api<Record_>(`/api/generation/${a.body.data!.id}/fields`, {
			method: 'PATCH',
			body: JSON.stringify({ fields: [{ name: 'reward', type: 'percent' }] }),
		});
		expect(edited.status).toBe(200);
		expect(edited.body.data!.proposal.collection.fields[0].type).toBe('percent');

		// The NEXT proposal with the same field name uses the learned type.
		const b = await propose({ collection: { name: 'Learn B', slug: 'gen_learn_b' }, prompt: 'Learn B with reward' });
		const learned = b.body.data!.proposal.collection.fields[0];
		expect(learned.type).toBe('percent');
		expect(learned.inference.reason).toContain('learned');
	});
});
