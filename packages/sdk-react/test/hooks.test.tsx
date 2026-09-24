import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
	SdkProvider,
	invalidateCollection,
	useCreateItem,
	useInfiniteItems,
	useItem,
	useItems,
	useRemoveItem,
	useUpdateItem,
	useView,
} from '../src/index';
import type { MmbixClient } from '@mmbix/sdk';

/** Type aliases get implicit index signatures — required so FakeRow/FakeSchema
 *  satisfy the SDK's `Record<string, Record<string, unknown>>` Schema constraint
 *  (interfaces do not). */
type FakeRow = { id: string; status: string };
type FakeSchema = { items: FakeRow; [key: string]: Record<string, unknown> };

type ListFn = (query?: {
	cursor?: string;
}) => Promise<{ data: FakeRow[]; meta: { limit: number; has_more: boolean; next_cursor?: string | null } }>;

function fakeClient(list: ListFn): MmbixClient<FakeSchema> {
	const items = vi.fn(() => ({ list }));
	return { items } as unknown as MmbixClient<FakeSchema>;
}

/** One QueryClient per test — this is what makes dedupe/cache real (in the app
 *  the <SdkProvider> owns a single client for the whole tree). staleTime 30s
 *  mirrors createQueryClient's default — without it data is instantly stale
 *  and every remount refetches. */
function makeQueryClient() {
	return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
}

function wrapper(client: MmbixClient<FakeSchema>, qc: QueryClient) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return (
			<SdkProvider<FakeSchema> client={client} queryClient={qc}>
				{children}
			</SdkProvider>
		);
	};
}

afterEach(() => {
	cleanup();
});

