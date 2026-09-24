import { useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Disc3, Plus, Search, Wrench, X } from 'lucide-react';

import { UnitActionSheet } from './board-unit-actions';
import { TruckRequestsPanel } from './truck-requests-panel';
import type { BoardUnitState } from '../data/board-actions';
import { unitTitleOf } from '../data/labels';
import { TREAD_BAND_META, treadBandOf, type TreadBand } from '../data/readings';
import type { TyreCardModel } from '../data/types';
import type { VehicleBoardState } from '../data/board';
import {
	BottomActionBar,
	GLASS_ICON_BUTTON,
	GLASS_ICON_BUTTON_ACTIVE,
	GLASS_ICON_BUTTON_IDLE,
	GLASS_PRIMARY_BUTTON,
} from '@/shared/components/bottom-action-bar';
import { EmptyState, FilteredEmptyState } from '@/shared/components/empty-state';
import { hapticSelection } from '@/shared/platform/haptics';

/**
 * The truck's ON-BOARD REGISTRY as a LIST — the body view the app bar's switch
 * swaps the wheel rig for (`/app/tyres/vehicle/:id`).
 *
 * ONE read feeds it (the page's `GET /api/mro/assets/holder?vehicle=`, already in
 * cache) split by the unit's DERIVED `kind` and its wheel state — no second
 * request, no new backend. TWO tabs, because the truck carries two DIFFERENT
 * things and asks two different questions:
 *
 *   · On board  → everything the truck holds, as three SECTIONS of one list:
 *                  On wheels · WORN (seated, tinted by the measured tread band),
 *                  Off wheels · UN-WORN (in the tray, deliberately GREY — colour
 *                  is reserved for a live safety state on a wheel), then
 *                  Equipment (the `assets`-flagged units: a jack, a toolbox).
 *   · Requests  → the truck's store REQUISITIONS (the shared `store-requests`
 *                  read, the same card the တောင်းခံလွှာ register shows) — what was
 *                  ordered for this plate, newest first. Tapping a row opens the
 *                  request's detail page; the tab is navigation, never a decision.
 *
 * A tyre and a jack were never two ANSWERS, they are two KINDS of one answer — "what
 * is on this truck" — so they share a panel and are told apart by their section
 * heading and their row badge (the seat for a worn tyre, UN-WORN, TOOL) rather than
 * by a tab that forced the operator to switch to learn the truck was missing one.
 * The row badges are load-bearing IN a mixed list: they state a row's kind and state
 * without reading up to the nearest heading.
 *
 * The active tab is VIEW state owned by the PAGE (`?scope=`, inside the page's ONE
 * `useViewState` container) — never a local `useState` — so the scope survives a
 * reload.
 *
 * A row is ONE tap target (the whole card): it opens that unit's ACTION MENU in a
 * bottom sheet — the pure verb set (`onBoardActions`) with a refused verb rendered
 * DISABLED WITH ITS REASON (Poka-Yoke) rather than hidden — so the list body is never
 * pushed around by a strip expanding under a row.
 *
 * The bottom action bar (the shared `BottomActionBar`) carries the toolbar: a
 * search toggle that morphs the pill into the filter field (matching a unit on
 * its serial / SKU / name — the SAME client-side filter as before), and the ONE
 * store action scoped to the focused tab as a `+` — a requisition already bound
 * to the plate (`?vehicle=` + `?scope=`), so the truck's needs are raised where
 * they are seen. Store stock reaches a truck through that request — never a fit
 * written behind the store's back.
 */
/** The on-board tab set — the truck's whole ASSET register (tyres + equipment) and
 *  its store REQUESTS. Tyres and equipment are NOT separate tabs: they are one
 *  answer to one question, rendered as sections of a single list. */
export type RegistryTab = 'onboard' | 'requests';

