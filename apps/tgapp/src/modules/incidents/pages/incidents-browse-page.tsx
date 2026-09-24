import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { IncidentCard } from '../components/incident-card';
import { fetchIncidentsPage, fetchIncidentsSearch } from '../data/api';
import { INCIDENTS_STALE_MS, qk } from '../data/query-keys';
import { INCIDENT_SEVERITY_LABELS, INCIDENT_SEVERITY_OPTIONS, type IncidentSeverityFilterValue } from '../data/status';
import type { IncidentCardModel, TruckIncidentSelection } from '../data/types';
import { EmptyState, FilteredEmptyState } from '@/shared/components/empty-state';
import { ListPage, type ListPageBodyHelpers } from '@/shared/components/list-page';
import { TruckGroupCard, UNASSIGNED_LABEL, compareNewestCreated, truckGroupsOf } from '@/shared/components/truck-groups';
import { useCursorList } from '@/shared/hooks/use-cursor-list';
import { hapticSelection } from '@/shared/platform/haptics';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';

/**
 * Accidents & Incidents → Browse all (`/app/incidents/browse`, reached from the
 * incidents kiosk search's "Browse all records" link).
 *
 * The launcher landing (`/app/incidents`) is the search-first kiosk: ONE centred
 * plate search, with a single match opening the truck page directly. This
 * register is its escape hatch — every record grouped BY TRUCK, read live from
 * the REAL `veh_incidents` collection (bound to the `veh_fleets` plate
 * directory; crew via the `personnel` m2m → `hrm_employees`): each truck that owns at least one
 * record is one IDENTITY-ONLY card — plate + brand chips with the record count
 * at the header's right. The card deliberately carries NO record line: it is
 * about the truck, so putting one arbitrary (newest) record on it only invited
 * "is that the latest?" confusion.
 *
 * The WHOLE CARD is the tap target and it opens THAT TRUCK's record list
 * (`/app/incidents/vehicle/:id`): the truck's complete file, newest first, where
 * each row opens the record's own edit form (`/app/incidents/record/:id`). So the
 * journey is always truck → its records → the tapped record's form; no bottom
 * sheet dumps a truck's file over the register. Records with no truck link have
 * no file to open, so they stay as their own tappable record cards under an
 * "Unassigned" heading. A bottom-bar severity filter (High / Medium / Low)
 * narrows the visible records; trucks left with no matching record drop out of
 * the view. Its back arrow returns to the kiosk (a real route, so a browse →
 * truck → edit round trip never loses the register).
 *
 * A toolbar search switches to the FLAT record cards (each still carries its
 * plate/brand identity chips + its crew from the `personnel` m2m), because
 * matches may span many trucks. Those are RECORD cards — a tap opens that
 * record's edit form. Each record's
 * plate/brand/vehicle id is the `vehicle` m2o EXPANDED in the SAME request (see
 * the dotted `fields` in `data/api.ts`), so this page is ONE self-contained read
 * of `veh_incidents` — no separate fleet-directory fetch.
 */
const SEVERITY_FILTER = enumParam<IncidentSeverityFilterValue>(
	Object.keys(INCIDENT_SEVERITY_LABELS) as IncidentSeverityFilterValue[],
	'all',
);

/** The browse screen's URL view state — one schema (see `useViewState`). */
const INCIDENT_BROWSE_VIEW = { [URL_PARAM.severity]: SEVERITY_FILTER } as const;

const EMPTY_STATE = { title: 'No accidents or incidents yet', hint: 'Accidents and incidents reported on fleet vehicles appear here.' };

