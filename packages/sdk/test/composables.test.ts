import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticate, createClient, memoryTokenStorage, rest, staticToken } from '../src/index';

function envelope(data: unknown) {
	return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function loginEnvelope(token: string) {
	return new Response(
		JSON.stringify({
			success: true,
			data: { status: 'approved', token, user: { id: '1', email: 'a@b.c', full_name: 'A', role_name: 'admin' } },
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('composable client (.with)', () => {
	it('rest() binds the request surface — request/queryMany/items still work', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				void init;
				// /query returns the keyed batch envelope; entity reads return rows.
				return String(url).includes('/query')
					? envelope({ results: [{ key: 'a', ok: true, data: [{ id: '1' }] }] })
					: envelope([{ id: '1' }]);
			}),
		);
		const client = createClient<Record<string, Record<string, unknown>>>({ baseUrl: 'https://api.example.com' }).with(rest());

		expect(await client.request('/entities/x')).toEqual([{ id: '1' }]);
		const page = await client.items('articles').list({ limit: 5 });
		expect(page.data).toEqual([{ id: '1' }]);
		expect(await client.queryMany([{ key: 'a', collection: 'articles', query: { limit: 5 } }])).toMatchObject({
			results: [{ key: 'a', ok: true }],
		});
	});

	it('staticToken() writes the token and adds getToken/setToken (Directus parity)', async () => {
		const headerOf = (init?: RequestInit) => new Headers(init?.headers ?? {}).get('Authorization');
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				void init;
				return envelope({ ok: true });
			}),
		);
		const client = createClient<Record<string, Record<string, unknown>>>({ baseUrl: 'https://api.example.com' }).with(
			staticToken('super-secure'),
		);

		expect(client.getToken()).toBe('super-secure');
		client.setToken('rotated');
		expect(client.getToken()).toBe('rotated');

		await client.request('/entities/x');
		expect(headerOf(vi.mocked(fetch).mock.calls[0]?.[1])).toBe('Bearer rotated');
	});

	it('authenticate() wires storage + login/logout/getToken/setToken', async () => {
		const storage = memoryTokenStorage();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => loginEnvelope('jwt-1')),
		);
		const client = createClient<Record<string, Record<string, unknown>>>({ baseUrl: 'https://api.example.com' }).with(
			authenticate({ tokenStorage: storage }),
		);

		expect(client.getToken()).toBeNull();
		await client.login('init-data');
		expect(client.getToken()).toBe('jwt-1');
		expect(storage.get()).toBe('jwt-1');

		client.logout();
		expect(client.getToken()).toBeNull();
		expect(storage.get()).toBeNull();
	});

	it('authenticate() without a storage keeps the storage the client was created with', async () => {
		const storage = memoryTokenStorage();
		const client = createClient<Record<string, Record<string, unknown>>>({ tokenStorage: storage }).with(authenticate({}));
		client.setToken('kept');
		expect(storage.get()).toBe('kept');
	});

	it('composition is order-independent and type-safe', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => envelope([])),
		);
		const client = createClient<Record<string, Record<string, unknown>>>({ baseUrl: 'https://api.example.com' })
			.with(authenticate({ tokenStorage: memoryTokenStorage() }))
			.with(rest())
			.with(staticToken('t'));

		expect(client.getToken()).toBe('t');
		expect(await client.request('/entities/x')).toEqual([]);
	});
});

describe('auth accessors (Directus getToken/setToken parity)', () => {
	it('auth.getToken()/auth.setToken() read and write the same storage', () => {
		const client = createClient<Record<string, Record<string, unknown>>>();
		expect(client.auth.getToken()).toBeNull();
		client.auth.setToken('jwt-x');
		expect(client.auth.getToken()).toBe('jwt-x');
	});
});
