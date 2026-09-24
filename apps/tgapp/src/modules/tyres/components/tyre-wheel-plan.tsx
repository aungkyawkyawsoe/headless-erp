import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronUp, LayoutList, Link2, Plus, Search, Truck, X } from 'lucide-react';
import {
	BottomActionBar,
	GLASS_ICON_BUTTON,
	GLASS_ICON_BUTTON_ACTIVE,
	GLASS_ICON_BUTTON_IDLE,
	GLASS_PRIMARY_BUTTON,
} from '@/shared/components/bottom-action-bar';
import { TruckInventoryList, matchesQuery, type BoardSegment, type RegistryTab } from './truck-inventory-list';
import type { TyreCardModel } from '../data/types';
import type { VehicleBoardState } from '../data/board';
import type { VehWheelSeat } from '../data/spec';
import { axleRowsOf, type AxleRow, type WheelOnAxle } from '../data/layout';
import { remainingTreadPercent, treadBandOf, TREAD_BAND_META, type TreadBand } from '../data/readings';
import { hapticSelection } from '@/shared/platform/haptics';

/**
 * The tyre wheel-position PLAN — one vehicle's full-screen management board
 * (`/app/tyres/vehicle/:id`). The declared axle rows are drawn as a chassis map
 * (front axle on top, left/right wheels around the centre rail), each seat filled
 * by its mounted serial tyre or left as a dashed vacant gap.
 *
 * The page reads top-to-bottom like the truck itself:
 *
 *   · RIG (default) — the 4-cell KPI summary (Good / Warning / Replace / **Empty** —
 *     a vacant wheel is itself a defect, so it is counted, not ignored) leads from
 *     the top; then "On the wheels · equipped" + a fitted count; then the rig
 *  region, which owns the scrolling; and the SAME glass bottom bar as the list —
 *  on-board count, a search that DIMS non-matching tyres (the drawing stays
 *  truthful, matches pop), the store request, and the rig/list switch at the far
 *  right edge.
 *   · LIST — the bottom bar's switch swaps the body for the ON-BOARD REGISTRY
 *     (`TruckInventoryList`): the truck's whole inventory as `Tyre` / `Equipment`
 *     tabs, worn tyres first, un-worn + tools muted, the same KPI summary on top.
 *
 * The rig is a READ-ONLY drawing: neither a FILLED tyre nor a VACANT seat is a tap
 * target, so a wheel can only state what is fitted. Management lives in the LIST
 * view (the bottom bar's switch), where tapping a row opens that unit's action MENU
 * in a bottom sheet. The rig keeps ONE deliberate shortcut — a fitted tile's corner
 * `✕`, which opens the take-off page directly (one writer per action).
 *
 * A filled tyre tile shows its MEASURED tread (mm) + remaining-% against the SKU
 * reference when a real `checked` reading exists (measurement-only, never an
 * estimate), and is tinted by its tread band (≥5 mm green / 3–5 amber / <3 red).
 * Un-worn tyres and equipment are GREY — colour is reserved for a live safety
 * state on a wheel. Every mutation goes through the engine writers (fit/return/
 * scrap/swap append immutable `mro_serial_events` rows); the page invalidates the
 * mounted board + affected serials' history so the board, the counts and the
 * serial pages agree.
 */
