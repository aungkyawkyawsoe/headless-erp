import { useCallback, useMemo } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { TyreWheelPlan, type WheelView } from '../components/tyre-wheel-plan';
import { WearOnWheelPanel } from '../components/wear-on-wheel-panel';
import type { RegistryTab } from '../components/truck-inventory-list';
import { fetchHolderAssets } from '../data/api';
import { buildFleetBoard, type VehicleBoardState } from '../data/board';
import { qk, TYRE_STALE_MS } from '../data/query-keys';
import { useBoardChanged } from '../data/use-board-changed';
import { EmptyState } from '@/shared/components/empty-state';
import { ModuleShell } from '@/shared/components/module-shell';
import { ListSkeleton } from '@/shared/components/skeletons';
import { useVehicleMasters } from '@/shared/lookups/hooks';
import { URL_PARAM, enumParam, stringParam, useViewState } from '@/shared/url-state';

/** The body presentation (`?tab=`) — the app bar's rig/list switch. URL state, so a
 *  reload or a pasted link restores the same body (the sibling convention on the
 *  fluid vehicle page, `?tab=overview|history`). */
const WHEEL_VIEW = enumParam<WheelView>(['rig', 'list'], 'rig');

/** The on-board registry's active panel (`?scope=`) — the truck's whole ASSET
 *  register (tyres and equipment in ONE list) or its store REQUESTS. Tyres and
 *  equipment are not separate panels: they are two kinds of one answer. */
const BOARD_SCOPE = enumParam<RegistryTab>(['onboard', 'requests'], 'onboard');

/** This screen's URL view state — ONE container (see `useViewState`). `?serial=` is
 * the WEAR mode: this truck's rig is drawn as a seat picker for that one un-worn tyre
 *  (absent = the ordinary read-only board). */
const VEHICLE_PLAN_VIEW = {
	[URL_PARAM.tab]: WHEEL_VIEW,
	[URL_PARAM.scope]: BOARD_SCOPE,
	[URL_PARAM.serial]: stringParam,
} as const;

/**
 * တာယာ → ONE truck — the FULL-SCREEN wheel-position KIOSK (`/app/tyres/vehicle/:id`,
 * reached from a By Fleet plate match or the On vehicles browse-all board). This is
 * the former fitment BOTTOM SHEET promoted to a real page: the vehicle's declared
 * wheel layout is drawn in the page body as a READ-ONLY drawing — a filled tyre
 * states its measured depth, a VACANT seat is an inert gap, and the only control is a
 * fitted tyre's corner `✕` (the take-off page). The management verbs live in the LIST
 * body (`?tab=list`): tapping a row opens that unit's action MENU in a bottom sheet
 * (history / inspect / move / swap / take off / return / write off / transfer, plus
 * `Wear` for a tray spare).
 *
 * The body is DUAL — the rig drawing, or the truck's on-board registry list — and the
 * app bar's switch between them is VIEW state (`?tab=`), as is the list's panel
 * (`?scope=onboard|requests`), so a reload or a pasted link restores the same screen.
 * The standard back affordance returns to the search/board that opened it.
 *
 * The read is the SAME board assembly the fitment screen uses — the shared plate
 * master + this truck's WHOLE asset register in one `GET /api/mro/assets/holder`
 * read (seated tyres, standby spares, `assets`-flagged items), built into a single
 * row via `buildFleetBoard` and rendered by the shared `TyreWheelPlan`. Every
 * mutation this screen performs invalidates the holder register AND the affected
 * serials' history/snapshot caches (`qk`), so the board, its tread-band counts and
 * the serial lifecycle pages always agree.
 */
