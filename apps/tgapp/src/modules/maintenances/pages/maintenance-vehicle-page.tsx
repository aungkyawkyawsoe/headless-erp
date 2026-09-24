import { useCallback, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LayoutList, Plus, RefreshCw, Truck } from 'lucide-react';

import { MaintenanceLogCard } from '../components/maintenance-log-card';
import { fetchTruckIdentity, fetchTruckMaintenancePage } from '../data/api';
import { MAINTENANCE_STALE_MS, qk } from '../data/query-keys';
import { useMaintenanceConfirm } from '../data/use-maintenance-confirm';
import type { MaintenanceLogCardModel, TruckMaintenanceSelection } from '../data/types';
import {
	BottomActionBar,
	GLASS_ICON_BUTTON,
	GLASS_ICON_BUTTON_ACTIVE,
	GLASS_ICON_BUTTON_IDLE,
	GLASS_PRIMARY_BUTTON,
} from '@/shared/components/bottom-action-bar';
import { ConfirmSheet } from '@/shared/components/confirm-sheet';
import { LoadMoreSentinel } from '@/shared/components/load-more-sentinel';
import { ModuleShell } from '@/shared/components/module-shell';
import { RecordHero } from '@/shared/components/record-hero';
import { SearchResultsList } from '@/shared/components/search-results-list';
import { ListSkeleton } from '@/shared/components/skeletons';
import { TruckImageCard } from '@/shared/components/truck-image-card';
import { useBarSearch } from '@/shared/hooks/use-bar-search';
import { useCursorList } from '@/shared/hooks/use-cursor-list';
import { hapticSelection } from '@/shared/platform/haptics';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';

/**
 * ပြင်ဆင် → ONE truck's maintenance file
 * (`/app/maintenances/vehicle/:id`, reached by a plate match on the kiosk or a
 * truck card on the register). The app bar shows the VEHICLE PLATE.
 *
 * ONE scroll, two views swapped by the bottom bar's list toggle (same pattern as
 * the tyres rig/list switch; `?tab=` is URL view state, default `overview`):
 *  1. **OVERVIEW** (default) — the truck PHOTO card, then the hero: the plate +
 *     the NEWEST job, so "what was last done" answers before any scrolling; tap →
 *     correct that job. No history is drawn — the file appears only when the
 *     list is asked for.
 *  2. **LIST** — the job cards ALONE (no photo, no hero): every job as its own
 *     SEPARATED card (expandable: breakdown, people, note, Edit/Confirm), with
 *     the km run since the previous job in the card header so the file still
 *     reads as a service-INTERVAL series rather than a stack of separate
 *     receipts.
 *
 * The truck photo rides the shared `veh_fleets` identity read (plate/brand/photo
 * in ONE fetch), so it shows on every open — a card tap only paints the header
 * instantly from router state while that read settles.
 *
 * Instant first paint: a card tap passes the truck identity through router STATE
 * (plate/brand), so the header paints before the shared identity read lands; deep
 * links carry no state and read the same `veh_fleets` row on open.
 */

/** This screen's URL view state — ONE container (see `useViewState`). The file
 *  opens on the OVERVIEW (hero only); the bottom bar's list toggle opens the
 *  history list. */
const FILE_VIEW = enumParam<'overview' | 'list'>(['overview', 'list'], 'overview');
const VEHICLE_FILE_VIEW = {
	[URL_PARAM.tab]: FILE_VIEW,
};

