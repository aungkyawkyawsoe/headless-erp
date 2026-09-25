/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * FACTORY COMPACT APP DSL — the token-cheap way an agent describes an app.
 *
 * The point of the compact form is that it is an ENCODING, not a second engine:
 * `app` decodes to a manifest and then runs the SAME validator, planner and
 * writer as `manifest`. These specs pin that both encodings produce the same
 * result, and that a malformed line is reported, never guessed.
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
async function api<T>(path: string): Promise<{ status: number; data?: T }> {
	const res = await SELF.fetch(`${BASE}${path}`, { headers: JSON_HEADERS });
	const body = (await res.json().catch(() => ({}))) as { data?: T };
	return { status: res.status, data: body.data };
}

const APP = {
	v: 1,
	cols: [
		{ s: 'dsl_supplier', n: 'DSL Supplier', f: ['name:text!', 'email:email'] },
		{
			s: 'dsl_po',
			n: 'DSL Purchase Order',
			f: ['code:text!', 'total:cur', 'supplier:m2o>dsl_supplier', 'status:sel(draft,approved)'],
		},
	],
	pages: [{ p: '/dsl-orders', t: 'DSL Orders', b: [{ id: 't1', type: 'table', layout: { order: 0 }, config: { collection: 'dsl_po' } }] }],
	roles: ['DSL Clerk'],
	grants: [{ r: 'DSL Clerk', c: 'dsl_po', can: 'rwc' }],
	kpis: [{ n: 'DSL PO Count', c: 'dsl_po', agg: 'count' }],
};

interface ApplyResult {
	plan: { warnings: string[]; summary: { create: number } };
	results: Array<{ target: string; ok: boolean; error?: string }>;
}

describe('compact App DSL over the control plane', () => {
	it('plan accepts the compact form and reports no warnings for a clean app', async () => {
		const plan = await tool<{ warnings: string[]; actions: Array<{ target: string; kind: string }> }>('plan_manifest', { app: APP });
		expect(plan.warnings).toEqual([]);
		expect(plan.actions.some((a) => a.target === 'collection:dsl_po' && a.kind === 'create')).toBe(true);
		expect(plan.actions.some((a) => a.target === 'role:DSL Clerk')).toBe(true);
	});

	it('apply builds the same app a full manifest would', async () => {
		const applied = await tool<ApplyResult>('apply_manifest', { app: APP });
		expect(applied.results.filter((r) => !r.ok)).toEqual([]);

		// schema + relation + select options + required flag survived the shorthand
		const schema = await api<{
			schema_json: { fields: Array<{ name: string; type: string; required?: boolean; related_collection?: string; options?: string[] }> };
		}>('/api/collections/dsl_po');
		expect(schema.status).toBe(200);
		const fields = schema.data!.schema_json.fields;
		expect(fields.find((f) => f.name === 'code')?.required).toBe(true);
		expect(fields.find((f) => f.name === 'total')?.type).toBe('currency');
		expect(fields.find((f) => f.name === 'supplier')?.related_collection).toBe('dsl_supplier');
		expect(fields.find((f) => f.name === 'status')?.options).toEqual(['draft', 'approved']);

		// governance + UI + analytics
		const roles = await api<Array<{ name: string }>>('/api/users/roles');
		expect((roles.data ?? []).some((r) => r.name === 'DSL Clerk')).toBe(true);
		const pages = await api<Array<{ path: string; blocks: unknown[] }>>('/api/pages');
		expect((pages.data ?? []).find((p) => p.path === '/dsl-orders')?.blocks).toHaveLength(1);
		const kpis = await api<Array<{ name: string }>>('/api/kpis');
		expect((kpis.data ?? []).some((k) => k.name === 'DSL PO Count')).toBe(true);
	});

	it('reports a broken line and still builds the rest (no guessing)', async () => {
		const applied = await tool<ApplyResult>('apply_manifest', {
			app: {
				v: 1,
				cols: [{ s: 'dsl_partial', f: ['ok:text', 'garbage-no-colon'] }],
				grants: [{ r: 'DSL Clerk', c: 'dsl_partial', can: 'rq' }],
			},
		});
		expect(applied.plan.warnings.join(' ')).toContain('malformed field "garbage-no-colon"');
		expect(applied.plan.warnings.join(' ')).toContain('unknown permission letter "q"');
		const schema = await api<{ schema_json: { fields: Array<{ name: string }> } }>('/api/collections/dsl_partial');
		const names = schema.data!.schema_json.fields.map((f) => f.name);
		expect(names).toContain('ok');
		expect(names).not.toContain('garbage-no-colon');
	});
});
