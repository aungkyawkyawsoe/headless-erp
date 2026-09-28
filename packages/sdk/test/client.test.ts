import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_PAGE_SIZE } from '@mmbix/config';
import { HttpError, NetworkError } from '../src/errors';
import { createClient, memoryTokenStorage, parseChangeEnvelope } from '../src/index';
import { createOfflineQueue, memoryQueueStorage } from '../src/offline';
import { isTokenExpired } from '../src/auth';

function envelope(data: unknown) {
	return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function envelopeWithMeta(data: unknown, meta: unknown) {
	return new Response(JSON.stringify({ success: true, data, meta }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** The entity engine's flat list contract: `{ success, data: T[], meta }`. */
function listEnvelope(rows: unknown[], meta: unknown) {
	return envelopeWithMeta(rows, meta);
}

/** The count_only shape: `{ success, data: [], meta: { total } }`. */
function countEnvelope(total: number) {
	return envelopeWithMeta([], { limit: 0, has_more: false, total });
}

function errorEnvelope(status: number, error: unknown) {
	return new Response(JSON.stringify({ success: false, error }), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('request pipeline', () => {
	it('unwraps the success envelope', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => envelope([{ id: '1' }])),
		);
		const client = createClient();
		expect(await client.request('/entities/x')).toEqual([{ id: '1' }]);
	});

	it('attaches the bearer token from storage (except login paths)', async () => {
		const headerOf = (init?: RequestInit) => new Headers(init?.headers ?? {}).get('Authorization');
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				void init;
				return envelope({ ok: true });
			}),
		);
		const client = createClient({ tokenStorage: memoryTokenStorage() });
		client.tokenStorage.set('jwt-abc');
		await client.request('/entities/orders');
		const calls = vi.mocked(fetch).mock.calls;
		expect(headerOf(calls[0]?.[1])).toBe('Bearer jwt-abc');

		// Login paths must NOT carry a stale token.
		await client.request('/auth/telegram', { method: 'POST', body: { initData: 'x' } });
		expect(headerOf(calls[1]?.[1])).toBeNull();
	});

	it('skips an expired token entirely (no doomed request) and clears it', async () => {
		let sawAuthHeader = false;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				sawAuthHeader = Boolean(new Headers(init?.headers ?? {}).get('Authorization'));
				return envelope({ ok: true });
			}),
		);
		const storage = memoryTokenStorage();
		const payload = JSON.stringify({ jti: 'x', user_id: 'u', exp: Date.now() - 3_600_000 });
		storage.set(btoa(payload + '.sig'));
		const client = createClient({ tokenStorage: storage });
		await client.request('/entities/x');
		expect(sawAuthHeader).toBe(false);
		expect(storage.get()).toBeNull();
	});

	it('401 → refreshSession once → retries with the fresh token', async () => {
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				const auth = new Headers(init?.headers ?? {}).get('Authorization') ?? '';
				calls.push(auth);
				return auth === 'Bearer fresh' ? envelope({ ok: true }) : errorEnvelope(401, 'Invalid or expired token');
			}),
		);
		const storage = memoryTokenStorage();
		storage.set('stale');
		const client = createClient({ tokenStorage: storage, refreshSession: async () => 'fresh' });
		await expect(client.request('/entities/x')).resolves.toEqual({ ok: true });
		expect(calls).toEqual(['Bearer stale', 'Bearer fresh']);
		expect(storage.get()).toBe('fresh');
	});

	it('surfaces the 401 when refreshSession returns null', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => errorEnvelope(401, 'Invalid or expired token')),
		);
		const client = createClient({ refreshSession: async () => null });
		await expect(client.request('/entities/x')).rejects.toMatchObject({ status: 401, code: 'API_ERROR' });
	});

	it('throws typed HttpError with the REAL top-level backend code', async () => {
		// The backend envelope: { success: false, error: string, code: string } —
		// `code` is a TOP-LEVEL sibling of `error`, not nested inside it.
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ success: false, error: 'Version conflict — row changed', code: 'CONFLICT' }), {
						status: 409,
						headers: { 'Content-Type': 'application/json' },
					}),
			),
		);
		const client = createClient();
		try {
			await client.request('/entities/x/1', { method: 'PUT' });
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(HttpError);
			expect((e as HttpError).status).toBe(409);
			expect((e as HttpError).code).toBe('CONFLICT');
		}
	});

	it('keeps the nested error-object fallback for legacy envelopes', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => errorEnvelope(409, { message: 'Version conflict', code: 'VERSION_CONFLICT' })),
		);
		const client = createClient();
		try {
			await client.request('/entities/x/1', { method: 'PUT' });
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(HttpError);
			expect((e as HttpError).status).toBe(409);
			expect((e as HttpError).code).toBe('VERSION_CONFLICT');
		}
	});

	it('throws NetworkError when fetch rejects (offline)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
		);
		const client = createClient();
		await expect(client.request('/entities/x')).rejects.toBeInstanceOf(NetworkError);
	});

	it('retries transient failures (429) with backoff, then succeeds', async () => {
		let calls = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				calls++;
				return calls === 1 ? errorEnvelope(429, 'Rate limit exceeded') : envelope({ ok: true });
			}),
		);
		const client = createClient({ retry: { attempts: 2, delayMs: 1 } });
		await expect(client.request('/entities/x')).resolves.toEqual({ ok: true });
		expect(calls).toBe(2);
	});

	it('sends Idempotency-Key and If-Match headers', async () => {
		let captured: Headers | undefined;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				captured = new Headers(init?.headers ?? {});
				return envelope({ id: '1' });
			}),
		);
		const client = createClient();
		await client.request('/entities/orders', {
			method: 'POST',
			body: { id: 'abc' },
			idempotencyKey: 'idem-1',
			ifMatch: '2026-08-26T00:00:00.000Z',
		});
		expect(captured?.get('Idempotency-Key')).toBe('idem-1');
		expect(captured?.get('If-Match')).toBe('2026-08-26T00:00:00.000Z');
	});

	it('auto-generates an Idempotency-Key for mutating requests without one', async () => {
		const keys: Array<string | null> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				keys.push(new Headers(init?.headers ?? {}).get('Idempotency-Key'));
				return envelope({ ok: true });
			}),
		);
		const client = createClient();
		await client.request('/entities/orders/1', { method: 'PUT', body: { note: 'x' } });
		expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/); // looks like a UUID
	});

	it('reuses the SAME Idempotency-Key across transient retries', async () => {
		const keys: string[] = [];
		let calls = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				calls++;
				keys.push(new Headers(init?.headers ?? {}).get('Idempotency-Key') ?? '');
				return calls === 1 ? errorEnvelope(502, 'Bad gateway') : envelope({ ok: true });
			}),
		);
		const client = createClient({ retry: { attempts: 2, delayMs: 1 } });
		await expect(client.request('/entities/orders/1', { method: 'PUT', body: { note: 'x' } })).resolves.toEqual({ ok: true });
		expect(keys).toHaveLength(2);
		expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
		expect(keys[1]).toBe(keys[0]); // the retry reuses the SAME key
	});

	it('does NOT send Idempotency-Key for GETs or login POSTs', async () => {
		const keys: Array<string | null> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				keys.push(new Headers(init?.headers ?? {}).get('Idempotency-Key'));
				return envelope({ ok: true });
			}),
		);
		const client = createClient();
		await client.request('/entities/orders');
		await client.request('/auth/telegram', { method: 'POST', body: { initData: 'x' } });
		expect(keys).toEqual([null, null]);
	});

	it('honors an explicit idempotencyKey as-is (not replaced)', async () => {
		const keys: Array<string | null> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				keys.push(new Headers(init?.headers ?? {}).get('Idempotency-Key'));
				return envelope({ ok: true });
			}),
		);
		const client = createClient();
		await client.request('/entities/orders', { method: 'POST', body: { id: 'abc' }, idempotencyKey: 'explicit-key-1' });
		expect(keys[0]).toBe('explicit-key-1');
	});
});

