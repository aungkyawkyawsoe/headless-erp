import { useCallback, useState } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutList, Plus, RefreshCw, X } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';

import { FluidFillRowCard } from '../components/fluid-history';
import { confirmFluidFill, fetchFluidFleetIdentity, fetchFluidHistoryPage } from '../data/api';
import { KIND_FILTER, KIND_TABS } from '../data/kinds';
import { qk } from '../data/query-keys';
import type { FluidFillHistoryModel, FluidKind, FluidListModel } from '../data/types';
import { kmLeftOf } from '@/modules/fleets/data/care';
import { FLUID_KIND_LABELS, KM_LEFT_TONE_CLASS, kmLeftShort, kmLeftTone } from '@/modules/fleets/data/status';
import { qk as fleetsQk } from '@/modules/fleets/data/query-keys';
import {
	BottomActionBar,
	GLASS_ICON_BUTTON,
	GLASS_ICON_BUTTON_ACTIVE,
	GLASS_ICON_BUTTON_IDLE,
	GLASS_PRIMARY_BUTTON,
} from '@/shared/components/bottom-action-bar';
import { ListPage } from '@/shared/components/list-page';
import { ModuleShell } from '@/shared/components/module-shell';
import { RecordHero } from '@/shared/components/record-hero';
import { SegmentedTabs } from '@/shared/components/segmented-tabs';
import { Shimmer } from '@/shared/components/skeletons';
import { TruckImageCard } from '@/shared/components/truck-image-card';
import { popBack } from '@/shared/platform/history';
import { isNewestRecord } from '@/shared/records/newest';
import { listPageErrorProps, useCursorList } from '@/shared/hooks/use-cursor-list';
import { hapticImpact } from '@/shared/platform/haptics';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';

/** The page's TWO views — the vehicle OVERVIEW (photo + the kind's standing,
 *  the default) and the kind's FILL HISTORY list. The bottom bar's + opens the
 *  record/create PAGE (`/app/fluid/+`), its list button opens the history; each
 *  press again folds back to the overview. */
type VehicleView = 'overview' | 'history';

/** The view is URL state (`?tab=`), the sibling convention: a reload keeps the
 *  open view and the bar toggle replaces (no stray history entries). The default
 *  is the OVERVIEW (photo + hero); the history list appears only when its bar
 *  button opens it. */
const VEHICLE_VIEW = enumParam<VehicleView>(['overview', 'history'], 'overview');

/** The page's URL view state — one schema (see `useViewState`). */
const FLUID_VEHICLE_VIEW = {
	[URL_PARAM.type]: KIND_FILTER,
	[URL_PARAM.tab]: VEHICLE_VIEW,
} as const;

/**
 * Fluid — ONE vehicle's full-screen service page (`/app/fluid/:id`, reached by
 * tapping a row on the Fluid list). The app bar shows the VEHICLE PLATE (not
 * "Fluid") so the page stays identifiable at a glance.
 *
 * Instant first paint: the tapped row arrives through router STATE (it holds the
 * plate + brand the header needs AND the vehicle's current odo from the list
 * read), so the OVERVIEW paints the header before its reads settle. Two lean
 * reads run on every open: the shared `veh_fleets` identity (the truck PHOTO +
 * header) and the ACTIVE kind's first `veh_fluid_fills` page (the hero's
 * last-service / next-due facts). Deep links / refreshes carry no state, so they
 * rely on the same `veh_fleets` read for the header + photo (see
 * `fetchFluidFleetIdentity`).
 *
 * Engine oil and Gear oil are TABS (`?type=`), not stacked sections — the page
 * manages ONE kind at a time. The kind has TWO views (the bottom bar's list
 * toggle swaps them; the bar's + opens the separate RECORD page):
 *
 *  1. OVERVIEW (the default on open) — the kind tabs + the vehicle photo and the
 *     kind's standing (last service / next due). Nothing else is drawn until a
 *     bar button asks for it.
 *  2. HISTORY (the bar's list toggle) — the kind's past FILLS as its own cards
 *     (one card per fill), CURSOR-PAGINATED and LAZY: page 1 loads as the view
 *     opens, next pages stream as the user scrolls; no photo, no hero. The bar
 *     search filters the loaded fills.
 *
 * The bar's + does NOT open a view here — it navigates to the RECORD PAGE
 * (`/app/fluid/+?vehicle=&type=`), a full-page create form whose save is the
 * native Telegram MainButton (see `fluid-create-page.tsx`).
 *
 * Every save writes a `veh_fluid_fills` row, then invalidates the ACTIVE kind's
 * history, the Fluid list and the fleet master list — the fleet cards' fill/odo-
 * derived care chips refresh the moment the user returns to /app/fleets. Lists
 * that are NOT mounted (the Fluid list + fleet list live on other routes) are
 * stale-marked only (`refetchType: 'none'`): they refetch once on the user's
 * next visit instead of refetching every cached page in the background here.
 */
