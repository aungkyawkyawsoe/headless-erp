/**
 * @mmbix/sdk-react — React server-state engine over @mmbix/sdk.
 *
 * Backed by TanStack Query (dedupe, cache, GC, retry, devtools) with Mmbix
 * semantics on top:
 *   - query keys are (collection, query) — two components asking the same thing
 *     share ONE network request and ONE cache entry
 *   - writes invalidate the collection's queries automatically (zero stale)
 *   - `useInfiniteItems` drives the engine's keyset cursor through
 *     `meta.next_cursor` (stable pages, no OFFSET degradation)
 *
 * Wrap the app in <SdkProvider client={client}> once; every hook below gets the
 * client from context.
 */
import {
	QueryClient,
	QueryClientProvider,
	keepPreviousData,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
	type QueryClientConfig,
	type UseMutationOptions,
	type UseQueryOptions,
} from '@tanstack/react-query';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ListQuery, ListResult, MmbixClient, MutateOptions } from '@mmbix/sdk';
import { fieldsToArray, restrictFields, serializeQuery } from '@mmbix/sdk';

// ── Provider ────────────────────────────────────────────────

const SdkContext = createContext<MmbixClient<never> | null>(null);

/** Default TanStack client — 30s staleTime (matches the SDK's read TTL) + 1 retry. */
export function createQueryClient(config?: QueryClientConfig): QueryClient {
	return new QueryClient({
		defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
		...config,
	});
}

/** Provides the SDK client + a QueryClient to every hook in the tree. */
export function SdkProvider<Schema extends Record<string, Record<string, unknown>>>({
	client,
	children,
	queryClient,
}: {
	client: MmbixClient<Schema>;
	children: ReactNode;
	queryClient?: QueryClient;
}): ReactNode {
	const [defaultClient] = useState(() => queryClient ?? createQueryClient());
	return (
		<QueryClientProvider client={defaultClient}>
			<SdkContext.Provider value={client as unknown as MmbixClient<never>}>{children}</SdkContext.Provider>
		</QueryClientProvider>
	);
}

/** The configured SDK client (from <SdkProvider>). */
export function useSdk<Schema extends Record<string, Record<string, unknown>>>(): MmbixClient<Schema> {
	const client = useContext(SdkContext);
	if (!client) throw new Error('useSdk must be used within <SdkProvider client={...}>');
	return client as unknown as MmbixClient<Schema>;
}

/** Shape of a useView cache key's second segment — keyed sources, each declaring the collection it reads (`['view', spec]` in useView). */
type ViewSpec = Record<string, { collection: string; query?: unknown }>;

/** Invalidate every cached query for a collection — the zero-stale lever.
 *  Collection reads key as `[collection, ...]` (prefix match); useView batches
 *  key as `['view', spec]`, so every batch whose spec reads this collection is
 *  invalidated too. */
export async function invalidateCollection(queryClient: QueryClient, collection: string): Promise<void> {
	await queryClient.invalidateQueries({ queryKey: [collection] });
	await queryClient.invalidateQueries({
		queryKey: ['view'],
		predicate: (query) => {
			const spec = query.queryKey[1];
			if (typeof spec !== 'object' || spec === null) return false;
			return Object.values(spec as ViewSpec).some((source) => source.collection === collection);
		},
	});
}

// ── Reads ───────────────────────────────────────────────────

/** The caller's field whitelist for a collection (cached 60s via the client). */
export function usePermissionFields<Schema extends Record<string, Record<string, unknown>>>(collection: string, enabled = true) {
	const client = useSdk<Schema>();
	return useQuery({
		queryKey: [collection, 'permissions'],
		queryFn: () => client.fieldRestrictions(collection),
		enabled,
		staleTime: 60_000,
		retry: false,
	});
}

export interface ItemsHookOptions<Schema, K extends keyof Schema & string, T = Schema[K][]> {
	enabled?: boolean;
	staleTime?: number;
	/** Transform the full list result (default: the rows). */
	select?: (result: ListResult<Schema[K]>) => T;
	/** Prune the requested `fields` against the role's field whitelist before
	 *  sending (Hasura-style zero over/under-fetch). The server enforces the
	 *  same rules anyway — this avoids even asking for hidden fields. */
	respectPermissions?: boolean;
	/** Extra TanStack options. */
	queryOptions?: Omit<
		UseQueryOptions<ListResult<Schema[K]>, unknown, T, (string | ListQuery<Schema[K]>)[]>,
		'queryKey' | 'queryFn' | 'select'
	>;
}