describe('items API', () => {
	it('lists with typed query → correct URL + meta passthrough', async () => {
		let capturedUrl = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				capturedUrl = String(url);
				return listEnvelope([{ id: '1' }], { limit: 10, has_more: false });
			}),
		);
		const client = createClient();
		const result = await client.items('orders').list({
			filter: { customer_id: { _eq: '42' } },
			fields: ['type', 'timestamp'],
			limit: 10,
		});
		expect(capturedUrl).toContain('/api/entities/orders?');
		expect(capturedUrl).toContain('filter%5Bcustomer_id%5D%5B_eq%5D=42');
		expect(capturedUrl).toContain('fields=type%2Ctimestamp');
		expect(result.data).toEqual([{ id: '1' }]);
		expect(result.meta.limit).toBe(10);
	});

	it('count() hits count_only and returns the total', async () => {
		let capturedUrl = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				capturedUrl = String(url);
				return countEnvelope(7);
			}),
		);
		const client = createClient();
		expect(await client.items('tasks').count({ filter: { status: { _eq: 'pending' } } })).toBe(7);
		expect(capturedUrl).toContain('count_only=true');
	});

	it('create() attaches a client UUID for replay-safe writes', async () => {
		let capturedBody = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				capturedBody = String(init?.body);
				return envelope({ id: 'abc-123', type: 'check-in' });
			}),
		);
		const client = createClient();
		await client.items('orders').create({ type: 'check-in' } as never);
		const parsed = JSON.parse(capturedBody) as { id: string };
		expect(parsed.id).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('update() forwards ifMatch for optimistic concurrency', async () => {
		let captured: Headers | undefined;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				captured = new Headers(init?.headers ?? {});
				return envelope({ id: '1' });
			}),
		);
		const client = createClient();
		await client.items('orders').update('1', { note: 'x' } as never, { ifMatch: 'ts-1' });
		expect(captured?.get('If-Match')).toBe('ts-1');
	});
});