export default function TyreVehiclePage() {
	const { id } = useParams<{ id: string }>();
	// Rig vs flat list — VIEW state, so it lives in the URL (`?tab=`, replaced, never
	// pushed): a reload or a pasted link opens the same body, and the app bar's switch
	// leaves exactly one history entry behind. The registry's `?scope=` rides along in
	// the SAME container — one declaration for this screen's whole view.
	const [view, setView] = useViewState(VEHICLE_PLAN_VIEW);
	const { tab: wheelView, scope: boardScope } = view;

	// The plate master this page joins — the SHARED vehicle masters read.
	const vehicles = useVehicleMasters();
	const vehiclesReady = !vehicles.isPending;

	// The truck's WHOLE asset register in ONE read — seated tyres, standby spares
	// and `assets`-flagged items: `GET /api/mro/assets/holder?vehicle=`. The board is
	// derived from its seated tyres; the same spare/asset slices feed the on-board
	// list's sections (worn / un-worn / equipment) — ONE query, one view.
	const holderQuery = useQuery({
		queryKey: qk.holderAssetsOf(id ?? ''),
		queryFn: () => fetchHolderAssets({ vehicle: id ?? '' }),
		// NOT gated on the plate masters — this read takes only the vehicle id; the
		// board joins the masters at render, so firing both in PARALLEL avoids a
		// serial round trip before the truck's tyres/equipment appear.
		enabled: Boolean(id),
		staleTime: TYRE_STALE_MS,
	});

	// `holderQuery.data ?? []` allocates a NEW array every render, so the three
	// filters below would re-run on every unrelated re-render (react-hooks flags
	// exactly this). Memoize the fallback once so they depend on a stable value and
	// only recompute when the read actually changes.
	const holderAssets = useMemo(() => holderQuery.data ?? [], [holderQuery.data]);
	const mounted = useMemo(() => holderAssets.filter((unit) => unit.kind === 'tyre' && unit.slot != null), [holderAssets]);
	const tray = useMemo(() => holderAssets.filter((unit) => unit.kind === 'tyre' && unit.slot == null), [holderAssets]);
	const assets = useMemo(() => holderAssets.filter((unit) => unit.kind === 'asset'), [holderAssets]);

	const ready = vehiclesReady && !holderQuery.isPending;

	// The ONE board row for this vehicle id — null until the masters have loaded
	// OR when the plate carries no wheel layout (nothing to draw).
	const vehicle: VehicleBoardState | null = useMemo(() => {
		if (!id || !vehicles.data || !holderQuery.data) return null;
		return (
			buildFleetBoard(
				vehicles.data.filter((master) => master.id === id),
				mounted,
			)[0] ?? null
		);
	}, [id, vehicles.data, holderQuery.data, mounted]);

	// The app bar's second line — the same `brand · unit · N wheels` line the rig
	// reads under its plate (absent until the plate master resolves).
	const subtitle = vehicle
		? [vehicle.brandLabel, vehicle.unitLabel, `${vehicle.seats.length} wheels`].filter(Boolean).join(' · ')
		: undefined;

	// After a board mutation (fit / inspect / move / swap / return / scrap), drop
	// the cached holder register — the board + counts repaint from the fresh read —
	// and drop the changed serials' history + snapshot caches so their full pages
	// never narrate stale state. Active queries refetch immediately. The SAME
	// reaction runs on the action pages (`useBoardChanged`).
	const handleBoardChanged = useBoardChanged();

	// The WEAR mode (`?serial=`): the tray spare the list's `Wear` verb handed over.
	// It must still be an UN-WORN tyre of THIS truck's register — a stale id (the
	// spare got worn, moved or removed) simply leaves the ordinary board standing
	// rather than drawing a picker for a unit that is no longer here.
	const placing = useMemo(
		() => (view.serial ? (tray.find((unit) => unit.id === view.serial) ?? null) : null),
		[view.serial, tray],
	);

	// A successful fit leaves the mode: the board repaints with the tyre on its new
	// wheel (the param is cleared, so a reload lands on the read-only board).
	const handlePlaced = useCallback(
		(serialIds: readonly string[]) => {
			handleBoardChanged(serialIds);
			setView({ serial: null });
		},
		[handleBoardChanged, setView],
	);

	return (
		<ModuleShell
			title={vehicle?.plateNo ?? 'Vehicle fitment'}
			subtitle={subtitle}
			fill
			backTo="/app/tyres/fleet"
		>
			{!ready ? (
				<ListSkeleton variant="vehicle" count={3} />
			) : holderQuery.isError || vehicles.isError ? (
				<div className={`${CARD_FRAME} p-6 text-center`}>
					<p className="text-sm font-semibold text-foreground">Could not load this vehicle's wheel plan.</p>
					<button
						type="button"
						onClick={() => {
							void holderQuery.refetch();
							void vehicles.refetch();
						}}
						className="mt-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
					>
						Try again
					</button>
				</div>
			) : !vehicle ? (
				<EmptyState
					title="Vehicle not found"
					hint="This plate has no wheel layout on file, or the vehicle was removed from the fleet register."
				/>
			) : placing ? (
				/* WEAR ON A WHEEL POSITION — the same rig, reopened as a seat picker:
				   the `+` seats are the target, so the operator taps the wheel they can
				   SEE instead of decoding a seat code in a dialog. */
				<WearOnWheelPanel
					vehicle={vehicle}
					tyre={placing}
					onPlaced={handlePlaced}
					onCancel={() => setView({ serial: null })}
				/>
			) : (
				<TyreWheelPlan
					vehicle={vehicle}
					view={wheelView}
					onViewChange={(next) => setView({ tab: next })}
					segment={boardScope}
					onSegmentChange={(next) => setView({ scope: next })}
					mounted={mounted}
					tray={tray}
					assets={assets}
					/* The list's `Wear` verb hands the spare to the picker above — one tap
					   later the SAME rig is drawn with a `+` on every free wheel, and the
					   rig view is forced so the operator lands on the drawing. */
					onPlaceOnWheel={(unit) => setView({ serial: unit.id, tab: 'rig' })}
				/>
			)}
		</ModuleShell>
	);
}