/**
 * One cursor-paginated page of a collection. Deduped + cached by TanStack:
 * identical (collection, query) from any component → ONE request.
 */
export function useItems<Schema extends Record<string, Record<string, unknown>>, K extends keyof Schema & string>(
	collection: K,
	query?: ListQuery<Schema[K]>,
	options: ItemsHookOptions<Schema, K> = {},
) {
	const client = useSdk<Schema>();
	const respectPermissions = options.respectPermissions === true;

	// Permission-aware pruning: fetch the whitelist once (cached 60s), then
	// intersect the requested projection before the request ever leaves.
	const perms = usePermissionFields(collection, respectPermissions);
	const finalQuery = useMemo(() => {
		if (!respectPermissions || perms.data === undefined) return query;
		const requested = fieldsToArray(query?.fields);
		const restricted = restrictFields(requested, perms.data);
		// `restricted` is undefined only when there are no restrictions at all —
		// otherwise it is a concrete (possibly unchanged) projection array.
		if (restricted === undefined) return query;
		const finalFields = Array.isArray(query?.fields) ? restricted : restricted.join(',');
		return { ...query, fields: finalFields as ListQuery<Schema[K]>['fields'] };
	}, [respectPermissions, query, perms.data]);

	// Wait for the whitelist before fetching data (only when pruning is on) so
	// the query key always reflects the FINAL pruned projection.
	const enabled = respectPermissions ? (perms.data !== undefined ? (options.enabled ?? true) : false) : options.enabled;

	return useQuery({
		queryKey: [collection, finalQuery ?? {}],
		queryFn: () => client.items(collection).list(finalQuery),
		select: options.select ?? ((result) => result.data as Schema[K][]),
		...(enabled !== undefined ? { enabled } : {}),
		...(options.staleTime !== undefined ? { staleTime: options.staleTime } : {}),
		placeholderData: keepPreviousData,
		...options.queryOptions,
	});
}

/**
 * Infinite keyset pagination — `fetchNextPage()` appends via
 * `meta.next_cursor`. One query key, N pages, zero OFFSET.
 */
export function useInfiniteItems<Schema extends Record<string, Record<string, unknown>>, K extends keyof Schema & string>(
	collection: K,
	query?: Omit<ListQuery<Schema[K]>, 'cursor'>,
	options: { enabled?: boolean; staleTime?: number } = {},
) {
	const client = useSdk<Schema>();
	return useInfiniteQuery({
		queryKey: [collection, 'infinite', query ?? {}],
		queryFn: ({ pageParam }) => client.items(collection).list({ ...query, cursor: (pageParam as string | undefined) ?? undefined }),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.meta.next_cursor ?? undefined,
		getPreviousPageParam: (firstPage) => firstPage.meta.prev_cursor ?? undefined,
		...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
		...(options.staleTime !== undefined ? { staleTime: options.staleTime } : {}),
	});
}

/** A single row by id — enabled only when an id is present. The PROJECTION is
 *  part of the cache identity: a lean `*` read and an expanded `*.*` read of
 *  the same record are different data and must never collide. */
export function useItem<Schema extends Record<string, Record<string, unknown>>, K extends keyof Schema & string>(
	collection: K,
	id: string | undefined,
	options: { fields?: ListQuery<Schema[K]>['fields']; enabled?: boolean; staleTime?: number } = {},
) {
	const client = useSdk<Schema>();
	const fieldsKey =
		options.fields !== undefined ? (Array.isArray(options.fields) ? options.fields.join(',') : String(options.fields)) : '*';
	return useQuery({
		queryKey: [collection, id, fieldsKey],
		queryFn: () => client.items(collection).get(id as string, options.fields !== undefined ? { fields: options.fields } : undefined),
		enabled: Boolean(id) && (options.enabled ?? true),
		...(options.staleTime !== undefined ? { staleTime: options.staleTime } : {}),
	});
}

/**
 * One view = ONE round trip (generic consolidation — the /api/query batch).
 * Declare every data need the view renders as keyed sources; the server
 * executes them in PARALLEL through the entity engine (per-collection RBAC +
 * response cache) and returns one keyed payload. Per-key `ok:false` results
 * degrade to `[]` so a failing source never blanks the view.
 *
 *   const { data } = useView({
 *     cards: { collection: 'orders', query: { filter: {...}, limit: 24 } },
 *     hero:  { collection: 'customers',  query: { fields: ['name_mm'] } },
 *   });
 *   data.cards // rows for the cards source
 */
