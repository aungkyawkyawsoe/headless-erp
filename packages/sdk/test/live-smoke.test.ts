/**
 * End-to-end smoke against a RUNNING dev API (localhost:8788).
 *
 * Best-effort: never fails the suite when the API is down or the dev schema is
 * empty — it self-skips instead. `./schema.ts` is the typegen output from the dev
 * schema (regenerate via:
 *   mmbix-typegen --url http://localhost:8788/api --token dev-token --out test
 * )
 *
 * Two independent gates, so one missing thing does not mute the rest:
 *   - `apiUp`     — is a dev API answering at all?
 *   - `itemsReady` — is a `items` collection seeded (its assertions need it)?
 * The offline-reads smoke additionally DISCOVERS any readable collection, so it
 * runs on a stock dev database with no seed.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ConditionalResponseCache, createClient, memoryResponseCacheStorage, memoryTokenStorage } from '../src/index';
import { Schemas, type Schema } from './schema';

const API = 'http://localhost:8788/api';
const AUTH = { Authorization: 'Bearer dev-token' };
const JSON_AUTH = { ...AUTH, 'Content-Type': 'application/json' };
const COLLECTION = 'items';

describe('live SDK smoke (dev API)', () => {
	let apiUp = false;
	let itemsReady = false;
	/** First readable collection in the dev schema — the policy toggle works on any. */
	let anyCollection = '';

	beforeAll(async () => {
		try {
			const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(2_000) });
			apiUp = res.ok;
		} catch {
			apiUp = false;
		}
		if (!apiUp) {
			console.warn('live-smoke: dev API not reachable — skipping');
			return;
		}

		// A healthy dev API without the `items` fixture is a valid state — probe it
		// so only the fixture assertions skip.
		try {
			const probe = await fetch(`${API}/entities/${COLLECTION}?limit=1`, {
				headers: AUTH,
				signal: AbortSignal.timeout(2_000),
			});
			itemsReady = probe.status !== 404;
			if (!itemsReady) console.warn(`live-smoke: ${COLLECTION} not seeded — fixture assertions skipped`);
		} catch {
			itemsReady = false;
		}

		try {
			const list = await fetch(`${API}/collections`, { headers: AUTH, signal: AbortSignal.timeout(2_000) });
			const body = (await list.json()) as { data?: Array<{ slug?: string; hidden?: boolean }> };
			anyCollection = body.data?.find((c) => c.slug && !c.hidden)?.slug ?? '';
		} catch {
			anyCollection = '';
		}
		if (!anyCollection) console.warn('live-smoke: no collection in the dev schema — offline-reads smoke skipped');
	});

	it('typed client lists real rows against the entity engine', async () => {
		if (!apiUp || !itemsReady) return; // skip silently when no dev server / no seed
		const client = createClient<Schema>({ baseUrl: API, tokenStorage: memoryTokenStorage() });
		client.tokenStorage.set('dev-token'); // IS_DEV dev-token — admin

		const result = await client.items(COLLECTION).list({
			fields: ['id', 'name', 'status'],
			limit: 3,
			sort: '-created_at',
		});
		expect(Array.isArray(result.data)).toBe(true);
		if (result.data.length > 0) {
			const row = result.data[0];
			expect(typeof row.id).toBe('string');
		}
		expect(typeof result.meta.limit).toBe('number');
	}, 15_000);

	it('generated Zod schemas parse real API rows (nullable columns OK)', async () => {
		if (!apiUp || !itemsReady) return; // skip silently when no dev server / no seed
		const client = createClient<Schema>({ baseUrl: API, tokenStorage: memoryTokenStorage() });
		client.tokenStorage.set('dev-token');

		const rows = await client.items(COLLECTION).list({ limit: 5, sort: '-created_at' });
		for (const row of rows.data) {
			// The runtime "purify" layer: a real row must satisfy the generated schema.
			const parsed = Schemas.items.parse(row);
			expect(parsed.id).toBe(row.id);
		}
	}, 15_000);

	/**
	 * Offline reads, end to end: the policy toggle must reach a real client as a
	 * device window (`X-Offline-Max-Age`), an unchanged read must revalidate as a
	 * 304, and the SDK must persist the body BECAUSE the server blessed it — no
	 * client-side allowlist. The collection's original policy is restored in
	 * `finally`, so the smoke leaves the dev database exactly as it found it.
	 */
	it('offline reads: the policy reaches the client, and ETag revalidates', async () => {
		if (!apiUp || !anyCollection) return;
		const policiesUrl = `${API}/collections/${anyCollection}/policies`;

		const before = (await (await fetch(policiesUrl, { headers: AUTH })).json()) as { data?: { offline_reads?: unknown } };
		const hadPolicy = before.data?.offline_reads !== undefined;

		try {
			const put = await fetch(policiesUrl, {
				method: 'PUT',
				headers: JSON_AUTH,
				body: JSON.stringify({ offline_reads: { enabled: true, max_age_s: 120 } }),
			});
			expect(put.status).toBe(200);

			const read = await fetch(`${API}/entities/${anyCollection}?limit=1`, { headers: AUTH });
			expect(read.status).toBe(200);
			expect(read.headers.get('X-Offline-Max-Age')).toBe('120');
			const etag = read.headers.get('ETag');
			expect(etag).toMatch(/^W\//);

			const revalidated = await fetch(`${API}/entities/${anyCollection}?limit=1`, {
				headers: { ...AUTH, 'If-None-Match': etag as string },
			});
			expect(revalidated.status).toBe(304);

			// The client half: a real SDK client persists the body to its storage
			// because the server authorized it.
			const storage = memoryResponseCacheStorage();
			const client = createClient({
				baseUrl: API,
				tokenStorage: memoryTokenStorage(),
				conditionalGet: new ConditionalResponseCache(50, storage),
			});
			client.tokenStorage.set('dev-token');
			await client.request(`/entities/${anyCollection}`, { query: { limit: 1 } });
			expect(storage.get().length).toBeGreaterThan(0);
			expect(storage.getFingerprint()).not.toBeNull();
		} finally {
			if (hadPolicy) {
				await fetch(policiesUrl, {
					method: 'PUT',
					headers: JSON_AUTH,
					body: JSON.stringify({ offline_reads: before.data?.offline_reads }),
				});
			} else {
				await fetch(`${policiesUrl}/offline_reads`, { method: 'DELETE', headers: AUTH });
			}
		}
	}, 15_000);
});
