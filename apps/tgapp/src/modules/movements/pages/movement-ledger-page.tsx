import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import { MovementLineCard } from '../components/movement-line-card';
import { MovementSummaryCard } from '../components/movement-summary-card';
import { StoreScopeFilter } from '../components/store-scope-filter';
import { fetchMovementLedger, fetchMovementModel } from '../data/api';
import { MOVEMENT_STALE_MS, qk } from '../data/query-keys';
import { MOVEMENT_DIRECTION_TABS, movementStoreLabel } from '../data/meta';
import type { MovementLineRow } from '../data/types';
import { BottomActionBar } from '@/shared/components/bottom-action-bar';
import { EmptyState } from '@/shared/components/empty-state';
import { LoadMoreSentinel } from '@/shared/components/load-more-sentinel';
import { ModuleShell } from '@/shared/components/module-shell';
import { SegmentedTabs } from '@/shared/components/segmented-tabs';
import { ListSkeleton } from '@/shared/components/skeletons';
import { useCursorFeed } from '@/shared/hooks/use-cursor-feed';
import { hapticSelection } from '@/shared/platform/haptics';
import { URL_PARAM, useViewState } from '@/shared/url-state';
import { MOVEMENT_VIEW } from './movement-models-page';

/** A line's list identity — the React key each line card renders under. */
function lineKey(line: MovementLineRow): string {
	return `${line.direction}:${line.line_id}`;
}

/**
 * Where a confirmed movement line's SOURCE document lives in the app — the tap
 * target that turns a ledger row from a dead end into the doc that produced it.
 *
 *  - inbound  → its full-screen detail (`/app/inbounds/:id?type=`);
 *  - outbound → its full-screen detail (`/app/outbounds/:id?type=`);
 *  - transfer → its full-screen detail (`/app/stock-moves/:id`);
 *  - adjustment → its full-screen detail (`/app/adjustments/:id`).
 *
 * `null` when the row carries no doc id (a hard-deleted document).
 */
function docRouteFor(line: MovementLineRow): string | null {
	if (!line.doc_id) return null;
	if (line.kind === 'adjustment') return `/app/adjustments/${line.doc_id}`;
	if (line.direction === 'trf' || line.kind === 'transfer') return `/app/stock-moves/${line.doc_id}`;
	if (line.direction === 'in') return `/app/inbounds/${line.doc_id}?${URL_PARAM.type}=${line.kind ?? 'purchase'}`;
	if (line.direction === 'out') return `/app/outbounds/${line.doc_id}?${URL_PARAM.type}=${line.kind ?? 'goods_issue'}`;
	return null;
}

/**
 * Movement — Screen 3 (`/app/movements/ledger/:modelId`): ONE model's line-level
 * ledger of CONFIRMED IN / OUT / TRF movements, served by
 * `/api/mro/movement/ledger` (newest first, keyset-paginated at 50/page).
 *
 * The header summary card carries the model's scope totals + on-hand; below it
 * the line cards stream in via `LoadMoreSentinel` against the response's opaque
 * `nextCursor`. The direction tabs + the optional store filter (အားလုံး =
 * every store) narrow BOTH the rows and the summary server-side; every scope
 * change opens that scope's own cache entry (the shared `useCursorFeed` key
 * holds direction + store), so flipping back to a previously viewed scope is
 * instant and never re-issues the page-1 request. The scope lives in the URL
 * (`?direction=` / `?location=`, carried from Screen 2's link), so back
 * navigation returns to the exact models list it came from.
 */