export function useView<Schema extends Record<string, Record<string, unknown>>>(
	sources: Record<string, { collection: keyof Schema & string; query?: ListQuery<Schema[keyof Schema & string]> }>,
	options: { enabled?: boolean; staleTime?: number } = {},
) {
	const client = useSdk<Schema>();
	const spec = useMemo(() => sources, [sources]);
	return useQuery({
		queryKey: ['view', spec],
		queryFn: async () => {
			const queries = Object.entries(spec).map(([key, source]) => ({
				key,
				collection: String(source.collection),
				query: source.query ? serializeQuery(source.query as never) : undefined,
			}));
			const { results } = await client.queryMany(queries);
			const out: Record<string, unknown> = {};
			for (const r of results) out[r.key] = r.ok ? r.data : [];
			return out;
		},
		...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
		...(options.staleTime !== undefined ? { staleTime: options.staleTime } : {}),
		placeholderData: keepPreviousData,
	});
}

// ── Writes (auto-invalidate) ────────────────────────────────

export interface CollectionMutationOptions<TVars, TContext = unknown> {
	/** Extra collections to invalidate after success. */
	invalidate?: string[];
	queryOptions?: Omit<UseMutationOptions<unknown, unknown, TVars, TContext>, 'mutationFn' | 'onSuccess'> & {
		onSuccess?: (data: unknown, vars: TVars, context: TContext | undefined) => void | Promise<void>;
	};
}

/** Create — replay-safe (client UUID + optional idempotency key) + auto-invalidate. */
export function useCreateItem<Schema extends Record<string, Record<string, unknown>>, K extends keyof Schema & string>(
	collection: K,
	options: CollectionMutationOptions<{ body: Partial<Schema[K]>; mutateOptions?: MutateOptions }> = {},
) {
	const client = useSdk<Schema>();
	const qc = useQueryClient();
	const { invalidate, queryOptions } = options;
	return useMutation({
		mutationFn: async ({ body, mutateOptions }) => client.items(collection).create(body, mutateOptions),
		onSuccess: async (data, vars, ctx) => {
			await invalidateCollection(qc, collection);
			for (const other of invalidate ?? []) await invalidateCollection(qc, other);
			await queryOptions?.onSuccess?.(data, vars, ctx);
		},
		...queryOptions,
	});
}

/** Update — pass `mutateOptions.ifMatch` for optimistic-concurrency (409) + auto-invalidate. */
export function useUpdateItem<Schema extends Record<string, Record<string, unknown>>, K extends keyof Schema & string>(
	collection: K,
	options: CollectionMutationOptions<{ id: string; body: Partial<Schema[K]>; mutateOptions?: Omit<MutateOptions, 'id'> }> = {},
) {
	const client = useSdk<Schema>();
	const qc = useQueryClient();
	const { invalidate, queryOptions } = options;
	return useMutation({
		mutationFn: async ({ id, body, mutateOptions }) => client.items(collection).update(id, body, mutateOptions),
		onSuccess: async (data, vars, ctx) => {
			await invalidateCollection(qc, collection);
			for (const other of invalidate ?? []) await invalidateCollection(qc, other);
			await queryOptions?.onSuccess?.(data, vars, ctx);
		},
		...queryOptions,
	});
}

/** Soft delete + auto-invalidate. */
export function useRemoveItem<Schema extends Record<string, Record<string, unknown>>, K extends keyof Schema & string>(
	collection: K,
	options: CollectionMutationOptions<{ id: string; ifMatch?: string }> = {},
) {
	const client = useSdk<Schema>();
	const qc = useQueryClient();
	const { invalidate, queryOptions } = options;
	return useMutation({
		mutationFn: async ({ id, ifMatch }) => client.items(collection).remove(id, { ifMatch }),
		onSuccess: async (data, vars, ctx) => {
			await invalidateCollection(qc, collection);
			for (const other of invalidate ?? []) await invalidateCollection(qc, other);
			await queryOptions?.onSuccess?.(data, vars, ctx);
		},
		...queryOptions,
	});
}

/** Convenience bundle — create/update/remove for one collection. */
export function useItemsMutation<Schema extends Record<string, Record<string, unknown>>, K extends keyof Schema & string>(collection: K) {
	const create = useCreateItem<Schema, K>(collection);
	const update = useUpdateItem<Schema, K>(collection);
	const remove = useRemoveItem<Schema, K>(collection);
	return { create, update, remove };
}
