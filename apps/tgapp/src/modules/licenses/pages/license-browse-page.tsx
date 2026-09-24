import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { LicenseLine } from '../components/license-line';
import { LicensePill } from '../components/license-badge';
import { fetchLicensesPage, fetchLicensesSearch, permitSummaryOf } from '../data/api';
import { LICENSE_STALE_MS, qk } from '../data/query-keys';
import { LICENSE_STATUS_LABELS, LICENSE_STATUS_OPTIONS, type LicenseStatusFilterValue } from '../data/status';
import type { LicenseCardModel, TruckCurrentPermit, TruckLicenseSelection } from '../data/types';
import { EmptyState, FilteredEmptyState } from '@/shared/components/empty-state';
import { ListPage, type ListPageBodyHelpers } from '@/shared/components/list-page';
import { TruckGroupCard, compareNewestCreated, truckGroupsOf } from '@/shared/components/truck-groups';
import { listPageErrorProps, useCursorList } from '@/shared/hooks/use-cursor-list';
import { hapticSelection } from '@/shared/platform/haptics';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';

/**
 * Licenses → Browse all (`/app/licenses/browse`, reached from the license kiosk
 * search's "Browse all licenses" link).
 *
 * The launcher landing (`/app/licenses`) is the search-first kiosk: ONE centred
 * plate search, with a single match opening the truck page directly. This
 * This register is its escape hatch — EVERY vehicle from the `veh_fleets` master
 * as one section card (vehicle-first, mirroring the fleets/fluid registers):
 * plate + brand chips in the header with the CURRENT license's remaining-days
 * pill at the header's right — the current license read from the denormalized
 * `last_license` pointer, the newest permit on file, shown as a lean line with a
 * period-year chip. A truck with NO permit on file still gets a card, carrying
 * the neutral "no license on file" line and a "No license" header slot. The
 * WHOLE CARD is the tap target — tapping it opens the truck's FULL-SCREEN page
 * (`/app/licenses/:id`), which fetches THAT truck's complete permit file from
 * the API on demand. A bottom-bar renewal-status filter (Valid / Expiring /
 * expired) narrows the visible records, and a toolbar search narrows the
 * vehicles by plate / brand. Its back arrow returns HERE (this is a real
 * route, so a browse → truck round trip never loses the register). There is no
 * standalone add — a license is filed on ITS truck (a tap opens the truck's
 * renewal screen: first permit, or the next annual renewal).
 *
 * The read is ONE cursor-walk over `veh_fleets` (see `data/api.ts`), each row
 * carrying its expanded `last_license` — no separate fleet-directory fetch and
 * no permit-collection read on this screen.
 */
const STATUS_FILTER = enumParam<LicenseStatusFilterValue>(Object.keys(LICENSE_STATUS_LABELS) as LicenseStatusFilterValue[], 'all');

/** The browse screen's WHOLE URL view state, declared ONCE — the screen's single
 *  source of truth for "where am I in this view" (key from `URL_PARAM`). */
const LICENSE_BROWSE_VIEW = {
	[URL_PARAM.status]: STATUS_FILTER,
} as const;

const EMPTY_STATE = { title: 'No vehicles yet', hint: 'Vehicles from the fleet directory appear here — add one to track its license.' };

/** One line inside a truck card — hoisted so its identity is stable. */
const renderLicenseLine = (license: LicenseCardModel) => <LicenseLine key={license.id} license={license} />;

/** The truck CARD's CURRENT line — the remaining-days pill lives in the truck
 *  header now, so this line keeps just the period-year chip. A vehicle with NO
 *  current license (`hasRecord === false`) renders the module's neutral hint
 *  instead, so every vehicle still gets a card. */
const renderRegisterLine = (license: LicenseCardModel) =>
	license.hasRecord === false ? (
		<p key={license.id} className="px-4 py-3 text-sub font-medium leading-myanmar text-muted-foreground">
			No license on file — open to add this truck's first permit.
		</p>
	) : (
		<LicenseLine key={license.id} license={license} showPill={false} />
	);

