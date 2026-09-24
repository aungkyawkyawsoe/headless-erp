import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOfflineQueue, fingerprint, memoryQueueStorage } from '../src/offline';

/** A server-shaped token — the payload carries the account the client scopes by. */
function tokenFor(userId: string, jti: string): string {
	return btoa(JSON.stringify({ jti, user_id: userId, iat: 1, exp: 9_999_999_999_999 }) + '.deadbeef');
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('createOfflineQueue', () => {
	it('enqueues mutations in order and reports them', () => {
		const queue = createOfflineQueue();
		queue.enqueue('POST', '/entities/orders', { id: 'a1', type: 'check-in' });
		queue.enqueue('DELETE', '/entities/orders/a1');
		expect(queue.pending()).toHaveLength(2);
		expect(queue.pending()[0].path).toBe('/entities/orders');
		expect(queue.pending()[0].id).toMatch(/^[0-9a-f-]{36}$/); // own queue id (UUID)
		expect((queue.pending()[0].body as { id: string }).id).toBe('a1'); // entity id preserved in the body — replay-safe
	});

	it('flushes in order with auth headers and drops successful items', async () => {
		const seen: Array<{ method: string; url: string; auth: string | null }> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				seen.push({ method: init?.method ?? 'GET', url: String(url), auth: new Headers(init?.headers ?? {}).get('Authorization') });
				return new Response(null, { status: 200 });
			}),
		);
		const queue = createOfflineQueue({ getToken: () => 'tok-1' });
		queue.enqueue('POST', '/entities/orders', { id: 'a1' });
		queue.enqueue('PUT', '/entities/orders/a1', { note: 'x' }, 'ts-1');

		expect(await queue.flush()).toBe(2);
		expect(queue.pending()).toHaveLength(0);
		expect(seen[0].url).toBe('/api/entities/orders');
		expect(seen[0].auth).toBe('Bearer tok-1');
		expect(seen[1].auth).toBe('Bearer tok-1');
	});

	it('replays with the captured Idempotency-Key; unkeyed items send no header', async () => {
		const seen: Array<{ method: string; key: string | null }> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				seen.push({ method: init?.method ?? 'GET', key: new Headers(init?.headers ?? {}).get('Idempotency-Key') });
				return new Response(null, { status: 200 });
			}),
		);
		const queue = createOfflineQueue();
		queue.enqueue('POST', '/entities/orders', { id: 'a1' }, null, 'idem-1');
		queue.enqueue('PUT', '/entities/orders/a1', { note: 'x' });

		expect(await queue.flush()).toBe(2);
		expect(queue.pending()).toHaveLength(0);
		expect(seen[0].key).toBe('idem-1'); // keyed item carries the header
		expect(seen[1].key).toBeNull(); // unkeyed item sends no header
	});

	it('treats a 409 replay as success (idempotent create already landed)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(null, { status: 409 })),
		);
		const queue = createOfflineQueue();
		queue.enqueue('POST', '/entities/x', { id: 'dup' });
		expect(await queue.flush()).toBe(1);
		expect(queue.pending()).toHaveLength(0);
	});

	it('drops a queued PUT with ifMatch on 409 (record changed while offline — permanent conflict)', async () => {
		const failed: Array<{ item: import('../src/offline').QueuedMutation; err: unknown }> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(null, { status: 409 })),
		);
		const queue = createOfflineQueue({ onFailed: (item, err) => failed.push({ item, err }) });
		queue.enqueue('PUT', '/entities/x/a', { note: 'x' }, 'ts-1');
		expect(await queue.flush()).toBe(0); // NOT counted as replayed
		expect(queue.pending()).toHaveLength(0); // dropped, not kept
		expect(failed).toHaveLength(1);
		expect((failed[0]?.err as Error).message).toContain('If-Match mismatch');
		expect(failed[0]?.item.ifMatch).toBe('ts-1');
	});

	it('still replays a queued DELETE with ifMatch on a non-409 success', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(null, { status: 200 })),
		);
		const queue = createOfflineQueue();
		queue.enqueue('DELETE', '/entities/x/a', undefined, 'ts-1');
		expect(await queue.flush()).toBe(1);
		expect(queue.pending()).toHaveLength(0);
	});

	it('keeps items that fail and reports them', async () => {
		let calls = 0;
		const failed: unknown[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				calls++;
				return calls === 1 ? Promise.reject(new TypeError('Failed to fetch')) : new Response(null, { status: 500 });
			}),
		);
		const queue = createOfflineQueue({ onFailed: (item, err) => failed.push({ item, err }) });
		queue.enqueue('POST', '/entities/x', { id: 'b1' });
		queue.enqueue('POST', '/entities/y', { id: 'b2' });

		expect(await queue.flush()).toBe(0);
		expect(queue.pending()).toHaveLength(2);
		expect(failed).toHaveLength(2);
	});

	it('notifies subscribers on enqueue/clear, and unsubscribes cleanly', () => {
		const queue = createOfflineQueue();
		const events: string[] = [];
		const unsub = queue.subscribe(() => events.push('change'));
		queue.enqueue('POST', '/entities/x', { id: 'c1' });
		queue.clear();
		expect(events).toEqual(['change', 'change']);
		unsub();
		queue.enqueue('POST', '/entities/x', { id: 'c2' });
		expect(events).toHaveLength(2); // no further notifications
	});

	it('persists across instances with a shared storage', () => {
		const storage = memoryQueueStorage();
		const first = createOfflineQueue({ storage });
		first.enqueue('DELETE', '/entities/x/a');
		const second = createOfflineQueue({ storage });
		expect(second.pending()).toHaveLength(1);
	});
});

