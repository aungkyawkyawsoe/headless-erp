import { useEffect, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { BottomActionBar, GLASS_PRIMARY_BUTTON } from './bottom-action-bar';
import { EmptyState, FilteredEmptyState } from './empty-state';
import { LoadMoreSentinel } from './load-more-sentinel';
import { ModuleShell } from './module-shell';
import { PageError } from './page-error';
import { SearchResultsList } from './search-results-list';
import { SingleSelectSheetFilter } from './sheet-filter';
import { ListSkeleton, type ListSkeletonVariant } from './skeletons';
import { useBarSearch } from '@/shared/hooks/use-bar-search';

/** Rows rendered before the list asks for an explicit reveal — see the bounded
 *  DOM note in `ListPage`. Big enough that a normal register never sees the
 *  control; small enough that the card subtrees stay flat. */
const RENDER_CHUNK = 300;

/** The infinite-scroll wiring — `useCursorList`'s paging surface. */
export interface ListPagePagination {
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
	onLoadMore: () => void;
	/**
	 * Only page after the user has actually scrolled. Without this, a list whose
	 * first page doesn't fill the viewport auto-fetches the next page during the
	 * initial paint (a premature cursor request on cold load). Legacy behavior
	 * (default) preloads; enable for lists that should page only on real scroll.
	 */
	waitForScroll?: boolean;
}

/**
 * The single-select filter's config. `value`/`onChange` come from the page's
 * own `useViewState` container (the param name and parser are module-specific —
 * `?status=`, `?type=`, `?category=`…), so this stays a pure props object.
 */
export interface ListPageFilter<T, F extends string> {
	value: F;
	onChange: (value: F) => void;
	/** All selectable values, the leading `'all'` (အားလုံး) entry included. */
	options: ReadonlyArray<{ value: F; label: string }>;
	/** The bar pill's center label for the current value (e.g. `labels[value]`). */
	centerLabel: string;
	/** The bottom sheet's title. */
	sheetTitle: string;
	/** The funnel trigger's accessible label (defaults to "စစ်ထုတ်ရန်"). */
	buttonLabel?: string;
	/**
	 * Row test for a non-`'all'` value — the shell short-circuits `'all'`.
	 * OPTIONAL: a SERVER-scoped filter (the page passes `value` into its own
	 * fetcher — `?status=`/`?location=`/… ) omits it, and the shell then treats
	 * the already-narrowed `rows` as the result instead of filtering again.
	 */
	matches?: (row: T, value: F) => boolean;
	/** The filtered-empty title — shown with the "clear filters" action. */
	emptyTitle: string;
}

/** State handed to a custom list-body renderer — the same empty/clear facts the
 *  default flat list uses, so grouped bodies never re-derive them. */
export interface ListPageBodyHelpers {
	/** The collection has NO rows at all — render the module's `EmptyState`. */
	isEmpty: boolean;
	/** The active bottom-bar filter yielded nothing to show — for a client-side
	 *  filter, rows exist but none match; for a server-scoped filter, the scoped
	 *  read itself returned no rows. Either way the module's `EmptyState` would be
	 *  wrong and the filter's `emptyTitle` should be used instead. */
	isFilteredEmpty: boolean;
	/** The first page FAILED to load (and there is nothing cached to show) — the
	 *  body should render the retry block, never a misleading empty state. */
	isError: boolean;
	/** Retry the failed read (the page's refetch). */
	onRetry: () => void;
	/** Clears the active filter AND the toolbar search (the shared clear). */
	clearFilters: () => void;
}

interface ListPageProps<T extends { id: string }, F extends string> {
	/** The app-bar title (e.g. "ယာဉ်"). */
	title: string;
	/**
	 * The page's loaded rows — ordered/deduped/sorted by the page (e.g.
	 * `sortTyresForList(list.rows)`). Filtering (and only filtering) lives here.
	 */
	rows: T[];
	/** Skeleton while the first rows load (`useCursorList.isPending`). */
	isPending?: boolean;
	/** The first page FAILED to load — render a retry block instead of the empty
	 *  state (a failed read must never masquerade as "no records"). Requires
	 *  `onRetry`. */
	isError?: boolean;
	/** Retries the failed first page (typically `list.refetch`). */
	onRetry?: () => void;
	/** Which real card the skeleton mirrors. */
	skeletonVariant: ListSkeletonVariant;
	/**
	 * One card per row — must carry its own `key` (the same contract as
	 * `SearchResultsList`). Rendered in both the list and the search results,
	 * so results always match the list.
	 */
	renderItem: (row: T) => ReactNode;
	/** The "no rows at all" copy. */
	emptyState: { title: string; hint: string };
	/** Cursor-paging — absent renders no sentinel (one-shot lists). */
	pagination?: ListPagePagination;
	/** The bar search's placeholder text. */
	searchPlaceholder: string;
	/** The server-side search — results render the same card as the list. */
	fetchSearch: (query: string) => Promise<T[]>;
	/** State the search's COVERAGE when it is not the whole collection — e.g. a
	 *  per-truck file whose search only narrows the loaded rows. Shown under the
	 *  result count so a local narrow never masquerades as a global search. */
	searchScopeNote?: string;
	/** The status/fuel/category… filter — absent renders a filter-free bar. */
	filter?: ListPageFilter<T, F>;
	/**
	 * Row presentation. `comfortable` (default) = one floating card per record
	 * with an inter-row gap (the app's long-standing mobile vocabulary).
	 * `compact` = the dense ERP grid: flat rows in ONE bordered card with
	 * hairline dividers, no gap, no per-row shadow — ~2–3× the records per
	 * screen. The rows themselves are `ErpRow`s (the module's `renderItem`).
	 */
	density?: 'comfortable' | 'compact';
	/** The bar pill's center label when the page has no filter. */
	centerText?: string;
	/** Where the back affordance leads — the dashboard by default. */
	backTo?: string;
	/** Optional content rendered above the list (e.g. a type-tab row) — stays
	 *  visible while a toolbar search is open so the scope switch never hides. */
	subheader?: ReactNode;
	/** The create (+) destination — absent hides the button. */
	create?: { to: string; label: string };
	/** Extra right-slot controls (e.g. the directory's manual ↻ refresh). */
	rightExtra?: ReactNode;
	/** Optional content rendered INSTEAD of the list (e.g. a tab's alternate view).
	 *  The subheader + bottom bar stay. */
	children?: ReactNode;
	/**
	 * Optional alternate rendering of the LOADED rows (e.g. grouped by truck)
	 * instead of the flat card list. Receives the filter-narrowed rows and the
	 * empty/filtered-empty/clear helpers so grouped views filter lines exactly
	 * like the flat list does — and must render its own `EmptyState` /
	 * `FilteredEmptyState` from those helpers. A toolbar SEARCH always takes over
	 * with the flat `renderItem` matches (results keep their identity chips).
	 */
	renderListBody?: (rows: T[], helpers: ListPageBodyHelpers) => ReactNode;
}

/**
 * The standard list page — the ONE layout every module list shares: a
 * `ModuleShell` with the toolbar search (🔍 toggle morphing the bar into an
 * isolated field), the page's card list with the empty / filtered-empty
 * states, the cursor-paginated `LoadMoreSentinel`, and the fixed bottom
 * action bar (filter trigger on the left, active-filter label in the pill,
 * search toggle + create on the right).
 *
 * The page supplies only its data wiring and module-specific copy:
 * `rows` (+ `isPending`/`pagination` from `useCursorList`), the card
 * renderer, the search fetcher, and — when the list filters — the filter's
 * options/labels/matcher. Every list page used to re-implement this whole
 * scaffold (~70% boilerplate); this component is the single source of it.
 */
export function ListPage<T extends { id: string }, F extends string = string>({
	title,
	rows,
	isPending = false,
	isError = false,
	onRetry,
	skeletonVariant,
	renderItem,
	emptyState,
	pagination,
	searchPlaceholder,
	fetchSearch,
	searchScopeNote,
	filter,
	density = 'comfortable',
	centerText,
	subheader,
	create,
	rightExtra,
	children,
	renderListBody,
	backTo,
}: ListPageProps<T, F>) {
	const navigate = useNavigate();
	const search = useBarSearch<T>(searchPlaceholder, fetchSearch);
	const compact = density === 'compact';

	// The filter comes in two shapes:
	//   • CLIENT-side — a `matches` predicate narrows the loaded rows (instant,
	//     no extra requests; further pages stream in via the sentinel);
	//   • SERVER-side — no predicate; the page already scoped its query by `value`
	//     (its key + fetcher carry it), so `rows` IS the result.
	// `'all'` short-circuits either way: every row passes and no matcher runs. A
	// server-scoped list that returns no rows is a FILTERED empty (the module's
	// "no records yet" copy would be a lie), so its empty copy comes from the
	// filter instead.
	const hasActiveFilter = filter != null && filter.value !== 'all';
	const matches = filter?.matches;
	const visible = hasActiveFilter && matches ? rows.filter((row) => matches(row, filter.value)) : rows;
	const isFilteredEmpty = hasActiveFilter && (matches ? visible.length === 0 && rows.length > 0 : rows.length === 0);

	// ── Bounded DOM ─────────────────────────────────────────────────────────────
	// The list renders at most `renderCap` rows; the rest are revealed on demand
	// (and the sentinel PAUSES while capped, so we never hold data we will not
	// render). This is what keeps layout and memory flat as a register grows —
	// scrolling a 500-row list used to build 500 card subtrees. A windowed
	// (virtual) list would need the row renderer to stop owning its own `<li>`;
	// the cap reaches the same O(rendered) property without changing that
	// contract, and every row stays in the accessibility tree once revealed.
	const [renderCap, setRenderCap] = useState(RENDER_CHUNK);
	// A new scope (filter tab / search) starts from a fully-visible first chunk.
	useEffect(() => {
		setRenderCap(RENDER_CHUNK);
	}, [filter?.value, search.query]);
	const capped = visible.length > renderCap;
	const renderedRows = capped ? visible.slice(0, renderCap) : visible;

	// The filtered-empty "clear" resets BOTH the filter and the toolbar search.
	const clearFilters = () => {
		filter?.onChange('all' as F);
		search.clear();
	};

	return (
		<ModuleShell title={title} backTo={backTo}>
			{subheader ? <div className="mb-3">{subheader}</div> : null}
			{search.open && search.query && !children ? (
				<SearchResultsList
					query={search.query}
					searching={search.searching}
					results={search.results}
					error={search.error}
					onClear={search.clear}
					renderItem={renderItem}
					compact={compact}
					scopeNote={searchScopeNote}
				/>
			) : children ? (
				children
			) : (
				<>
					{isPending ? (
						<ListSkeleton variant={compact ? 'dense' : skeletonVariant} />
					) : isError && rows.length === 0 ? (
						/* A FAILED first page never renders as an empty list — the read must be
						   retryable, otherwise a transient outage looks like "no records".
						   Stretched to the pane like the other empty states. */
						<PageError onRetry={onRetry} fill />
					) : renderListBody ? (
						renderListBody(visible, {
							isEmpty: rows.length === 0,
							isFilteredEmpty,
							isError,
							onRetry: onRetry ?? (() => {}),
							clearFilters,
						})
					) : (
						// The dashed card STRETCHES to the pane's full height (see `fill`):
						// an empty list is not a small card floating over a blank half-page —
						// it owns the screen, so the create action sits in the visual centre.
						<ul
							className={`${compact ? 'list-window-compact' : 'list-window'} flex cursor-pointer flex-col ${
								compact ? 'divide-y divide-border overflow-hidden rounded-xl border border-border bg-card' : 'gap-3'
							} ${visible.length === 0 ? 'min-h-0 flex-1' : ''}`}
						>
							{renderedRows.map((row) => renderItem(row))}
							{capped && (
								// BOUNDED DOM: past the cap the list stops appending nodes and
								// asks for an explicit reveal. Scrolling a 500-row register used
								// to build 500 card subtrees (layout + memory grow with N);
								// now the DOM is bounded and each reveal is a deliberate chunk.
								<li className="flex justify-center py-3">
									<button
										type="button"
										onClick={() => setRenderCap((cap) => cap + RENDER_CHUNK)}
										className="rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold leading-myanmar text-foreground shadow-sm transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										Show {Math.min(RENDER_CHUNK, visible.length - renderCap)} more ({visible.length - renderedRows.length} left)
									</button>
								</li>
							)}
							{rows.length === 0 && !isFilteredEmpty && (
								<EmptyState
									{...emptyState}
									fill
									action={
										create ? (
											// Clickable TEXT, not a filled pill: in an otherwise empty
											// surface a solid button competes with the copy and reads
											// as the "next screen" — the create action here is a quiet
											// aside, so a primary-tinted link is enough. The 44px hit
											// area comes from padding, so the target stays tappable.
											<button
												type="button"
												onClick={() => navigate(create.to)}
												className="-my-1.5 inline-flex min-h-11 items-center px-2 text-sm font-semibold leading-myanmar text-primary underline decoration-primary/40 underline-offset-4 transition-colors hover:decoration-primary focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring"
											>
												{create.label}
											</button>
										) : undefined
									}
								/>
							)}
							{isFilteredEmpty && filter && <FilteredEmptyState title={filter.emptyTitle} onClear={clearFilters} fill />}
						</ul>
					)}

					{/* Next page — streams in as the sentinel nears the viewport (throttled).
					    Paused while the DOM is CAPPED: loading rows we will not render would
					    only grow memory. A reveal re-mounts it and paging resumes. */}
					{pagination && !capped && (
						<LoadMoreSentinel
							hasMore={pagination.hasNextPage}
							loading={pagination.isFetchingNextPage}
							onLoadMore={pagination.onLoadMore}
							waitForScroll={pagination.waitForScroll}
						/>
					)}
				</>
			)}

			{/* Room for the fixed bottom bar when the list is fully scrolled. */}
			<div className="h-24" aria-hidden />

			<BottomActionBar
				left={
					filter ? (
						<SingleSelectSheetFilter
							options={filter.options}
							value={filter.value}
							onChange={filter.onChange}
							sheetTitle={filter.sheetTitle}
							buttonLabel={filter.buttonLabel}
						/>
					) : (
						search.button
					)
				}
				center={filter ? filter.centerLabel : centerText}
				panel={search.panel}
				panelOpen={search.open}
				right={
					<div className="flex items-center gap-1.5">
						{/* Filter pages move the search toggle next to the create button. */}
						{filter ? search.button : null}
						{create && (
							<button type="button" onClick={() => navigate(create.to)} aria-label={create.label} className={GLASS_PRIMARY_BUTTON}>
								<Plus className="size-5" aria-hidden />
							</button>
						)}
						{rightExtra}
					</div>
				}
			/>
		</ModuleShell>
	);
}