export default function FluidVehiclePage() {
	const navigate = useNavigate();
	const location = useLocation();
	const queryClient = useQueryClient();
	const { id } = useParams<{ id: string }>();
	const [viewState, setViewState] = useViewState(FLUID_VEHICLE_VIEW);
	const { type: kind, tab: view } = viewState;

	// The fill awaiting a confirm decision — the bottom sheet flips its engine
	// `doc_status` to approved (the card's Confirm opens it; see below).
	const [confirmTarget, setConfirmTarget] = useState<FluidFillHistoryModel | null>(null);
	const [confirming, setConfirming] = useState(false);
	const [confirmError, setConfirmError] = useState<string | null>(null);

	// The tapped list row — identity only (plate/brand). Deep links carry none, so
	// a lean fleet read backs those. Preferring state over a fetch is what removes
	// the spurious `veh_fleets?...&filter[id]=...` call on every card tap.
	const routed = (location.state as { row?: FluidListModel } | null)?.row ?? null;

	// The truck's identity — plate/brand for the header AND the PHOTO that leads
	// the page, so the read runs on EVERY open (a card tap only shortens the first
	// paint from router state, never substitutes the read). ONE lean `veh_fleets`
	// fetch, cached under the shared master key.
	const fleetIdentity = useQuery({
		queryKey: qk.fleet(id ?? ''),
		queryFn: () => fetchFluidFleetIdentity(id as string),
		enabled: id != null && id !== '',
	});

	// The ACTIVE kind's paged fill history — the page's ONLY reads are its rows
	// (the fill log itself), loaded on every open so the OVERVIEW hero can name
	// the kind's last service / next due (the page's "belonging item") AND the
	// record form's previous-interval hint is ready. Keyed per (vehicle, kind) so
	// each tab keeps its own pages.
	const history = useCursorList({
		queryKey: qk.history(id ?? '', kind),
		fetcher: (cursor) => fetchFluidHistoryPage(id as string, kind, cursor),
		enabled: id != null && id !== '',
	});

	// Identity is ready when the tapped list row carried it, or the lean fleet
	// read settled — the header/hero need only the plate (the record PAGE reads
	// its own odo prefill).
	const identityReady = id != null && id !== '' && (routed != null || (fleetIdentity.data?.plateNo != null && !fleetIdentity.isPending));
	const plateNo = (routed?.plateNo ?? fleetIdentity.data?.plateNo ?? '').trim();
	const brand = routed?.brandLabel ?? fleetIdentity.data?.brandLabel ?? null;

	// The ACTIVE kind's newest fill — the OVERVIEW hero's last-service / next-due
	// facts (the record page reads the previous interval itself).
	const newestFill = history.rows[0] ?? null;

	// The vehicle's current odometer — the tapped row's read, else the shared
	// identity read's `last_odo` (a deep link carries no router state).
	const currentOdo = routed?.currentOdo ?? fleetIdentity.data?.lastOdo ?? null;
	// Km left until the ACTIVE kind's next service — `next due − current odo`, the
	// SAME arithmetic the fleet/fluid list chips use (`kmLeftOf`). Null until both
	// inputs exist (the hero's top-right pill simply does not draw).
	const kmLeft = kmLeftOf(newestFill?.nextDueOdo ?? null, currentOdo);

	// A fill save changes the ACTIVE kind's history (new top fill + count) and
	// everything that renders km-left from it — the Fluid list chips and the FLEET
	// list chips. The odometer anchor is untouched by a fill (only a Daily ODO
	// write changes it), so it is deliberately NOT invalidated here.
	//
	// The unmounted LISTS (Fluid list + fleet list live on other routes) are
	// STALE-MARKED only (`refetchType: 'none'`): refetching them here (refetchType
	// 'all') burned a full read cycle PER CACHED PAGE of each infinite list
	// (`veh_fleets` + /api/query + care reads × loaded pages) on every save,
	// for screens the user isn't even looking at. Invalidated queries refetch on
	// mount, so the chips are still fresh the moment the user navigates back.
	const invalidate = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: qk.history(id ?? '', kind), refetchType: 'active' });
		void queryClient.invalidateQueries({ queryKey: qk.list(), refetchType: 'none' });
		void queryClient.invalidateQueries({ queryKey: fleetsQk.fleets(), refetchType: 'none' });
	}, [queryClient, id, kind]);

	// The app bar titles the VEHICLE PLATE (not "Fluid") — a plain string so the
	// browser/document title stays clean (ModuleShell sets document.title).
	const title = identityReady && plateNo ? plateNo : 'Fluid';

	// The bottom bar's + opens the RECORD page — a real route (`/app/fluid/+`)
	// bound to this truck + kind, so the form is a full page whose save is the
	// native MainButton (there is no in-page bar there to overlap it).
	const openRecord = useCallback(() => {
		if (!id) return;
		navigate(`/app/fluid/+?${URL_PARAM.vehicle}=${id}&${URL_PARAM.type}=${kind}`);
	}, [navigate, id, kind]);

	// The CORRECTION action — only the NEWEST fill of the active kind is editable;
	// older service history stays read-only.
	const handleEdit = useCallback((fill: FluidFillHistoryModel) => navigate(`/app/fluid/fill/${fill.id}`), [navigate]);

	// HISTORY rows — one compact card per fill (shared by the list + the toolbar
	// search results, so results always match the list). A PENDING fill's Confirm
	// action opens the decision sheet below; the newest fill offers Edit.
	const renderItem = useCallback(
		(fill: FluidFillHistoryModel) => (
			<FluidFillRowCard
				key={fill.id}
				fill={fill}
				onEdit={isNewestRecord(history.rows, fill.id) ? handleEdit : undefined}
				onConfirm={(row) => {
					hapticImpact('light');
					setConfirmTarget(row);
					setConfirmError(null);
				}}
			/>
		),
		[history.rows, handleEdit],
	);

	// Confirm — walk the engine `doc_status` ladder to `approved` (the engine
	// validates every hop + the actor's approve permission server-side), then
	// refresh this kind's history so the card flips to Confirmed.
	const runConfirm = async () => {
		if (!confirmTarget || confirming) return;
		const target = confirmTarget;
		setConfirming(true);
		setConfirmError(null);
		try {
			await confirmFluidFill(target.id, target.docStatus);
			hapticImpact('medium');
			invalidate();
			setConfirmTarget(null);
		} catch (err) {
			console.error('[fluids] fill confirm failed', err);
			setConfirmError(err instanceof Error && err.message ? err.message : "Couldn't confirm this fill — try again.");
		} finally {
			setConfirming(false);
		}
	};

	// Without identity (deep link still loading/switching) keep the loading shell;
	// Client-side search over the loaded history rows (there is no server-side
	// fill search endpoint — the bar search narrows what is already read).
	const fetchSearch = useCallback(
		async (query: string) => {
			const q = query.toLowerCase();
			return history.rows.filter((row) => row.createdLabel?.toLowerCase().includes(q));
		},
		[history.rows],
	);

	// Without identity (deep link still loading/switching) keep the loading shell;
	// an identity read that fails offers Retry. The tap path resolves identity
	// immediately from the routed row, so it never shows this first shell.
	if (!identityReady) {
		return (
			<ModuleShell title={title} backTo="/app/fluid">
				{routed == null && fleetIdentity.isPending ? (
					<FluidBoardShimmer />
				) : (
					<FluidErrorState onRetry={() => void fleetIdentity.refetch()} onBack={() => popBack(navigate, '/app/fluid')} />
				)}
			</ModuleShell>
		);
	}

	// ── OVERVIEW view — the vehicle photo + the kind's standing ──────────────
	if (view === 'overview') {
		return (
			<ModuleShell title={title} backTo="/app/fluid">
				<div className="flex flex-col gap-3">
					<SegmentedTabs options={KIND_TABS} value={kind} onChange={(value) => setViewState({ type: value })} ariaLabel="Fluid type" />
					<VehicleHero
						identity={plateNo}
						image={fleetIdentity.data?.image ?? null}
						brand={brand}
						kind={kind}
						newestFill={newestFill}
						kmLeft={kmLeft}
					/>
				</div>

				{/* Room for the fixed bottom bar when the page is fully scrolled. */}
				<div className="h-24" aria-hidden />

				<BottomActionBar
					center={FLUID_KIND_LABELS[kind]}
					right={
						<div className="flex items-center gap-1.5">
							<button
								type="button"
								onClick={openRecord}
								aria-label={`Record ${FLUID_KIND_LABELS[kind].toLowerCase()} fill`}
								aria-pressed={false}
								className={GLASS_PRIMARY_BUTTON}
							>
								<Plus className="size-5" aria-hidden />
							</button>
							<button
								type="button"
								onClick={() => setViewState({ tab: 'history' })}
								aria-label={`${FLUID_KIND_LABELS[kind]} fill history`}
								aria-pressed={false}
								className={`${GLASS_ICON_BUTTON} ${GLASS_ICON_BUTTON_IDLE}`}
							>
								<LayoutList className="size-5" aria-hidden />
							</button>
						</div>
					}
				/>
			</ModuleShell>
		);
	}

	// ── HISTORY view — the kind's fills as the standard list page ────────────
	return (
		<>
			<ListPage
				{...listPageErrorProps(history)}
				title={title}
				backTo="/app/fluid"
				rows={history.rows}
				isPending={history.isPending}
				skeletonVariant="vehicle"
				renderItem={renderItem}
				emptyState={{
					title: 'No fills yet',
					hint: 'Record the first service with the + button on this screen.',
				}}
				pagination={{
					hasNextPage: history.hasNextPage,
					isFetchingNextPage: history.isFetchingNextPage,
					onLoadMore: () => void history.fetchNextPage(),
					waitForScroll: true,
				}}
				searchPlaceholder="Search history"
				fetchSearch={fetchSearch}
				centerText={FLUID_KIND_LABELS[kind]}
				rightExtra={
					<div className="flex items-center gap-1.5">
						<button
							type="button"
							onClick={openRecord}
							aria-label={`Record ${FLUID_KIND_LABELS[kind].toLowerCase()} fill`}
							aria-pressed={false}
							className={GLASS_PRIMARY_BUTTON}
						>
							<Plus className="size-5" aria-hidden />
						</button>
						<button
							type="button"
							onClick={() => setViewState({ tab: 'overview' })}
							aria-label={`${FLUID_KIND_LABELS[kind]} fill history`}
							aria-pressed
							className={`${GLASS_ICON_BUTTON} ${GLASS_ICON_BUTTON_ACTIVE}`}
						>
							<LayoutList className="size-5" aria-hidden />
						</button>
					</div>
				}
				subheader={
					<SegmentedTabs options={KIND_TABS} value={kind} onChange={(value) => setViewState({ type: value })} ariaLabel="Fluid type" />
				}
			/>

			{/* Confirm decision sheet — a PENDING row's Confirm action lands here. */}
			<Sheet
				open={confirmTarget !== null}
				onOpenChange={(open) => {
					if (!open) setConfirmTarget(null);
				}}
			>
				<SheetContent side="bottom" showCloseButton={false} className="rounded-t-3xl">
					<SheetHeader className="flex-row items-center justify-between gap-3 pb-1">
						<SheetTitle className="text-base leading-myanmar">Confirm {FLUID_KIND_LABELS[kind].toLowerCase()} fill?</SheetTitle>
						<button
							type="button"
							onClick={() => setConfirmTarget(null)}
							aria-label="Close"
							className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground active:scale-90"
						>
							<X className="size-4" aria-hidden />
						</button>
					</SheetHeader>

					<div className="max-h-[62dvh] overflow-y-auto overscroll-contain px-4">
						{confirmTarget ? (
							<p className="text-sm leading-myanmar text-muted-foreground">
								{confirmTarget.createdLabel ?? '—'} · {confirmTarget.odo?.toLocaleString() ?? '—'} km · due{' '}
								{confirmTarget.nextDueOdo?.toLocaleString() ?? '—'} km
								{confirmTarget.qtyLiters != null ? ` · ${confirmTarget.qtyLiters} L` : ''}
							</p>
						) : null}
						{confirmError && (
							<p
								role="alert"
								className="mt-3 rounded-md bg-status-danger-soft px-3 py-2 text-xs font-medium leading-myanmar text-status-danger"
							>
								{confirmError}
							</p>
						)}
					</div>

					<div className="flex items-center gap-3 px-4 pt-1 pb-safe">
						<button
							type="button"
							onClick={() => setConfirmTarget(null)}
							disabled={confirming}
							className="flex-1 rounded-full border border-border bg-background px-4 py-2.5 text-sm font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95 disabled:opacity-50"
						>
							Not now
						</button>
						<button
							type="button"
							onClick={() => void runConfirm()}
							disabled={confirming}
							className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-bold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95 disabled:opacity-40 disabled:active:scale-100"
						>
							{confirming ? 'Confirming…' : 'Confirm'}
						</button>
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
}

