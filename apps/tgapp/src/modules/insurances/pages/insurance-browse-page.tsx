import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { InsuranceLine } from '../components/insurance-line';
import { InsurancePill } from '../components/insurance-badge';
import { fetchInsurancesPage, fetchInsurancesSearch, insuranceCurrentOf, sortInsurancesByUrgency } from '../data/api';
import { INSURANCE_STALE_MS, qk } from '../data/query-keys';
import { INSURANCE_STATUS_LABELS, INSURANCE_STATUS_OPTIONS, type InsuranceStatusFilterValue } from '../data/status';
import type { InsuranceCardModel, InsuranceCurrentState, TruckInsuranceSelection } from '../data/types';
import { EmptyState, FilteredEmptyState } from '@/shared/components/empty-state';
import { ListPage, type ListPageBodyHelpers } from '@/shared/components/list-page';
import { TruckGroupCard, compareNewestCreated, truckGroupsOf } from '@/shared/components/truck-groups';
import { listPageErrorProps, useCursorList } from '@/shared/hooks/use-cursor-list';
import { hapticSelection } from '@/shared/platform/haptics';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';

/**
 * Insurances → Browse all (`/app/insurances/browse`, reached from the insurance
 * kiosk search's "Browse all policies" link).
 *
 * The launcher landing (`/app/insurances`) is the search-first kiosk: ONE
 * centred plate search, with a single match opening the truck page directly.
 * This register is its escape hatch — EVERY vehicle from the `veh_fleets` master
 * as one section card (vehicle-first, mirroring the fleets/fluid registers):
 * plate + brand chips in the header with the CURRENT policy's remaining-days
 * pill at the header's right — the current policy read from the denormalized
 * `last_insurance` pointer, the newest policy on file, shown as a lean line with
 * a period-year chip. A truck with NO policy on file still gets a card, carrying
 * the neutral "no policy on file" line and a "No policy" header slot. The WHOLE
 * CARD is the tap target — tapping it opens the truck's FULL-SCREEN page
 * (`/app/insurances/:id`), which fetches THAT truck's complete policy file from
 * the API on demand. A bottom-bar status filter (Valid / Expiring / Expired)
 * narrows the visible records, and a toolbar search narrows the vehicles by
 * plate / brand. Its back arrow returns HERE (this is a real route, so a browse
 * → truck round trip never loses the register). There is no standalone add — a
 * policy is filed on ITS truck (a tap opens the truck's renewal screen: first
 * policy, or the next annual renewal).
 *
 * The read is ONE cursor-walk over `veh_fleets` (see `data/api.ts`), each row
 * carrying its expanded `last_insurance` — no separate fleet-directory fetch and
 * no policy-collection read on this screen.
 */
const STATUS_FILTER = enumParam<InsuranceStatusFilterValue>(Object.keys(INSURANCE_STATUS_LABELS) as InsuranceStatusFilterValue[], 'all');

/** The browse screen's WHOLE URL view state, declared ONCE — the screen's single
 *  source of truth for "where am I in this view" (key from `URL_PARAM`). */
const INSURANCE_BROWSE_VIEW = {
	[URL_PARAM.status]: STATUS_FILTER,
} as const;

const EMPTY_STATE = { title: 'No vehicles yet', hint: 'Vehicles from the fleet directory appear here — add one to track its policy.' };

/** One line inside a truck card — hoisted so its identity is stable. */
const renderInsuranceLine = (insurance: InsuranceCardModel) => <InsuranceLine key={insurance.id} insurance={insurance} />;

/** The truck CARD's CURRENT line — the remaining-days pill lives in the truck
 *  header now, so this line keeps just the period-year chip. A vehicle with NO
 *  current policy (`hasRecord === false`) renders the module's neutral hint
 *  instead, so every vehicle still gets a card. */
const renderRegisterLine = (insurance: InsuranceCardModel) =>
	insurance.hasRecord === false ? (
		<p key={insurance.id} className="px-4 py-3 text-sub font-medium leading-myanmar text-muted-foreground">
			No policy on file — open to add this truck's first policy.
		</p>
	) : (
		<InsuranceLine key={insurance.id} insurance={insurance} showPill={false} />
	);

