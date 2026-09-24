import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { GroupLineCard } from '../components/group-line-card';
import { MovementFeed } from '../components/movement-feed';
import { MovementModelRowCard } from '../components/movement-model-row';
import { StoreScopeFilter } from '../components/store-scope-filter';
import { fetchMovementGroupLines, fetchMovementGroupModels, fetchMovementGroupName } from '../data/api';
import { MOVEMENT_STALE_MS, qk } from '../data/query-keys';
import {
	MOVEMENT_DIRECTION_PARAM,
	MOVEMENT_DIRECTION_TABS,
	MOVEMENT_LOCATION_PARAM,
	MOVEMENT_VIEW_PARAM,
	MOVEMENT_VIEW_TABS,
	movementScopeQuery,
	movementStoreLabel,
} from '../data/meta';
import type { MovementLineRow, MovementModelRow } from '../data/types';
import { BottomActionBar } from '@/shared/components/bottom-action-bar';
import { EmptyState } from '@/shared/components/empty-state';
import { ModuleShell } from '@/shared/components/module-shell';
import { SegmentedTabs } from '@/shared/components/segmented-tabs';
import { useCursorFeed } from '@/shared/hooks/use-cursor-feed';
import { hapticImpact } from '@/shared/platform/haptics';
import { URL_PARAM, stringOrEmptyParam, useViewState } from '@/shared/url-state';

/** The group query param — Screen 2's scope, set by the Screen 1 deep link. */
const GROUP_PARAM = stringOrEmptyParam;

/** The movement screens' WHOLE URL view state, declared ONCE — the single source
 *  of truth for the direction + store scope (and Screen 2's group). Exported so
 *  Screen 3 (the model ledger) shares the SAME schema. */
export const MOVEMENT_VIEW = {
	[URL_PARAM.group]: GROUP_PARAM,
	[URL_PARAM.tab]: MOVEMENT_VIEW_PARAM,
	[URL_PARAM.direction]: MOVEMENT_DIRECTION_PARAM,
	[URL_PARAM.location]: MOVEMENT_LOCATION_PARAM,
} as const;

/** A line's list identity — the React key each line card renders under. */
function lineKey(line: MovementLineRow): string {
	return `${line.direction}:${line.line_id}`;
}

/**
 * Movement — Screen 2 (`/app/movements/models?group=<id>`): ONE item-name group's
 * movement, read TWO ways over the SAME scope (`?tab=`):
 *
 *  - **Models** (the DEFAULT) — the group's register: one row per SKU that moved,
 *    with its IN/OUT/TRF totals, its line + document counts and the day it last
 *    moved (`/api/mro/movement/models`, keyset-paginated). A tap opens that SKU's
 *    ledger (Screen 3). This is what the screen is named for and what an operator
 *    asks first — "which parts moved, how much"; the per-line history is one tap
 *    deeper.
 *  - **Transactions** — the group's CONFIRMED movement LINE feed
 *    (`/api/mro/movement/lines`): every in/out/transfer line of those models as its
 *    own card (qty pill + doc-type tag + date on top, the model over its doc no ·
 *    store line, creator + line total in the footer), for when the question is
 *    "what exactly happened".
 *
 * Both lists STREAM: page 1 on mount, later pages as the sentinel nears the
 * viewport after a real scroll; both are scoped by the SAME direction pills
 * (IN | OUT | TRF — no 'All' pill: the default feed shows every direction and a
 * re-tap of the active pill clears back to it) and the optional bottom-bar store
 * filter (အားလုံး = every store). The reading + scope live in the URL (`?tab=` /
 * `?direction=` / `?location=`), so a reload or back/forward restores exactly what
 * was on screen — and the default reading stays out of the URL. The app-bar title
 * is the GROUP'S ENGLISH NAME — a LEAN one-row `mro_item_name` lookup by id
 * (never the whole catalog walk Screen 1's directory needs).
 */