export default function MovementLedgerPage() {
	const { modelId } = useParams<{ modelId: string }>();
	const navigate = useNavigate();
	const model = modelId?.trim() ?? '';
	const [view, setView] = useViewState(MOVEMENT_VIEW);
	const { direction, location } = view;

	// A scope switch opens a (possibly shorter) list — never below the fold.
	useEffect(() => {
		window.scrollTo({ top: 0 });
	}, [direction, location]);

	// The header's display name — a lean `mro_item_model` read (Screen 3 carries
	// the model id alone). The master row may be gone (deleted SKU with lines):
	// fall back to the first loaded line's own model_name before giving up.
	const modelQuery = useQuery({
		queryKey: qk.model(model),
		queryFn: () => fetchMovementModel(model),
		enabled: model !== '',
		staleTime: MOVEMENT_STALE_MS,
	});

	// The model's line ledger — page 1 (rows + the scope summary) on mount,
	// later pages stream via the sentinel. The shared feed hook keeps every
	// loaded page under ONE keyed cache entry, so the header summary (which the
	// server computes over the whole scope) rides page 1 (`firstPage`) and
	// stays consistent with the rows below it.
	const feed = useCursorFeed({
		queryKey: qk.ledger(model, direction, location),
		fetcher: (cursor) => fetchMovementLedger({ model, direction, location, cursor }),
		enabled: model !== '',
		staleTime: MOVEMENT_STALE_MS,
	});
	const feedError = feed.error && feed.error.message.trim() ? feed.error.message : 'Could not load the ledger — try again.';

	const modelName = modelQuery.data?.name ?? feed.rows[0]?.model_name ?? null;

	return (
		<ModuleShell title={modelName ?? 'Item movements'}>
			<div className="flex flex-1 flex-col gap-3">
				{/* The direction scope — IN | OUT | TRF chips (same as Screen 2). */}
				<SegmentedTabs
					options={MOVEMENT_DIRECTION_TABS}
					value={direction}
					onChange={(next) => setView({ direction: next })}
					ariaLabel="Movement direction"
					deselectValue="all"
				/>

				{model === '' ? (
					<EmptyState title="No item selected" hint="Open this screen from a moving item on the Movements list." fill />
				) : feed.isPending ? (
					<ListSkeleton variant="store-request" count={4} />
				) : feed.loadFailed ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center">
						<p className="text-xs font-medium leading-myanmar text-status-danger">{feedError}</p>
						<button
							type="button"
							onClick={() => void feed.refetch()}
							className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
						>
							<RefreshCw className="size-3.5" strokeWidth={2.2} aria-hidden />
							Try again
						</button>
					</div>
				) : feed.firstPage === undefined ? null : (
					<>
						{/* The model's scope summary — totals + on-hand over the ACTIVE
							scope (the server computes it on every page-1 response). */}
						<MovementSummaryCard name={modelName} summary={feed.firstPage.summary} />

						{feed.rows.length === 0 ? (
							<EmptyState
								title="No movements here"
								hint="Try another direction tab or store filter — only confirmed IN / OUT / TRF lines appear."
								fill
							/>
						) : (
							<ul className="flex flex-col gap-2.5">
								{feed.rows.map((line) => (
									<MovementLineCard
										key={lineKey(line)}
										line={line}
										onOpen={
											docRouteFor(line)
												? () => {
														hapticSelection();
														navigate(docRouteFor(line) as string);
													}
												: undefined
										}
									/>
								))}
							</ul>
						)}

						{/* Next page — streams in as the sentinel nears the viewport. On a
							page failure the sentinel steps aside for the inline retry (which
							re-fires the SAME failed page — the cache keeps its cursor). */}
						{feed.moreFailed ? (
							<div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-3">
								<p className="text-meta font-medium leading-myanmar text-muted-foreground">Couldn't load more lines.</p>
								<button
									type="button"
									onClick={() => void feed.fetchNextPage()}
									className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-meta font-semibold leading-myanmar text-primary-foreground"
								>
									Try again
								</button>
							</div>
						) : (
							<LoadMoreSentinel
								hasMore={feed.hasNextPage}
								loading={feed.isFetchingNextPage}
								onLoadMore={() => void feed.fetchNextPage()}
								loadingLabel="Loading lines…"
								waitForScroll
							/>
						)}
					</>
				)}

				{/* Room for the fixed bottom bar when the list is fully scrolled. */}
				<div className="h-24" aria-hidden />
			</div>

			{/* The optional store filter — အားလုံး (empty = every store) by default. */}
			<BottomActionBar
				left={<StoreScopeFilter value={location} onChange={(next) => setView({ location: next })} sheetTitle="Select store" />}
				center={movementStoreLabel(location)}
			/>
		</ModuleShell>
	);
}
