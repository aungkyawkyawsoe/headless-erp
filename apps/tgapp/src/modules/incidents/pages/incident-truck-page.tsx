import { useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, RefreshCw } from 'lucide-react';

import { IncidentHistoryCard } from '../components/incident-history-card';
import { fetchTruckIdentity, fetchTruckIncidentPage } from '../data/api';
import { INCIDENTS_STALE_MS, qk } from '../data/query-keys';
import { KIND_META } from '../data/status';
import type { IncidentCardModel, TruckIncidentSelection } from '../data/types';
import { GLASS_PRIMARY_BUTTON } from '@/shared/components/bottom-action-bar';
import { ListPage } from '@/shared/components/list-page';
import { ModuleShell } from '@/shared/components/module-shell';
import { ListSkeleton } from '@/shared/components/skeletons';
import { useCursorList } from '@/shared/hooks/use-cursor-list';
import { popBack } from '@/shared/platform/history';

/**
 * Accidents & Incidents — ONE truck's full-screen page
 * (`/app/incidents/vehicle/:id`, reached by tapping a truck card on the register
 * `/app/incidents/browse` or from the kiosk search): the truck photo card, then
 * the hero: the plate + the NEWEST record, so "what was last reported" answers
 * before any scrolling (tap → correct that record), then the truck's complete
 * accident/incident file as its own list-page rows (one EXPANDABLE event card
 * per record, NEWEST first), CURSOR-PAGINATED and lazy-loaded. Tapping a card
 * reveals the record's details inline; the Edit action inside goes to its
 * prefilled form (`/app/incidents/record/:id`, the same screen the register's
 * cards open). The bar's + NAVIGATES to the truck's dedicated LOG page
 * (`/app/incidents/vehicle/:id/log`) — full-screen with NO bottom toolbar and a
 * native MainButton Save; the bar search narrows the loaded records.
 *
 * Zero-extra-call opening: the tapped truck arrives through router STATE (it
 * holds the plate/brand the header needs) so only the record-file read runs on
 * open — never a fleet read on the tap path's FIRST paint. The ONE read that
 * does run on every open is the shared `veh_fleets` identity, because the truck
 * PHOTO leads the page (the router state only shortens that first paint, never
 * substitutes the read). Deep links / refreshes carry no state, so they rely on
 * the same lean `veh_fleets` read for the header + photo (see
 * `fetchTruckIdentity`).
 */
