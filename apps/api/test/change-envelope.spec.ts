/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { pluginHookRegistry } from '@/core/plugin-hooks';

/**
 * Change envelope — every write response names the collections it changed, so a
 * client can invalidate precisely instead of nuking a whole domain.
 *
 * `meta.changed = { collections: string[], rows: Record<string, string[]> }` is
 * attached by `success()` from the request-scoped collector that every existing
 * `invalidateCollectionReads(...)` call feeds (primary row + cascade parents +
 * hook/denorm writes). Reads carry no such key.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface Envelope {
	status: number;
	body: { success?: boolean; data?: any; meta?: { changed?: { collections?: string[]; rows?: Record<string, string[]> } } };
}

async function api(path: string, init?: RequestInit): Promise<Envelope> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...JSON_HEADERS, ...ADMIN, ...(init?.headers ?? {}) },
	});
	const parsed = (await res.json().catch(() => null)) as Envelope['body'] | null;
	return { status: res.status, body: parsed ?? {} };
}

let created = 0;

async function makeCollection(): Promise<string> {
	const slug = `ce_docs_${++created}`;
	const res = await api('/api/collections', {
		method: 'POST',
		body: JSON.stringify({
			name: `Change Envelope ${created}`,
			slug,
			description: null,
			fields: [{ name: 'title', type: 'text', label: 'Title', required: false }],
		}),
	});
	expect(res.status, `create ${slug}`).toBe(201);
	return slug;
}

const field = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
	name,
	type,
	// Engine rule: a field is NOT NULL unless `required: false` is explicit.
	...(extra.required === undefined ? { required: false } : {}),
	...extra,
});

async function createCollection(slug: string, name: string, fields: Array<Record<string, unknown>>) {
	const res = await api('/api/collections', { method: 'POST', body: JSON.stringify({ name, slug, fields }) });
	expect(res.status, `create ${slug}`).toBe(201);
}

describe('change envelope (meta.changed)', () => {
	it('a create names the collection and the new row id', async () => {
		const slug = await makeCollection();
		const res = await api(`/api/entities/${slug}`, { method: 'POST', body: JSON.stringify({ title: 'a' }) });

		expect(res.status).toBe(201);
		const changed = res.body.meta?.changed;
		expect(changed?.collections).toContain(slug);
		expect(changed?.rows?.[slug]).toContain(res.body.data.id);
	});

	it('an update names the collection and the edited row id', async () => {
		const slug = await makeCollection();
		const created = await api(`/api/entities/${slug}`, { method: 'POST', body: JSON.stringify({ title: 'a' }) });
		const id = created.body.data.id as string;

		const res = await api(`/api/entities/${slug}/${id}`, { method: 'PUT', body: JSON.stringify({ title: 'b' }) });
		expect(res.status).toBe(200);
		const changed = res.body.meta?.changed;
		expect(changed?.collections).toContain(slug);
		expect(changed?.rows?.[slug]).toContain(id);
	});

	it('a soft delete names the collection and the removed row id', async () => {
		const slug = await makeCollection();
		const created = await api(`/api/entities/${slug}`, { method: 'POST', body: JSON.stringify({ title: 'a' }) });
		const id = created.body.data.id as string;

		const res = await api(`/api/entities/${slug}/${id}`, { method: 'DELETE' });
		expect(res.status).toBe(200);
		expect(res.body.meta?.changed?.rows?.[slug]).toContain(id);
	});

	it('a read carries no change envelope', async () => {
		const slug = await makeCollection();
		await api(`/api/entities/${slug}`, { method: 'POST', body: JSON.stringify({ title: 'a' }) });

		const res = await api(`/api/entities/${slug}`);
		expect(res.status).toBe(200);
		expect(res.body.meta?.changed).toBeUndefined();
	});

	it('includes a collection a fire-and-forget hook writes (denorm)', async () => {
		// A compiled after_insert hook that REWRITES another collection (declared via
		// `writesTo`) runs fire-and-forget, so it completes AFTER the response is
		// built. The envelope must capture the declaration at dispatch time or the
		// client never refreshes the target collection.
		await createCollection('orders', 'Orders', [field('title', 'text', { required: true })]);
		await createCollection('order_stats', 'Order Stats', [field('count', 'number')]);

		pluginHookRegistry.createAPI('test-denorm').on({
			collection: 'orders',
			event: 'after_insert',
			writesTo: ['order_stats'],
			handler: async () => {},
		});

		const res = await api('/api/entities/orders', { method: 'POST', body: JSON.stringify({ title: 'a' }) });
		expect(res.status).toBe(201);
		expect(res.body.meta?.changed?.collections).toContain('orders');
		expect(res.body.meta?.changed?.collections).toContain('order_stats');
	});
});