describe('createOfflineQueue identity scoping', () => {
	it('replays a RE-MINTED token for the same account (a refresh is not a new user)', async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		let token = tokenFor('u-1', 'jti-1');
		const queue = createOfflineQueue({ getToken: () => token });
		queue.enqueue('POST', '/entities/orders', { id: 'a1' });

		token = tokenFor('u-1', 'jti-2'); // same human, fresh session
		expect(await queue.flush()).toBe(1);
		expect(queue.pending()).toHaveLength(0);
		expect(warn).not.toHaveBeenCalled();
	});

	it('never replays another account’s queue — and keeps its items for its owner', async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		let token = tokenFor('u-1', 'jti-1');
		const queue = createOfflineQueue({ getToken: () => token });
		queue.enqueue('POST', '/entities/orders', { id: 'a1' });

		token = tokenFor('u-2', 'jti-9'); // a different human on the same device
		expect(await queue.flush()).toBe(0);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(queue.pending()).toHaveLength(1); // no data loss — the owner may return
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it('silently adopts the current identity when there is nothing queued', async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const storage = memoryQueueStorage();
		storage.setFingerprint?.(fingerprint('someone-else'));
		const queue = createOfflineQueue({ storage, getToken: () => tokenFor('u-1', 'jti-1') });

		expect(await queue.flush()).toBe(0);
		expect(warn).not.toHaveBeenCalled(); // no writes existed to warn about

		// The tag moved on, so the NEXT write is this account's without a warning.
		queue.enqueue('POST', '/entities/orders', { id: 'a1' });
		expect(queue.pending()).toHaveLength(1);
		expect(warn).not.toHaveBeenCalled();
	});

	it('discards a previous account’s writes when a new one queues its own', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const storage = memoryQueueStorage();

		const first = createOfflineQueue({ storage, getToken: () => tokenFor('u-1', 'jti-1') });
		first.enqueue('POST', '/entities/orders', { id: 'a1' });

		const second = createOfflineQueue({ storage, getToken: () => tokenFor('u-2', 'jti-2') });
		second.enqueue('POST', '/entities/orders', { id: 'b1' });

		expect(second.pending().map((item) => (item.body as { id: string }).id)).toEqual(['b1']);
		expect(warn).toHaveBeenCalledTimes(1);
	});
});