export default function IncidentBrowsePage() {
	const navigate = useNavigate();
	const list = useCursorList({
		queryKey: qk.incidents(),
		fetcher: (cursor) => fetchIncidentsPage(cursor),
		staleTime: INCIDENTS_STALE_MS,
	});

	const [view, setView] = useViewState(INCIDENT_BROWSE_VIEW);
	const { severity: severityFilter } = view;

	// A tapped TRUCK card opens that truck's record list
	// (`/app/incidents/vehicle/:id`). The plate/brand ride along in router state so
	// the destination header paints instantly (no fleet read on the tap path).
	const openTruck = useCallback(
		(truck: TruckIncidentSelection) => {
			hapticSelection();
			navigate(`/app/incidents/vehicle/${truck.vehicleId}`, { state: { row: truck } });
		},
		[navigate],
	);

	// A tapped RECORD card (the toolbar search's flat results) opens that record's
	// edit form directly — the card already IS the record.
	const openRecord = useCallback(
		(record: IncidentCardModel) => {
			hapticSelection();
			navigate(`/app/incidents/record/${record.id}`);
		},
		[navigate],
	);

	/** Hoisted per-truck body — groups the severity-narrowed records under their
	 *  trucks (each card is IDENTITY ONLY; tapping it opens that truck's record
	 *  list) and renders the module's empty / filtered-empty states. Records with
	 *  no truck link render as their own tappable record cards, since there is no
	 *  truck file to open. */
	const renderIncidentGroups = useCallback(
		function renderIncidentGroups(rows: IncidentCardModel[], helpers: ListPageBodyHelpers): ReactNode {
			if (helpers.isEmpty) return <EmptyState {...EMPTY_STATE} fill />;
			if (helpers.isFilteredEmpty)
				return <FilteredEmptyState title="No record matches this severity" onClear={helpers.clearFilters} fill />;
			return (
				<ul className="flex flex-col gap-3">
					{truckGroupsOf(rows, (record) => ({
						vehicleId: record.vehicleId,
						plate: record.plateNo,
						brand: record.brandLabel,
					})).map((group) => {
						// Newest record first — items[0] is the truck's newest record.
						const items = [...group.items].sort(compareNewestCreated);
						const count = items.length;
						const vehicleId = group.vehicleId;

						// No truck link → no truck file to open, so these stay as their own
						// tappable record cards under an "Unassigned" heading.
						if (!vehicleId) {
							return (
								<li key={group.key}>
									<p className="px-1 text-meta font-semibold uppercase tracking-wide text-muted-foreground">{UNASSIGNED_LABEL}</p>
									<ul className="mt-2 flex flex-col gap-3">
										{items.map((record) => (
											<IncidentCard key={record.id} record={record} onOpen={openRecord} />
										))}
									</ul>
								</li>
							);
						}

						return (
							<TruckGroupCard
								key={group.key}
								plate={group.plate}
								brand={group.brand}
								// The header's right slot: the record COUNT on this truck — the card
								// carries no record line, its list is one tap away.
								countLabel={`${count} ${count === 1 ? 'record' : 'records'}`}
								items={items}
								onOpen={() => openTruck({ vehicleId, plate: group.plate, brand: group.brand })}
							/>
						);
					})}
				</ul>
			);
		},
		[openTruck, openRecord],
	);

	/** ONE toolbar-search hit — the SAME card the list shows: a truck-linked
	 *  record renders the truck card (tapping opens that truck's record list,
	 *  exactly like the list), an unlinked one stays its own record card. The old
	 *  flat renderer always opened the RECORD page, so search diverged from the
	 *  list it claims to mirror. */
	const renderHit = useCallback(
		(record: IncidentCardModel) => {
			const vehicleId = record.vehicleId;
			if (!vehicleId) return <IncidentCard key={record.id} record={record} onOpen={openRecord} />;
			return (
				<TruckGroupCard
					key={record.id}
					plate={record.plateNo}
					brand={record.brandLabel}
					countLabel="1 record"
					items={[record]}
					onOpen={() => openTruck({ vehicleId, plate: record.plateNo, brand: record.brandLabel })}
				/>
			);
		},
		[openTruck, openRecord],
	);

	return (
		<ListPage
			title="Accidents & Incidents"
			backTo="/app/incidents"
			rows={list.rows}
			isPending={list.isPending}
			isError={list.isError}
			onRetry={() => void list.refetch()}
			skeletonVariant="incidents"
			renderItem={renderHit}
			renderListBody={renderIncidentGroups}
			emptyState={EMPTY_STATE}
			pagination={{
				hasNextPage: list.hasNextPage,
				isFetchingNextPage: list.isFetchingNextPage,
				onLoadMore: () => void list.fetchNextPage(),
			}}
			searchPlaceholder="Search title / description / location"
			fetchSearch={(query) => fetchIncidentsSearch(query)}
			filter={{
				value: severityFilter,
				onChange: (value: IncidentSeverityFilterValue) => setView({ severity: value }),
				options: INCIDENT_SEVERITY_OPTIONS,
				centerLabel: INCIDENT_SEVERITY_LABELS[severityFilter],
				sheetTitle: 'Filter by severity',
				matches: (record, severity) => record.severity === severity,
				emptyTitle: 'No record matches this severity',
			}}
			centerText="incidents"
			create={{ to: '/app/incidents/+', label: 'Log record' }}
		/>
	);
}
