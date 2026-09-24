import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { TransferCard } from '../components/stock-move-card';
import { fetchTransferPage, fetchTransferSearch } from '../data/api';
import { TRANSFER_STALE_MS, qk } from '../data/query-keys';
import { TRANSFER_STATUS_LABELS, TRANSFER_STATUS_OPTIONS } from '../data/status';
import type { TransferStatusFilterValue } from '../data/status';
import type { TransferCardModel } from '../data/types';
import { ListPage } from '@/shared/components/list-page';
import { useCursorList } from '@/shared/hooks/use-cursor-list';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';

// URL-driven doc-status filter — `?status=` survives reloads and back/forward
// round-trips; nuqs `replace` (default) keeps taps out of history. Exported so
// the full-screen detail page can carry the filter in its back fallback.
export const TRANSFER_STATUS_PARAM = enumParam<TransferStatusFilterValue>(
	Object.keys(TRANSFER_STATUS_LABELS) as TransferStatusFilterValue[],
	'all',
);

/** The list's WHOLE URL view state — the doc-status filter. Exported so the
 *  full-screen detail page reads `?status=` through the SAME schema. */
export const TRANSFER_VIEW = {
	[URL_PARAM.status]: TRANSFER_STATUS_PARAM,
} as const;

/**
 * ပြောင်းရွှေ့မှုများ — the MRO location-transfer list (`/app/stock-moves`,
 * launcher tile `stock-moves` → ပြောင်းရွှေ့).
 *
 * Every `mro_transfers` document (TRF-…) in ONE cursor-paginated list (newest
 * first) — each card shows the route (ပေးပို့ → လက်ခံ store labels) and the
 * doc-status filter (မူကြမ်း / အတည်ပြုပြီး / ပယ်ဖျက်) narrows the workflow
 * stage SERVER-side (`?status=`), so paging stays honest. Tapping a card opens
 * its FULL-SCREEN detail page (`/app/stock-moves/:id`); DRAFT rows carry the
 * အတည်ပြုမည် confirm action on the card itself
 * (`/api/mro/transfers/:id/confirm` — the moment stock actually moves); the
 * bottom bar holds the filter, a server-side 🔍 search and the create (+)
 * button.
 */
export default function StockMovesPage() {
	const navigate = useNavigate();
	const [view, setView] = useViewState(TRANSFER_VIEW);
	const { status: statusFilter } = view;
	const list = useCursorList({
		queryKey: qk.transfers(statusFilter),
		fetcher: (cursor) => fetchTransferPage(statusFilter, cursor),
		staleTime: TRANSFER_STALE_MS,
	});

	// Tap a card → its FULL-SCREEN detail page (the former items bottom sheet).
	// `?status=` keeps the app-bar back fallback on the filter the doc came from.
	const renderTransfer = useCallback(
		(doc: TransferCardModel) => (
			<TransferCard key={doc.id} doc={doc} onOpen={(d) => navigate(`/app/stock-moves/${d.id}?${URL_PARAM.status}=${statusFilter}`)} />
		),
		[navigate, statusFilter],
	);

	return (
		<ListPage
			title="Transfers"
			rows={list.rows}
			isPending={list.isPending}
			isError={list.isError}
			onRetry={() => void list.refetch()}
			skeletonVariant="store-request"
			renderItem={renderTransfer}
			emptyState={{
				title: 'No transfers yet',
				hint: 'Movements you record appear here.',
			}}
			pagination={{
				hasNextPage: list.hasNextPage,
				isFetchingNextPage: list.isFetchingNextPage,
				onLoadMore: () => void list.fetchNextPage(),
			}}
			searchPlaceholder="Search number / note"
			fetchSearch={(query) => fetchTransferSearch(statusFilter, query)}
			filter={{
				value: statusFilter,
				onChange: (value) => setView({ status: value }),
				options: TRANSFER_STATUS_OPTIONS,
				centerLabel: TRANSFER_STATUS_LABELS[statusFilter],
				sheetTitle: 'Filter by status',
				emptyTitle: 'No transfers match the selected status',
			}}
			create={{ to: '/app/stock-moves/+', label: 'New Transfer' }}
			density="compact"
		/>
	);
}
