import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, memoryTokenStorage } from '../src/index';
import { fieldsToArray, restrictFields } from '../src/permissions';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('restrictFields', () => {
	it('null (no restrictions) → projection unchanged', () => {
		expect(restrictFields(['a', 'b'], null)).toEqual(['a', 'b']);
		expect(restrictFields(undefined, null)).toBeUndefined();
	});

	it('[] (deny all) → only id survives', () => {
		expect(restrictFields(['a', 'b'], [])).toEqual(['id']);
		expect(restrictFields(undefined, [])).toEqual(['id']);
	});

	it('no requested projection → whitelist caps the request', () => {
		expect(restrictFields(undefined, ['name', 'email'])).toEqual(['name', 'email']);
	});

	it('"*" (everything) → whitelist caps it', () => {
		expect(restrictFields(['*'], ['name', 'email'])).toEqual(['name', 'email']);
	});

	it('named fields → intersected with the whitelist (hidden fields dropped)', () => {
		expect(restrictFields(['id', 'salary', 'name'], ['id', 'name'])).toEqual(['id', 'name']);
		expect(restrictFields(['secret'], ['id', 'name'])).toEqual([]);
	});
});

describe('fieldsToArray', () => {
	it('normalizes string, comma-list, array and undefined projections', () => {
		expect(fieldsToArray('a,b,c')).toEqual(['a', 'b', 'c']);
		expect(fieldsToArray('*')).toEqual(['*']);
		expect(fieldsToArray(['a', 'b'])).toEqual(['a', 'b']);
		expect(fieldsToArray(undefined)).toBeUndefined();
	});
});

describe('client.fieldRestrictions', () => {
	it('fetches /auth/me?collection= and returns the whitelist (cached 60s)', async () => {
		let meCalls = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (String(url).includes('/auth/me')) {
					meCalls++;
					return new Response(JSON.stringify({ success: true, data: { field_restrictions: ['id', 'name'] } }), { status: 200 });
				}
				return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
			}),
		);
		const client = createClient({ tokenStorage: memoryTokenStorage() });
		client.tokenStorage.set('tok');

		expect(await client.fieldRestrictions('orders')).toEqual(['id', 'name']);
		expect(await client.fieldRestrictions('orders')).toEqual(['id', 'name']); // cache hit — no 2nd call
		expect(meCalls).toBe(1);
	});

	it('concurrent callers share ONE in-flight /auth/me (no duplicate fetches)', async () => {
		let meCalls = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (String(url).includes('/auth/me')) meCalls++;
				return new Response(JSON.stringify({ success: true, data: { field_restrictions: ['id', 'name'] } }), { status: 200 });
			}),
		);
		const client = createClient({ tokenStorage: memoryTokenStorage() });
		client.tokenStorage.set('tok');

		const [a, b] = await Promise.all([client.fieldRestrictions('orders'), client.fieldRestrictions('orders')]);
		expect(a).toEqual(['id', 'name']);
		expect(b).toEqual(['id', 'name']);
		expect(meCalls).toBe(1);
	});

	it('null when unrestricted (admin or no restrictions)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ success: true, data: { field_restrictions: null } }), { status: 200 })),
		);
		const client = createClient();
		expect(await client.fieldRestrictions('orders')).toBeNull();
	});

	it('pruneFields applies the whitelist to a projection', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (String(url).includes('/auth/me')) {
					return new Response(JSON.stringify({ success: true, data: { field_restrictions: ['id', 'type'] } }), { status: 200 });
				}
				return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
			}),
		);
		const client = createClient();
		expect(await client.pruneFields('orders', ['id', 'timestamp', 'type'])).toEqual(['id', 'type']);
	});
});

describe('client.queryMany', () => {
	it('POSTs keyed specs to /api/query and unwraps the keyed results', async () => {
		let captured: { url: string; method?: string; body?: unknown } = { url: '' };
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				captured = { url: String(url), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined };
				return new Response(
					JSON.stringify({
						success: true,
						data: {
							results: [
								{ key: 'a', ok: true, data: [{ id: '1' }] },
								{ key: 'b', ok: false, error: 'denied' },
							],
						},
					}),
					{ status: 200 },
				);
			}),
		);
		const client = createClient({ tokenStorage: memoryTokenStorage() });
		client.tokenStorage.set('tok');

		const params = new URLSearchParams({ limit: '5' });
		const result = await client.queryMany([
			{ key: 'a', collection: 'orders', query: params },
			{ key: 'b', collection: 'secret' },
		]);

		expect(captured.url).toBe('/api/query');
		expect(captured.method).toBe('POST');
		expect(captured.body).toEqual({
			queries: [
				{ key: 'a', collection: 'orders', params: { limit: '5' } },
				// Page-size policy: a spec without a limit gets the SDK default (25).
				{ key: 'b', collection: 'secret', params: { limit: '25' } },
			],
		});
		expect(result.results).toHaveLength(2);
		expect(result.results[0]).toMatchObject({ key: 'a', ok: true });
		expect(result.results[1]).toMatchObject({ key: 'b', ok: false });
	});
});