export default function MaintenanceVehiclePage() {
	const navigate = useNavigate();
	const location = useLocation();
	const { id } = useParams<{ id: string }>();

	const [view, setView] = useViewState(VEHICLE_FILE_VIEW);
	const showHistory = view[URL_PARAM.tab] === 'list';

	const routed = (location.state as { row?: TruckMaintenanceSelection } | null)?.row ?? null;

	// The truck's identity — plate/brand for the header AND the photo for the
	// hero's image, so the read runs on EVERY open (the router state only shortens
	// the first paint, never substitutes the read). ONE lean `veh_fleets` fetch,
	// cached under the shared master key, so repeat opens are instant.
	const identity = useQuery({
		queryKey: qk.fleet(id ?? ''),
		queryFn: () => fetchTruckIdentity(id as string),
		enabled: id != null && id !== '',
	});

	const file = useCursorList({
		queryKey: qk.truck(id ?? ''),
		fetcher: (cursor) => fetchTruckMaintenancePage(id as string, cursor),
		enabled: id != null && id !== '',
		staleTime: MAINTENANCE_STALE_MS,
	});

	const plate = routed?.plate ?? identity.data?.plate ?? null;
	const brand = routed?.brand ?? identity.data?.brand ?? null;
	const title = plate ?? 'Vehicle maintenance';
	/** The truck's photo — rides the shared identity read (`veh_fleets.image`),
	 *  so the hero's under-card shows the truck itself. */
	const truckImage = identity.data?.image ?? null;

	const rows = file.rows;
	const latest = rows[0] ?? null;
	const jobCountLabel = `${rows.length} job${rows.length === 1 ? '' : 's'}`;

	/** The km run since the PREVIOUS (older) job — the ledger's transition line.
	 *  Rows arrive newest-first, so a row's predecessor is the next entry. */
	const gaps = useMemo(() => {
		const map = new Map<string, number | null>();
		for (let i = 0; i < rows.length; i++) {
			const current = rows[i];
			const previous = rows[i + 1];
			map.set(current.id, current.odoKm != null && previous?.odoKm != null ? current.odoKm - previous.odoKm : null);
		}
		return map;
	}, [rows]);

	const openLog = useCallback(
		(log: MaintenanceLogCardModel) => {
			hapticSelection();
			navigate(`/app/maintenances/log/${log.id}`);
		},
		[navigate],
	);

	// Confirm — the draft gate. A confirmed row is frozen server-side, so its Edit
	// action is never rendered; the sheet just posts the row the operator picked.
	const [pending, setPending] = useState<MaintenanceLogCardModel | null>(null);
	const { busy: confirming, error: confirmError, confirm, reset: resetConfirm } = useMaintenanceConfirm();
	const requestConfirm = useCallback(
		(log: MaintenanceLogCardModel) => {
			resetConfirm();
			hapticSelection();
			setPending(log);
		},
		[resetConfirm],
	);
	const runConfirm = useCallback(() => {
		if (pending) void confirm(pending, () => setPending(null));
	}, [confirm, pending]);

	// The bar search narrows the already-loaded pages (one truck's file is small).
	const search = useBarSearch<MaintenanceLogCardModel>(
		'Search job / technician / note',
		useCallback(
			async (query: string) => {
				const q = query.toLowerCase();
				return rows.filter(
					(log) =>
						(log.issueTypeName ?? '').toLowerCase().includes(q) ||
						(log.jobCode ?? '').toLowerCase().includes(q) ||
						(log.technician ?? '').toLowerCase().includes(q) ||
						(log.note ?? '').toLowerCase().includes(q),
				);
			},
			[rows],
		),
	);

	const createTo = `/app/maintenances/+?vehicle=${encodeURIComponent(id ?? '')}`;

	return (
		<ModuleShell title={title} backTo="/app/maintenances">
			{search.open && search.query ? (
				<SearchResultsList
					query={search.query}
					searching={search.searching}
					results={search.results}
					error={search.error}
					onClear={search.clear}
					compact
					renderItem={(log) => (
						<MaintenanceLogCard
							key={log.id}
							log={log}
							kmSincePrevious={gaps.get(log.id)}
							onOpen={openLog}
							onConfirm={requestConfirm}
							confirming={pending?.id === log.id && confirming}
						/>
					)}
				/>
			) : file.isPending ? (
				<ListSkeleton variant="maintenance" count={3} />
			) : file.isError && rows.length === 0 ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-4 py-10 text-center">
					<p className="text-sm font-medium leading-myanmar text-status-danger">Couldn't load this truck's maintenance file.</p>
					<button
						type="button"
						onClick={() => void file.refetch()}
						className="flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
					>
						<RefreshCw className="size-3.5" strokeWidth={2.2} aria-hidden />
						Try again
					</button>
				</div>
			) : (
				<div className="flex flex-col gap-3">
					{showHistory ? (
						<section>
							<p className="mb-1.5 flex items-baseline justify-between gap-3 px-1">
								<span className="text-meta font-bold uppercase tracking-[0.14em] leading-none text-muted-foreground">Service history</span>
								<span className="text-meta font-medium leading-myanmar text-muted-foreground">{jobCountLabel}</span>
							</p>
							{rows.length === 0 ? (
								<div className="rounded-xl border border-dashed border-border px-3.5 py-6 text-center text-xs leading-myanmar text-muted-foreground">
									No maintenance on file — log the first job with the + button below.
								</div>
							) : (
								<ul className="flex flex-col gap-3">
									{rows.map((log) => (
										<MaintenanceLogCard
											key={log.id}
											log={log}
											kmSincePrevious={gaps.get(log.id)}
											onOpen={openLog}
											onConfirm={requestConfirm}
											confirming={pending?.id === log.id && confirming}
										/>
									))}
								</ul>
							)}
						</section>
					) : (
						<>
							{/* The truck photo — a square tile as wide as the hero card below (see
							   `TruckImageCard`, the same `veh_fleets.image` the fleet card tiles, a
							   truck glyph until one is uploaded). */}
							<TruckImageCard image={truckImage} alt={plate ?? 'Truck'} />

							{/* Hero — the truck and its most recent job (tap → correct it). The ONE
							   thing the overview draws alongside the photo. */}
							<RecordHero
								identity={plate ?? '—'}
								identitySub={brand}
								headline={latest?.issueTypeName ?? 'No maintenance on file'}
								facts={[{ label: 'Last job', value: latest?.rangeLabel ?? '—' }]}
								onOpen={latest && latest.docStatus !== 'confirmed' ? () => openLog(latest) : undefined}
								ariaLabel="Correct the latest job"
							/>
						</>
					)}

					{showHistory ? (
						<LoadMoreSentinel
							hasMore={file.hasNextPage}
							loading={file.isFetchingNextPage}
							onLoadMore={() => void file.fetchNextPage()}
							waitForScroll
						/>
					) : null}
				</div>
			)}

			{/* Room for the fixed bottom bar when the page is fully scrolled. */}
			<div className="h-24" aria-hidden />

			<BottomActionBar
				center={jobCountLabel}
				panel={search.panel}
				panelOpen={search.open}
				right={
					<div className="flex items-center gap-1.5">
						{search.button}
						<button type="button" onClick={() => navigate(createTo)} aria-label="New maintenance log" className={GLASS_PRIMARY_BUTTON}>
							<Plus className="size-5" aria-hidden />
						</button>
						<button
							type="button"
							onClick={() => {
								hapticSelection();
								setView({ tab: showHistory ? 'overview' : 'list' });
							}}
							aria-label={showHistory ? 'Show the truck overview' : 'Show the service history'}
							aria-pressed={showHistory}
							className={`${GLASS_ICON_BUTTON} ${showHistory ? GLASS_ICON_BUTTON_ACTIVE : GLASS_ICON_BUTTON_IDLE}`}
						>
							{showHistory ? <Truck className="size-5" aria-hidden /> : <LayoutList className="size-5" aria-hidden />}
						</button>
					</div>
				}
			/>

			<ConfirmSheet
				open={pending != null}
				title="Confirm this job?"
				description="Once confirmed the record is final — it can no longer be edited from the app."
				confirmLabel="Confirm job"
				busy={confirming}
				error={confirmError}
				onConfirm={runConfirm}
				onClose={() => setPending(null)}
			/>
		</ModuleShell>
	);
}
