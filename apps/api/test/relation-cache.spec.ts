/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Relation-aware response cache — a read that EXPANDS a relation embeds rows from
 * another collection, so it may only be cached when a write to that collection
 * drops the entry. The engine tags the cache entry with every embedded collection
 * (`readdep:<slug>`) and clears those tags from the write seam.
 *
 * Proof strategy: mutate the embedded row with RAW D1 (bypassing the invalidation
 * seam). A still-old value proves the read was genuinely served from the cache;
 * then a write THROUGH the entity API must make the next read see the new value,
 * proving the dependency tag (not just the own-collection pattern) is what cleared it.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function api(
	path: string,
	init?: RequestInit,
): Promise<{ status: number; body: { success?: boolean; error?: string; data?: unknown } }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...JSON_HEADERS, ...ADMIN, ...(init?.headers ?? {}) },
	});
	return { status: res.status, body: (await res.json().catch(() => null)) ?? {} };
}

const CHILD = 'rc_child';
const PARENT = 'rc_parent';

beforeAll(async () => {
	const child = await api('/api/collections', {
		method: 'POST',
		body: JSON.stringify({
			name: 'Relation Cache Child',
			slug: CHILD,
			description: null,
			fields: [{ name: 'name', type: 'text', label: 'Name', required: false }],
		}),
	});
	expect(child.status, child.body.error).toBe(201);
	const parent = await api('/api/collections', {
		method: 'POST',
		body: JSON.stringify({
			name: 'Relation Cache Parent',
			slug: PARENT,
			description: null,
			fields: [
				{ name: 'title', type: 'text', label: 'Title', required: false },
				{ name: 'child', type: 'm2o', label: 'Child', required: false, related_collection: CHILD },
			],
		}),
	});
	expect(parent.status, parent.body.error).toBe(201);
});

/** Read the first parent with its embedded child and return the child's name. */
async function readParentChildName(): Promise<unknown> {
	const res = await api(`/api/entities/${PARENT}?fields=id,child`);
	expect(res.status, res.body.error).toBe(200);
	const row = (res.body.data as Array<Record<string, unknown>>)[0];
	return (row?.child as Record<string, unknown> | undefined)?.name;
}

describe('relation-aware response cache', () => {
	it('caches a relation-expanded read, then drops it when the embedded collection is written', async () => {
		const c = await api(`/api/entities/${CHILD}`, { method: 'POST', body: JSON.stringify({ name: 'ALPHA' }) });
		expect(c.status, c.body.error).toBe(201);
		const childId = (c.body.data as { id: string }).id;

		const p = await api(`/api/entities/${PARENT}`, { method: 'POST', body: JSON.stringify({ title: 'P', child: childId }) });
		expect(p.status, p.body.error).toBe(201);

		// First read populates the cache with the embedded child "ALPHA".
		expect(await readParentChildName()).toBe('ALPHA');

		// Mutate the CHILD with raw D1 — this bypasses invalidateCollectionReads, so
		// seeing the OLD value below proves the read was served from the cache.
		await env.DB.prepare(`UPDATE cms_${CHILD} SET name = ? WHERE id = ?`).bind('BETA', childId).run();
		expect(await readParentChildName()).toBe('ALPHA');

		// A write through the ENTITY API fires invalidateCollectionReads(child), which
		// clears the dependency tag — the next read must reflect the new child value.
		const w = await api(`/api/entities/${CHILD}/${childId}`, { method: 'PUT', body: JSON.stringify({ name: 'GAMMA' }) });
		expect(w.status, w.body.error).toBe(200);
		expect(await readParentChildName()).toBe('GAMMA');
	});

	it('a lean projection and an expanded projection of the same row never share a cache entry', async () => {
		// Different canonical URL ⇒ different key, so an expanded read can never be
		// served a lean cached body (or vice versa).
		const lean = await api(`/api/entities/${PARENT}?fields=id,title`);
		expect(lean.status, lean.body.error).toBe(200);
		const leanRow = (lean.body.data as Array<Record<string, unknown>>)[0];
		expect(leanRow.title).toBeDefined();
		expect('child' in leanRow).toBe(false);

		const expanded = await api(`/api/entities/${PARENT}?fields=id,child`);
		expect('child' in (expanded.body.data as Array<Record<string, unknown>>)[0]).toBe(true);

		// Re-read the lean one — a shared entry would have leaked the child into it.
		const again = await api(`/api/entities/${PARENT}?fields=id,title`);
		expect('child' in (again.body.data as Array<Record<string, unknown>>)[0]).toBe(false);
	});
});