/** The store-requisition CATALOG scope (`?scope=` on the create deep-link) — a
 *  different fact from `RegistryTab`: a panel is what this screen shows, a catalog
 *  scope is what a REQUEST may ask for. Only the RIG still deep-links one, because
 *  the wheel drawing is tyres by definition ("order the tyre that is missing from
 *  this seat"); the merged list panel has no focused kind to narrow a form to. */
export type BoardSegment = 'tyre' | 'equipment';

/** The segment control's tabs, in render order. A tab names the PANEL only — the
 *  registry's sizes are answered by the sections inside it, not by a badge. */
const SEGMENTS: ReadonlyArray<{ value: RegistryTab; label: string }> = [
	{ value: 'onboard', label: 'On board' },
	{ value: 'requests', label: 'Requests' },
];

/** The tab list + its panel ids — one pair, referenced by BOTH sides' ARIA. */
const TAB_LIST = 'on-board-tabs';
const TAB_PANEL = 'on-board-panel';
const tabId = (value: RegistryTab) => `${TAB_LIST}-${value}`;

/** One measured depth on a row — plain mm text (12.9 / 8 / 4.5 …). */
function depthText(treadMm: number): string {
	const rounded = Math.round(treadMm * 10) / 10;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Icon-well classes for a worn tyre — the traffic-light band of its tread. */
const BAND_ICON: Record<TreadBand, string> = {
	good: 'border-status-success/60 bg-status-success-soft text-status-success',
	warn: 'border-status-warning/60 bg-status-warning-soft text-status-warning',
	danger: 'border-status-danger/60 bg-status-danger-soft text-status-danger',
};
const BAND_TEXT: Record<TreadBand, string> = {
	good: 'text-status-success',
	warn: 'text-status-warning',
	danger: 'text-status-danger',
};
/** UN-WORN / equipment wells sit on a MUTED row, so theirs is the plain surface —
 *  colour never implies a safety state. */
const PLAIN_ICON = 'border-border bg-card text-muted-foreground';
/** The condition copy for an `assets`-flagged unit. */
const CONDITION_LABELS: Record<string, string> = { good: 'Good', fair: 'Fair', poor: 'Poor', damaged: 'Damaged' };

/** The list's single search box matches a unit on its serial, SKU or name. Shared
 *  with the rig's bottom-bar search so both views filter by the SAME rule. */
export function matchesQuery(unit: TyreCardModel, query: string): boolean {
	if (!query) return true;
	return `${unit.serialNo ?? ''} ${unit.modelName ?? ''} ${unit.itemNameEn ?? ''}`.toLowerCase().includes(query);
}

/** One registry row — a unit drawn as ONE card-wide tap target that opens its action
 *  menu. A WORN row sits on the card surface; an UN-WORN / equipment row is MUTED, so
 *  "off a wheel" is visible at a glance without reading a badge.
 *
 *  The title names the item AND the model (`unitTitleOf`). Its FACE is the SKU's own
 *  picture (`mro_item_model.image`) as a FULL-BLEED left tile — it fills the card's
 *  height and its left/top/bottom edges are the card's own (the same photo-card
 *  anatomy the လက်ကျန် list uses), so the row is identified by the product, not by a
 *  glyph in a box. The inset glyph chip is what a SKU with no photo (or whose media
 *  cannot load) falls back to, and that chip keeps the tread band.
 *
 *  A TYRE row (one with a measured depth) reads its condition twice, both from the
 *  module's ONE traffic light (`TREAD_BAND_META`): a colour DOT leading the name, and
 *  the measured THICKNESS as the figure at the card's top-right. The dot is the fast
 *  read and carries the band's name for a screen reader (colour is never the only
 *  carrier); a unit with no measurement shows NEITHER — the module never estimates. */
function UnitRow({
	icon,
	iconClass,
	image,
	treadMm,
	title,
	badge,
	meta,
	muted,
	onOpen,
	openLabel,
}: {
	icon: ReactNode;
	iconClass: string;
	/** The SKU's photo (`/api/media/<key>`) — null when the model has no picture. */
	image?: string | null;
	/** The unit's latest MEASURED tread (mm) — the prop that MAKES a row a tyre row.
	 *  `undefined` (the prop is absent) ⇒ not a tyre (equipment) ⇒ no dot, no figure.
	 *  `null` ⇒ a tyre nothing has measured yet ⇒ a grey "not measured" dot.
	 *  A number ⇒ the full read: the band dot + the depth figure at the top-right. */
	treadMm?: number | null;
	title: ReactNode;
	badge?: ReactNode;
	meta: ReactNode;
	/** Off a wheel (an un-worn tyre / an equipment unit) ⇒ the muted surface. */
	muted?: boolean;
	/** Open the unit's action menu (the bottom sheet). */
	onOpen: () => void;
	openLabel: string;
}) {
	// A media asset can be missing (GC'd, or never synced to this environment), so a
	// failed load falls back to the glyph. The failed SRC is remembered rather than a
	// boolean, so a later corrected URL is allowed to try again.
	const [failedSrc, setFailedSrc] = useState<string | null>(null);
	const showImage = Boolean(image) && failedSrc !== image;
	// The measured depth's condition band — the SAME thresholds the wheel map's tiles
	// and its legend use, so the card can never disagree with the board.
	const band = treadBandOf(treadMm);
	const bandMeta = band ? TREAD_BAND_META.find((row) => row.band === band) : undefined;
	const depthTone = band ? BAND_TEXT[band] : 'text-muted-foreground';
	// The condition dot. A measured depth paints its band (`TREAD_BAND_META`); a tyre
	// nothing has measured yet is GREY and says so — a missing reading is a state the
	// floor needs to see, not silence (and grey keeps the module's rule that colour is
	// reserved for a LIVE reading). Equipment is not a tyre: no dot at all.
	const dot = bandMeta
		? { className: bandMeta.dot, label: `Tread ${bandMeta.label}` }
		: treadMm !== undefined
			? { className: 'bg-muted-foreground/40', label: 'Tread not measured' }
			: null;
	return (
		// `overflow-hidden` — the photo tile's corners ARE the card's radius.
		<li className={`overflow-hidden rounded-xl border border-border ${muted ? 'bg-muted/30' : 'bg-card'}`}>
			<button
				type="button"
				onClick={() => {
					hapticSelection();
					onOpen();
				}}
				aria-label={`${openLabel} — open its actions`}
				aria-haspopup="dialog"
				// `items-stretch` lets the photo tile span the card's whole height. With a
				// photo the row keeps only its RIGHT inset — no top/bottom/left padding at
				// all, so the picture reaches all three card edges — and the vertical
				// breathing room moves into the text column below (the same anatomy as the
				// stock list's photo card). A glyph row keeps its even padding.
				className={`flex w-full items-stretch gap-2.5 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring ${
					showImage ? 'pr-2.5' : 'p-2.5'
				}`}
			>
				{showImage ? (
					<img
						src={image ?? undefined}
						alt=""
						loading="lazy"
						onError={() => setFailedSrc(image ?? null)}
						className="w-12 shrink-0 self-stretch bg-muted/40 object-cover"
					/>
				) : (
					<span className={`flex size-9 shrink-0 items-center justify-center rounded-lg border ${iconClass}`}>{icon}</span>
				)}
				<span className={`flex min-w-0 flex-1 flex-col justify-center ${showImage ? 'py-2.5' : ''}`}>
					<span className="flex min-w-0 items-center gap-1.5">
						{dot ? (
							<span role="img" aria-label={dot.label} className={`size-2 shrink-0 rounded-full ${dot.className}`} />
						) : null}
						<span className="truncate text-[12.5px] leading-tight font-bold tracking-tight text-foreground">{title}</span>
						{badge}
						{treadMm != null && band ? (
							<span className={`ml-auto shrink-0 text-[11.5px] leading-none font-bold tabular-nums ${depthTone}`}>
								{depthText(treadMm)} mm
							</span>
						) : null}
					</span>
					<span className="mt-0.5 flex items-baseline gap-1.5 truncate text-[10.5px] leading-snug font-medium text-muted-foreground">
						{meta}
					</span>
				</span>
				<ChevronRight className="size-4 shrink-0 self-center text-muted-foreground" aria-hidden />
			</button>
		</li>
	);
}

/** A sub-section heading inside the Tyre tab ("On wheels · worn (2)"). */
function SectionHeading({ label, count }: { label: string; count: number }) {
	return (
		<p className="mt-2.5 mb-1.5 text-[9px] font-extrabold tracking-widest text-muted-foreground uppercase">
			{label} ({count})
		</p>
	);
}

/** A tab with nothing to show — a dashed CARD (the shared `EmptyState`), never a
 *  bare line of text and never a "(0)" section heading. A search that simply
 *  matched nothing is a DIFFERENT fact from an empty truck, so it offers the
 *  one-tap clear instead. */
function EmptyTab({ searching, title, hint, onClear }: { searching: boolean; title: string; hint: string; onClear: () => void }) {
	// `fill` — either empty state OWNS this tab's whole panel (the registry body below the
	// search), so it stretches to the panel's height instead of floating in a half-empty
	// pane with the store button stranded under it.
	return searching ? <FilteredEmptyState title="No unit matches" onClear={onClear} fill /> : <EmptyState title={title} hint={hint} fill />;
}

export interface TruckInventoryListProps {
	/** The truck whose registry this is (its plate + declared seats). */
	vehicle: VehicleBoardState;
	/** WORN — tyres seated on a wheel of THIS truck. */
	mounted: TyreCardModel[];
	/** UN-WORN — tyres riding in this truck's tray, on no wheel. */
	tray: TyreCardModel[];
	/** `assets`-flagged units this truck holds (a jack, a toolbox). */
	assets: TyreCardModel[];
	/** The active panel (`?scope=`) — VIEW state owned by the page, so the tab
	 *  survives a reload. */
	segment: RegistryTab;
	/** Switch the panel (a URL write — replace, never push). */
	onSegmentChange: (segment: RegistryTab) => void;
	/** Open a unit's full-screen lifecycle page (a tyre or an asset). */
	onOpenHistory: (unit: TyreCardModel) => void;
	/** Hand an un-worn tyre to the WEAR flow: the page reopens this truck's wheel rig
	 *  as a seat picker (`?serial=<unit id>`), where the `+` seats are the target.
	 *  The list performs NO fit itself — a wheel is chosen on the drawing, not in a
	 *  chip list, so the operator sees where the tyre is going. */
	onPlaceOnWheel: (unit: TyreCardModel) => void;
	/** Order from the store — already bound to THIS truck. `null` = the Requests tab,
	 *  where the new request is bound to the plate alone. */
	onRequestFromStore: () => void;
	/** The bar's RIGHT slot — the rig/list switch, threaded in to dodge a circular
	 *  import (the toggle lives in `tyre-wheel-plan`). Rendered rightmost, after the
	 *  + action, so search · + · switch read left-to-right like the rig's own bar. */
	barRight?: ReactNode;
}

export function TruckInventoryList({
	vehicle,
	mounted,
	tray,
	assets,
	segment,
	onSegmentChange,
	onOpenHistory,
	onPlaceOnWheel,
	onRequestFromStore,
	barRight,
}: TruckInventoryListProps) {
	const [menu, setMenu] = useState<{ unit: TyreCardModel; state: BoardUnitState } | null>(null);
	/** The bar search — an OPEN toggle plus the filter term. The truck's whole
	 *  inventory is already loaded, so the filter is client-side (no read). */
	const [searchOpen, setSearchOpen] = useState(false);
	const [query, setQuery] = useState('');

	// Every seat the board declares that no mounted tyre fills — derived from the
	// SAME board the rig draws, so "Wear" can never offer an occupied wheel.
	const vacantSeats = useMemo(() => vehicle.seats.filter((seat) => !vehicle.mount.has(seat.id)), [vehicle]);
	const seatLabelOf = useMemo(() => {
		const byId = new Map(vehicle.seats.map((seat) => [seat.id, seat.label]));
		return (slot: string | null) => (slot ? (byId.get(slot) ?? slot) : null);
	}, [vehicle]);

	const q = query.trim().toLowerCase();
	const worn = useMemo(() => mounted.filter((unit) => matchesQuery(unit, q)), [mounted, q]);
	const unworn = useMemo(() => tray.filter((unit) => matchesQuery(unit, q)), [tray, q]);
	const equipment = useMemo(() => assets.filter((unit) => matchesQuery(unit, q)), [assets, q]);

	/** Close the search AND drop its term — the clear-on-close rule. */
	const closeSearch = () => {
		setSearchOpen(false);
		setQuery('');
	};

	/** The truck's floor plan, fed to a unit's action menu so its gates (a swap needs a
	 *  second mounted tyre, a wear needs a vacant wheel) are decided by the same facts
	 *  the rig's tiles use. */
	const peers = Math.max(0, mounted.length - 1);

	const body =
		segment === 'requests' ? (
			/* The truck's store requisitions — the SAME card the /app/store-requests
			   register shows, so "what did we ask the store for" reads identically. */
			<TruckRequestsPanel vehicleId={vehicle.id} />
		) : worn.length + unworn.length + equipment.length === 0 ? (
			<EmptyTab
				searching={Boolean(q)}
				title="Nothing on board"
				hint="Tyres and equipment issued to this truck — on a wheel, off one in the tray, or in the toolbox — appear here."
				onClear={closeSearch}
			/>
		) : (
			<>
				{worn.length > 0 ? (
					<>
						<SectionHeading label="On wheels · worn" count={worn.length} />
						<ul className="flex flex-col gap-1.5">
							{worn.map((unit) => {
								const band = treadBandOf(unit.treadMm);
								const seat = seatLabelOf(unit.slot);
								return (
									<UnitRow
										key={unit.id}
										icon={<Disc3 className="size-4" aria-hidden />}
										iconClass={band ? BAND_ICON[band] : PLAIN_ICON}
										image={unit.imageUrl}
										treadMm={unit.treadMm}
										title={unitTitleOf(unit)}
										badge={
											seat ? (
												<span className="shrink-0 rounded bg-foreground/85 px-1.5 py-0.5 text-[9px] leading-none font-bold tracking-wide text-background">
													{seat}
												</span>
											) : null
										}
										meta={
											<span className="truncate font-mono font-bold text-muted-foreground">S/N {unit.serialNo ?? '—'}</span>
										}
										onOpen={() => setMenu({ unit, state: 'worn' })}
										openLabel={unit.serialNo ?? unit.modelName ?? 'Tyre'}
									/>
								);
							})}
						</ul>
					</>
				) : null}

				{unworn.length > 0 ? (
					<>
						<SectionHeading label="Off wheels · un-worn" count={unworn.length} />
						<ul className="flex flex-col gap-1.5">
							{unworn.map((unit) => (
								<UnitRow
									key={unit.id}
									icon={<Disc3 className="size-4" aria-hidden />}
									iconClass={PLAIN_ICON}
									image={unit.imageUrl}
									treadMm={unit.treadMm}
									title={unitTitleOf(unit)}
									badge={
										<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] leading-none font-bold tracking-wide text-muted-foreground">
											UN-WORN
										</span>
									}
									meta={
										<span className="truncate font-mono font-bold text-muted-foreground">S/N {unit.serialNo ?? '—'}</span>
									}
									muted
									onOpen={() => setMenu({ unit, state: 'unworn' })}
									openLabel={unit.serialNo ?? unit.modelName ?? 'Tyre'}
								/>
							))}
						</ul>
					</>
				) : null}

				{equipment.length > 0 ? (
					<>
						<SectionHeading label="Equipment" count={equipment.length} />
						<ul className="flex flex-col gap-1.5">
							{equipment.map((unit) => (
								<UnitRow
									key={unit.id}
									icon={<Wrench className="size-4" aria-hidden />}
									iconClass={PLAIN_ICON}
									image={unit.imageUrl}
									title={unitTitleOf(unit)}
									badge={
										<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] leading-none font-bold tracking-wide text-muted-foreground">
											TOOL
										</span>
									}
									meta={
										<span className="truncate font-mono font-bold text-muted-foreground">
											{unit.condition ? `${CONDITION_LABELS[unit.condition] ?? unit.condition} · ` : ''}S/N {unit.serialNo ?? '—'}
										</span>
									}
									muted
									onOpen={() => setMenu({ unit, state: 'asset' })}
									openLabel={unit.serialNo ?? unit.itemNameEn ?? 'Equipment'}
								/>
							))}
						</ul>
					</>
				) : null}
			</>
		);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/* The segment control — equal pills in the app's tab language, sized as the
			    kiosk's primary control (a comfortable 40px target, not a chip). The panels
			    are named for the QUESTION (what is on this truck / what did we ask for),
			    never for one of the kinds inside them. */}
			<div role="tablist" aria-label="On-board registry" className="flex shrink-0 gap-1.5">
				{SEGMENTS.map((item) => {
					const active = segment === item.value;
					return (
						<button
							key={item.value}
							type="button"
							role="tab"
							id={tabId(item.value)}
							aria-controls={TAB_PANEL}
							aria-selected={active}
							onClick={() => {
								hapticSelection();
								onSegmentChange(item.value);
							}}
							className={`inline-flex h-10 flex-1 items-center justify-center rounded-full border px-3 text-sub leading-none font-bold whitespace-nowrap transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 ${
								active ? 'border-transparent bg-primary text-primary-foreground shadow-sm' : 'border-border bg-card/80 text-foreground'
							}`}
						>
							{item.label}
						</button>
					);
				})}
			</div>

			<div role="tabpanel" id={TAB_PANEL} aria-labelledby={tabId(segment)} className="mt-1.5 min-h-0 flex-1 overflow-y-auto pr-1 pb-24">
				{body}
			</div>

			{/* The bottom action bar — the 🔍 toggle morphs the pill into the registry
			    filter (the inline box's job, now in the shared bar), and the + is the
			    truck's ONE store action, scoped to the focused tab: a requisition already
			    bound to the plate (`?vehicle=`). Stock arrives through the request, so
			    nothing here writes a fit behind the store's back. On the Requests tab
			    there is nothing to filter (the list IS the requests), so the search
			    toggle hides and the + opens a request bound to the plate alone. */}
			<BottomActionBar
				center={segment === 'requests' ? 'Requests' : `${worn.length + unworn.length + equipment.length} on board`}
				panel={
					segment === 'requests' ? undefined : (
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
									aria-label="Filter the on-board registry"
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
					)
				}
				panelOpen={segment !== 'requests' && searchOpen}
				right={
					<div className="flex items-center gap-1.5">
						{segment === 'requests' ? null : (
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
						)}
						<button
							type="button"
							onClick={() => {
								hapticSelection();
								onRequestFromStore();
							}}
							aria-label={segment === 'requests' ? 'New request' : 'Request from store'}
							className={GLASS_PRIMARY_BUTTON}
						>
							<Plus className="size-5" aria-hidden />
						</button>
						{barRight}
					</div>
				}
			/>

			{/* The action menu for the tapped row — ONE sheet, its verbs gated by the SAME
			    facts the rig draws (a swap needs a second mounted tyre, a wear a vacant
			    wheel), so the two surfaces can never offer different verbs. */}
			{menu ? (
				<UnitActionSheet
					vehicle={vehicle}
					unit={menu.unit}
					state={menu.state}
					vacantSeats={vacantSeats}
					peers={peers}
					onOpenHistory={onOpenHistory}
					onWear={onPlaceOnWheel}
					onClose={() => setMenu(null)}
				/>
			) : null}
		</div>
	);
}
