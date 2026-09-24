import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

/**
 * One cursor-paginated page — the wire shape every list-page fetcher returns.
 * Pages fetch `LIST_PAGE_SIZE` (25 — the API's own default page size) rows per
 * round trip; further rows stream in as the user scrolls (throttled by the
 * `LoadMoreSentinel`'s IntersectionObserver + React Query's per-page dedupe).
 */
export interface CursorPage<T> {
	rows: T[];
	/** Pass back to the next `list()` call; `null` = no more pages. */
	nextCursor: string | null;
	hasMore: boolean;
}

interface UseCursorListOptions<T> {
	/** TanStack Query key — shared across pages for one cache. */
	queryKey: readonly unknown[];
	/** Fetches one page of rows; `cursor` undefined = the first page. */
	fetcher: (cursor?: string) => Promise<CursorPage<T>>;
	/** Gate on the session (tg_id) resolving before the first fetch. */
	enabled?: boolean;
	/** How long a loaded page stays fresh (passed to `useInfiniteQuery`). */
	staleTime?: number;
}

/**
 * Cursor-paginated list — the shared pattern for EVERY list page (employees,
 * request lists, approval center, approvals): fetch page 1 (25 rows — the API's
 * default page size) on mount, then `fetchNextPage()` streams the next cursor
 * page on demand.
 *
 * `rows` is the flattened, ordered concatenation of every loaded page. A fetch
 * that errors (e.g. collection missing on a fresh DB) yields `rows: []` with
 * `isPending` false, so the hook itself cannot distinguish "no records" from
 * "the read failed" — that is why every `ListPage` consumer MUST spread
 * `listPageErrorProps(list)` into the page. Without it the `ListPage` empty
 * state silently stands in for a failed read (an outage that reads as "no
 * records"). The hook surfaces `isError`; the page is responsible for showing it.
 */
export function useCursorList<T>({ queryKey, fetcher, enabled = true, staleTime }: UseCursorListOptions<T>) {
	const query = useInfiniteQuery({
		queryKey,
		queryFn: ({ pageParam }) => fetcher(pageParam as string | undefined),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
		enabled,
		staleTime,
	});
	// Flattened once per fetched-pages identity — re-renders caused by page-local
	// state (toolbar search typing, filter sheets) reuse the same rows array, so
	// memoized row cards skip re-rendering.
	const rows = useMemo(() => query.data?.pages.flatMap((page) => page.rows) ?? [], [query.data?.pages]);
	return { ...query, rows };
}

/**
 * The `ListPage` error props for a `useCursorList` result — spread it so a
 * failed first page renders the shared retry block instead of the empty state:
 *
 *   const list = useCursorList({ … });
 *   <ListPage {...listPageErrorProps(list)} … />
 *
 * Extracted because "forgot to pass isError=onRetry" is invisible at the call
 * site and turns a transient outage into a lie ("no records") — one helper,
 * one place to get it right.
 */
export function listPageErrorProps(list: { isError: boolean; refetch: () => unknown }): {
	isError: boolean;
	onRetry: () => void;
} {
	return { isError: list.isError, onRetry: () => void list.refetch() };
}
