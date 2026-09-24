import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { StoreRequestCard } from '../components/store-request-card';
import { fetchRequisitionsPage, fetchRequisitionsSearch } from '../data/api';
import { qk, REQUISITIONS_STALE_MS } from '../data/query-keys';
import { REQUISITION_FILTER_LABELS, REQUISITION_FILTER_OPTIONS, type RequisitionFilterValue } from '../data/status';
import type { MroRequisitionCardModel } from '../data/types';
import { ListPage } from '@/shared/components/list-page';
import { listPageErrorProps, useCursorList } from '@/shared/hooks/use-cursor-list';
import { SegmentedTabs } from '@/shared/components/segmented-tabs';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';

/**
 * Store requests — the MRO store requisition list (`/app/store-requests`, launcher
 * tile `store-requests`).
 *
 * A HORIZONTALLY-SCROLLABLE segmented lifecycle tab bar sits above the list
 * (Requested / Completed / Rejected, English-only, no count badges) driven by
 * `?status=` so the chosen group survives reloads. The tab is a SERVER-SIDE scope
 * — tapping one re-reads the list filtered to that group (each group gets its own
 * cursor-paginated, 10-per-page newest-first cache). Each card is a NAVIGATION ROW
 * into the request's detail page (`/app/store-requests/:id`) — the store keeper
 * APPROVES, ISSUES (partial goods issue) or REJECTS the request there. The card
 * itself is the lean summary (number + `requisition_status` pill, store + date,
 * requester/approver, issued-so-far progress, totals summary + note); no inline
 * approve/issue action remains on the list.
 *
 * THREE tabs, not five: `requested` merges the OPEN queue (requested + approved,
 * plus still-open drafts — "nothing issued yet"), `completed` merges
 * partially-issued with fulfilled ("goods have started moving"), and there is no
 * `all` catch-all — every lifecycle belongs to one of the three. See
 * `RequisitionFilterValue`.
 */
const REQUISITION_STATUS_FILTER = enumParam<RequisitionFilterValue>(
	REQUISITION_FILTER_OPTIONS.map((option) => option.value),
	'requested',
);

/** The list's WHOLE URL view state — the lifecycle status scope. */
const REQUISITION_STATUS_VIEW = {
	[URL_PARAM.status]: REQUISITION_STATUS_FILTER,
} as const;

export default function StoreRequestsPage() {
	const navigate = useNavigate();
	const [view, setView] = useViewState(REQUISITION_STATUS_VIEW);
	const { status: statusFilter } = view;

	// The tab value is the SERVER-SIDE status scope — switching tabs swaps the
	// query key + fetcher, so the page re-reads the API filtered to that group.
	const list = useCursorList({
		queryKey: qk.requisitions(statusFilter),
		fetcher: (cursor) => fetchRequisitionsPage(statusFilter, cursor),
		staleTime: REQUISITIONS_STALE_MS,
	});

	// One card per row — tap opens the request's detail page (approve / issue /
	// reject all happen there). `useCallback` keeps the renderer stable page→page.
	const renderItem = useCallback(
		(request: MroRequisitionCardModel) => (
			<StoreRequestCard
				key={request.id}
				request={request}
				onOpen={() => {
					navigate(`/app/store-requests/${request.id}`);
				}}
				statusLabel={statusFilter === 'rejected' ? 'Rejected' : undefined}
			/>
		),
		[navigate, statusFilter],
	);

	return (
		<ListPage
			{...listPageErrorProps(list)}
			title="Requisition"
			rows={list.rows}
			isPending={list.isPending}
			skeletonVariant="store-request"
			subheader={
				<SegmentedTabs
					options={REQUISITION_FILTER_OPTIONS}
					value={statusFilter}
					onChange={(value) => setView({ status: value })}
					scrollable
					showCount={false}
					ariaLabel="Requisition status"
				/>
			}
			renderItem={renderItem}
			emptyState={{
				title: `No ${REQUISITION_FILTER_LABELS[statusFilter].toLowerCase()} requests`,
				hint: 'Requisitions appear here as they move through the store.',
			}}
			pagination={{
				hasNextPage: list.hasNextPage,
				isFetchingNextPage: list.isFetchingNextPage,
				onLoadMore: () => void list.fetchNextPage(),
				waitForScroll: true,
			}}
			searchPlaceholder="Search number / note"
			fetchSearch={(query) => fetchRequisitionsSearch(statusFilter, query)}
			centerText={REQUISITION_FILTER_LABELS[statusFilter]}
			create={{ to: '/app/store-requests/+', label: 'New Requisition' }}
			// Separated card list — each request renders as its own floating card
			// with an inter-row gap, giving visual breathing room between items.
			density="comfortable"
		/>
	);
}