interface TyreWheelPlanProps {
	vehicle: VehicleBoardState;
	/** The rig ↔ flat-list presentation — VIEW state (`?tab=`), OWNED BY THE PAGE.
	 *  The switch itself lives in the shared bottom bar, so it is threaded (not
	 *  owned) here. */
	view: WheelView;
	/** Switch the rig ↔ list presentation (a URL write — replace, never push). */
	onViewChange: (view: WheelView) => void;
	/** The on-board registry's active tab — VIEW state (`?scope=`), owned by the
	 *  page so the store requisition deep-link carries the same canonical key (only
	 *  the two asset scopes are a valid request scope; `requests` is the truck's
	 *  requisition list). */
	segment: RegistryTab;
	/** Switch the registry's active tab (a URL write — replace, never push). */
	onSegmentChange: (segment: RegistryTab) => void;
	/** This truck's mounted tyres — the swap partner picker (a swap never crosses trucks). */
	mounted: TyreCardModel[];
	/** Hand an un-worn tyre to the WEAR flow — the page reopens this same truck's rig as
	 *  a seat picker (`?serial=<unit id>`): the list's `Wear` verb, the one place a
	 *  free wheel is named (`WheelSeatPicker`), never a chip list of seat codes. */
	onPlaceOnWheel: (unit: TyreCardModel) => void;
	/** This truck's un-worn tyres — the units riding it but NOT seated on a
	 *  wheel (read from the one holder register). The LIST view's un-worn section. */
	tray?: TyreCardModel[];
	/** This truck's other held ASSETS — `assets`-flagged units (a jack, a toolbox)
	 *  read from the same holder register. The LIST view's Equipment tab. */
	assets?: TyreCardModel[];
}

/** The two ways the truck is drawn: the chassis rig, or its inventory as a list. */
export type WheelView = 'rig' | 'list';

/** The rig/list switch. It lives in the SHARED bottom bar — the one toolbar both
 *  bodies carry — as the RIGHTMOST slot, after the search + request where the thumb
 *  already is (search · + · switch), and the app bar keeps just the plate. Active
 *  tint follows the CURRENT view (`aria-pressed`), like the search capsule's open
 *  tint. */
export function WheelViewToggle({ view, onChange }: { view: WheelView; onChange: (view: WheelView) => void }) {
	return (
		<button
			type="button"
			onClick={() => {
				hapticSelection();
				onChange(view === 'rig' ? 'list' : 'rig');
			}}
			aria-label={view === 'rig' ? 'Switch to the on-board list' : 'Switch to the wheel rig'}
			aria-pressed={view === 'list'}
			className={`${GLASS_ICON_BUTTON} ${view === 'list' ? GLASS_ICON_BUTTON_ACTIVE : GLASS_ICON_BUTTON_IDLE}`}
		>
			{view === 'rig' ? <LayoutList className="size-5" aria-hidden /> : <Truck className="size-5" aria-hidden />}
		</button>
	);
}

