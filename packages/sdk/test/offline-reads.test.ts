import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ConditionalResponseCache,
	NetworkError,
	createClient,
	fingerprint,
	memoryResponseCacheStorage,
	memoryTokenStorage,
} from '../src/index';

/**
 * Offline reads — a read body is kept on the device ONLY when the server blessed
 * that response with `X-Offline-Max-Age` (the collection's `policies.offline_reads`),
 * and only for that window. Everything else stays network-only.
 */

const TOKEN = 'jwt-offline-test';
const URL_PATH = '/entities/orders';
const KEY = `/api${URL_PATH}`;

function ok(data: unknown, etag?: string, offlineMaxAge?: number) {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (etag) headers.ETag = etag;
	if (offlineMaxAge !== undefined) headers['X-Offline-Max-Age'] = String(offlineMaxAge);
	return new Response(JSON.stringify({ success: true, data }), { status: 200, headers });
}

const offline = () => new TypeError('Failed to fetch');
const withToken = () => {
	const storage = memoryTokenStorage();
	storage.set(TOKEN);
	return storage;
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('offline reads (SDK)', () => {
	it('serves a blessed read from the device when the network is gone', async () => {
		const rows = [{ id: '1' }];
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(ok(rows, 'W/"v1"', 3600))
			.mockRejectedValueOnce(offline());
		vi.stubGlobal('fetch', fetchMock);

		const client = createClient({
			tokenStorage: withToken(),
			conditionalGet: new ConditionalResponseCache(200, memoryResponseCacheStorage()),
		});
		expect(await client.request(URL_PATH)).toEqual(rows);
		// Second call never reaches the server (fetch rejects) yet returns the rows.
		expect(await client.request(URL_PATH)).toEqual(rows);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('does NOT serve a read the server never blessed', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(ok([{ id: '1' }], 'W/"v1"'))
			.mockRejectedValueOnce(offline());
		vi.stubGlobal('fetch', fetchMock);

		const client = createClient({
			tokenStorage: withToken(),
			conditionalGet: new ConditionalResponseCache(200, memoryResponseCacheStorage()),
		});
		expect(await client.request(URL_PATH)).toEqual([{ id: '1' }]);
		await expect(client.request(URL_PATH)).rejects.toBeInstanceOf(NetworkError);
	});

	it('survives a reload when the storage is shared (device persistence)', async () => {
		const rows = [{ id: '1' }];
		const storage = memoryResponseCacheStorage();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok(rows, 'W/"v1"', 3600)));

		// Session 1 — one online read.
		const first = createClient({ tokenStorage: withToken(), conditionalGet: new ConditionalResponseCache(200, storage) });
		expect(await first.request(URL_PATH)).toEqual(rows);

		// Session 2 — a brand-new client (as after a WebView reload) with no network.
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(offline()));
		const second = createClient({ tokenStorage: withToken(), conditionalGet: new ConditionalResponseCache(200, storage) });
		expect(await second.request(URL_PATH)).toEqual(rows);
	});

	it('refuses a device copy that belongs to another account', async () => {
		const storage = memoryResponseCacheStorage();
		storage.set([{ key: KEY, entry: { etag: 'W/"v1"', data: [{ id: 'secret' }], storedAt: Date.now(), maxAgeS: 3600 } }]);
		storage.setFingerprint('someone-else');
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(offline()));

		const client = createClient({ tokenStorage: withToken(), conditionalGet: new ConditionalResponseCache(200, storage) });
		await expect(client.request(URL_PATH)).rejects.toBeInstanceOf(NetworkError);
		// The other account's copy is discarded, not left for the next hydrate.
		expect(storage.get()).toEqual([]);
		expect(storage.getFingerprint()).toBeNull();
	});

	it('drops an entry whose offline window has expired', async () => {
		const storage = memoryResponseCacheStorage();
		storage.set([{ key: KEY, entry: { etag: 'W/"v1"', data: [{ id: '1' }], storedAt: Date.now() - 10_000, maxAgeS: 1 } }]);
		storage.setFingerprint(fingerprint(TOKEN));
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(offline()));

		const client = createClient({ tokenStorage: withToken(), conditionalGet: new ConditionalResponseCache(200, storage) });
		await expect(client.request(URL_PATH)).rejects.toBeInstanceOf(NetworkError);
	});

	it('purges every device copy on logout', async () => {
		const storage = memoryResponseCacheStorage();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok([{ id: '1' }], 'W/"v1"', 3600)));

		const client = createClient({ tokenStorage: withToken(), conditionalGet: new ConditionalResponseCache(200, storage) });
		await client.request(URL_PATH);
		expect(storage.get()).toHaveLength(1);

		client.auth.logout();
		expect(storage.get()).toEqual([]);
		expect(storage.getFingerprint()).toBeNull();
	});

	it('keeps the offline window sliding across a 304 revalidation', async () => {
		const storage = memoryResponseCacheStorage();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(ok([{ id: '1' }], 'W/"v1"', 3600))
			.mockResolvedValueOnce(new Response(null, { status: 304, headers: { 'X-Offline-Max-Age': '3600' } }))
			.mockRejectedValueOnce(offline());
		vi.stubGlobal('fetch', fetchMock);

		const client = createClient({ tokenStorage: withToken(), conditionalGet: new ConditionalResponseCache(200, storage) });
		await client.request(URL_PATH);
		const storedAt = storage.get()[0]?.entry.storedAt as number;

		// A 304 at a later time must refresh the window, not let it lapse.
		vi.spyOn(Date, 'now').mockReturnValue(storedAt + 60_000);
		expect(await client.request(URL_PATH)).toEqual([{ id: '1' }]);
		expect(storage.get()[0]?.entry.storedAt).toBe(storedAt + 60_000);

		// And the refreshed copy is still servable offline.
		expect(await client.request(URL_PATH)).toEqual([{ id: '1' }]);
	});

	it('never persists a write response', async () => {
		const storage = memoryResponseCacheStorage();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ id: '1' }, 'W/"v1"', 3600)));

		const client = createClient({ tokenStorage: withToken(), conditionalGet: new ConditionalResponseCache(200, storage) });
		await client.request(URL_PATH, { method: 'POST', body: { title: 'a' } });
		expect(storage.get()).toEqual([]);
	});
});