export default function LicenseBrowsePage() {
	const navigate = useNavigate();
	const list = useCursorList({
		queryKey: qk.licenses(),
		fetcher: fetchLicensesPage,
		staleTime: LICENSE_STALE_MS,
	});

	const [view, setView] = useViewState(LICENSE_BROWSE_VIEW);
	const { status: statusFilter } = view;

	// The CURRENT permit summary per truck across EVERY loaded page — a card tap
	// routes it to the truck page so the renewal form can carry the number AND
	// gate on the expiry with NO read on its record view. Computed filter-
	// INDEPENDENTLY: the status filter narrows which rows are visible, but the
	// summary must come from the truck's newest permit (an older permit matching
	// the filter would otherwise overwrite the renewal with a stale record).
	const currentPermitByTruck = useMemo(() => {
		const by = new Map<string, TruckCurrentPermit | null>();
		for (const group of truckGroupsOf(list.rows)) {
			if (!group.vehicleId) continue;
			const newest = [...group.items].sort(compareNewestCreated)[0];
			// A vehicle with no current license routes `null` (not a phantom summary):
			// the truck page's renew gate then reads "first record", exactly as it did
			// before the register became vehicle-first.
			by.set(group.vehicleId, newest?.hasRecord === false ? null : permitSummaryOf(newest));
		}
		return by;
	}, [list.rows]);

	// The tapped truck's per-truck page (`/app/licenses/:id`) — the page owns the
	// navigation and hands the tapped truck's identity (plate/brand + vehicle id)
	// through router state so the destination header paints instantly. The register
	// is vehicle-first, so every card carries a `veh_fleets` id to navigate to.
	const openTruck = useCallback(
		(truck: TruckLicenseSelection) => {
			hapticSelection();
			navigate(`/app/licenses/${truck.vehicleId}`, { state: { row: truck } });
		},
		[navigate],
	);

	/** Hoisted per-truck body — groups the filter-narrowed licenses under their
	 *  trucks (each card shows the truck's CURRENT license; tapping the card
	 *  opens the truck's full-screen page) and renders the module's empty /
	 *  filtered-empty states. */
	const renderLicenseGroups = useCallback(
		function renderLicenseGroups(rows: LicenseCardModel[], helpers: ListPageBodyHelpers): ReactNode {
			if (helpers.isEmpty) return <EmptyState {...EMPTY_STATE} fill />;
			if (helpers.isFilteredEmpty) return <FilteredEmptyState title="No license matches this status" onClear={helpers.clearFilters} fill />;
			return (
				<ul className="flex flex-col gap-3">
					{truckGroupsOf(rows).map((group) => {
						// The register is vehicle-first — one vehicle per group, so items[0] IS
						// the truck's current license card (or its `hasRecord: false` placeholder).
						const current = group.items[0];
						const hasRecord = current?.hasRecord !== false;
						const vehicleId = group.vehicleId;
						return (
							<TruckGroupCard
								key={group.key}
								plate={group.plate}
								brand={group.brand}
								// The header's right slot: the current license's remaining-days pill on a
								// truck that has one; a neutral "No license" on a truck without.
								countLabel={
									current && vehicleId && hasRecord ? (
										<LicensePill size="md" tone={current.tone} remainingDays={current.remainingDays} />
									) : (
										'No license'
									)
								}
								items={group.items}
								renderLine={vehicleId ? renderRegisterLine : renderLicenseLine}
								onOpen={
									vehicleId
										? () =>
												openTruck({
													vehicleId,
													plate: group.plate,
													brand: group.brand,
													current: currentPermitByTruck.get(vehicleId) ?? null,
												})
										: undefined
								}
							/>
						);
					})}
				</ul>
			);
		},
		[openTruck, currentPermitByTruck],
	);

	/** ONE toolbar-search hit — rendered with the SAME truck card the list uses (a
	 *  single-item group), so a result is indistinguishable from the row it
	 *  replaced AND taps through to the truck page exactly like the list does.
	 *  The old flat `<LicenseCard>` was a DEAD END: no tap target and a different
	 *  card shape, so "search then tap" silently did nothing. */
	const renderTruckHit = useCallback(
		(license: LicenseCardModel) => {
			const vehicleId = license.vehicleId ?? null;
			const hasRecord = license.hasRecord !== false;
			return (
				<TruckGroupCard
					key={license.id}
					plate={license.plate}
					brand={license.brand}
					countLabel={
						vehicleId && hasRecord ? <LicensePill size="md" tone={license.tone} remainingDays={license.remainingDays} /> : 'No license'
					}
					items={[license]}
					renderLine={vehicleId ? renderRegisterLine : renderLicenseLine}
					onOpen={
						vehicleId
							? () =>
									openTruck({
										vehicleId,
										plate: license.plate,
										brand: license.brand,
										current: currentPermitByTruck.get(vehicleId) ?? null,
									})
							: undefined
					}
				/>
			);
		},
		[openTruck, currentPermitByTruck],
	);

	return (
		<ListPage
			{...listPageErrorProps(list)}
			title="Licenses"
			backTo="/app/licenses"
			rows={list.rows}
			isPending={list.isPending}
			skeletonVariant="license"
			renderItem={renderTruckHit}
			renderListBody={renderLicenseGroups}
			emptyState={EMPTY_STATE}
			pagination={{
				hasNextPage: list.hasNextPage,
				isFetchingNextPage: list.isFetchingNextPage,
				onLoadMore: () => void list.fetchNextPage(),
			}}
			searchPlaceholder="Search plate / brand"
			fetchSearch={fetchLicensesSearch}
			filter={{
				value: statusFilter,
				onChange: (value) => setView({ status: value }),
				options: LICENSE_STATUS_OPTIONS,
				centerLabel: LICENSE_STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ?? 'All',
				sheetTitle: 'Filter by status',
				matches: (record, tone) => record.hasRecord !== false && record.tone === tone,
				emptyTitle: 'No license matches this status',
			}}
			centerText="licenses"
		/>
	);
}
