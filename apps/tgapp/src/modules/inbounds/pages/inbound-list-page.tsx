import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';

import { InboundDocCard } from '../components/inbound-doc-card';
import { fetchInboundPage, fetchInboundSearch } from '../data/api';
import { INBOUND_STALE_MS, qk } from '../data/query-keys';
import { INBOUND_TYPE_META } from '../data/meta';
import type { InboundCardModel, InboundType } from '../data/types';
import { MRO_LOCATIONS, MRO_LOCATION_LABELS } from '@/shared/mro';
import type { MroLocation } from '@/shared/mro';
import { ListPage } from '@/shared/components/list-page';
import { useCursorList } from '@/shared/hooks/use-cursor-list';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';

// URL-driven store filter — `?location=` survives reloads and back/forward
// round-trips; nuqs `replace` (default) keeps taps out of history. There is NO
// "အားလုံး" option — the funnel is a store picker and the shown docs are
// always scoped to ONE store (the inbound doc's receiving `location` column),
// defaulting to the main store.
const INBOUND_LOCATION_FILTER = enumParam<MroLocation>(
	MRO_LOCATIONS.map((location) => location.value),
	'main_store',
);

/** The list pane's WHOLE URL view state — the store filter. */
const INBOUND_LIST_VIEW = {
	[URL_PARAM.location]: INBOUND_LOCATION_FILTER,
} as const;

/**
 * အဝင်စာရင်း — the canonical inbound (GRN) list page. ONE parameterized list for
 * the three inbound kinds (Purchase / Opening / Return) of ONE store. Kind tabs
 * differ by `type` and docs are always scoped to the selected `location` (both
 * server-side filters, default main store). Tapping a card opens its FULL-SCREEN
 * doc detail page (`/app/inbounds/:id` — the former items bottom sheet is a real
 * route with a back arrow now). DRAFT rows carry the အတည်ပြုမည် confirm action
 * (`/api/mro/inbounds/:id/confirm` — the moment stock actually lands); the
 * bottom bar holds the STORE location filter (ပင်မစတိုး …), a server-side 🔍
 * search and the create (+) button for this kind + store.
 */
export function InboundListPage({
	type,
	title,
	subheader,
}: {
	type: InboundType;
	title: string;
	/** The kind-tab row rendered above the list (the hub's scope switch). */
	subheader?: ReactNode;
}) {
	const navigate = useNavigate();
	const meta = INBOUND_TYPE_META[type];
	const [view, setView] = useViewState(INBOUND_LIST_VIEW);
	const { location } = view;
	const list = useCursorList({
		queryKey: qk.inbounds(type, location),
		fetcher: (cursor) => fetchInboundPage(type, location, cursor),
		staleTime: INBOUND_STALE_MS,
	});

	// Tap a card → its FULL-SCREEN detail page (the former items bottom sheet).
	// `?type=` keeps the app-bar back fallback on the tab the doc came from.
	const renderInbound = useCallback(
		(doc: InboundCardModel) => (
			<InboundDocCard key={doc.id} doc={doc} onOpen={(d) => navigate(`/app/inbounds/${d.id}?${URL_PARAM.type}=${d.type}`)} />
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
			renderItem={renderInbound}
			emptyState={{
				title: 'No inbound records yet',
				hint: 'Goods receipts you create appear here.',
			}}
			pagination={{
				hasNextPage: list.hasNextPage,
				isFetchingNextPage: list.isFetchingNextPage,
				onLoadMore: () => void list.fetchNextPage(),
				// Page 2 only after a real scroll — a short first page must not auto-fetch.
				waitForScroll: true,
			}}
			searchPlaceholder="Search number / note"
			fetchSearch={(query) => fetchInboundSearch(type, location, query)}
			filter={{
				value: location,
				onChange: (value) => setView({ location: value }),
				options: MRO_LOCATIONS,
				centerLabel: MRO_LOCATION_LABELS[location],
				sheetTitle: 'Select store',
				matches: (doc, loc) => doc.location === loc,
				emptyTitle: 'No inbound records in the selected store',
			}}
			create={{ to: `/app/inbounds/+?${URL_PARAM.type}=${type}`, label: `New ${meta.tagLabel}` }}
			density="compact"
		/>
	);
}
