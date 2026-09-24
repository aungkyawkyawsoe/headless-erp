import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConditionalResponseCache, createClient } from '../src/index';

function ok(data: unknown, etag?: string) {
	return new Response(JSON.stringify({ success: true, data }), {
		status: 200,
		headers: { 'Content-Type': 'application/json', ...(etag ? { ETag: etag } : {}) },
	});
}

const notModified = () => new Response(null, { status: 304 });

/** The `If-None-Match` a recorded fetch call sent, if any. */
const sent = (call: readonly unknown[] | undefined) => new Headers((call?.[1] as RequestInit | undefined)?.headers).get('If-None-Match');

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('conditional GET (SDK)', () => {
	it('replays the stored tag and serves an unchanged 304 from memory', async () => {
		const rows = [{ id: '1' }];
		const fetchMock = vi.fn().mockResolvedValueOnce(ok(rows, 'W/"v1"')).mockResolvedValueOnce(notModified());
		vi.stubGlobal('fetch', fetchMock);

		const client = createClient();
		// First read has nothing to revalidate against.
		expect(await client.request('/entities/orders')).toEqual(rows);
		expect(sent(fetchMock.mock.calls[0])).toBeNull();

		// Second read sends the tag; the bodiless 304 still yields the rows, because
		// the client kept the body the tag described.
		expect(await client.request('/entities/orders')).toEqual(rows);
		expect(sent(fetchMock.mock.calls[1])).toBe('W/"v1"');
	});

	it('replaces the stored body when the tag changes', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(ok([{ id: '1' }], 'W/"v1"'))
			.mockResolvedValueOnce(ok([{ id: '1' }, { id: '2' }], 'W/"v2"'))
			.mockResolvedValueOnce(notModified());
		vi.stubGlobal('fetch', fetchMock);
		const client = createClient();

		await client.request('/entities/orders');
		expect(await client.request('/entities/orders')).toEqual([{ id: '1' }, { id: '2' }]);
		// The newer tag is now the one replayed, and it still resolves from memory.
		expect(await client.request('/entities/orders')).toEqual([{ id: '1' }, { id: '2' }]);
		expect(sent(fetchMock.mock.calls[2])).toBe('W/"v2"');
	});

	it('does not revalidate a response the server did not tag', async () => {
		// A factory, not a shared Response — a body can only be read once.
		const fetchMock = vi.fn(async () => ok([{ id: '1' }]));
		vi.stubGlobal('fetch', fetchMock);
		const client = createClient();

		await client.request('/entities/orders');
		await client.request('/entities/orders');
		expect(sent(fetchMock.mock.calls[1])).toBeNull();
	});

	it('keeps query variants apart', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(ok([{ id: '1' }], 'W/"page1"'))
			.mockResolvedValueOnce(ok([{ id: '2' }], 'W/"page2"'))
			.mockResolvedValueOnce(notModified())
			.mockResolvedValueOnce(notModified());
		vi.stubGlobal('fetch', fetchMock);
		const client = createClient();

		await client.request('/entities/orders', { query: { limit: 1 } });
		await client.request('/entities/orders', { query: { limit: 1, cursor: 'c' } });
		expect(await client.request('/entities/orders', { query: { limit: 1 } })).toEqual([{ id: '1' }]);
		expect(await client.request('/entities/orders', { query: { limit: 1, cursor: 'c' } })).toEqual([{ id: '2' }]);
		expect(sent(fetchMock.mock.calls[2])).toBe('W/"page1"');
		expect(sent(fetchMock.mock.calls[3])).toBe('W/"page2"');
	});

	it('never revalidates when disabled', async () => {
		const fetchMock = vi.fn(async () => ok([{ id: '1' }], 'W/"v1"'));
		vi.stubGlobal('fetch', fetchMock);
		const client = createClient({ conditionalGet: false });

		await client.request('/entities/orders');
		await client.request('/entities/orders');
		expect(sent(fetchMock.mock.calls[1])).toBeNull();
	});

	it('does not revalidate writes', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(ok({ id: '1' }, 'W/"v1"'))
			.mockResolvedValueOnce(ok({ id: '1' }, 'W/"v1"'));
		vi.stubGlobal('fetch', fetchMock);
		const client = createClient();

		await client.request('/entities/orders', { method: 'POST', body: { title: 'a' } });
		await client.request('/entities/orders', { method: 'POST', body: { title: 'b' } });
		expect(sent(fetchMock.mock.calls[1])).toBeNull();
	});
});

describe('ConditionalResponseCache', () => {
	it('evicts the least recently used entry past its cap', () => {
		const cache = new ConditionalResponseCache(2);
		cache.set('a', { etag: '1', data: [] });
		cache.set('b', { etag: '2', data: [] });
		// Touch `a` so `b` becomes the least recently used.
		expect(cache.get('a')?.etag).toBe('1');
		cache.set('c', { etag: '3', data: [] });

		expect(cache.size).toBe(2);
		expect(cache.get('a')?.etag).toBe('1');
		expect(cache.get('b')).toBeUndefined();
		expect(cache.get('c')?.etag).toBe('3');
	});

	it('clears on demand', () => {
		const cache = new ConditionalResponseCache();
		cache.set('a', { etag: '1', data: [] });
		cache.clear();
		expect(cache.size).toBe(0);
	});
});