/** The page's shared error fallback — a Retry back to the list, shown when the
 *  vehicle is missing or its fluid anchor could not be loaded. */
function FluidErrorState({ onRetry, onBack }: { onRetry: () => void; onBack: () => void }) {
	return (
		<div className="flex flex-1 flex-col items-center gap-3 px-4 pt-16 text-center">
			<p className="text-sm font-medium leading-myanmar text-status-danger">Could not load this vehicle's fluid board.</p>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={onRetry}
					className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
				>
					<RefreshCw className="size-3.5" strokeWidth={2.2} aria-hidden />
					Retry
				</button>
				<button
					type="button"
					onClick={onBack}
					className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
				>
					Back to list
				</button>
			</div>
		</div>
	);
}

/** The board's loading shimmer — the vehicle page's pre-identity skeleton. */
function FluidBoardShimmer() {
	return (
		<div aria-hidden className="flex flex-col gap-3">
			{Array.from({ length: 3 }).map((_, i) => (
				<div key={i} className={`${CARD_FRAME} p-3 shadow-card`}>
					<Shimmer className="h-4 w-1/3 rounded" />
					<Shimmer className="mt-2.5 h-6 w-1/2 rounded" />
					<Shimmer className="mt-2 h-3 w-3/4 rounded" />
				</div>
			))}
		</div>
	);
}