describe('page-size policy (enterprise grade)', () => {
	it('list() sends an explicit default limit of 25 when none is given', async () => {
		let capturedUrl = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				capturedUrl = String(url);
				return listEnvelope([], { limit: 25, has_more: false });
			}),
		);
		const client = createClient();
		await client.items('orders').list({});
		expect(capturedUrl).toContain('limit=25');
	});

	it('list() clamps page sizes above the server ceiling to MAX_PAGE_SIZE', async () => {
		let capturedUrl = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				capturedUrl = String(url);
				return listEnvelope([], { limit: MAX_PAGE_SIZE, has_more: false });
			}),
		);
		const client = createClient();
		await client.items('products').list({ limit: MAX_PAGE_SIZE + 200 });
		expect(capturedUrl).toContain(`limit=${MAX_PAGE_SIZE}`);
	});

	it('queryMany specs get the same page-size policy (default 25, max MAX_PAGE_SIZE)', async () => {
		let capturedBody = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				capturedBody = String(init?.body);
				return envelope({ results: [] });
			}),
		);
		const client = createClient();
		await client.queryMany([
			{ key: 'a', collection: 'orders', query: {} },
			{ key: 'b', collection: 'products', query: { limit: MAX_PAGE_SIZE + 500 } },
		]);
		const parsed = JSON.parse(capturedBody) as {
			queries: Array<{ key: string; params: Record<string, string> }>;
		};
		expect(parsed.queries[0]?.params.limit).toBe('25');
		expect(parsed.queries[1]?.params.limit).toBe(String(MAX_PAGE_SIZE));
	});

	it('queryMany truncates batches to the server cap (12) and warns once', async () => {
		let capturedBody = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				capturedBody = String(init?.body);
				return envelope({ results: [] });
			}),
		);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const client = createClient();
		const specs = Array.from({ length: 20 }, (_, i) => ({ key: `k${i}`, collection: 'orders', query: {} }));
		await client.queryMany(specs);
		const parsed = JSON.parse(capturedBody) as { queries: Array<{ key: string }> };
		expect(parsed.queries).toHaveLength(12);
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});
});

it('loadLimits() discovers the backend contract and clamps against it', async () => {
	let capturedUrl = '';
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			capturedUrl = String(url);
			if (String(url).includes('/api/meta')) {
				return envelope({ platform: 'mmbix-headless', pagination: { default_page_size: 50, max_page_size: 200 } });
			}
			const q = new URL(String(url), 'http://localhost').searchParams;
			void init;
			return listEnvelope([], { limit: Number(q.get('limit') ?? 0), has_more: false });
		}),
	);
	const client = createClient();
	expect(client.limits).toEqual({ defaultPageSize: 25, maxPageSize: MAX_PAGE_SIZE }); // built-in mirror

	await client.loadLimits();
	expect(client.limits).toEqual({ defaultPageSize: 50, maxPageSize: 200 }); // adopted from the server

	await client.items('orders').list({}); // no limit → policy default
	expect(capturedUrl).toContain('limit=50');
	await client.items('orders').list({ limit: 500 }); // above policy max → clamped
	expect(capturedUrl).toContain('limit=200');
});

