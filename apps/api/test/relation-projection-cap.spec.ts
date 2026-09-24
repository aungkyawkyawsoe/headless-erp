/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Relation expansion over-fetch guards (m2m + child tables):
 *
 *   1. m2m targets are fetched with the caller's projection (`tags.name` →
 *      { id, name } — no `*` then JS-prune) and capped per parent (default 50,
 *      mirrors the o2m path; `?o2m_limit=` raises it).
 *   2. child-table children are capped per parent the same way (a page of rows
 *      never materializes every child of every parent).
 *   3. the bulk import route creates rows with bounded concurrency (rows are
 *      independent) — used here to seed the 60 tags.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

let seq = 0;
function nextSlug(prefix: string): string {
	seq += 1;
	return `${prefix}_cap_${seq}`;
}

async function createCollection(slug: string, fields: Array<Record<string, unknown>>): Promise<Response> {
	return SELF.fetch(`${BASE_URL}/api/collections`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify({ name: `Cap ${slug}`, slug, fields }),
	});
}

async function createItem(collection: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
	const res = await SELF.fetch(`${BASE_URL}/api/entities/${collection}`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify(body),
	});
	expect(res.status).toBe(201);
	return ((await res.json()) as { data: Record<string, unknown> }).data;
}

describe('m2m + child-table expansion over-fetch guards', () => {
	it('m2m targets narrow to the requested projection and cap at 50 per parent (o2m_limit override)', async () => {
		const tagSlug = nextSlug('tags');
		const postSlug = nextSlug('posts');
		expect(
			(
				await createCollection(tagSlug, [
					{ name: 'name', type: 'text', required: true },
					{ name: 'color', type: 'text', required: false },
					{ name: 'is_hot', type: 'boolean', required: false },
				])
			).status,
		).toBe(201);
		expect(
			(
				await createCollection(postSlug, [
					{ name: 'title', type: 'text', required: true },
					{ name: 'tags', type: 'm2m', required: false, related_collection: tagSlug },
				])
			).status,
		).toBe(201);

		// Seed 60 tags through the bulk IMPORT route (rows are independent — the
		// route pools them; no naming series here, so every row must land).
		const tagsPayload = {
			format: 'json',
			data: Array.from({ length: 60 }, (_, i) => ({ name: `tag_${i}`, color: `c${i}`, is_hot: i % 2 === 0 })),
		};
		const importRes = await SELF.fetch(`${BASE_URL}/api/entities/${tagSlug}/import`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify(tagsPayload),
		});
		expect(importRes.status).toBe(200);
		expect(((await importRes.json()) as { data: { imported: number; errors: unknown[] } }).data).toEqual({ imported: 60, errors: [] });

		const tagIds = (
			(await (await SELF.fetch(`${BASE_URL}/api/entities/${tagSlug}?limit=100&fields=id`, { headers: ADMIN })).json()) as {
				data: { id: string }[];
			}
		).data.map((t) => t.id);
		expect(tagIds.length).toBe(60);

		const post = await createItem(postSlug, { title: 'Linked', tags: tagIds });

		// Projected path: { id, name } only (no full-row transfer, no system cols).
		const projected = await SELF.fetch(`${BASE_URL}/api/entities/${postSlug}/${post.id}?fields=title,tags.name`, { headers: ADMIN });
		expect(projected.status).toBe(200);
		const projRow = ((await projected.json()) as { data: Record<string, unknown> }).data;
		expect(projRow.title).toBe('Linked');
		const projTags = projRow.tags as Array<Record<string, unknown>>;
		expect(projTags).toHaveLength(50); // per-parent cap (default 50)
		expect(projTags[0]).toEqual({ id: expect.any(String), name: expect.any(String) });
		for (const t of projTags) expect(Object.keys(t).sort()).toEqual(['id', 'name']);

		// Full-row request stays full (no projection regressions on `tags.*`).
		const full = await SELF.fetch(`${BASE_URL}/api/entities/${postSlug}/${post.id}?fields=tags.*`, { headers: ADMIN });
		expect(full.status).toBe(200);
		const fullTags = ((await full.json()) as { data: Record<string, unknown> }).data.tags as Array<Record<string, unknown>>;
		expect(fullTags).toHaveLength(50);
		expect(fullTags[0]).toHaveProperty('name');
		expect(fullTags[0]).toHaveProperty('color');
		expect(typeof (fullTags[0] as Record<string, unknown>).is_hot).toBe('boolean'); // decoded inside the relation too

		// ?o2m_limit= raises the same cap on the m2m path (all 60 come back).
		// The override is a LIST-read parameter (detail reads stay at 50).
		const raised = await SELF.fetch(`${BASE_URL}/api/entities/${postSlug}?limit=5&fields=title,tags.name&o2m_limit=500`, {
			headers: ADMIN,
		});
		expect(raised.status).toBe(200);
		const raisedRow = ((await raised.json()) as { data: Array<Record<string, unknown>> }).data.find((r) => r.id === post.id);
		const raisedTags = (raisedRow as Record<string, unknown>).tags as Array<Record<string, unknown>>;
		expect(raisedTags).toHaveLength(60);
	});

	it('child-table children cap at 50 per parent', async () => {
		const lineSlug = nextSlug('inv_lines');
		const invSlug = nextSlug('invoices');
		expect(
			(
				await createCollection(lineSlug, [
					// Child rows link back via an explicit parent_id field (canonical recipe).
					{ name: 'parent_id', type: 'text', required: false },
					{ name: 'product', type: 'text', required: true },
					{ name: 'qty', type: 'integer', required: true },
				])
			).status,
		).toBe(201);
		expect(
			(
				await createCollection(invSlug, [
					{ name: 'customer', type: 'text', required: true },
					{ name: 'items', type: 'table', required: false, related_collection: lineSlug },
				])
			).status,
		).toBe(201);

		// Embedded child rows (parent + children in one create — 60 lines).
		const inv = await createItem(invSlug, {
			customer: 'Acme',
			items: Array.from({ length: 60 }, (_, i) => ({ product: `p${i}`, qty: i + 1 })),
		});

		const res = await SELF.fetch(`${BASE_URL}/api/entities/${invSlug}/${inv.id}?fields=*,items`, { headers: ADMIN });
		expect(res.status).toBe(200);
		const row = ((await res.json()) as { data: Record<string, unknown> }).data;
		const items = row.items as Array<Record<string, unknown>>;
		expect(items).toHaveLength(50); // per-parent cap (default 50), same as o2m/m2m
		// Kept rows are the id-ordered first 50 of the 60 created — every qty is one
		// of the originals, none duplicated.
		const qtys = items.map((l) => l.qty as number);
		expect(new Set(qtys).size).toBe(50);
		expect(qtys.every((q) => Number.isInteger(q) && q >= 1 && q <= 60)).toBe(true);
		// No `:1` duplicated columns and no internal window rank leaks.
		for (const line of items) {
			expect(Object.keys(line).filter((k) => /:\d+$/.test(k))).toEqual([]);
			expect(line).not.toHaveProperty('_ct_rn');
			expect(line).not.toHaveProperty('parent_id');
		}
	});
});
