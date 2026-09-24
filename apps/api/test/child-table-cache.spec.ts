/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * A `table`-field (composite document) write lands its rows in the CHILD
 * collection's own table, so the write must drop the CHILD collection's cached
 * reads — invalidating only the parent slugs leaves a reader of those rows (the
 * document page's own line read, keyed on the child collection) serving the
 * PRE-SAVE lines until the response cache's TTL. A parent could be saved — its
 * children replaced delete-and-recreate — and reopening it showed the old lines.
 *
 * Proof strategy: fill the child read's cache, then prove the entry is LIVE with a
 * RAW D1 mutation (which bypasses the invalidation seam) — the read still answers
 * the old body, so a cache entry really exists. A composite PUT through the ENTITY
 * API must then make the very next read reflect the replaced child set, which is
 * exactly what failed before the fix (the row count stayed at the old value).
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const PARENT = 'ctc_parent';
const CHILD = 'ctc_child';

async function api(
	path: string,
	init?: RequestInit,
): Promise<{
	status: number;
	body: {
		success?: boolean;
		error?: string;
		data?: unknown;
		meta?: { changed?: { collections?: string[] } };
	};
}> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...JSON_HEADERS, ...ADMIN, ...(init?.headers ?? {}) },
	});
	return { status: res.status, body: (await res.json().catch(() => null)) ?? {} };
}

/** The parent's children as the DOCUMENT PAGE reads them — keyed on the child slug. */
async function readChildren(parentId: string): Promise<Array<Record<string, unknown>>> {
	const res = await api(`/api/entities/${CHILD}?filter[parent_id][_eq]=${parentId}&fields=id,label,parent_id&sort=id`);
	expect(res.status, res.body.error).toBe(200);
	return res.body.data as Array<Record<string, unknown>>;
}

beforeAll(async () => {
	const child = await api('/api/collections', {
		method: 'POST',
		body: JSON.stringify({
			name: 'Child Table Cache Child',
			slug: CHILD,
			description: null,
			fields: [
				{ name: 'label', type: 'text', label: 'Label', required: false },
				{ name: 'parent_id', type: 'text', label: 'Parent', required: false },
			],
		}),
	});
	expect(child.status, child.body.error).toBe(201);
	const parent = await api('/api/collections', {
		method: 'POST',
		body: JSON.stringify({
			name: 'Child Table Cache Parent',
			slug: PARENT,
			description: null,
			fields: [
				{ name: 'title', type: 'text', label: 'Title', required: false },
				{ name: 'lines', type: 'table', label: 'Lines', required: false, related_collection: CHILD },
			],
		}),
	});
	expect(parent.status, parent.body.error).toBe(201);
});

describe('a composite write drops the CHILD collection’s cached reads', () => {
	it('a PUT that replaces the children makes the next child read show the replaced set', async () => {
		const created = await api(`/api/entities/${PARENT}`, {
			method: 'POST',
			body: JSON.stringify({ title: 'P', lines: [{ label: 'one' }, { label: 'two' }] }),
		});
		expect(created.status, created.body.error).toBe(201);
		const parentId = (created.body.data as { id: string }).id;

		// First read fills the child collection's cache for this exact URL.
		const first = await readChildren(parentId);
		expect(first).toHaveLength(2);

		// Mutate the child with RAW D1 — bypassing the invalidation seam — so seeing
		// the OLD body below proves the entry is genuinely live, not a fresh read.
		const anyChild = first[0].id as string;
		await env.DB.prepare(`UPDATE cms_${CHILD} SET label = ? WHERE id = ?`).bind('MUTATED', anyChild).run();
		expect((await readChildren(parentId)).map((row) => row.label)).toContain('one');

		// Replace the child set through the ENTITY API (one line left). The write must
		// drop the child collection's reads as part of itself.
		const put = await api(`/api/entities/${PARENT}/${parentId}`, {
			method: 'PUT',
			body: JSON.stringify({ title: 'P', lines: [{ label: 'only' }] }),
		});
		expect(put.status, put.body.error).toBe(200);

		const after = await readChildren(parentId);
		expect(after).toHaveLength(1);
		expect(after[0].label).toBe('only');
	});

	it('a composite CREATE drops them too — a child-list read cannot miss the rows it just added', async () => {
		// Warm the CHILD collection's UNFILTERED list (a real screen reads exactly this,
		// and it is cached under the child slug). Creating a parent adds child rows, so
		// that cached body must be dropped by the same write.
		const before = await api(`/api/entities/${CHILD}?fields=id,label&sort=id&limit=500`);
		expect(before.status, before.body.error).toBe(200);
		expect((before.body.data as Array<{ label: string }>).some((row) => row.label === 'fresh')).toBe(false);

		const created = await api(`/api/entities/${PARENT}`, {
			method: 'POST',
			body: JSON.stringify({ title: 'Q', lines: [{ label: 'fresh' }] }),
		});
		expect(created.status, created.body.error).toBe(201);

		const after = await api(`/api/entities/${CHILD}?fields=id,label&sort=id&limit=500`);
		expect(after.status, after.body.error).toBe(200);
		expect((after.body.data as Array<{ label: string }>).some((row) => row.label === 'fresh')).toBe(true);
	});

	it('names the CHILD collection in the write’s change envelope, so clients drop it too', async () => {
		const created = await api(`/api/entities/${PARENT}`, {
			method: 'POST',
			body: JSON.stringify({ title: 'R', lines: [{ label: 'enveloped' }] }),
		});
		expect(created.status, created.body.error).toBe(201);
		const parentId = (created.body.data as { id: string }).id;

		const put = await api(`/api/entities/${PARENT}/${parentId}`, {
			method: 'PUT',
			body: JSON.stringify({ title: 'R', lines: [{ label: 'enveloped twice' }] }),
		});
		expect(put.status, put.body.error).toBe(200);
		const changed = put.body.meta?.changed;
		expect(changed?.collections).toContain(CHILD);
		expect(changed?.collections).toContain(PARENT);
	});
});
