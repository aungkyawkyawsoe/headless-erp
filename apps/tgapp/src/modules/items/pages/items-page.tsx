import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { ItemCard } from '../components/item-card';
import { fetchItemModelsPage, fetchItemModelsSearch } from '../data/api';
import { ITEMS_STALE_MS, qk } from '../data/query-keys';
import { itemModelEditPath } from '@/shared/mro';
import { ITEM_TRACKING_FILTER_VALUES, ITEM_TRACKING_LABELS, ITEM_TRACKING_OPTIONS, type TrackingFilterValue } from '../data/status';
import type { ItemCardModel } from '../data/types';
import { ListPage } from '@/shared/components/list-page';
import { listPageErrorProps, useCursorList } from '@/shared/hooks/use-cursor-list';
import { URL_PARAM, enumParam, stringParam, useViewState } from '@/shared/url-state';

/**
 * ပစ္စည်းများ — the MRO item-model catalog (`/app/items`, launcher tile
 * `items` → ပစ္စည်းများ).
 *
 * The MRO SKU IS the `mro_item_model` collection (there is no `mro_items` /
 * `store_items`): cursor-paginated at `LIST_PAGE_SIZE` rows per page (newest
 *  first is irrelevant here — the catalog reads sorted by NAME; page 1 renders
 *  immediately, further pages stream in as the list approaches the bottom via
 * `LoadMoreSentinel`). Each card is self-contained and deliberately thin: the
 * SKU's photo (or the shared monogram) and the two names — the English label
 * (group + model) over the Myanmar one,
 * BOTH wrapping rather than truncating. It paints NO tracking-policy badge: the
 * policy is a property of the item NAME and is stated where it is actionable (the
 * `?tracking=` filter below, the SKU pickers, the item form's inherited field) —
 * the m2o masters arrive expanded via the
 * `item_name.tracking` dot-path fields (the list read asks ONLY for what the card
 * paints, see `CARD_FIELDS` in `data/api.ts`). The card paints NO stock figure:
 * the catalog is for finding a SKU, and the stock belongs to the stock app, which
 * shows it where the lines actually live.
 *
 * Tapping a card opens that SKU's EDIT FORM (`itemModelEditPath` →
 * `/app/items/:id/edit`) — the SKU's stock-lines page (`/app/stocks/item/:id`) is
 * deliberately NOT reachable from the catalog: a browse is about the SKU's own
 * record, and one tap should land there identically for every session rather than
 * on a page only some roles can read.
 *
 * The fixed bottom action bar carries the standard list-view controls — a
 * TRACKING-policy filter (`?tracking=` — narrow the list to one policy), a 🔍
 * toggle that reveals the search field ATTACHED to the bar (never at the top
 * of the page) — filtering client-side over the loaded rows like every other
 * list. A `?item_name=<uuid>` deep link (from the mro-categories
 * ပစ္စည်းအုပ်စု cards) SERVER-filters the list to one `mro_item_name` master:
 * the query key is scoped so two masters cache separately, the server search
 * runs inside the master, and the create (+) button opens the form preselected
 * with that master. The tracking filter UI works exactly as without the param.
 */

// URL-driven tracking filter — `?tracking=batch` survives reloads and
// back/forward round-trips; nuqs `replace` (default) keeps taps out of
// history. `'all'` shows every policy.
const TRACKING_FILTER = enumParam<TrackingFilterValue>([...ITEM_TRACKING_FILTER_VALUES], 'all');

/** The items list's WHOLE URL view state, declared ONCE — the `?item_name=` master
 *  scope + the tracking-policy filter (key from `URL_PARAM`). */
const ITEMS_VIEW = {
	[URL_PARAM.itemName]: stringParam,
	[URL_PARAM.tracking]: TRACKING_FILTER,
} as const;

export default function ItemsPage() {
	const navigate = useNavigate();
	// `?item_name=<uuid>` — the mro-categories ပစ္စည်းအုပ်စု deep link; null when
	// absent (then the list reads unfiltered). `?tracking=` narrows the policy.
	const [view, setView] = useViewState(ITEMS_VIEW);
	const { item_name: itemNameId, tracking: trackingFilter } = view;

	// The `?item_name=` deep link scopes the query key (two masters cache
	// separately) AND the fetcher (the server filters by the master).
	const listQk = itemNameId ? [...qk.items(), { item_name: itemNameId }] : qk.items();
	const list = useCursorList({
		queryKey: listQk,
		fetcher: (cursor) => fetchItemModelsPage(cursor, itemNameId ?? undefined),
		staleTime: ITEMS_STALE_MS,
	});

	// One card per row, ONE destination: the SKU's edit form. `useCallback` keeps
	// the renderer's identity stable so `ItemCard`'s memo skips untouched rows on
	// unrelated re-renders.
	const renderItemModel = useCallback(
		(item: ItemCardModel) => <ItemCard key={item.id} item={item} onOpen={() => navigate(itemModelEditPath(item.id))} />,
		[navigate],
	);

	// The create (+) destination keeps the active context so the form opens
	// preselected: an active `?item_name=` master wins (the new SKU belongs to that
	// ပစ္စည်းအုပ်စု); otherwise the plain route. The tracking filter is deliberately
	// NOT carried over — the policy belongs to the item name, which the form picks.
	const createTo = itemNameId ? `/app/items/+?${URL_PARAM.itemName}=${itemNameId}` : '/app/items/+';

	return (
		<ListPage
			{...listPageErrorProps(list)}
			title="Items"
			rows={list.rows}
			isPending={list.isPending}
			skeletonVariant="items"
			renderItem={renderItemModel}
			emptyState={{ title: 'No items yet', hint: 'Add a new item to start tracking MRO stock.' }}
			pagination={{
				hasNextPage: list.hasNextPage,
				isFetchingNextPage: list.isFetchingNextPage,
				onLoadMore: () => void list.fetchNextPage(),
			}}
			searchPlaceholder="Search item name"
			fetchSearch={(query) => fetchItemModelsSearch(query, itemNameId ?? undefined)}
			filter={{
				value: trackingFilter,
				onChange: (next) => setView({ tracking: next }),
				options: ITEM_TRACKING_OPTIONS,
				centerLabel: ITEM_TRACKING_LABELS[trackingFilter],
				sheetTitle: 'Filter by tracking',
				matches: (item, tracking) => item.tracking === tracking,
				emptyTitle: 'No items with this tracking method',
			}}
			create={{ to: createTo, label: 'New Item' }}
		/>
	);
}