/** One measured depth on a tile or row — a plain mm figure (12.9 / 8 / 4.5 …). */
function depthText(treadMm: number): string {
	const rounded = Math.round(treadMm * 10) / 10;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** The tile's face classes — traffic-light band for a measured tyre, plain card
 *  for a mounted one with no reading. */
function tileFace(band: TreadBand | null): string {
	if (band === 'good') return 'border-status-success/60 bg-status-success-soft text-status-success';
	if (band === 'warn') return 'border-status-warning/60 bg-status-warning-soft text-status-warning';
	if (band === 'danger') return 'border-status-danger/60 bg-status-danger-soft text-status-danger';
	return 'border-border bg-card text-muted-foreground';
}

/** The remaining-% bar tone — follows the measured tread band. */
function bandFill(band: TreadBand | null): string {
	if (band === 'good') return 'bg-status-success';
	if (band === 'warn') return 'bg-status-warning';
	if (band === 'danger') return 'bg-status-danger';
	return 'bg-muted-foreground/40';
}

/**
 * The rig's tile WIDTH, applied to the flex ITEM — one definition shared by a
 * vacant seat and a fitted tyre so the two can never drift apart (a row that
 * jitters between filled and empty is the failure mode this prevents).
 *
 * Fluid on purpose: `50% - 3px` is half of one SIDE minus half the dual gap, so a
 * dual pair fills its side exactly and a steer single comes out exactly as wide as
 * a dual — at ANY phone width. That replaced a fixed box, whose min-content set a
 * floor the row could not shrink past (so the rig clipped on a narrow phone) and
 * which left every tile narrower than the row could afford on a wide one.
 *
 * It lives on the FLEX ITEM, never on the face: a fitted tile's face sits one level
 * deeper (inside the `group` wrapper that anchors its corner `✕`), so a percentage
 * on the face would resolve against that wrapper instead of the side group.
 */
const TILE_WIDTH = 'w-[calc(50%_-_3px)]';

/** The shared tile FACE — its height and chrome, identical for a vacant seat and a
 *  fitted tyre (the width comes from `TILE_WIDTH` on the item). */
const TILE_FACE = 'flex h-[128px] w-full flex-col items-center justify-between rounded-xl border-2 p-1.5 text-center';

/** One square wheel tile — position code on top, measured depth + remaining bar in
 *  the middle, the tyre's identity at the foot. The rig is a READ-ONLY drawing: a
 *  VACANT seat is a dashed gap and a FILLED tyre a band-tinted reading, both plain
 *  `role="img"` surfaces with no tap target — management lives in the LIST view (the
 *  app bar's switch), where a row opens its action menu. The tile keeps ONE
 *  deliberate shortcut, the corner `✕` that opens the take-off page, always rendered
 *  (faint) so it is usable on TOUCH and emphasised on hover/focus for pointer devices. */
function TyreTile({
	wheel,
	onUnseat,
	dimmed = false,
}: {
	wheel: WheelOnAxle;
	/** Open the take-off page for this tyre (the corner `✕`). A seat PICKER omits
	 *  it: there the tile is context for a filled wheel, with nothing to take off. */
	onUnseat?: (tyre: TyreCardModel) => void;
	/** A mounted tyre the rig's search did NOT match — kept on its wheel (the drawing
	 *  must stay truthful) but drawn on the muted surface so the matches pop. */
	dimmed?: boolean;
}) {
	const { tyre } = wheel;
	// The DISPLAY code (`A2-1`) — derived by the layout, never the stored label.
	const label = wheel.code;

	// A vacant seat is INFORMATION, not a control: the operator reads the gaps here
	// and seats an un-worn tyre from the list (`Wear` on the row). So the tile is a plain
	// `role="img"` with no tap target — nothing to press means nothing misleading.
	if (!tyre) {
		return (
			<div
				role="img"
				aria-label={`${label} — vacant wheel seat, no tyre fitted`}
				className={`${TILE_WIDTH} ${TILE_FACE} border-dashed border-border bg-card text-muted-foreground`}
			>
				<span className="max-w-full truncate text-[11px] leading-none font-extrabold tracking-wide opacity-90">{label}</span>
				<span className="h-1" />
				<span className="max-w-full truncate text-[10px] leading-none font-semibold opacity-80">Empty</span>
			</div>
		);
	}

	const reading = tyre.treadMm;
	const tone = dimmed ? null : treadBandOf(reading);
	const pct = dimmed ? null : remainingTreadPercent(tyre);
	const footer = tyre.modelName ?? tyre.serialNo ?? 'Tyre';
	const labelText = `${label} — ${tyre.serialNo ?? tyre.modelName ?? 'tyre'}`;
	const readingText = reading != null ? `${depthText(reading)} mm tread` : 'no reading';

	return (
		<div className={`group relative ${TILE_WIDTH}`}>
			{/* A mounted tyre is INFORMATION too — the rig is a drawing, so the tile is
			    never a button; tapping a wheel can only ever be misleading here. */}
			<div
				role="img"
				aria-label={`${labelText} — ${readingText}, mounted${dimmed ? ', hidden by search' : ''}`}
				className={`${TILE_FACE} ${dimmed ? 'border-border bg-muted/30 text-muted-foreground opacity-60' : tileFace(tone)}`}
			>
				<span className="max-w-full truncate text-[11px] leading-none font-extrabold tracking-wide opacity-90">{label}</span>

				{/* The tile's centre — one block so every tile aligns: the measured depth,
			    or a dash for a mounted tyre with no reading. */}
				<span className="flex h-[18px] items-center justify-center gap-0.5 leading-none">
					{reading != null ? (
						<>
							<span className="text-key font-extrabold">{depthText(reading)}</span>
							<span className="text-[8px] font-bold opacity-70">mm</span>
						</>
					) : (
						<span className="text-meta font-bold opacity-40">—</span>
					)}
				</span>

				{/* Remaining-tread mini bar — fill = % of the SKU's new-tread reference. */}
				{pct != null ? (
					<span className="h-1 w-full overflow-hidden rounded-full bg-muted/50">
						<span className={`block h-full rounded-full ${bandFill(tone)}`} style={{ width: `${pct}%` }} />
					</span>
				) : (
					<span className="h-1" />
				)}

				<span className="max-w-full truncate text-[10px] leading-none font-semibold opacity-80">{footer}</span>
			</div>

			{/* The take-off affordance — a corner `✕` on a filled wheel that opens the
			    take-off page. Always present (faint) so touch devices can use it; hover/
			    focus lights it up. */}
			{onUnseat ? (
				<button
					type="button"
					onClick={() => {
						hapticSelection();
						onUnseat(tyre);
					}}
					aria-label={`${labelText} — take it off the wheel`}
					className="absolute -top-1.5 -right-1.5 z-10 flex size-5 items-center justify-center rounded-full border border-status-danger/40 bg-card text-status-danger opacity-70 shadow-sm transition-opacity duration-150 outline-none group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring active:scale-90"
				>
					<X className="size-3" aria-hidden />
				</button>
			) : null}
		</div>
	);
}

/** One axle's caption — the row's DISPLAY code (`A2`, `B4`) on its own line above
 *  its wheels. A side-less row carries no code, so it prints no caption.
 *  It used to be a 32px left gutter on every row — by far the rig's largest fixed
 *  cost of horizontal space (a tenth of the drawing) to print four characters.
 *  Lifting it out gives that width back to the wheels AND lets the rail sit on the
 *  true centre line. */
function AxleCaption({ code }: { code: string }) {
	if (!code) return null;
	return <span className="mb-1 block text-[9px] leading-none font-extrabold tracking-widest text-muted-foreground uppercase">{code}</span>;
}

/** One axle row of the chassis map — its caption, then left group | rail | right.
 *  The TILE is pluggable so the picker below draws the same row with a tappable
 *  seat instead of the rig's read-only one (one row layout, two tile kinds). */
function AxleRowView({
	row,
	onUnseat,
	renderTile,
}: {
	row: AxleRow;
	onUnseat?: (tyre: TyreCardModel) => void;
	/** How one wheel is drawn — the rig's own read-only tile by default. */
	renderTile?: (wheel: WheelOnAxle) => ReactNode;
}) {
	const tile = (wheel: WheelOnAxle) => renderTile?.(wheel) ?? <TyreTile key={wheel.seat.id} wheel={wheel} onUnseat={onUnseat} />;

	// Side-less seats (odd/legacy spares) centre under the rail — no side split.
	if (row.center.length > 0) {
		return (
			<div className="mb-3 flex flex-col">
				<AxleCaption code={row.code} />
				{/* Half the row, so a centred seat is the same box as a dual's tile. */}
				<div className="flex w-1/2 justify-center gap-1.5">{row.center.map((wheel) => tile(wheel))}</div>
			</div>
		);
	}
	return (
		<div className="mb-3 flex flex-col">
			<AxleCaption code={row.code} />
			{/* Each side is EXACTLY half the row: a dual pair fills its half, a steer
			    single matches a dual's width, and the two sides can never drift. */}
			<div className="relative flex items-center gap-3">
				<div className="flex min-w-0 flex-1 gap-1.5">{row.left.map((wheel) => tile(wheel))}</div>
				{/* The chassis rail — a centered axle beam behind the wheels. */}
				<span
					aria-hidden
					className="absolute inset-y-1 left-1/2 w-[5px] -translate-x-1/2 rounded-full bg-gradient-to-b from-muted/60 to-border"
				/>
				<div className="flex min-w-0 flex-1 justify-end gap-1.5">{row.right.map((wheel) => tile(wheel))}</div>
			</div>
		</div>
	);
}

/** The band's display label (`Good` / `Warning` / `Replace`) — from the ONE
 *  catalog (`TREAD_BAND_META`), never a second hand-tuned list. */

/**
 * The DESTINATION wheel rig — the SAME chassis drawing the truck page renders
 * (axle rows + rail + tile faces), used as a SEAT PICKER: a FREE seat is the
 * tap target, everything else is the rig's read-only tile. Picking the gap you
 * can see beats decoding a list of seat codes, and because both drawings share
 * the tile anatomy they can never drift apart.
 *
 * The caller owns the RULE (`freeSeatIds`): a seat missing from the set is not
 * selectable, so a destination the engine would refuse is never tappable.
 */
export function WheelSeatPicker({
	rows,
	freeSeatIds,
	selectedSeatId,
	currentSeatId,
	onSelect,
}: {
	rows: AxleRow[];
	/** Seat ids the caller's rule still allows (`freeFitmentTargets`). */
	freeSeatIds: ReadonlySet<string>;
	selectedSeatId: string | null;
	/** The seat this unit sits on NOW — drawn as "This tyre", never as a stranger. */
	currentSeatId?: string | null;
	onSelect: (seatId: string) => void;
}) {
	const renderTile = (wheel: WheelOnAxle): ReactNode => {
		if (freeSeatIds.has(wheel.seat.id)) {
			return (
				<SeatPickerTile
					key={wheel.seat.id}
					seat={wheel.seat}
					code={wheel.code}
					selected={selectedSeatId === wheel.seat.id}
					onSelect={onSelect}
				/>
			);
		}
		if (currentSeatId != null && wheel.seat.id === currentSeatId) {
			return <CurrentSeatTile key={wheel.seat.id} code={wheel.code} />;
		}
		return <TyreTile key={wheel.seat.id} wheel={wheel} />;
	};

	return (
		<div className="flex flex-col">
			{/* The same front cue the truck page carries — the rig is never ambiguous
			    about which end is up. */}
			<div className="mb-2 flex items-center justify-center gap-1.5 text-[9px] font-bold tracking-widest text-muted-foreground uppercase">
				<ChevronUp className="size-3 text-primary" aria-hidden />
				<span>Front — steering axle</span>
				<ChevronUp className="size-3 text-primary" aria-hidden />
			</div>
			{rows.map((row) => (
				<AxleRowView key={row.key} row={row} renderTile={renderTile} />
			))}
		</div>
	);
}

/** One VACANT seat in a picker — the rig's dashed gap, made a tap target (the rig
 *  itself never is). Selected reads as the chosen destination, not a hover state. */
function SeatPickerTile({
	seat,
	code,
	selected,
	onSelect,
}: {
	seat: VehWheelSeat;
	code: string;
	selected: boolean;
	onSelect: (seatId: string) => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={selected}
			aria-label={`${code || seat.label} — free wheel seat, move the tyre here`}
			onClick={() => {
				hapticSelection();
				onSelect(seat.id);
			}}
			className={`${TILE_WIDTH} ${TILE_FACE} border-dashed outline-none transition-transform duration-150 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] ${
				selected ? 'border-primary bg-primary/10 text-primary ring-2 ring-primary/40' : 'border-border bg-card text-muted-foreground'
			}`}
		>
			<span className="max-w-full truncate text-[10px] leading-none font-extrabold tracking-wide opacity-90">{code}</span>
			<span className="flex h-[18px] items-center justify-center leading-none">
				<Plus className="size-4 opacity-60" aria-hidden />
			</span>
			<span className="h-1" />
			<span className="max-w-full truncate text-[9px] leading-none font-semibold opacity-80">{selected ? 'Chosen' : 'Free'}</span>
		</button>
	);
}

/** The seat the unit being moved sits on right now — a filled wheel that is not a
 *  stranger, so a same-truck rotation is not read as "someone else is here". */
function CurrentSeatTile({ code }: { code: string }) {
	return (
		<div
			role="img"
			aria-label={`${code} — the seat this tyre is on now`}
			className={`${TILE_WIDTH} ${TILE_FACE} border-border bg-muted/40 text-muted-foreground`}
		>
			<span className="max-w-full truncate text-[10px] leading-none font-extrabold tracking-wide opacity-90">{code}</span>
			<span className="flex h-[18px] items-center justify-center leading-none text-meta font-bold opacity-50">—</span>
			<span className="h-1" />
			<span className="max-w-full truncate text-[9px] leading-none font-semibold opacity-80">This tyre</span>
		</div>
	);
}

/** The KPI summary's cell tones — the traffic-light bands plus the vacant wheel. */
const KPI_TONE: Record<TreadBand, string> = {
	good: 'border-status-success/30 bg-status-success-soft text-status-success',
	warn: 'border-status-warning/30 bg-status-warning-soft text-status-warning',
	danger: 'border-status-danger/30 bg-status-danger-soft text-status-danger',
};
const KPI_EMPTY_TONE = 'border-border bg-muted/50 text-muted-foreground';

/** The stable fallback for an absent `assets` prop (a new array each render would
 *  re-run every downstream memo for nothing). */
const EMPTY_ASSETS: TyreCardModel[] = [];

/** The tread-band summary — one cell per band plus the vacant-seat count. A
 *  vacant wheel is itself a defect, so Empty is a KPI, not noise. Leads the
 *  rig AND the list views. */
function KpiSummary({ counts, className }: { counts: Record<TreadBand | 'empty', number>; className?: string }) {
	return (
		<div className={`grid shrink-0 grid-cols-4 gap-1.5 ${className ?? ''}`}>
			{TREAD_BAND_META.map((item) => (
				<div key={item.band} className={`rounded-xl border px-1 py-1.5 text-center ${KPI_TONE[item.band]}`}>
					<span className="block text-sm leading-tight font-extrabold tabular-nums">{counts[item.band]}</span>
					<span className="text-[9px] font-bold uppercase opacity-80">{item.label}</span>
				</div>
			))}
			<div className={`rounded-xl border px-1 py-1.5 text-center ${KPI_EMPTY_TONE}`}>
				<span className="block text-sm leading-tight font-extrabold tabular-nums">{counts.empty}</span>
				<span className="text-[9px] font-bold uppercase opacity-80">Empty</span>
			</div>
		</div>
	);
}

export function TyreWheelPlan({
	vehicle,
	view,
	onViewChange,
	segment,
	onSegmentChange,
	mounted,
	onPlaceOnWheel,
	tray = [],
	assets = EMPTY_ASSETS,
}: TyreWheelPlanProps) {
	const navigate = useNavigate();

	// The wheel map — axle rows derived from the declared seat list, filled by
	// the same mounted cards the board list keys (no re-read).
	const axles = useMemo(() => axleRowsOf(vehicle), [vehicle]);
	// Every FITTED wheel on this truck, in draw order — the "N / N fitted" count.
	const fitted = useMemo(() => axles.flatMap((row) => [...row.left, ...row.right, ...row.center]).filter((wheel) => wheel.tyre), [axles]);

	// A unit's FULL-SCREEN lifecycle page (the same page a By Serial match opens;
	// reachable from the action menu's `History` row) — the list's one detail surface.
	const openTyreHistory = useCallback(
		(tyre: TyreCardModel) => {
			hapticSelection();
			navigate(`/app/tyres/tyre/${tyre.id}`, { state: { tyre } });
		},
		[navigate],
	);

	/** The corner `✕` — the take-off write, on its own full-screen page. */
	const unseatWheel = useCallback(
		(tyre: TyreCardModel) => navigate(`/app/tyres/vehicle/${vehicle.id}/action/unseat/${tyre.id}`),
		[navigate, vehicle.id],
	);

	// The store operation: order deep-links the requisition form already bound to this
	// plate (`?vehicle=` — `StoreRequestCreatePage`). Store stock reaches a truck through
	// that request, never by writing a fit here.
	//
	// `scope` is the CATALOG prefill, and only the RIG passes one: the wheel drawing is
	// tyres by definition, so "order the tyre missing from this seat" is unambiguous
	// there. The merged list panel passes NONE — it shows tyres and equipment together,
	// so there is no focused kind to narrow the form to, and a scope guessed from the
	// last tab the operator looked at would narrow a form they never asked to narrow.
	const requestFromStore = useCallback(
		(scope?: BoardSegment) => {
			const base = `/app/store-requests/+?vehicle=${encodeURIComponent(vehicle.id)}`;
			navigate(scope ? `${base}&scope=${scope}` : base);
		},
		[navigate, vehicle.id],
	);

	const total = vehicle.seats.length;

	// The KPI footer — how many of this truck's seats fall in each tread band, plus
	// how many are EMPTY. A tyre with no reading is never guessed into a band, so it
	// counts as good as a vacant wheel does: unmeasured. That is why the footer sums
	// to the seat count.
	const kpi = useMemo(() => {
		const counts: Record<TreadBand | 'empty', number> = { good: 0, warn: 0, danger: 0, empty: 0 };
		for (const seat of vehicle.seats) {
			const band = treadBandOf(vehicle.mount.get(seat.id)?.treadMm ?? null);
			counts[band ?? 'empty'] += 1;
		}
		return counts;
	}, [vehicle]);

	// The RIG's own bottom bar — the same glass toolbar the list carries, so both
	// bodies behave alike. The search matches serial / SKU / name (the SAME rule the
	// list's filter uses, `matchesQuery`); the drawing stays TRUTHFUL: a non-match
	// keeps its wheel but is dimmed to the muted surface, so the matches pop.
	const [searchOpen, setSearchOpen] = useState(false);
	const [query, setQuery] = useState('');
	const closeSearch = () => {
		setSearchOpen(false);
		setQuery('');
	};
	const rigQuery = query.trim().toLowerCase();
	const matchingFinished: ReadonlySet<string> = useMemo(() => {
		if (!rigQuery) return new Set<string>();
		return new Set(fitted.filter((wheel) => wheel.tyre && matchesQuery(wheel.tyre, rigQuery)).map((wheel) => wheel.tyre!.id));
	}, [fitted, rigQuery]);

	const renderRigTile = (wheel: WheelOnAxle): ReactNode => (
		<TyreTile
			key={wheel.seat.id}
			wheel={wheel}
			onUnseat={unseatWheel}
			dimmed={Boolean(wheel.tyre) && rigQuery !== '' && !matchingFinished.has(wheel.tyre!.id)}
		/>
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{view === 'list' ? (
				/* LIST — the band summary leads (above the on-board registry), then the
				   truck's whole inventory, the SAME actions the rig's tiles expand (so an
				   action exists in exactly ONE place per unit). */
				<>
					<KpiSummary counts={kpi} className="mb-2" />
					<TruckInventoryList
						vehicle={vehicle}
						mounted={mounted}
						tray={tray}
						assets={assets}
						segment={segment}
						onSegmentChange={onSegmentChange}
						onOpenHistory={openTyreHistory}
						onPlaceOnWheel={onPlaceOnWheel}
						onRequestFromStore={requestFromStore}
						barRight={<WheelViewToggle view={view} onChange={onViewChange} />}
					/>
				</>
			) : (
				<>
					{/* The band summary leads the rig too — a vacant wheel is a defect, so
					   Empty is a KPI, not noise. */}
					<KpiSummary counts={kpi} className="mb-2" />

					{/* The fitted count, then the rig region. */}
					<div className="mt-1 flex shrink-0 items-center justify-between gap-2">
						<p className="flex items-center gap-1.5 text-[10px] font-extrabold tracking-widest text-muted-foreground uppercase">
							<Link2 className="size-3 text-muted-foreground" aria-hidden />
							On the wheels · equipped
						</p>
						<span className="text-[10px] font-bold text-muted-foreground tabular-nums">
							{fitted.length} / {total} fitted
						</span>
					</div>

					{/* The rig region — the ONE part that yields: `basis-auto` + `shrink` lets it
					   give height to whatever shares the body, and scroll internally for the rest.
					   `pb-24` keeps the last axle row above the fixed bottom bar. The drawing is
					   filtered by the rig's search: a non-match stays on its wheel, dimmed. */}
					<div className="min-h-0 shrink grow basis-auto overflow-y-auto pt-2 pb-24">
						{axles.length > 0 ? (
							<div className="flex flex-col">
								{axles.map((row) => (
									<AxleRowView key={row.key} row={row} renderTile={renderRigTile} />
								))}
							</div>
						) : (
							<p className="py-3 text-center text-meta font-semibold text-muted-foreground">This plate declares no wheel positions.</p>
						)}
					</div>

					{/* The rig's bottom bar — identical glass toolbar to the list's: the on-board
					   count, a search that dims non-matching tyres on the drawing, and the ONE
					   store action scoped to the tyre catalog. */}
					<BottomActionBar
						center={`${fitted.length} on board`}
						panel={
							<div className="flex w-full items-center gap-2">
								<div className="relative min-w-0 flex-1">
									<Search
										className="pointer-events-none absolute top-1/2 left-4 z-10 size-4 -translate-y-1/2 text-muted-foreground"
										aria-hidden
									/>
									<input
										value={query}
										onChange={(event) => setQuery(event.target.value)}
										placeholder="Search model or serial…"
										autoComplete="off"
										spellCheck={false}
										aria-label="Filter the wheel map"
										className="h-11 w-full rounded-full border border-border/60 bg-white/90 pr-4 pl-11 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:border-ring/60 dark:border-white/15 dark:bg-card/95"
									/>
								</div>
								<button
									type="button"
									onClick={() => {
										hapticSelection();
										closeSearch();
									}}
									aria-label="Clear search"
									className={`relative flex size-11 items-center justify-center rounded-full border border-border/60 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-white/15 ${GLASS_ICON_BUTTON_ACTIVE}`}
								>
									<X className="size-5" aria-hidden />
								</button>
							</div>
						}
						panelOpen={searchOpen}
						right={
							<div className="flex items-center gap-1.5">
								<button
									type="button"
									onClick={() => {
										hapticSelection();
										if (searchOpen) closeSearch();
										else setSearchOpen(true);
									}}
									aria-label={searchOpen ? 'Close search' : 'Search'}
									className={`${GLASS_ICON_BUTTON} ${searchOpen ? GLASS_ICON_BUTTON_ACTIVE : GLASS_ICON_BUTTON_IDLE}`}
								>
									{searchOpen ? <X className="size-5" aria-hidden /> : <Search className="size-5" aria-hidden />}
								</button>
								<button
									type="button"
									onClick={() => {
										hapticSelection();
										requestFromStore('tyre');
									}}
									aria-label="Request tyre"
									className={GLASS_PRIMARY_BUTTON}
								>
									<Plus className="size-5" aria-hidden />
								</button>
								<WheelViewToggle view={view} onChange={onViewChange} />
							</div>
						}
					/>
				</>
			)}
		</div>
	);
}
