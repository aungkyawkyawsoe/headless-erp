import { useCallback } from 'react';

import { MaintenanceTruckCard } from '../components/maintenance-truck-card';
import { fetchMaintenanceBrowsePage, fetchMaintenanceBrowseSearch } from '../data/api';
import { MAINTENANCE_STALE_MS, qk } from '../data/query-keys';
import type { MaintenanceTruckBrowseModel } from '../data/types';
import { ListPage } from '@/shared/components/list-page';
import { listPageErrorProps, useCursorList } from '@/shared/hooks/use-cursor-list';

/**
 * ပြင်ဆင် → Browse all (`/app/maintenances/browse`, the kiosk's "Browse all
 * vehicles" escape hatch).
 *
 * The FULL truck register, mirroring `/app/fluid/browse`: EVERY truck of the
 * fleet master (plate-sorted, cursor-paginated) appears whether or not it has a
 * maintenance record yet. Each card is IDENTITY-ONLY (plate + brand) and the
 * register is a PURE `veh_fleets` read — one request per page, no per-truck
 * maintenance join. Tapping a truck opens ITS maintenance file
 * (`/app/maintenances/vehicle/:id`); the log's own edit form is one step
 * further (`/app/maintenances/log/:id`).
 *
 * The toolbar search is a plate/brand search over the fleet master — the same
 * cards as the list, so searching a fragment returns every matching truck,
 * record or not.
 */
const EMPTY_STATE = { title: 'No vehicles yet', hint: 'Add vehicles to the fleet first — maintenance jobs appear here.' };

export default function MaintenancesBrowsePage() {
	// The register — a PURE fleet-master list, so a truck with no record on file
	// still appears (mirroring the Fluid register).
	const list = useCursorList({
		queryKey: qk.trucks(),
		fetcher: fetchMaintenanceBrowsePage,
		staleTime: MAINTENANCE_STALE_MS,
	});

	/** ONE truck card — the same card the list and the toolbar search render. */
	const renderTruck = useCallback((truck: MaintenanceTruckBrowseModel) => <MaintenanceTruckCard key={truck.id} truck={truck} />, []);

	return (
		<ListPage
			{...listPageErrorProps(list)}
			title="Vehicle maintenance"
			backTo="/app/maintenances"
			rows={list.rows}
			isPending={list.isPending}
			isError={list.isError}
			onRetry={() => void list.refetch()}
			skeletonVariant="maintenance"
			renderItem={renderTruck}
			emptyState={EMPTY_STATE}
			pagination={{
				hasNextPage: list.hasNextPage,
				isFetchingNextPage: list.isFetchingNextPage,
				onLoadMore: () => void list.fetchNextPage(),
			}}
			searchPlaceholder="Plate number / brand"
			fetchSearch={fetchMaintenanceBrowseSearch}
			centerText="Maintenance"
			create={{ to: '/app/maintenances/+', label: 'New maintenance log' }}
		/>
	);
}