export default function InsuranceBrowsePage() {
	const navigate = useNavigate();
	const list = useCursorList({
		queryKey: qk.insurances(),
		fetcher: fetchInsurancesPage,
		staleTime: INSURANCE_STALE_MS,
	});

	const [view, setView] = useViewState(INSURANCE_BROWSE_VIEW);
	const { status: statusFilter } = view;

	// The CURRENT policy summary per truck across EVERY loaded page — a card tap
	// routes it to the truck page so the record view can gate its renewal form
	// with NO read. Computed filter-INDEPENDENTLY: the status filter narrows which
	// rows are visible, but the summary must come from the truck's newest policy
	// (an older policy matching the filter would otherwise mis-gate the renewal).
	const currentPolicyByTruck = useMemo(() => {
		const by = new Map<string, InsuranceCurrentState | null>();
		for (const group of truckGroupsOf(list.rows, (policy) => ({
			vehicleId: policy.vehicleId,
			plate: policy.plateNo,
			brand: policy.brandLabel,
		}))) {
			if (!group.vehicleId) continue;
			const newest = [...group.items].sort(compareNewestCreated)[0];
			// A vehicle with no current policy routes `null` (not a phantom summary):
			// the truck page's renew gate then reads "first record", exactly as it did
			// before the register became vehicle-first.
			by.set(group.vehicleId, newest?.hasRecord === false ? null : insuranceCurrentOf(newest));
		}
		return by;
	}, [list.rows]);

	// The tapped truck's per-truck page (`/app/insurances/:id`) — the page owns
	// the navigation and hands the tapped truck's identity (plate/brand + vehicle
	// id) through router state so the destination header paints instantly. The
	// register is vehicle-first, so every card carries a `veh_fleets` id.
	const openTruck = useCallback(
		(truck: TruckInsuranceSelection) => {
			hapticSelection();
			navigate(`/app/insurances/${truck.vehicleId}`, { state: { row: truck } });
		},
		[navigate],
	);

	// Most-urgent-first across every loaded page (overdue → expiring → valid).
	// Memoized on the loaded pages: search/status re-renders reuse the order.
	const source: InsuranceCardModel[] = useMemo(() => sortInsurancesByUrgency(list.rows), [list.rows]);

	/** Hoisted per-truck body — groups the filter-narrowed policies under their
	 *  trucks (each card shows the truck's CURRENT policy; tapping the card
	 *  opens the truck's full-screen page) and renders the module's empty /
	 *  filtered-empty states. */
	const renderInsuranceGroups = useCallback(
		function renderInsuranceGroups(rows: InsuranceCardModel[], helpers: ListPageBodyHelpers): ReactNode {
			if (helpers.isEmpty) return <EmptyState {...EMPTY_STATE} fill />;
			if (helpers.isFilteredEmpty) return <FilteredEmptyState title="No policy matches this status" onClear={helpers.clearFilters} fill />;
			return (
				<ul className="flex flex-col gap-3">
					{truckGroupsOf(rows, (policy) => ({
						vehicleId: policy.vehicleId,
						plate: policy.plateNo,
						brand: policy.brandLabel,
					})).map((group) => {
						// The register is vehicle-first — one vehicle per group, so items[0] IS
						// the truck's current policy card (or its `hasRecord: false` placeholder).
						const current = group.items[0];
						const hasRecord = current?.hasRecord !== false;
						const vehicleId = group.vehicleId;
						return (
							<TruckGroupCard
								key={group.key}
								plate={group.plate}
								brand={group.brand}
								// The header's right slot: the current policy's remaining-days pill on a
								// truck that has one; a neutral "No policy" on a truck without.
								countLabel={
									current && vehicleId && hasRecord ? (
										<InsurancePill size="md" status={current.status} remainingDays={current.remainingDays} />
									) : (
										'No policy'
									)
								}
								items={group.items}
								renderLine={vehicleId ? renderRegisterLine : renderInsuranceLine}
								onOpen={
									vehicleId
										? () =>
												openTruck({
													vehicleId,
													plate: group.plate,
													brand: group.brand,
													current: currentPolicyByTruck.get(vehicleId) ?? null,
												})
										: undefined
								}
							/>
						);
					})}
				</ul>
			);
		},
		[openTruck, currentPolicyByTruck],
	);

	/** ONE toolbar-search hit — the SAME truck card the list uses (a single-item
	 *  group), so a result looks like the row it replaced and taps through to the
	 *  truck page. The old flat `<InsuranceCard>` had no tap target at all. */
	const renderTruckHit = useCallback(
		(insurance: InsuranceCardModel) => {
			const vehicleId = insurance.vehicleId ?? null;
			const hasRecord = insurance.hasRecord !== false;
			return (
				<TruckGroupCard
					key={insurance.id}
					plate={insurance.plateNo}
					brand={insurance.brandLabel}
					countLabel={
						vehicleId && hasRecord ? (
							<InsurancePill size="md" status={insurance.status} remainingDays={insurance.remainingDays} />
						) : (
							'No policy'
						)
					}
					items={[insurance]}
					renderLine={vehicleId ? renderRegisterLine : renderInsuranceLine}
					onOpen={
						vehicleId
							? () =>
									openTruck({
										vehicleId,
										plate: insurance.plateNo,
										brand: insurance.brandLabel,
										current: currentPolicyByTruck.get(vehicleId) ?? null,
									})
							: undefined
					}
				/>
			);
		},
		[openTruck, currentPolicyByTruck],
	);

	return (
		<ListPage
			{...listPageErrorProps(list)}
			title="Insurances"
			backTo="/app/insurances"
			rows={source}
			isPending={list.isPending}
			skeletonVariant="insurance"
			renderItem={renderTruckHit}
			renderListBody={renderInsuranceGroups}
			emptyState={EMPTY_STATE}
			pagination={{
				hasNextPage: list.hasNextPage,
				isFetchingNextPage: list.isFetchingNextPage,
				onLoadMore: () => void list.fetchNextPage(),
			}}
			searchPlaceholder="Search plate / brand"
			fetchSearch={fetchInsurancesSearch}
			filter={{
				value: statusFilter,
				onChange: (value) => setView({ status: value }),
				options: INSURANCE_STATUS_OPTIONS,
				centerLabel: INSURANCE_STATUS_LABELS[statusFilter],
				sheetTitle: 'Filter by status',
				matches: (insurance, status) => insurance.hasRecord !== false && insurance.status === status,
				emptyTitle: 'No policy matches this status',
			}}
			centerText="insurances"
		/>
	);
}
