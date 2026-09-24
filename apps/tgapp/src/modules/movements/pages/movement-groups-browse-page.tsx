import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';

import { MovementGroupRow } from '../components/movement-group-row';
import { fetchMovementGroups } from '../data/api';
import { MOVEMENT_STALE_MS, qk } from '../data/query-keys';
import { EmptyState } from '@/shared/components/empty-state';
import { LoadMoreSentinel } from '@/shared/components/load-more-sentinel';
import { ModuleShell } from '@/shared/components/module-shell';
import { ListSkeleton } from '@/shared/components/skeletons';
import { hapticImpact } from '@/shared/platform/haptics';

/** ပစ္စည်းလှုပ်ရှားမှု — the module's Burmese screen name (launcher label). */
const MOVEMENT_TITLE = 'Movements';

/**
 * Movement — Browse all (`/app/movements/browse`): the MOVING item-groups
 * directory.
 *
 * This is the former Screen 1 register, now one tap off the kiosk landing
 * (`/app/movements`) via its idle "Browse all item groups" link. It is a real
 * route with its own back arrow, so browsing the full directory and returning
 * never loses the kiosk's query.
 *
 * The rows are the item-name masters that actually have CONFIRMED movement,
 * served by `/api/mro/movement/groups` — a SERVER-SCOPED, name-sorted,
 * keyset-paginated read (never the whole-catalog walk the mro-categories hub
 * needs). The TanStack infinite query caches the directory for a freshness
 * window (`MOVEMENT_STALE_MS`) and pages on scroll via the sentinel, so a back
 * navigation or launcher revisit costs zero API calls while still picking up a
 * newly confirmed group on the next stale read.
 *
 * The rows are stripped to the group itself: English + Myanmar display-name
 * lines and the right chevron — no count pill, no member aggregates. Tapping a
 * group opens its movement feed (Screen 2).
 */
export default function MovementGroupsBrowsePage() {
	const navigate = useNavigate();

	// The moving-groups directory — infinite (keyset) + cached, deduped by the
	// query client. Page 1 loads on mount; later pages stream via the sentinel.
	const groupsQuery = useInfiniteQuery({
		queryKey: qk.groups(),
		queryFn: ({ pageParam }) => fetchMovementGroups({ cursor: pageParam ?? null }),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (last) => last.nextCursor ?? undefined,
		staleTime: MOVEMENT_STALE_MS,
	});

	const groups = groupsQuery.data?.pages.flatMap((page) => page.rows) ?? [];

	const openGroup = (id: string) => {
		hapticImpact('light');
		navigate(`/app/movements/models?group=${encodeURIComponent(id)}`);
	};

	return (
		<ModuleShell title={MOVEMENT_TITLE}>
			<div className="flex flex-1 flex-col gap-3">
				{groupsQuery.isPending ? (
					<ListSkeleton variant="category" count={3} />
				) : groupsQuery.isError ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center">
						<p className="text-xs font-medium leading-myanmar text-status-danger">Couldn't load the item groups</p>
						<button
							type="button"
							onClick={() => void groupsQuery.refetch()}
							className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
						>
							<RefreshCw className="size-3.5" strokeWidth={2.2} aria-hidden />
							Try again
						</button>
					</div>
				) : groups.length === 0 ? (
					<EmptyState
						title="No item groups yet"
						hint="Groups appear here once a confirmed IN / OUT / TRF document moves one of their parts."
					/>
				) : (
					<ul className="flex flex-col gap-3">
						{groups.map((group) => (
							<MovementGroupRow key={group.id} group={group} onOpen={() => openGroup(group.id)} />
						))}
					</ul>
				)}

				{/* Next page — streams in as the sentinel nears the viewport (only after
					a real scroll, so a short directory never auto-drains extra pages). */}
				{groupsQuery.hasNextPage && (
					<LoadMoreSentinel
						hasMore={groupsQuery.hasNextPage}
						loading={groupsQuery.isFetchingNextPage}
						onLoadMore={() => void groupsQuery.fetchNextPage()}
						loadingLabel="Loading groups…"
						waitForScroll
					/>
				)}
			</div>
		</ModuleShell>
	);
}
