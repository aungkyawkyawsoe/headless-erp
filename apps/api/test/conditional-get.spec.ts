/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Conditional GET — `success()` stamps a weak ETag (a hash of the exact bytes)
 * on every 200 GET, and a matching `If-None-Match` answers 304 with no body.
 *
 * Because the tag IS the content, it needs no version to store and no
 * invalidation: a write changes the bytes, which changes the tag, which turns
 * the next revalidation back into a 200. These tests pin that contract on the
 * entity read routes (list + detail), the ones a miniapp refetches constantly.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

let created = 0;

async function makeCollection(): Promise<string> {
	const slug = `cg_docs_${++created}`;
	const res = await SELF.fetch(`${BASE_URL}/api/collections`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify({
			name: `Conditional GET ${created}`,
			slug,
			description: null,
			fields: [{ name: 'title', type: 'text', label: 'Title', required: false }],
		}),
	});
	expect(res.status, `create ${slug}`).toBe(201);
	return slug;
}

/** Raw GET — headers matter here, so no envelope unwrapping. */
function get(path: string, headers: Record<string, string> = {}) {
	return SELF.fetch(`${BASE_URL}${path}`, { headers: { ...ADMIN, ...headers } });
}

async function createRow(slug: string, title: string): Promise<string> {
	const res = await SELF.fetch(`${BASE_URL}/api/entities/${slug}`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify({ title }),
	});
	expect(res.status).toBe(201);
	return ((await res.json()) as { data: { id: string } }).data.id;
}

describe('conditional GET (ETag / 304)', () => {
	it('a read returns a weak ETag and a matching If-None-Match gets a bodiless 304', async () => {
		const slug = await makeCollection();
		await createRow(slug, 'a');

		const first = await get(`/api/entities/${slug}`);
		expect(first.status).toBe(200);
		const etag = first.headers.get('ETag');
		expect(etag).toMatch(/^W\/"/);

		const second = await get(`/api/entities/${slug}`, { 'If-None-Match': etag as string });
		expect(second.status).toBe(304);
		expect(await second.text()).toBe('');
		// Revalidation keeps the same tag — the client's copy is still current.
		expect(second.headers.get('ETag')).toBe(etag);
	});

	it('a write changes the representation, so the stale tag no longer matches', async () => {
		const slug = await makeCollection();
		await createRow(slug, 'a');

		const etag = (await get(`/api/entities/${slug}`)).headers.get('ETag') as string;

		await createRow(slug, 'b');

		const after = await get(`/api/entities/${slug}`, { 'If-None-Match': etag });
		expect(after.status).toBe(200);
		expect(after.headers.get('ETag')).not.toBe(etag);
	});

	it('covers detail reads too', async () => {
		const slug = await makeCollection();
		const id = await createRow(slug, 'a');

		const first = await get(`/api/entities/${slug}/${id}`);
		expect(first.status).toBe(200);
		const etag = first.headers.get('ETag') as string;

		const second = await get(`/api/entities/${slug}/${id}`, { 'If-None-Match': etag });
		expect(second.status).toBe(304);
	});

	it('treats If-None-Match: * as any existing representation', async () => {
		const slug = await makeCollection();
		await createRow(slug, 'a');
		expect((await get(`/api/entities/${slug}`, { 'If-None-Match': '*' })).status).toBe(304);
	});

	it('keys the tag to the representation — same bytes share it, a projection does not', async () => {
		const slug = await makeCollection();
		await createRow(slug, 'a');

		const lean = (await get(`/api/entities/${slug}`)).headers.get('ETag');
		// The bare `*` wildcard is the DEFAULT lean read by design — identical bytes,
		// so reusing one tag for both is correct, not a collision.
		const wildcard = (await get(`/api/entities/${slug}?fields=*`)).headers.get('ETag');
		expect(wildcard).toBe(lean);

		// A real projection is a different representation → a different tag (and the
		// lean tag must not satisfy it, or the client would keep the wider body).
		const projected = (await get(`/api/entities/${slug}?fields=id`)).headers.get('ETag');
		expect(projected).not.toBe(lean);
		expect((await get(`/api/entities/${slug}?fields=id`, { 'If-None-Match': lean as string })).status).toBe(200);
	});

	it('carries no ETag on writes (only reads are conditional)', async () => {
		const slug = await makeCollection();
		const res = await SELF.fetch(`${BASE_URL}/api/entities/${slug}`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ title: 'a' }),
		});
		expect(res.status).toBe(201);
		expect(res.headers.get('ETag')).toBeNull();
	});
});