/** The vehicle hero — the truck photo, then the kind's standing (the "belonging
 *  item" the OVERVIEW leads with). `newestFill` is the ACTIVE kind's newest
 *  history row — `—` until that read settles (the fill file itself is the
 *  HISTORY view). */
function VehicleHero({
	identity,
	image,
	brand,
	kind,
	newestFill,
	kmLeft,
}: {
	identity: string;
	image: string | null;
	brand: string | null;
	kind: FluidKind;
	newestFill: FluidFillHistoryModel | null;
	kmLeft: number | null;
}) {
	return (
		<>
			{/* The truck photo — a square tile (see `TruckImageCard`), riding the
			   shared identity read (`veh_fleets.image`). */}
			<TruckImageCard image={image} alt={identity || 'Truck'} />

			<RecordHero
				identity={identity || '—'}
				identitySub={brand}
				headline={FLUID_KIND_LABELS[kind]}
				status={
					kmLeft != null ? (
						<span
							className={`shrink-0 rounded-full px-3 py-0.5 text-meta font-semibold leading-myanmar ${KM_LEFT_TONE_CLASS[kmLeftTone(kmLeft)]}`}
						>
							{kmLeftShort(kmLeft)}
						</span>
					) : undefined
				}
				facts={[
					{ label: 'Last service', value: newestFill?.odo != null ? `${newestFill.odo.toLocaleString()} km` : '—' },
					{ label: 'Next due', value: newestFill?.nextDueOdo != null ? `${newestFill.nextDueOdo.toLocaleString()} km` : '—' },
				]}
			/>
		</>
	);
}
