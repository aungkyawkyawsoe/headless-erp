/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Bulk operations — the SINGLE-round-trip delete/restore the Studio uses instead
 * of an N-request for-loop. Pins:
 *   - `action: 'delete'` soft-deletes every id in one request;
 *   - `action: 'restore'` (the additive action) brings soft-deleted rows back;
 *   - an unknown action is rejected with 400.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const SLUG = 'zz_bulk_demo';

type ApiBody = { success?: boolean; error?: string; data?: unknown };

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: ApiBody }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...JSON_HEADERS, ...ADMIN, ...(init?.headers ?? {}) },
	});
	return { status: res.status, body: ((await res.json().catch(() => null)) ?? {}) as ApiBody };
}

async function createItem(title: string): Promise<string> {
	const res = await api(`/api/entities/${SLUG}`, { method: 'POST', body: JSON.stringify({ title }) });
	expect(res.status, `create item ${title}`).toBe(201);
	return String((res.body.data as { id: string }).id);
}

async function listCount(trashed: boolean): Promise<number> {
	const res = await api(`/api/entities/${SLUG}?limit=100${trashed ? '&trashed=true' : ''}`);
	expect(res.status).toBe(200);
	return (res.body.data as unknown[]).length;
}

describe('bulk delete / restore — one request for N rows', () => {
	it('deletes N rows in one request, then restores them in one request', async () => {
		// Materialize the collection (idempotent create).
		const created = await api('/api/collections', {
			method: 'POST',
			body: JSON.stringify({
				name: 'ZZ Bulk Demo',
				slug: SLUG,
				fields: [{ name: 'title', type: 'text', label: 'Title', required: false }],
			}),
		});
		expect([201, 400].includes(created.status), `create collection (${created.status})`).toBe(true);

		const id1 = await createItem('one');
		const id2 = await createItem('two');
		const id3 = await createItem('three');
		expect(await listCount(false)).toBe(3);

		// Bulk delete two of them.
		const del = await api(`/api/bulk/${SLUG}`, {
			method: 'POST',
			body: JSON.stringify({ action: 'delete', items: [id1, id2] }),
		});
		expect(del.status).toBe(200);
		const delResults = (del.body.data as { results: Array<{ id?: string; status: string }> }).results;
		expect(delResults.map((r) => r.status)).toEqual(['deleted', 'deleted']);
		expect(await listCount(false)).toBe(1);
		expect(await listCount(true)).toBe(2);

		// Bulk restore both.
		const restore = await api(`/api/bulk/${SLUG}`, {
			method: 'POST',
			body: JSON.stringify({ action: 'restore', items: [id1, id2] }),
		});
		expect(restore.status).toBe(200);
		const restoreResults = (restore.body.data as { results: Array<{ id?: string; status: string }> }).results;
		expect(restoreResults.map((r) => r.status)).toEqual(['restored', 'restored']);
		expect(await listCount(false)).toBe(3);
		expect(id3).toBeTruthy();
	});

	it('rejects an unknown bulk action', async () => {
		const res = await api(`/api/bulk/${SLUG}`, {
			method: 'POST',
			body: JSON.stringify({ action: 'explode', items: [] }),
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toMatch(/create.*update.*delete.*restore/i);
	});
});
