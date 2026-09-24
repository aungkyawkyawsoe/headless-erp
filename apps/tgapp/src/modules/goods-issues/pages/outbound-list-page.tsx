import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';

import { OutboundDocCard } from '../components/outbound-doc-card';
import { fetchOutboundPage, fetchOutboundSearch } from '../data/api';
import { qk, OUTBOUND_STALE_MS } from '../data/query-keys';
import { OUTBOUND_TYPE_META } from '../data/meta';
import type { MroOutboundType, OutboundCardModel } from '../data/types';
import { MRO_LOCATIONS, MRO_LOCATION_LABELS } from '@/shared/mro';
import type { MroLocation } from '@/shared/mro';
import { ListPage } from '@/shared/components/list-page';
import { useCursorList } from '@/shared/hooks/use-cursor-list';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';

// URL-driven store filter — `?location=` survives reloads and back/forward
// round-trips; nuqs `replace` (default) keeps taps out of history. There is NO
// "အားလုံး" option — the funnel is a store picker and the shown docs are
// always scoped to ONE store (the outbound doc's issuing `location` column),
// defaulting to the main store.
const OUTBOUND_LOCATION_FILTER = enumParam<MroLocation>(
	MRO_LOCATIONS.map((location) => location.value),
	'main_store',
);

/** The list pane's WHOLE URL view state — the store filter. */
const OUTBOUND_LIST_VIEW = {
	[URL_PARAM.location]: OUTBOUND_LOCATION_FILTER,
} as const;

/**
 * The canonical outbound list page — ONE parameterized list for the three
 * outbound kinds (Issue / Write-off / Dispose) of ONE store. Each screen is
 * the SAME `mro_outbounds` document flow (draft → အတည်ပြုမည် → confirmed); the
 * pages differ in `type` and the scoped `location` (both server-side filters,
 * default main store).
 *
 * Cursor-paginated at `LIST_PAGE_SIZE` docs (newest first) — page 1 renders
 * immediately, further pages stream in as the list approaches the bottom via
 * `LoadMoreSentinel`. Cards need no joins (they render header fields only), so
 * there is no master lookup to wait for. Tapping a card opens its FULL-SCREEN
 * doc detail page (`/app/outbounds/:id` — the former items bottom sheet is a
 * real route with a back arrow now). DRAFT rows carry the အတည်ပြုမည် confirm
 * action on the card itself (`/api/mro/outbounds/:id/confirm`); the bottom bar
 * holds the STORE location filter (ပင်မစတိုး …), a server-side 🔍 search and the
 * create (+) button for this type + store.
 */
export function OutboundListPage({
	type,
	title,
	subheader,
}: {
	type: MroOutboundType;
	title: string;
	/** Optional type-tab row rendered above the list (the hub's scope switch). */
	subheader?: ReactNode;
}) {
	const navigate = useNavigate();
	const meta = OUTBOUND_TYPE_META[type];
	const [view, setView] = useViewState(OUTBOUND_LIST_VIEW);
	const { location } = view;
	const list = useCursorList({
		queryKey: qk.outbounds(type, location),
		fetcher: (cursor) => fetchOutboundPage(type, location, cursor),
		staleTime: OUTBOUND_STALE_MS,
	});

	// Tap a card → its FULL-SCREEN detail page (the former items bottom sheet).
	// `?type=` keeps the app-bar back fallback on the tab the doc was opened from.
	const renderOutbound = useCallback(
		(doc: OutboundCardModel) => (
			<OutboundDocCard key={doc.id} doc={doc} onOpen={(d) => navigate(`/app/outbounds/${d.id}?${URL_PARAM.type}=${d.type}`)} />
		),
		[navigate],
	);

	return (
		<ListPage
			title={title}
			subheader={subheader}
			rows={list.rows}
			isPending={list.isPending}
			isError={list.isError}
			onRetry={() => void list.refetch()}
			skeletonVariant="store-request"
			renderItem={renderOutbound}
			emptyState={{
				title: 'No outbound records yet',
				hint: 'Goods issues you create appear here.',
			}}
			pagination={{
				hasNextPage: list.hasNextPage,
				isFetchingNextPage: list.isFetchingNextPage,
				onLoadMore: () => void list.fetchNextPage(),
				// Page 2 only after a real scroll — a short first page must not auto-fetch.
				waitForScroll: true,
			}}
			searchPlaceholder="Search number / note"
			fetchSearch={(query) => fetchOutboundSearch(type, location, query)}
			filter={{
				value: location,
				onChange: (value) => setView({ location: value }),
				options: MRO_LOCATIONS,
				centerLabel: MRO_LOCATION_LABELS[location],
				sheetTitle: 'Select store',
				matches: (doc, loc) => doc.location === loc,
				emptyTitle: 'No outbound records in the selected store',
			}}
			create={{ to: meta.createRoute, label: `New ${meta.tagLabel}` }}
			density="compact"
		/>
	);
}
