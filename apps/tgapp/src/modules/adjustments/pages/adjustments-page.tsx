import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { AdjustmentCard } from '../components/adjustment-card';
import { fetchAdjustmentPage, fetchAdjustmentSearch } from '../data/api';
import { ADJUSTMENT_STALE_MS, qk } from '../data/query-keys';
import { ADJUSTMENT_STATUS_LABELS, ADJUSTMENT_STATUS_OPTIONS } from '../data/status';
import type { AdjustmentStatusFilterValue } from '../data/status';
import type { AdjustmentCardModel } from '../data/types';
import { ListPage } from '@/shared/components/list-page';
import { useCursorList } from '@/shared/hooks/use-cursor-list';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';

// URL-driven doc-status filter — `?status=` survives reloads and back/forward
// round-trips; nuqs `replace` (default) keeps taps out of history. Exported so
// the full-screen detail page can carry the filter in its back fallback.
export const ADJUSTMENT_STATUS_PARAM = enumParam<AdjustmentStatusFilterValue>(
	Object.keys(ADJUSTMENT_STATUS_LABELS) as AdjustmentStatusFilterValue[],
	'all',
);

/** The adjustments list's WHOLE URL view state, declared ONCE — the screen's
 *  single source of truth for "where am I in this view" (key from `URL_PARAM`).
 *  Exported so the full-screen detail page shares the SAME schema. */
export const ADJUSTMENT_VIEW = {
	[URL_PARAM.status]: ADJUSTMENT_STATUS_PARAM,
} as const;

/**
 * Adjustments — the MRO stock-correction list (`/app/adjustments`). ONE FLAT
 * list of every store's correction documents (no kind or store tabs — the
 * screen shows the whole `mro_adjustments` feed, newest first). Each card holds
 * its draft "Approve" action (a DIFFERENT employee confirms the report to apply
 * the ± deltas) and taps through to the FULL-SCREEN detail page
 * (`/app/adjustments/:id`); the bottom bar carries the doc-status filter, a
 * server-side 🔍 search and the create (+) button for this feed.
 *
 * The status filter is SERVER-scoped (`filter[doc_status][_eq]=…` in the page's
 * query) so paging stays honest — a status whose rows are past page 1 still
 * pages to them. The URL keeps it (`?status=`).
 */
export function AdjustmentsPage() {
	const navigate = useNavigate();
	const [view, setView] = useViewState(ADJUSTMENT_VIEW);
	const { status } = view;
	const list = useCursorList({
		queryKey: qk.adjustments(status),
		fetcher: (cursor) => fetchAdjustmentPage(status, cursor),
		staleTime: ADJUSTMENT_STALE_MS,
	});

	// Tap a card → its FULL-SCREEN detail page. `?status=` keeps the app-bar back
	// fallback on the filter the doc came from.
	const renderAdjustment = useCallback(
		(doc: AdjustmentCardModel) => (
			<AdjustmentCard key={doc.id} doc={doc} onOpen={(d) => navigate(`/app/adjustments/${d.id}?${URL_PARAM.status}=${status}`)} />
		),
		[navigate, status],
	);

	return (
		<ListPage
			title="Adjustments"
			rows={list.rows}
			isPending={list.isPending}
			isError={list.isError}
			onRetry={() => void list.refetch()}
			skeletonVariant="store-request"
			renderItem={renderAdjustment}
			emptyState={{
				title: 'No adjustments yet',
				hint: 'Stock corrections you report appear here.',
			}}
			pagination={{
				hasNextPage: list.hasNextPage,
				isFetchingNextPage: list.isFetchingNextPage,
				onLoadMore: () => void list.fetchNextPage(),
			}}
			searchPlaceholder="Search number / description"
			fetchSearch={(query) => fetchAdjustmentSearch(status, query)}
			filter={{
				value: status,
				onChange: (next) => setView({ status: next }),
				options: ADJUSTMENT_STATUS_OPTIONS,
				centerLabel: ADJUSTMENT_STATUS_LABELS[status],
				sheetTitle: 'Filter by status',
				emptyTitle: 'No adjustments in the selected status',
			}}
			create={{ to: '/app/adjustments/+', label: 'New Adjustment' }}
			density="compact"
		/>
	);
}

export default AdjustmentsPage;