describe('offline queue wiring', () => {
	it('network-failed writes enqueue for replay; reads and login never do', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
		);
		const storage = memoryQueueStorage();
		const queue = createOfflineQueue({ storage });
		const client = createClient({ offlineQueue: queue });

		// Write → enqueued.
		await expect(client.request('/entities/requests', { method: 'POST', body: { status: 'pending' } })).rejects.toBeInstanceOf(
			NetworkError,
		);
		expect(queue.pending()).toHaveLength(1);

		// Read → never queued.
		await expect(client.request('/entities/requests')).rejects.toBeInstanceOf(NetworkError);
		expect(queue.pending()).toHaveLength(1);

		// Login → never queued.
		await expect(client.request('/auth/telegram', { method: 'POST', body: { initData: 'x' } })).rejects.toBeInstanceOf(NetworkError);
		expect(queue.pending()).toHaveLength(1);
	});

	it('noQueue: true opts a read-encoded POST out of the replay queue', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
		);
		const storage = memoryQueueStorage();
		const queue = createOfflineQueue({ storage });
		const client = createClient({ offlineQueue: queue });

		await expect(
			client.request('/reports/execute', { method: 'POST', body: { collection: 'store_purchases' }, noQueue: true }),
		).rejects.toBeInstanceOf(NetworkError);
		expect(queue.pending()).toEqual([]);
	});

	it('onWrite fires only for successful non-login writes; onSettled reports reachability', async () => {
		const writes: Array<[string, string]> = [];
		const settled: Array<[string, string, boolean]> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				return envelope({ id: '1' });
			}),
		);
		const client = createClient({
			onWrite: (p, m) => writes.push([p, m]),
			onSettled: (p, m, ok) => settled.push([p, m, ok]),
		});

		await client.request('/entities/orders', { method: 'POST', body: { type: 'check-in' } });
		await client.request('/entities/orders'); // read
		expect(writes).toEqual([['/entities/orders', 'POST']]);
		expect(settled).toHaveLength(2);
		expect(settled.every(([, , ok]) => ok === true)).toBe(true);
	});
});

describe('change envelope (meta.changed)', () => {
	it('delivers the touched collections + rows to onChange', async () => {
		const seen: Array<{ collections: string[]; rows: Record<string, string[]> }> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				envelopeWithMeta(
					{ id: 'inv-1' },
					{
						changed: { collections: ['orders', 'stock'], rows: { orders: ['inv-1'] } },
					},
				),
			),
		);
		const client = createClient({ onChange: (change) => seen.push(change) });

		await client.request('/entities/orders', { method: 'POST', body: { id: 'inv-1' } });

		expect(seen).toEqual([{ collections: ['orders', 'stock'], rows: { orders: ['inv-1'] } }]);
	});

	it('does not fire when a response carries no envelope', async () => {
		const seen: unknown[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => envelope({ id: '1' })),
		);
		const client = createClient({ onChange: (change) => seen.push(change) });

		await client.request('/entities/orders', { method: 'POST', body: {} });

		expect(seen).toEqual([]);
	});

	it('parseChangeEnvelope tolerates junk and filters non-string entries', () => {
		expect(parseChangeEnvelope(undefined)).toBeUndefined();
		expect(parseChangeEnvelope({ changed: 'nope' })).toBeUndefined();
		expect(parseChangeEnvelope({ changed: { collections: [] } })).toBeUndefined();
		expect(parseChangeEnvelope({ changed: { collections: ['a', 5], rows: { a: ['1', 2], b: 'x' } } })).toEqual({
			collections: ['a'],
			rows: { a: ['1'] },
		});
	});
});