export default function IncidentTruckPage() {
	const navigate = useNavigate();
	const location = useLocation();
	const { id } = useParams<{ id: string }>();

	// The tapped truck — identity only (plate/brand). Deep links carry none, so a
	// lean fleet read backs those. Preferring state over a fetch is what removes
	// the spurious `veh_fleets` read on every card tap.
	const routed = (location.state as { row?: TruckIncidentSelection } | null)?.row ?? null;

	// The truck's identity — plate/brand for the header AND the PHOTO that leads
	// the page, so the read runs on EVERY open (a card tap only shortens the first
	// paint from router state, never substitutes the read). ONE lean `veh_fleets`
	// fetch, cached under the shared master key.
	const identity = useQuery({
		queryKey: qk.fleet(id ?? ''),
		queryFn: () => fetchTruckIdentity(id as string),
		enabled: id != null && id !== '',
	});

	// The truck's paged record file — the page's ONLY read is the record log
	// itself, loaded so the truck's records show the moment it opens. Keyed per
	// vehicle so each truck keeps its own pages; a save invalidates the prefix so
	// the new record leads the list.
	const file = useCursorList({
		queryKey: qk.truck(id ?? ''),
		fetcher: (cursor) => fetchTruckIncidentPage(id as string, cursor),
		enabled: id != null && id !== '',
		staleTime: INCIDENTS_STALE_MS,
	});

	// Whether the truck's record file has been read this session — the bar's
	// center pill stays neutral until it loads.
	const fileRead = file.data != null;

	// Identity — known the moment the tapped row lands, or after a deep-link
	// fleet read resolves. The app-bar title depends on it, so a loading id keeps
	// the page in its loading shell until ready.
	const identityReady = id != null && id !== '' && (routed != null || (identity.data != null && !identity.isPending));
	const plate = routed?.plate ?? identity.data?.plate ?? null;
	const title = identityReady && plate ? plate : 'Incidents';
	const vehicleId = id as string;

	// The bottom bar's center pill — the size of the truck's loaded record file.
	// Before the list has been read it shows the neutral module label; once
	// loaded: "3 records" / "No records".
	const recordsLabel =
		!fileRead || file.isPending
			? 'Incidents'
			: file.rows.length === 0
				? 'No records'
				: `${file.rows.length} ${file.rows.length === 1 ? 'record' : 'records'}`;

	// The event card's Edit action opens that record's edit form
	// (`/app/incidents/record/:id`) — the same prefilled screen the register's
	// search-result cards open. The edit screen's back pop returns here to the
	// truck's list.
	const openRecord = useCallback(
		(record: IncidentCardModel) => {
			navigate(`/app/incidents/record/${record.id}`);
		},
		[navigate],
	);

	// One event card per row — hoisted so its identity is stable (used by the list
	// and the toolbar search results alike); each card expands its details inline
	// and offers the Edit action.
	const renderRecord = useCallback(
		(record: IncidentCardModel) => <IncidentHistoryCard key={record.id} record={record} onOpen={openRecord} />,
		[openRecord],
	);

	// Client-side search over the loaded file rows (the truck's file is read in
	// pages — the bar search narrows what is already read, like the Fluid page).
	const fetchSearch = useCallback(
		async (query: string) => {
			const q = query.toLowerCase();
			return file.rows.filter(
				(record) =>
					(record.description ?? '').toLowerCase().includes(q) ||
					(record.location ?? '').toLowerCase().includes(q) ||
					(record.dateLabel ?? '').toLowerCase().includes(q) ||
					(KIND_META[record.kind] ?? KIND_META.incident).label.toLowerCase().includes(q),
			);
		},
		[file.rows],
	);

	if (!identityReady) {
		return (
			<ModuleShell title={title} backTo="/app/incidents/browse">
				{routed == null && identity.isPending ? (
					// The truck identity is still resolving on a deep link — mirror the LIST
					// rows the page opens on.
					<ListSkeleton variant="incidents" />
				) : (
					<div className="flex flex-1 flex-col items-center gap-3 px-4 pt-16 text-center">
						<p className="text-sm font-medium leading-myanmar text-status-danger">Could not load this truck.</p>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => void identity.refetch()}
								className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
							>
								<RefreshCw className="size-3.5" strokeWidth={2.2} aria-hidden />
								Retry
							</button>
							<button
								type="button"
								onClick={() => popBack(navigate, '/app/incidents/browse')}
								className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
							>
								Back to list
							</button>
						</div>
					</div>
				)}
			</ModuleShell>
		);
	}

	// ── The truck's records as the standard list page ─────────────────────────
	return (
		<ListPage
			title={title}
			backTo="/app/incidents/browse"
			rows={file.rows}
			isPending={file.isPending}
			isError={file.isError}
			onRetry={() => void file.refetch()}
			skeletonVariant="incidents"
			renderItem={renderRecord}
			emptyState={{
				title: 'No records yet',
				hint: 'Log the first accident or incident with the + button on this screen.',
			}}
			pagination={{
				hasNextPage: file.hasNextPage,
				isFetchingNextPage: file.isFetchingNextPage,
				onLoadMore: () => void file.fetchNextPage(),
				waitForScroll: true,
			}}
			searchPlaceholder="Search title / description / location"
			fetchSearch={fetchSearch}
			centerText={recordsLabel}
			rightExtra={
				<button
					type="button"
					onClick={() => navigate(`/app/incidents/vehicle/${vehicleId}/log`)}
					aria-label="Log record"
					className={GLASS_PRIMARY_BUTTON}
				>
					<Plus className="size-5" aria-hidden />
				</button>
			}
		/>
	);
}
