import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';

/** ONE cursor-paginated page — the wire shape every custom feed page returns
 *  (`nextCursor: null` = no more pages). A page type may carry scope-level
 *  extras beyond the rows (the movement ledger's summary rides page 1), so the
 *  hook is generic over the page type `P` built on this base. */
export interface FeedPageBase<T> {
	rows: T[];
	/** The opaque next-page key — `null` = no more pages. */
	nextCursor: string | null;
}

/** The row type of any feed page (`FeedPageBase` is generic over it). */
export type FeedRow<P> = P extends FeedPageBase<infer T> ? T : never;

export interface UseCursorFeedOptions<P extends FeedPageBase<unknown>> {
	/** TanStack Query key — EVERY payload part (scope, filter, direction) is IN
	 *  the key, so switching scope reuses its own cache entry (a revisit of a
	 *  previously chosen scope costs zero API calls) and concurrent mounts of
	 *  the same scope share ONE request (StrictMode double-mount included). */
	queryKey: QueryKey;
	/** Fetches one page of the feed; `cursor` undefined = the first page. */
	fetcher: (cursor?: string) => Promise<P>;
	/** Gate (e.g. a required route id) before the first fetch. */
	enabled?: boolean;
	/** Freshness window — `STALE_MS.module` for read-only confirmed feeds. */
	staleTime?: number;
}

/**
 * Cursor-paginated custom feed — the shared pattern for EVERY domain read that
 * pages on an opaque `nextCursor` (`/mro/movement/lines`, `/movement/ledger`,
 * …): page 1 loads on mount, `fetchNextPage()` streams the rest on demand.
 *
 * This is `useCursorList`'s sibling for feeds whose fetchers return the raw
 * `{ rows, nextCursor }` contract (no precomputed `hasMore`) and whose pages
 * may carry extras beyond the rows. The underlying TanStack infinite query
 * keeps each page under ONE cache entry, so pages never re-fetch on their own
 * and a scope change mid-flight can never leak stale rows into the new feed
 * (the cache key changed — the old pages simply stay parked under their own
 * key until GC).
 *
 * `rows` is the flattened, ordered concatenation of every loaded page; the
 * returned query also exposes the raw `data.pages` (read scope extras off
 * `firstPage`).
 */
export function useCursorFeed<P extends FeedPageBase<unknown>>({ queryKey, fetcher, enabled = true, staleTime }: UseCursorFeedOptions<P>) {
	const query = useInfiniteQuery({
		queryKey,
		queryFn: ({ pageParam }) => fetcher(pageParam as string | undefined),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		enabled,
		staleTime,
	});

	// Flattened once per loaded-pages identity — re-renders caused by page-local
	// state (filter sheets, tab taps) reuse the same rows array, so memoized row
	// cards skip re-rendering.
	const rows = useMemo<FeedRow<P>[]>(() => query.data?.pages.flatMap((page) => page.rows as FeedRow<P>[]) ?? [], [query.data?.pages]);

	return {
		...query,
		rows,
		/** Page 1 of the current scope — the feed's scope-level extras (e.g. the
		 *  ledger summary) ride on it. `undefined` until the first page lands. */
		firstPage: query.data?.pages[0],
		/** The FIRST page failed and nothing is on screen — the page-level error
		 *  state (skeleton steps aside for the retry block). */
		loadFailed: query.isError && query.data === undefined,
		/** A fetch failed while rows were already on screen (a later page, or a
		 *  stale-window refresh) — the inline retry below the list re-fires it. */
		moreFailed: query.isError && query.data !== undefined,
	};
}