describe('auth helpers', () => {
	it('client.auth.token returns the stored unexpired token', () => {
		const storage = memoryTokenStorage();
		storage.set('valid');
		const client = createClient({ tokenStorage: storage });
		expect(client.auth.token).toBe('valid');
	});

	it('client.auth.logout clears storage', () => {
		const storage = memoryTokenStorage();
		storage.set('valid');
		const client = createClient({ tokenStorage: storage });
		client.auth.logout();
		expect(storage.get()).toBeNull();
		expect(isTokenExpired('x')).toBe(false); // sanity: helper exported
	});

	it('auth.login resolves (not rejects) with a pending Telegram result and stores no token', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ success: true, data: { status: 'pending', tg_id: '123', full_name: 'Aung Kyaw' } }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					}),
			),
		);
		const storage = memoryTokenStorage();
		const client = createClient({ tokenStorage: storage });
		const result = await client.auth.login('init-data');
		expect(result).toEqual({ status: 'pending', tg_id: '123', full_name: 'Aung Kyaw' });
		expect(storage.get()).toBeNull(); // pending → no token
	});

	it('auth.login stores the token only on an approved result', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							success: true,
							data: { status: 'approved', token: 'jwt-1', user: { id: '1', email: 'a@b.c', full_name: 'A' } },
						}),
						{ status: 200, headers: { 'Content-Type': 'application/json' } },
					),
			),
		);
		const storage = memoryTokenStorage();
		const client = createClient({ tokenStorage: storage });
		const result = await client.auth.login('init-data');
		expect(result.status).toBe('approved');
		expect(storage.get()).toBe('jwt-1');
	});

	it('auth.devLogin resolves with a pending result too', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ success: true, data: { status: 'pending', tg_id: '9', full_name: 'Dev' } }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					}),
			),
		);
		const storage = memoryTokenStorage();
		const client = createClient({ tokenStorage: storage });
		const result = await client.auth.devLogin({ id: 9, first_name: 'Dev' });
		expect(result.status).toBe('pending');
		expect(storage.get()).toBeNull();
	});
});

