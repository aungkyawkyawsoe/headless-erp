/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Generic integrity engine — a collection declares `policies.integrity.rules`
 * and `GET /api/collections/:slug/integrity` runs them as bounded reads:
 * orphan / aggregate_mismatch / duplicate / stale. No domain code.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const AUTH_JSON = { ...JSON_HEADERS, ...ADMIN };

interface Res<T> {
	status: number;
	body: { success?: boolean; data?: T; error?: string };
}

async function api<T>(path: string, init?: RequestInit): Promise<Res<T>> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, { ...init, headers: { ...AUTH_JSON, ...(init?.headers ?? {}) } });
	const body = (await res.json().catch(() => null)) as Res<T>['body'] | null;
	return { status: res.status, body: body ?? {} };
}

const field = (name: string, type: string, extra: Record<string, unknown> = {}) => ({ name, type, required: false, ...extra });

async function createCollection(slug: string, fields: Array<Record<string, unknown>>): Promise<void> {
	const res = await api('/api/collections', { method: 'POST', body: JSON.stringify({ name: slug, slug, description: null, fields }) });
	expect([201, 409], `${slug}: ${res.status} ${res.body.error ?? ''}`).toContain(res.status);
}

async function createRow(slug: string, body: Record<string, unknown>): Promise<string> {
	const res = await api<{ id: string }>(`/api/entities/${slug}`, { method: 'POST', body: JSON.stringify(body) });
	expect(res.status).toBe(201);
	return res.body.data!.id;
}

interface IntegrityResult {
	enabled: boolean;
	checked: number;
	violations: number;
	results: Array<{ rule: { type: string }; count: number; truncated: boolean; rows: Array<Record<string, unknown>> }>;
	errors: Array<{ error: string }>;
}

describe('generic integrity engine', () => {
	let orderDrift = '';
	let orderOrphan = '';
	let orderStale = '';
	let codeDup = '';

	beforeAll(async () => {
		await createCollection('customers', [field('name', 'text')]);
		await createCollection('orders', [
			field('code', 'text'),
			field('total', 'number'),
			field('customer', 'm2o', { related_collection: 'customers' }),
		]);
		await createCollection('order_lines', [field('order_ref', 'm2o', { related_collection: 'orders' }), field('amount', 'number')]);

		const c1 = await createRow('customers', { name: 'Acme' });

		// A1: total 100 but its line sums to 40 → aggregate_mismatch.
		orderDrift = await createRow('orders', { code: 'A', total: 100, customer: c1 });
		await createRow('order_lines', { order_ref: orderDrift, amount: 40 });

		// A2: points at a missing customer → orphan.
		orderOrphan = await createRow('orders', { code: 'B', total: 0, customer: '00000000-0000-4000-8000-00000000dead' });

		// A3/A4: the same code → duplicate.
		codeDup = 'DUP';
		await createRow('orders', { code: codeDup, total: 0, customer: c1 });
		await createRow('orders', { code: codeDup, total: 0, customer: c1 });

		// A5: updated long ago → stale.
		orderStale = await createRow('orders', { code: 'C', total: 0, customer: c1 });
		await env.DB.prepare('UPDATE cms_orders SET updated_at = ? WHERE id = ?').bind('2020-01-01 00:00:00', orderStale).run();

		// Declare the rules via the policy control plane.
		const put = await api('/api/collections/orders/policies', {
			method: 'PUT',
			body: JSON.stringify({
				integrity: {
					enabled: true,
					limit: 50,
					rules: [
						{ type: 'orphan', field: 'customer' },
						{
							type: 'aggregate_mismatch',
							field: 'total',
							child: { collection: 'order_lines', fk: 'order_ref', field: 'amount' },
							fn: 'sum',
						},
						{ type: 'duplicate', fields: ['code'] },
						{ type: 'stale', field: 'updated_at', max_age_days: 1 },
					],
				},
			}),
		});
		expect(put.status).toBe(200);
	});

	it('reports each declared anomaly type', async () => {
		const res = await api<IntegrityResult>('/api/collections/orders/integrity');
		expect(res.status).toBe(200);
		const data = res.body.data!;
		expect(data.enabled).toBe(true);
		expect(data.checked).toBe(4);
		expect(data.errors).toEqual([]);

		const byType = (t: string) => data.results.find((r) => r.rule.type === t)!;

		const orphan = byType('orphan');
		expect(orphan.rows.map((r) => r.id)).toContain(orderOrphan);

		const agg = byType('aggregate_mismatch');
		const aggRow = agg.rows.find((r) => r.id === orderDrift)!;
		expect(Number(aggRow.stored)).toBe(100);
		expect(Number(aggRow.derived)).toBe(40);

		const dup = byType('duplicate');
		expect(dup.rows.some((r) => r.code === codeDup)).toBe(true);

		const stale = byType('stale');
		expect(stale.rows.map((r) => r.id)).toContain(orderStale);

		expect(data.violations).toBeGreaterThan(0);
	});

	it('is disabled (200) when the collection declares no integrity policy', async () => {
		const res = await api<IntegrityResult>('/api/collections/order_lines/integrity');
		expect(res.status).toBe(200);
		expect(res.body.data!.enabled).toBe(false);
	});

	it('rejects a malformed rule at write time', async () => {
		const res = await api('/api/collections/order_lines/policies', {
			method: 'PUT',
			body: JSON.stringify({ integrity: { enabled: true, rules: [{ type: 'nonsense' }] } }),
		});
		expect(res.status).toBe(400);
	});

	it('404s for an unknown collection', async () => {
		const res = await api('/api/collections/does_not_exist/integrity');
		expect(res.status).toBe(404);
	});
});