describe('useItems', () => {
	it('fetches once for multiple consumers with the same query (dedupe)', async () => {
		const qc = makeQueryClient();
		const list = vi.fn(async () => ({ data: [{ id: '1', status: 'a' }], meta: { limit: 10, has_more: false } }));
		const client = fakeClient(list);

		const a = renderHook(() => useItems<FakeSchema, 'items'>('items', { limit: 10 }), { wrapper: wrapper(client, qc) });
		const b = renderHook(() => useItems<FakeSchema, 'items'>('items', { limit: 10 }), { wrapper: wrapper(client, qc) });

		await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
		expect(list).toHaveBeenCalledTimes(1); // shared cache → ONE request
		expect(a.result.current.data).toEqual([{ id: '1', status: 'a' }]);
		expect(b.result.current.data).toEqual(a.result.current.data);
		a.unmount();
		b.unmount();
	});

	it('serves a cached query without refetching (zero duplicate requests)', async () => {
		const qc = makeQueryClient();
		const list = vi.fn(async () => ({ data: [{ id: '1', status: 'a' }], meta: { limit: 10, has_more: false } }));
		const client = fakeClient(list);

		const first = renderHook(() => useItems<FakeSchema, 'items'>('items'), { wrapper: wrapper(client, qc) });
		await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
		first.unmount();

		const second = renderHook(() => useItems<FakeSchema, 'items'>('items'), { wrapper: wrapper(client, qc) });
		await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

		expect(list).toHaveBeenCalledTimes(1); // remount → cache hit (fresh within staleTime)
		second.unmount();
	});

	it('invalidates a collection → refetches', async () => {
		const qc = makeQueryClient();
		const list = vi.fn(async () => ({ data: [{ id: '1', status: 'a' }], meta: { limit: 10, has_more: false } }));
		const client = fakeClient(list);

		const { result } = renderHook(() => useItems<FakeSchema, 'items'>('items'), { wrapper: wrapper(client, qc) });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(list).toHaveBeenCalledTimes(1);

		await act(async () => {
			await invalidateCollection(qc, 'items');
		});
		await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
	});

	it('respectPermissions prunes fields against the role whitelist before fetching', async () => {
		const qc = makeQueryClient();
		const list = vi.fn(async (_query?: { fields?: unknown }) => ({
			data: [{ id: '1', status: 'a' }],
			meta: { limit: 10, has_more: false },
		}));
		const fieldRestrictions = vi.fn(async () => ['id', 'status']);
		const client = {
			items: vi.fn(() => ({ list })),
			fieldRestrictions,
		} as unknown as MmbixClient<FakeSchema>;

		const { result } = renderHook(
			() => useItems<FakeSchema, 'items'>('items', { fields: ['id', 'secret', 'status'] }, { respectPermissions: true }),
			{ wrapper: wrapper(client, qc) },
		);
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(fieldRestrictions).toHaveBeenCalledWith('items');
		const sentQuery = list.mock.calls[0]?.[0] as { fields?: unknown };
		expect(sentQuery.fields).toEqual(['id', 'status']); // 'secret' pruned before the request
	});

	it('respectPermissions caps a * projection to the whitelist', async () => {
		const qc = makeQueryClient();
		const list = vi.fn(async (_query?: { fields?: unknown }) => ({
			data: [{ id: '1', status: 'a' }],
			meta: { limit: 10, has_more: false },
		}));
		const client = {
			items: vi.fn(() => ({ list })),
			fieldRestrictions: vi.fn(async () => ['id', 'status']),
		} as unknown as MmbixClient<FakeSchema>;

		const { result } = renderHook(() => useItems<FakeSchema, 'items'>('items', { fields: '*' }, { respectPermissions: true }), {
			wrapper: wrapper(client, qc),
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		const sentQuery = list.mock.calls[0]?.[0] as { fields?: unknown };
		expect(sentQuery.fields).toBe('id,status');
	});
});

describe('useInfiniteItems', () => {
	it('pages through keyset cursors via fetchNextPage', async () => {
		const qc = makeQueryClient();
		const list = vi.fn(async (query?: { cursor?: string }) => {
			if (query?.cursor === 'c2') return { data: [{ id: '3', status: 'c' }], meta: { limit: 2, has_more: false } };
			return {
				data: [
					{ id: '1', status: 'a' },
					{ id: '2', status: 'b' },
				],
				meta: { limit: 2, has_more: true, next_cursor: 'c2' },
			};
		});
		const client = fakeClient(list);

		const { result } = renderHook(() => useInfiniteItems<FakeSchema, 'items'>('items', { limit: 2 }), { wrapper: wrapper(client, qc) });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data?.pages[0].data).toHaveLength(2);
		expect(result.current.hasNextPage).toBe(true);

		await act(async () => {
			await result.current.fetchNextPage();
		});
		await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
		expect(result.current.data?.pages[1].data).toEqual([{ id: '3', status: 'c' }]);
		expect(list).toHaveBeenCalledTimes(2); // page 2 carries the next_cursor
	});
});

describe('useItem', () => {
	it('dedupes identical projections (StrictMode double-mount → ONE fetch)', async () => {
		const qc = makeQueryClient();
		const get = vi.fn(async () => ({ id: '1', status: 'a' }));
		const client = { items: vi.fn(() => ({ get })) } as unknown as MmbixClient<FakeSchema>;

		const a = renderHook(() => useItem<FakeSchema, 'items'>('items', '1'), { wrapper: wrapper(client, qc) });
		const b = renderHook(() => useItem<FakeSchema, 'items'>('items', '1'), { wrapper: wrapper(client, qc) });
		await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
		expect(get).toHaveBeenCalledTimes(1);
		expect(a.result.current.data).toEqual({ id: '1', status: 'a' });
		b.unmount();
		a.unmount();
	});

	it('different projections of the same record are distinct cache entries (no stale collision)', async () => {
		const qc = makeQueryClient();
		const get = vi.fn(async (_id: string, opts?: { fields?: unknown }) => ({
			id: '1',
			status: 'a',
			...(opts?.fields ? { expanded: true } : {}),
		}));
		const client = { items: vi.fn(() => ({ get })) } as unknown as MmbixClient<FakeSchema>;

		const lean = renderHook(() => useItem<FakeSchema, 'items'>('items', '1'), { wrapper: wrapper(client, qc) });
		await waitFor(() => expect(lean.result.current.isSuccess).toBe(true));
		const wide = renderHook(() => useItem<FakeSchema, 'items'>('items', '1', { fields: '*.*' }), { wrapper: wrapper(client, qc) });
		await waitFor(() => expect(wide.result.current.isSuccess).toBe(true));

		expect(get).toHaveBeenCalledTimes(2); // a lean '*' read and an expanded '*.*' read are different data
		lean.unmount();
		wide.unmount();
	});
});

describe('useView', () => {
	it('sends ALL sources in ONE round trip and returns the keyed payload', async () => {
		const qc = makeQueryClient();
		type QuerySpec = { key: string; collection: string; query?: unknown };
		const queryMany = vi.fn(async (_queries: QuerySpec[]) => ({
			results: [
				{ key: 'cards', ok: true, data: [{ id: '1', status: 'a' }] },
				{ key: 'hero', ok: true, data: [{ id: 'e1' }] },
			],
		}));
		const client = { queryMany } as unknown as MmbixClient<FakeSchema>;

		const { result } = renderHook(
			() =>
				useView<FakeSchema>({
					cards: { collection: 'items', query: { limit: 24 } },
					hero: { collection: 'items', query: { limit: 1 } },
				}),
			{ wrapper: wrapper(client, qc) },
		);
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(queryMany).toHaveBeenCalledTimes(1); // ONE round trip for the whole view
		const spec = queryMany.mock.calls[0]?.[0] ?? [];
		expect(spec).toHaveLength(2);
		expect(spec[0]).toMatchObject({ key: 'cards', collection: 'items' });
		expect(result.current.data).toMatchObject({
			cards: [{ id: '1', status: 'a' }],
			hero: [{ id: 'e1' }],
		});
	});

	it('degrades a failed source to [] without blanking the view', async () => {
		const qc = makeQueryClient();
		const queryMany = vi.fn(async () => ({
			results: [
				{ key: 'ok', ok: true, data: [{ id: '1' }] },
				{ key: 'broken', ok: false, error: 'no read permission' },
			],
		}));
		const client = { queryMany } as unknown as MmbixClient<FakeSchema>;

		const { result } = renderHook(() => useView<FakeSchema>({ ok: { collection: 'items' }, broken: { collection: 'items' } }), {
			wrapper: wrapper(client, qc),
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toMatchObject({ ok: [{ id: '1' }], broken: [] });
	});

	it('invalidates a [view, spec] batch when a write touches a collection it reads', async () => {
		const qc = makeQueryClient();
		type QuerySpec = { key: string; collection: string; query?: unknown };
		const queryMany = vi.fn(async (_queries: QuerySpec[]) => ({
			results: [{ key: 'cards', ok: true, data: [{ id: '1', status: 'a' }] }],
		}));
		const client = { queryMany } as unknown as MmbixClient<FakeSchema>;

		// View A reads `items` (must refetch); view B reads another collection
		// (must stay cached — invalidation is collection-scoped, not all views).
		const a = renderHook(() => useView<FakeSchema>({ cards: { collection: 'items', query: { limit: 24 } } }), {
			wrapper: wrapper(client, qc),
		});
		const b = renderHook(() => useView<FakeSchema>({ hero: { collection: 'other', query: { limit: 1 } } }), {
			wrapper: wrapper(client, qc),
		});
		await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
		await waitFor(() => expect(b.result.current.isSuccess).toBe(true));
		expect(queryMany).toHaveBeenCalledTimes(2); // one batch per view on mount

		await act(async () => {
			await invalidateCollection(qc, 'items');
		});

		await waitFor(() => expect(queryMany).toHaveBeenCalledTimes(3)); // only the `items` batch refetched
		a.unmount();
		b.unmount();
	});
});

describe('mutations', () => {
	it('useCreateItem sends the payload and invalidates the collection (list refetches)', async () => {
		const qc = makeQueryClient();
		const create = vi.fn(async () => ({ id: 'new', status: 'x' }));
		const list = vi.fn(async () => ({ data: [], meta: { limit: 10, has_more: false } }));
		const client = {
			items: vi.fn((_c: string) => ({ list, create })),
		} as unknown as MmbixClient<FakeSchema>;

		// A mounted list consumer — the invalidation must refetch it.
		const listHook = renderHook(() => useItems<FakeSchema, 'items'>('items'), { wrapper: wrapper(client, qc) });
		await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

		const { result } = renderHook(() => useCreateItem<FakeSchema, 'items'>('items'), { wrapper: wrapper(client, qc) });
		await act(async () => {
			await result.current.mutateAsync({ body: { status: 'x' } as never });
		});
		expect(create).toHaveBeenCalledWith({ status: 'x' }, undefined);

		await waitFor(() => expect(list).toHaveBeenCalledTimes(2)); // zero-stale: refetched
		listHook.unmount();
	});

	it('useUpdateItem forwards ifMatch for optimistic concurrency', async () => {
		const qc = makeQueryClient();
		const update = vi.fn(async () => ({ id: '1', status: 'b' }));
		const client = {
			items: vi.fn(() => ({ update })),
		} as unknown as MmbixClient<FakeSchema>;

		const { result } = renderHook(() => useUpdateItem<FakeSchema, 'items'>('items'), { wrapper: wrapper(client, qc) });
		await act(async () => {
			await result.current.mutateAsync({ id: '1', body: { status: 'b' } as never, mutateOptions: { ifMatch: 'ts-1' } });
		});
		expect(update).toHaveBeenCalledWith('1', { status: 'b' }, { ifMatch: 'ts-1' });
	});

	it('useRemoveItem deletes and invalidates the collection', async () => {
		const qc = makeQueryClient();
		const remove = vi.fn(async () => ({ id: '1' }));
		const list = vi.fn(async () => ({ data: [{ id: '1', status: 'a' }], meta: { limit: 10, has_more: false } }));
		const client = {
			items: vi.fn((_c: string) => ({ list, remove })),
		} as unknown as MmbixClient<FakeSchema>;

		const listHook = renderHook(() => useItems<FakeSchema, 'items'>('items'), { wrapper: wrapper(client, qc) });
		await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

		const { result } = renderHook(() => useRemoveItem<FakeSchema, 'items'>('items'), { wrapper: wrapper(client, qc) });
		await act(async () => {
			await result.current.mutateAsync({ id: '1' });
		});
		expect(remove).toHaveBeenCalledWith('1', { ifMatch: undefined });
		await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
		listHook.unmount();
	});
});