describe('refresh tokens & logout', () => {
	/** A token the client considers expired (exp 1h ago). */
	function expiredToken(): string {
		return btoa(JSON.stringify({ jti: 'x', user_id: 'u', exp: Date.now() - 3_600_000 }) + '.sig');
	}

	/** A successful /auth/refresh payload. */
	function refreshEnvelope(token = 'fresh', refresh = 'refresh-2') {
		return envelope({ token, refresh_token: refresh, user: { id: 'u', email: 'a@b.c', full_name: 'A' } });
	}

	const authOf = (init?: RequestInit) => new Headers(init?.headers ?? {}).get('Authorization');

	it('rotates an expired token up front (no doomed request) and sends the fresh bearer', async () => {
		const calls: Array<{ path: string; auth: string | null; idem: string | null }> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				const path = new URL(String(url), 'http://x').pathname;
				calls.push({ path, auth: authOf(init), idem: new Headers(init?.headers ?? {}).get('Idempotency-Key') });
				return path === '/api/auth/refresh' ? refreshEnvelope() : envelope({ ok: true });
			}),
		);
		const storage = memoryTokenStorage();
		storage.set(expiredToken());
		storage.setRefresh?.('refresh-1');
		const client = createClient({ tokenStorage: storage });
		await expect(client.request('/entities/x')).resolves.toEqual({ ok: true });
		expect(calls).toEqual([
			// The rotation authenticates by the token itself — no bearer, no key.
			{ path: '/api/auth/refresh', auth: null, idem: null },
			{ path: '/api/entities/x', auth: 'Bearer fresh', idem: null },
		]);
		expect(storage.get()).toBe('fresh');
		expect(storage.getRefresh?.()).toBe('refresh-2');
	});

	it('rotates ONCE when concurrent requests race the same expired token', async () => {
		let refreshCalls = 0;
		const entityAuth: Array<string | null> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				const path = new URL(String(url), 'http://x').pathname;
				if (path === '/api/auth/refresh') {
					refreshCalls++;
					await Promise.resolve(); // widen the window so a second caller overlaps
					return refreshEnvelope();
				}
				entityAuth.push(authOf(init));
				return envelope({ ok: true });
			}),
		);
		const storage = memoryTokenStorage();
		storage.set(expiredToken());
		storage.setRefresh?.('refresh-1');
		const client = createClient({ tokenStorage: storage });
		await Promise.all([client.request('/entities/a'), client.request('/entities/b')]);
		// A second rotation would present an already-rotated token — theft to the
		// server, which revokes the whole chain. Single-flight is a correctness
		// requirement, not an optimization.
		expect(refreshCalls).toBe(1);
		expect(entityAuth).toEqual(['Bearer fresh', 'Bearer fresh']);
	});

	it('a refused rotation (401) ends the session and the request surfaces the 401', async () => {
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				const path = new URL(String(url), 'http://x').pathname;
				if (path === '/api/auth/refresh') {
					calls.push('refresh');
					return errorEnvelope(401, 'Invalid refresh token');
				}
				calls.push('request');
				return errorEnvelope(401, 'Invalid or expired token');
			}),
		);
		const storage = memoryTokenStorage();
		storage.set(expiredToken());
		storage.setRefresh?.('refresh-1');
		const client = createClient({ tokenStorage: storage });
		await expect(client.request('/entities/x')).rejects.toMatchObject({ status: 401 });
		expect(calls).toEqual(['refresh', 'request']); // rotation first, then the tokenless request
		expect(storage.get()).toBeNull();
		expect(storage.getRefresh?.()).toBeNull();
	});

	it('401 → rotates the refresh token once → retries with the fresh bearer', async () => {
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				const path = new URL(String(url), 'http://x').pathname;
				if (path === '/api/auth/refresh') {
					calls.push(`refresh:${authOf(init) ?? 'anon'}`);
					return refreshEnvelope();
				}
				const auth = authOf(init) ?? 'anon';
				calls.push(auth);
				return auth === 'Bearer fresh' ? envelope({ ok: true }) : errorEnvelope(401, 'Invalid or expired token');
			}),
		);
		const storage = memoryTokenStorage();
		storage.set('stale'); // unparseable → sent as-is until the server rejects it
		storage.setRefresh?.('refresh-1');
		const client = createClient({ tokenStorage: storage });
		await expect(client.request('/entities/x')).resolves.toEqual({ ok: true });
		expect(calls).toEqual(['Bearer stale', 'refresh:anon', 'Bearer fresh']);
		expect(storage.get()).toBe('fresh');
		expect(storage.getRefresh?.()).toBe('refresh-2');
	});

	it('prefers the refresh token over the refreshSession hook', async () => {
		const hook = vi.fn(async () => 'hooked');
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) =>
				new URL(String(url), 'http://x').pathname === '/api/auth/refresh' ? refreshEnvelope() : envelope({ ok: true }),
			),
		);
		const storage = memoryTokenStorage();
		storage.set(expiredToken());
		storage.setRefresh?.('refresh-1');
		const client = createClient({ tokenStorage: storage, refreshSession: hook });
		await client.request('/entities/x');
		expect(hook).not.toHaveBeenCalled();
	});

	it('auth.refresh() rotates the chain and stores the successor', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => refreshEnvelope()),
		);
		const storage = memoryTokenStorage();
		storage.set('old');
		storage.setRefresh?.('refresh-1');
		const client = createClient({ tokenStorage: storage });
		await expect(client.auth.refresh()).resolves.toBe(true);
		expect(storage.get()).toBe('fresh');
		expect(storage.getRefresh?.()).toBe('refresh-2');
	});

	it('auth.refresh() resolves false without a stored token — no network call', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const client = createClient({ tokenStorage: memoryTokenStorage() });
		await expect(client.auth.refresh()).resolves.toBe(false);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('auth.refresh() ends the session on a 401 refusal', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => errorEnvelope(401, 'Invalid refresh token')),
		);
		const storage = memoryTokenStorage();
		storage.set('old');
		storage.setRefresh?.('refresh-1');
		const client = createClient({ tokenStorage: storage });
		await expect(client.auth.refresh()).resolves.toBe(false);
		expect(storage.get()).toBeNull();
		expect(storage.getRefresh?.()).toBeNull();
	});

	it('a network failure during rotation keeps the session (a later try may succeed)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('network down');
			}),
		);
		const storage = memoryTokenStorage();
		storage.set('old');
		storage.setRefresh?.('refresh-1');
		const client = createClient({ tokenStorage: storage });
		await expect(client.auth.refresh()).resolves.toBe(false);
		expect(storage.get()).toBe('old');
		expect(storage.getRefresh?.()).toBe('refresh-1');
	});

	it('logout() clears locally FIRST, then revokes the chain server-side', async () => {
		const bodies: Array<Record<string, unknown>> = [];
		let sawClearedStorage: boolean | null = null;
		const storage = memoryTokenStorage();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				sawClearedStorage = storage.get() === null && storage.getRefresh?.() === null;
				bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
				return envelope({ revoked: 1 });
			}),
		);
		storage.set('tok');
		storage.setRefresh?.('refresh-1');
		const client = createClient({ tokenStorage: storage });
		await client.auth.logout();
		expect(sawClearedStorage).toBe(true); // local state is gone when the revoke leaves
		expect(bodies).toEqual([{ refresh_token: 'refresh-1', all: false }]);
	});

	it('logout({ all: true }) asks for every chain of the user to be revoked', async () => {
		const bodies: Array<Record<string, unknown>> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
				return envelope({ revoked: 3 });
			}),
		);
		const storage = memoryTokenStorage();
		storage.set('tok');
		storage.setRefresh?.('refresh-1');
		const client = createClient({ tokenStorage: storage });
		await client.auth.logout({ all: true });
		expect(bodies).toEqual([{ refresh_token: 'refresh-1', all: true }]);
	});

	it('logout() resolves even when the revoke call fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('network down');
			}),
		);
		const storage = memoryTokenStorage();
		storage.set('tok');
		storage.setRefresh?.('refresh-1');
		const client = createClient({ tokenStorage: storage });
		await expect(client.auth.logout()).resolves.toBeUndefined();
		expect(storage.get()).toBeNull();
		expect(storage.getRefresh?.()).toBeNull();
	});

	it('logout() without a stored refresh token never calls the server', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const storage = memoryTokenStorage();
		storage.set('tok');
		const client = createClient({ tokenStorage: storage });
		await client.auth.logout();
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(storage.get()).toBeNull();
	});

	it('loginPassword forwards device_id and stores the issued chain', async () => {
		const bodies: Array<Record<string, unknown>> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
				return envelope({ token: 'jwt-1', refresh_token: 'refresh-1', user: { id: '1', email: 'a@b.c', full_name: 'A' } });
			}),
		);
		const storage = memoryTokenStorage();
		const client = createClient({ tokenStorage: storage });
		await client.auth.loginPassword('a@b.c', 'pw', 'device-7');
		expect(bodies).toEqual([{ email: 'a@b.c', password: 'pw', device_id: 'device-7' }]);
		expect(storage.get()).toBe('jwt-1');
		expect(storage.getRefresh?.()).toBe('refresh-1');
	});

	it('a sign-in replaces the prior chain — or clears it when the server issued none', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => envelope({ token: 'jwt-2', user: { id: '2', email: 'b@c.d', full_name: 'B' } })),
		);
		const storage = memoryTokenStorage();
		storage.set('jwt-1');
		storage.setRefresh?.('refresh-from-account-1');
		const client = createClient({ tokenStorage: storage });
		await client.auth.loginPassword('b@c.d', 'pw');
		expect(storage.get()).toBe('jwt-2');
		expect(storage.getRefresh?.()).toBeNull(); // never carry a previous session's chain
	});

	it('a Telegram sign-in clears any prior refresh chain (the route issues none)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => envelope({ status: 'approved', token: 'jwt-t', user: { id: '1', email: 'a@b.c', full_name: 'A' } })),
		);
		const storage = memoryTokenStorage();
		storage.set('jwt-old');
		storage.setRefresh?.('refresh-old');
		const client = createClient({ tokenStorage: storage });
		await client.auth.login('init-data');
		expect(storage.get()).toBe('jwt-t');
		expect(storage.getRefresh?.()).toBeNull();
	});

	it('an auth-path request never rotates, clears or grafts the session', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => envelope({ revoked: 0 })),
		);
		const storage = memoryTokenStorage();
		storage.set(expiredToken());
		storage.setRefresh?.('refresh-1');
		const client = createClient({ tokenStorage: storage });
		await client.request('/auth/logout', { method: 'POST', body: { refresh_token: 'refresh-1' } });
		const headers = new Headers(vi.mocked(fetch).mock.calls[0]?.[1]?.headers ?? {});
		expect(headers.get('Authorization')).toBeNull();
		expect(headers.get('Idempotency-Key')).toBeNull();
		expect(storage.get()).not.toBeNull(); // the refresh token must survive for logout()/refresh()
		expect(storage.getRefresh?.()).toBe('refresh-1');
		expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1); // no rotation recursion
	});
});