export default function MovementModelsPage() {
	const navigate = useNavigate();
	const [view, setView] = useViewState(MOVEMENT_VIEW);
	const { group, tab: listView, direction, location } = view;

	// A scope/reading switch opens a (possibly shorter) feed — never below the fold.
	useEffect(() => {
		window.scrollTo({ top: 0 });
	}, [listView, direction, location]);

	// The group's display name — a LEAN `mro_item_name` by-id lookup (the app-bar
	// title only). The whole-set directory read Screen 1 uses would re-walk the
	// entire SKU catalog (cursor pages of `/entities/mro_item_model`) on EVERY
	// mount just to resolve one name — this one-row read replaces that walk.
	const groupQuery = useQuery({
		queryKey: qk.group(group),
		queryFn: () => fetchMovementGroupName(group),
		enabled: group !== '',
		staleTime: MOVEMENT_STALE_MS,
	});
	const groupName = groupQuery.data?.nameEn ?? null;

	// The group's MODEL rows — the DEFAULT register: one SKU per row with its
	// totals. Fetched only while that reading is on screen; the scope is in the
	// key, so flipping a tab/store reuses that scope's cached pages.
	const modelsFeed = useCursorFeed({
		queryKey: qk.groupModels(group, direction, location),
		fetcher: (cursor) => fetchMovementGroupModels({ group, direction, location, cursor }),
		enabled: group !== '' && listView === 'models',
		staleTime: MOVEMENT_STALE_MS,
	});

	// The group's CONFIRMED line feed (the Transactions reading) — same wiring, its
	// own cache entry per scope. Page 1 on mount, later pages stream via the
	// sentinel; a scope change can never leak another scope's pages (the key changed).
	const linesFeed = useCursorFeed({
		queryKey: qk.groupLines(group, direction, location),
		fetcher: (cursor) => fetchMovementGroupLines({ group, direction, location, cursor }),
		enabled: group !== '' && listView === 'lines',
		staleTime: MOVEMENT_STALE_MS,
	});

	/** The failure to show — the server's own message when it has one. */
	const errorOf = (feed: { error: Error | null }, fallback: string) =>
		feed.error && feed.error.message.trim() ? feed.error.message : fallback;

	// Tap a model row / a line → that model's line ledger (Screen 3), carrying the
	// scope over so the ledger opens on exactly what was being looked at.
	const openModel = (modelId: string) => {
		hapticImpact('light');
		navigate(`/app/movements/ledger/${encodeURIComponent(modelId)}${movementScopeQuery(direction, location)}`);
	};

	return (
		<ModuleShell title={groupName ?? 'Item Groups'}>
			<div className="flex flex-1 flex-col gap-3">
				{/* The READING — the group's SKUs (Models, the default) or its lines
					(Transactions). Two readings of one scope, so the choice is URL view
					state rather than a second screen. */}
				<SegmentedTabs
					options={MOVEMENT_VIEW_TABS}
					value={listView}
					onChange={(next) => setView({ tab: next })}
					ariaLabel="Movement list"
				/>

				{/* The direction scope — IN | OUT | TRF filter chips (no All pill: the
					default feed shows every direction; a re-tap of the active chip clears
					back to it). Switching refetches the server-narrowed feed. */}
				<SegmentedTabs
					options={MOVEMENT_DIRECTION_TABS}
					value={direction}
					onChange={(next) => setView({ direction: next })}
					ariaLabel="Movement direction"
					deselectValue="all"
				/>

				{group === '' ? (
					<EmptyState title="No item group selected" hint="Open this screen from an item group on the Movements home." fill />
				) : listView === 'models' ? (
					<MovementFeed<MovementModelRow>
						rows={modelsFeed.rows}
						isPending={modelsFeed.isPending}
						loadFailed={modelsFeed.loadFailed}
						moreFailed={modelsFeed.moreFailed}
						hasNextPage={modelsFeed.hasNextPage}
						isFetchingNextPage={modelsFeed.isFetchingNextPage}
						errorMessage={errorOf(modelsFeed, 'Could not load the models — try again.')}
						onRetry={() => void modelsFeed.refetch()}
						onLoadMore={() => void modelsFeed.fetchNextPage()}
						renderRow={(row) => <MovementModelRowCard key={row.model} row={row} onOpen={() => openModel(row.model)} />}
						emptyTitle="No models moved here"
						emptyHint="Try another direction tab or store filter — only SKUs with confirmed IN / OUT / TRF lines appear."
						loadingLabel="Loading models…"
					/>
				) : (
					<MovementFeed<MovementLineRow>
						rows={linesFeed.rows}
						isPending={linesFeed.isPending}
						loadFailed={linesFeed.loadFailed}
						moreFailed={linesFeed.moreFailed}
						hasNextPage={linesFeed.hasNextPage}
						isFetchingNextPage={linesFeed.isFetchingNextPage}
						errorMessage={errorOf(linesFeed, 'Could not load the movement lines — try again.')}
						onRetry={() => void linesFeed.refetch()}
						onLoadMore={() => void linesFeed.fetchNextPage()}
						renderRow={(line) => (
							<GroupLineCard key={lineKey(line)} line={line} onOpen={line.model ? () => openModel(line.model!) : undefined} />
						)}
						emptyTitle="No movements here"
						emptyHint="Try another direction tab or store filter — only confirmed IN / OUT / TRF lines appear."
						loadingLabel="Loading lines…"
					/>
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
