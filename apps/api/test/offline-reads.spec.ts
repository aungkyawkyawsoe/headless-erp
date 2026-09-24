/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Offline reads — the per-collection policy that lets a CLIENT keep a read body
 * on the device. `success()`-level ETag/304 revalidation is separate (see
 * conditional-get.spec.ts); this pins the ALLOWLIST channel.
 *
 * The server advertises permission with `X-Offline-Max-Age: <seconds>` on a
 * successful read — absent means "do not persist" (the default). Because the
 * signal rides the response it governs, flipping the Studio policy takes effect
 * on the very next read, with no discovery round trip and no slug list to leak.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

let created = 0;

async function makeCollection(): Promise<string> {
	const slug = `off_docs_${++created}`;
	const res = await SELF.fetch(`${BASE_URL}/api/collections`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify({
			name: `Offline Reads ${created}`,
			slug,
			description: null,
			fields: [{ name: 'title', type: 'text', label: 'Title', required: false }],
		}),
	});
	expect(res.status, `create ${slug}`).toBe(201);
	return slug;
}

function get(path: string, headers: Record<string, string> = {}) {
	return SELF.fetch(`${BASE_URL}${path}`, { headers: { ...ADMIN, ...headers } });
}

function putPolicies(slug: string, policies: unknown) {
	return SELF.fetch(`${BASE_URL}/api/collections/${slug}/policies`, {
		method: 'PUT',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify(policies),
	});
}

async function createRow(slug: string): Promise<string> {
	const res = await SELF.fetch(`${BASE_URL}/api/entities/${slug}`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify({ title: 'a' }),
	});
	expect(res.status).toBe(201);
	return ((await res.json()) as { data: { id: string } }).data.id;
}

describe('offline reads policy (X-Offline-Max-Age)', () => {
	it('is deny-by-default: reads carry no offline header until the policy is on', async () => {
		const slug = await makeCollection();
		await createRow(slug);

		const res = await get(`/api/entities/${slug}`);
		expect(res.status).toBe(200);
		expect(res.headers.get('X-Offline-Max-Age')).toBeNull();
	});

	it('grants the window on list AND detail reads once enabled', async () => {
		const slug = await makeCollection();
		const id = await createRow(slug);

		const put = await putPolicies(slug, { offline_reads: { enabled: true, max_age_s: 3_600 } });
		expect(put.status).toBe(200);

		const list = await get(`/api/entities/${slug}`);
		expect(list.status).toBe(200);
		expect(list.headers.get('X-Offline-Max-Age')).toBe('3600');

		const detail = await get(`/api/entities/${slug}/${id}`);
		expect(detail.status).toBe(200);
		expect(detail.headers.get('X-Offline-Max-Age')).toBe('3600');
	});

	it('exposes the merged policy through /policies/resolved', async () => {
		const slug = await makeCollection();
		await putPolicies(slug, { offline_reads: { enabled: true, max_age_s: 900 } });

		const res = await get(`/api/collections/${slug}/policies/resolved`);
		const body = (await res.json()) as { data: { offlineReads: { enabled: boolean; maxAgeS: number } } };
		expect(body.data.offlineReads).toEqual({ enabled: true, maxAgeS: 900 });
	});

	it('leaves the server response cache untouched — different trust boundary', async () => {
		const slug = await makeCollection();
		// Cache OFF but offline reads ON: they must not be conflated.
		await putPolicies(slug, { cache: { enabled: false }, offline_reads: { enabled: true, max_age_s: 60 } });

		const res = await get(`/api/collections/${slug}/policies/resolved`);
		const body = (await res.json()) as { data: { cache: { enabled: boolean }; offlineReads: { enabled: boolean } } };
		expect(body.data.cache.enabled).toBe(false);
		expect(body.data.offlineReads.enabled).toBe(true);
	});

	it('takes effect on the next read when disabled again', async () => {
		const slug = await makeCollection();
		await createRow(slug);
		await putPolicies(slug, { offline_reads: { enabled: true, max_age_s: 60 } });
		expect((await get(`/api/entities/${slug}`)).headers.get('X-Offline-Max-Age')).toBe('60');

		await putPolicies(slug, { offline_reads: { enabled: false } });
		expect((await get(`/api/entities/${slug}`)).headers.get('X-Offline-Max-Age')).toBeNull();
	});

	it('rejects a nonsense max age before it can reach a device', async () => {
		const slug = await makeCollection();
		for (const bad of [0, -5, 'soon']) {
			const res = await putPolicies(slug, { offline_reads: { enabled: true, max_age_s: bad } });
			expect(res.status, `max_age_s=${String(bad)}`).toBe(400);
		}
	});

	it('still rejects unknown policy features', async () => {
		const slug = await makeCollection();
		const res = await putPolicies(slug, { teleport: { enabled: true } });
		expect(res.status).toBe(400);
	});

	it('composes with ETag revalidation', async () => {
		const slug = await makeCollection();
		await createRow(slug);
		await putPolicies(slug, { offline_reads: { enabled: true, max_age_s: 60 } });

		const first = await get(`/api/entities/${slug}`);
		const etag = first.headers.get('ETag') as string;
		expect(etag).toMatch(/^W\//);

		const second = await get(`/api/entities/${slug}`, { 'If-None-Match': etag });
		expect(second.status).toBe(304);
		expect(second.headers.get('X-Offline-Max-Age')).toBe('60');
	});
});
