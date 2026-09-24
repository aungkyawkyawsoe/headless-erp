import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

import { EmptyState } from '@/shared/components/empty-state';
import { LoadMoreSentinel } from '@/shared/components/load-more-sentinel';
import { ListSkeleton } from '@/shared/components/skeletons';

interface MovementFeedProps<T> {
	rows: T[];
	/** Page 1 is still loading — the skeleton stands in for the list. */
	isPending: boolean;
	/** Page 1 failed with nothing on screen — the retry block. */
	loadFailed: boolean;
	/** A LATER page failed with rows already showing — the inline retry. */
	moreFailed: boolean;
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
	/** The failure to show (the server's own message when it has one). */
	errorMessage: string;
	onRetry: () => void;
	onLoadMore: () => void;
	/** The list's row key — the caller knows the row's identity. */
	renderRow: (row: T) => ReactNode;
	emptyTitle: string;
	emptyHint: string;
	/** The hint under the list while the next page streams. */
	loadingLabel: string;
}

/**
 * ONE cursor-paginated list's five states for Screen 2 — loading, first-page
 * failure, empty, rows, and the next-page sentinel (with its own inline retry).
 * Both readings of the group screen (the SKU register and the transaction feed)
 * render through this, so a fix to paging/retry/empty copy lands on both at once
 * instead of leaving one view behind — which is exactly how the two drifted when
 * the markup was copied per view.
 *
 * The sentinel is `waitForScroll`: a short first page renders and the next page
 * is fetched when the operator actually scrolls, never during the first paint.
 */
export function MovementFeed<T>({
	rows,
	isPending,
	loadFailed,
	moreFailed,
	hasNextPage,
	isFetchingNextPage,
	errorMessage,
	onRetry,
	onLoadMore,
	renderRow,
	emptyTitle,
	emptyHint,
	loadingLabel,
}: MovementFeedProps<T>) {
	if (isPending) return <ListSkeleton variant="store-request" count={4} />;

	if (loadFailed) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center">
				<p className="text-xs font-medium leading-myanmar text-status-danger">{errorMessage}</p>
				<button
					type="button"
					onClick={onRetry}
					className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
				>
					<RefreshCw className="size-3.5" strokeWidth={2.2} aria-hidden />
					Try again
				</button>
			</div>
		);
	}

	if (rows.length === 0) return <EmptyState title={emptyTitle} hint={emptyHint} fill />;

	return (
		<>
			{/* Each row component renders its own <li> with its own key — the feed
			    only supplies the frame and the states. */}
			<ul className="flex flex-col gap-2.5">{rows.map((row) => renderRow(row))}</ul>

			{moreFailed ? (
				<div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-3">
					<p className="text-meta font-medium leading-myanmar text-muted-foreground">Couldn't load more.</p>
					<button
						type="button"
						onClick={onLoadMore}
						className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-meta font-semibold leading-myanmar text-primary-foreground"
					>
						Try again
					</button>
				</div>
			) : (
				<LoadMoreSentinel
					hasMore={hasNextPage}
					loading={isFetchingNextPage}
					onLoadMore={onLoadMore}
					loadingLabel={loadingLabel}
					waitForScroll
				/>
			)}
		</>
	);
}
