import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar, AvatarFallback, AvatarImage } from '@mmbix/design-system/avatar';
import {
	ArrowRightLeft,
	Boxes,
	Check,
	CircleDotDashed,
	ClipboardCheck,
	Gauge,
	Move,
	PackageOpen,
	Receipt,
	RotateCw,
	Search,
	ShieldOff,
	SlidersHorizontal,
	Truck,
	Undo2,
	UserPlus,
	Users,
	X,
	type LucideIcon,
} from 'lucide-react';

import type { TyreCardModel, TyreEventKind, TyreEventLine } from '../data/types';
import { fetchMountedTyres, fetchTyreEvents, freeFitmentTargets, issueAsset, moveTyrePosition, recordTyreCheck } from '../data/api';
import { axleRowsOf } from '../data/layout';
import { buildFleetBoard } from '../data/board';
import { WheelSeatPicker } from './tyre-wheel-plan';
import { fetchCurrentEmployee } from '@/modules/attendance/data/api';
import { qk, TYRE_STALE_MS } from '../data/query-keys';
import { DENSE_CARD_FRAME } from '@/shared/components/card';
import { TyreStatusPill } from './tyre-status-pill';
import { remainingTreadPercent, treadReadingLabel } from '../data/readings';
import { PersonnelPickerSheet } from '@/shared/components/personnel-picker-sheet';
import { Shimmer } from '@/shared/components/skeletons';
import { hapticImpact, hapticSelection } from '@/shared/platform/haptics';
import { formatEnglishDateLabel, formatRelativeTime } from '@/shared/time/myanmar';
import { useVehicleMasters } from '@/shared/lookups/hooks';

/**
 * The tyre DETAIL BODY — the full-page serial history's content (`/app/tyres/
 * tyre/:id`), extracted from the register's old bottom sheet. The tyre card is
 * the unit's LIVE snapshot (`mro_stock_serials`); this body adds exactly what
 * the snapshot can't tell you: the unit's IMMUTABLE lifecycle history.
 *
 *  ┌──────────────────────────────────────────────┐
 *  │ 265 70R 19.5 F                     [Issued]   │
 *  │ ┌──────────────────────────────────────────┐ │
 *  │ │ Remaining tread             82% · 13.8 mm│ │
 *  │ │ ███████████████████████░░░░░░░░          │ │
 *  │ └──────────────────────────────────────────┘ │
 *  └──────────────────────────────────────────────┘
 *  LIFECYCLE HISTORY                         5 events
 *   ╷
 *   ●──┌────────────────────────────────────────┐
 *   │  │ 20-Sep-2026  အခြားကားသို့ ပြောင်းရွေ့     │
 *   │  │ RF-11 · trailer-l1 → 9Q-5691 · U Soe   │
 *   │  │ ────────────────────────────────────── │
 *   │  │ Reported by U Hla Tun          3 hrs ago│
 *   │  └────────────────────────────────────────┘
 *   ○──┌────────────────────────────────────────┐
 *   │  │ 01-Jun-2026  စတိုသို့ရောက်ရှိ              │
 *   │  │ Main store                             │
 *   │  │ ────────────────────────────────────── │
 *   │  │                             2 months ago│
 *   │  └────────────────────────────────────────┘
 *
 * The history is a CARD TIMELINE, the way an operator reads a service book: one
 * event per card, strung on a hairline spine whose node carries the row's
 * IDENTITY — the actor's (or the approver's) directory photo, else their
 * monogram, else the event's own glyph when nobody is on the row at all (a kiosk
 * action, an inbound receipt). `line.face` decides that in ONE place
 * (`data/api.ts`), with name + photo + monogram bound together so the alt text
 * can never label the wrong person.
 *
 * The live-state header paints INSTANTLY from the resolved unit row; the history
 * body shimmers while `mro_serial_events` for exactly this unit loads (one
 * on-demand query per opened tyre, never per list row).
 */

/** A compact live-status pill in the header — reuses the register card pill. */
const StatusPill = TyreStatusPill;

/** Shimmer cards mirroring the settled timeline's title + fact + footer. */
function TimelineShimmer() {
	return (
		<div aria-hidden className="flex flex-col gap-2.5">
			{[0, 1, 2, 3].map((i) => (
				<div key={i} className={`${DENSE_CARD_FRAME} shadow-card p-2.5`}>
					<div className="flex items-center justify-between gap-2">
						<Shimmer className="h-3 w-2/5 rounded" />
						<Shimmer className="h-2.5 w-12 rounded" />
					</div>
					<Shimmer className="mt-2 h-3 w-4/5 rounded" />
					<Shimmer className="mt-2 h-2.5 w-1/2 rounded" />
				</div>
			))}
		</div>
	);
}

/** An event → its glyph. This is the node's icon when NOBODY is on the row —
 *  see `TimelineRow`, which prefers the person's photo. */
const EVENT_ICON: Record<TyreEventKind, LucideIcon> = {
	purchased: Receipt,
	returned: Undo2,
	fitted: CircleDotDashed,
	store_transferred: ArrowRightLeft,
	rotated: RotateCw,
	refitted: ArrowRightLeft,
	unseated: PackageOpen,
	issued: UserPlus,
	reissued: Users,
	written_off: ShieldOff,
	adjusted: SlidersHorizontal,
	checked: Gauge,
};

/**
 * ONE lifecycle event as a card on the timeline spine:
 *
 *   ●──┌─────────────────────────────────────────┐
 *   │  │ 20-Sep-2026  ကားတွင် ခနဖြုတ်သိမ်း         │
 *   │  │ 1TLR-8919 · drv1-lo → not on a wheel    │
 *   │  │ ─────────────────────────────────────── │
 *   │  │ Reported by U Hla Tun          3 hrs ago│
 *   │  └─────────────────────────────────────────┘
 *
 * The node sits ON the spine (its centre is the spine's x), so the event reads as
 * this unit's place in a story rather than as a separate column. The movement
 * line states the WHERE only — the people get their own labelled line, because a
 * name appended to a place ("1TLR-8919 → … · U Hla Tun") reads as part of the
 * location. A row nobody but the reporter is on leaves that half EMPTY: "No
 * approval needed" restated what the row's kind already said and buried the rows
 * that do carry a name.
 *
 * The card is a FIXED three-line shape — the effective DATE the transition took
 * effect CONCATENATED onto the title (the day reads before the event names it),
 * one slot for the event's own fact (where it moved, or the reading it recorded)
 * and a hairline footer holding WHO (left) and the AGE (right). Both time facts
 * come from the row's ONE effective instant (`effectiveDate` + `timestamp`) —
 * never from the moment it was written — and the two lower slots render even when
 * empty, which is what keeps every card the same height.
 */
function TimelineRow({ line, latest }: { line: TyreEventLine; latest: boolean }) {
	const Icon = EVENT_ICON[line.kind] ?? Boxes;
	const age = line.timestamp ? formatRelativeTime(line.timestamp) : null;
	const effectiveDate = formatEnglishDateLabel(line.effectiveDate);
	const reporter = line.actor?.name ?? null;
	const party = line.party;
	const reading = [
		line.treadMm != null ? `Tread ${line.treadMm} mm` : null,
		line.psi != null ? `${line.psi} psi` : null,
		line.condition ? line.condition[0].toUpperCase() + line.condition.slice(1) : null,
	].filter((part): part is string => Boolean(part));
	return (
		<li className="relative">
			{/* The node ON the spine — the row's identity, not decoration: the
			   reporter's (or the approver's) photo, else their monogram, else the
			   event's glyph when NOBODY is on the row. A monogram beats the glyph
			   because the glyph is identical on every row of its kind (it says which
			   event happened, which the title already says), while initials still
			   answer the slot's one question: who.

			   The LATEST event's node is filled and every older one is an outline, so
			   the unit's current state reads at a glance without a legend. */}
			<Avatar className="absolute -left-7 top-1 z-10 size-6 border-2 border-background">
				{line.face?.photo ? <AvatarImage src={line.face.photo} alt={line.face.name} /> : null}
				<AvatarFallback className={latest ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}>
					{line.face ? (
						<>
							<span aria-hidden className="text-[9px] font-semibold tracking-wide">
								{line.face.monogram}
							</span>
							<span className="sr-only">{line.face.name}</span>
						</>
					) : (
						<Icon className="size-3" strokeWidth={2} aria-hidden />
					)}
				</AvatarFallback>
			</Avatar>

			<div className={`${DENSE_CARD_FRAME} shadow-card p-2.5`}>
				{/* The effective DATE leads the title — the day reads before the event
				    names it ("20-Sep-2026  ကားတွင် ခနဖြုတ်သိမ်း"), so an operator scanning
				    the column meets WHEN first. It sits INSIDE the paragraph (an inline
				    run), so a wrapped Burmese label still hangs off it — a flex column
				    would make the title a second line. The title is BURMESE:
				    `leading-myanmar` gives the stacked diacritics the headroom a
				    `leading-tight` box clips, and it WRAPS rather than truncating. */}
				<p className="min-w-0 text-sub font-semibold leading-myanmar break-words text-foreground">
					{effectiveDate ? (
						<span className="mr-1.5 text-[10px] font-semibold tabular-nums whitespace-nowrap text-muted-foreground">
							{effectiveDate}
						</span>
					) : null}
					{line.title}
				</p>
				{/* The event's OWN fact — where it moved (or the reading it recorded) —
				    in a fixed-height slot, so a movement card and an inspection card are
				    the same height. */}
				<p className="mt-0.5 min-h-[15px] text-xs leading-snug text-muted-foreground">
					{reading.length > 0 ? (
						<span className="font-semibold tabular-nums text-foreground">{reading.join(' · ')}</span>
					) : (
						line.detail
					)}
				</p>
				{/* The card's footer under a hairline: WHO (left) and the AGE (right).
				    Always rendered so every card keeps one height; a name equal to the
				    reporter is skipped upstream, so the same person is never printed twice. */}
				<div className="mt-1.5 flex min-w-0 items-center justify-between gap-2 border-t border-border/50 pt-1.5 text-[10px] leading-none">
					<span className="min-w-0 truncate font-medium leading-myanmar text-muted-foreground">
						{reporter ? (
							<>
								Reported by <span className="font-semibold text-foreground">{reporter}</span>
							</>
						) : null}
						{party ? (
							<>
								{reporter ? ' · ' : null}
								{party.label} <span className="font-semibold text-foreground">{party.name}</span>
							</>
						) : null}
					</span>
					{age ? (
						<span className="shrink-0 font-medium tabular-nums whitespace-nowrap text-muted-foreground">{age}</span>
					) : null}
				</div>
			</div>
		</li>
	);
}

/**
 * The "Inspect" affordance — record ONE real tread reading on an ISSUED (in-use)
 * tyre through the engine's `POST /serials/:id/check` route.
 *
 *  ┌──────────────────────────────────────────────┐
 *  │ (chevron)  Record inspection        [open] ▾  │
 *  │   Tread depth (mm)  [ 14.2 ]   max 14 mm      │
 *  │   Condition         [ Good ]                  │
 *  │   Note              [ monthly check     ]     │
 *  │   [Save reading]                              │
 *  │   ✓ Reading saved · Tread inspected · just now│
 *  └──────────────────────────────────────────────┘
 *
 * Tread is CAPPED at the SKU's NEW-tread baseline (`referenceTreadMm`): a tyre
 * cannot be thicker than it was when new, so a larger number is a typo or a wrong
 * unit — refused rather than stored (no baseline ⇒ nothing to cap against).
 * Only tread + a condition grade are collected — inflation pressure is not part
 * of a tread check.
 *
 * The recorded actor is the CURRENT logged-in employee (attributed `by_user`).
 * On success the parent refreshes: the timeline picks up the new `checked` event
 * and the register/fitment caches are invalidated so the remaining-tread % moves.
 * Collapsed by default; only ISSUED units can be measured (in-stock/scrapped
 * have no wear) so the trigger is hidden for them.
 */
export function InspectSection({ tyre, onRecorded, defaultOpen }: { tyre: TyreCardModel; onRecorded: () => void; defaultOpen?: boolean }) {
	const [open, setOpen] = useState(!!defaultOpen);
	const [tread, setTread] = useState('');
	const [condition, setCondition] = useState('');
	const [note, setNote] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState<string | null>(null);

	// Only issued (in-use) units have measurable wear. When closed we still keep a
	// mount guard so the affordance only appears on real truck tyres.
	if (tyre.status !== 'issued') return null;

	// A tyre is measured by tread; any other asset (a jack, a toolbox) by a
	// condition grade alone.
	const isTyre = tyre.kind === 'tyre';
	// The NEW-tread baseline this reading can never exceed — absent when the SKU
	// carries no reference, in which case there is nothing to cap against.
	const maxTreadMm = tyre.referenceTreadMm != null && tyre.referenceTreadMm > 0 ? tyre.referenceTreadMm : null;

	const submit = async () => {
		setError(null);
		setDone(null);
		const treadMm = tread.trim() === '' ? null : Number(tread);
		const grade = condition.trim() || null;
		if (isTyre && (treadMm == null || Number.isNaN(treadMm)) && !grade) {
			setError('Enter a measured tread depth (mm) or a condition grade — a reading needs at least one.');
			return;
		}
		if (!isTyre && !grade) {
			setError('Choose a condition grade for this asset.');
			return;
		}
		if (treadMm != null && (!Number.isFinite(treadMm) || treadMm < 0)) {
			setError('Tread depth must be a positive number in millimetres.');
			return;
		}
		// A tyre cannot be thicker than it was brand new — the baseline is the cap.
		if (treadMm != null && maxTreadMm != null && treadMm > maxTreadMm) {
			setError(`Tread depth cannot exceed this tyre's new-tread reading of ${maxTreadMm} mm.`);
			return;
		}
		setBusy(true);
		try {
			const actor = await fetchCurrentEmployee();
			if (!actor) throw new Error('No employee account is linked to this session — someone else must take this reading.');
			const result = await recordTyreCheck(tyre.id, {
				actorId: actor.id,
				treadMm: treadMm != null && !Number.isNaN(treadMm) ? treadMm : null,
				condition: grade,
				note: note.trim() || undefined,
			});
			hapticImpact('medium');
			setTread('');
			setCondition('');
			setNote('');
			const parts = [
				result.tread_mm != null ? `${result.tread_mm} mm` : null,
				grade ? `${grade[0].toUpperCase()}${grade.slice(1)}` : null,
			].filter(Boolean);
			setDone(`Recorded ${parts.join(' · ') || 'reading'} — ${actor.name}.`);
			setOpen(false);
			onRecorded();
		} catch (err) {
			hapticImpact('light');
			console.error('[tyres] inspect failed', err);
			setError(err instanceof Error && err.message ? err.message : 'Could not save this reading — try again.');
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="mt-4 rounded-xl border border-border/70 bg-card">
			<button
				type="button"
				onClick={() => {
					hapticSelection();
					setOpen((v) => !v);
					setError(null);
				}}
				className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left outline-none rounded-xl focus-visible:ring-2 focus-visible:ring-ring"
				aria-expanded={open}
			>
				<span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
					{done ? <Check className="size-4 text-status-success" aria-hidden /> : <Gauge className="size-4" aria-hidden />}
				</span>
				<span className="min-w-0 flex-1">
					<span className="block text-sub font-semibold leading-tight text-foreground">Record inspection</span>
					<span className="block text-meta leading-snug text-muted-foreground">
						{done ?? 'Measure the remaining tread while this tyre is on the truck.'}
					</span>
				</span>
				<X className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-45' : ''}`} aria-hidden />
			</button>

			{open ? (
				<div className="border-t border-border/70 px-3 pt-3 pb-3.5">
					{isTyre ? (
						<label className="flex flex-col gap-1">
							<span className="flex items-baseline justify-between gap-2">
								<span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Tread depth (mm)</span>
								{maxTreadMm != null ? (
									<span className="text-[10px] font-medium tabular-nums text-muted-foreground">max {maxTreadMm} mm</span>
								) : null}
							</span>
							<input
								inputMode="decimal"
								type="number"
								step="0.1"
								min="0"
								max={maxTreadMm ?? undefined}
								value={tread}
								placeholder={maxTreadMm != null ? `new ${maxTreadMm} mm` : 'e.g. 14.2'}
								onChange={(e) => setTread(e.target.value)}
								className="h-10 w-full rounded-lg border border-input bg-card px-2 text-right text-sm font-semibold tabular-nums text-foreground outline-none focus:border-ring/60"
								aria-label="Measured tread depth in millimetres"
							/>
						</label>
					) : null}
					<label className={`${isTyre ? 'mt-2.5 ' : ''}flex flex-col gap-1`}>
						<span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Condition</span>
						<select
							value={condition}
							onChange={(e) => setCondition(e.target.value)}
							className="h-10 w-full rounded-lg border border-input bg-card px-2 text-sm font-semibold text-foreground outline-none focus:border-ring/60"
							aria-label="Asset condition grade"
						>
							<option value="">{isTyre ? 'Not graded' : 'Choose a grade…'}</option>
							<option value="good">Good</option>
							<option value="fair">Fair</option>
							<option value="poor">Poor</option>
							<option value="damaged">Damaged</option>
						</select>
					</label>
					<label className="mt-2.5 flex flex-col gap-1">
						<span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Note</span>
						<input
							value={note}
							onChange={(e) => setNote(e.target.value)}
							placeholder="e.g. monthly wear check"
							className="h-10 w-full rounded-lg border border-input bg-card px-2 text-sm font-medium text-foreground outline-none focus:border-ring/60"
							aria-label="Inspection note"
						/>
					</label>
					<button
						type="button"
						disabled={busy}
						onClick={() => void submit()}
						className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
					>
						<ClipboardCheck className="size-4" aria-hidden />
						{busy ? 'Saving…' : 'Save reading'}
					</button>
					{error ? (
						<p className="mt-2.5 rounded-lg bg-status-danger-soft px-3 py-2 text-xs leading-snug text-status-danger">{error}</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}

/**
 * The detail body's "Move" affordance — hand off to a picker of the FREE wheel
 * seats a mounted tyre can go to. Presented inline (tap the Move row → a
 * destination grid appears).
 */
/**
 * The detail body's "Move" affordance — the SAME-TRUCK re-seat writer for a
 * MOUNTED tyre: rotate it to another free wheel seat on the truck that already
 * holds it. A seat change that keeps the truck does not change the HOLDER, so
 * the engine writes it directly.
 *
 * A cross-truck move is deliberately NOT offered here — it CHANGES the holder
 * and is therefore an approval-gated shape (`assertCustodyChangeAllowed`): it is
 * FILED from the truck board's action menu (`Request a transfer`), which records
 * an `mro_asset_requests` row a recorded superior must approve and execute.
 * Offering a second truck on this screen would render a form the writer 403s on,
 * so the destination list is narrowed to the current truck and no truck picker is
 * shown at all.
 *
 * Presented inline (tap the Move row → a destination grid appears).
 */
export function MovePositionSection({
	tyre,
	onRecorded,
	defaultOpen,
}: {
	tyre: TyreCardModel;
	onRecorded: () => void;
	defaultOpen?: boolean;
}) {
	const navigate = useNavigate();
	const vehicles = useVehicleMasters();
	const lookupsReady = !vehicles.isPending;
	// A mounted tyre can only move to a seat the OTHER mounted tyres leave free —
	// the shared mounted-set read (server-scoped, display-ready — no register
	// walk). Fetched lazily: only for a tyre that CAN move (issued + seated) AND
	// only once the Move section is opened (never fire it for an in-stock tyre or
	// a collapsed section). The query is keyed `qk.mountedTyres()`, the SAME cache
	// the fitment board fills, so an already-warm board costs nothing here.
	const canMove = tyre.status === 'issued' && !!tyre.plateNo;
	const [open, setOpen] = useState(!!defaultOpen);
	const mountedQuery = useQuery({
		queryKey: qk.mountedTyres(),
		queryFn: () => fetchMountedTyres(),
		enabled: lookupsReady && canMove && open,
		staleTime: TYRE_STALE_MS,
	});

	const [slotId, setSlotId] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState<string | null>(null);

	// Stable fallbacks — `data ?? []` allocates on every render, which would re-run
	// every memo below for nothing.
	const vehicleList = useMemo(() => vehicles.data ?? [], [vehicles.data]);
	const mountedList = useMemo(() => mountedQuery.data ?? [], [mountedQuery.data]);

	// The truck that holds this tyre — the ONLY truck on offer. Resolved from the
	// plate, so the seat list below is scoped to the unit's own chassis.
	const currentVehId = useMemo(
		() => (tyre.plateNo ? (vehicleList.find((v) => v.plate_no?.trim() === tyre.plateNo)?.id ?? null) : null),
		[vehicleList, tyre.plateNo],
	);

	// Every FREE seat on ITS OWN truck for this tyre (current seat + occupied seats
	// excluded) — cross-truck seats are dropped because moving to one would change
	// the holder. Computed unconditionally (hooks must run before the early return
	// below); it's only rendered once a mounted tyre is the subject.
	const targets = useMemo(
		() => freeFitmentTargets(tyre, vehicleList, mountedList).filter((target) => target.vehicleId === currentVehId),
		[tyre, vehicleList, mountedList, currentVehId],
	);

	// The truck's own rig — assembled from the SAME reads the truck page uses (the
	// plate master + every mounted card → `buildFleetBoard`), so the drawing here is
	// literally the board that truck shows, free seats included. Keyed on the truck
	// that HOLDS this tyre: there is no destination truck to choose.
	const destBoard = useMemo(
		() => (currentVehId ? (buildFleetBoard(vehicleList, mountedList).find((board) => board.id === currentVehId) ?? null) : null),
		[currentVehId, vehicleList, mountedList],
	);
	const destRows = useMemo(() => (destBoard ? axleRowsOf(destBoard) : []), [destBoard]);
	// The seats THIS tyre's rule leaves open on its own truck — the picker's rule.
	const freeSeatIds = useMemo(() => new Set(targets.map((t) => t.slotId)), [targets]);

	// Only a MOUNTED (issued + seated) tyre can move — hidden otherwise.
	if (tyre.status !== 'issued' || !tyre.plateNo) return null;

	// Rotate within the truck that already holds this tyre. The destination truck is
	// FIXED (`currentVehId`) — a seat change that keeps the truck does not change the
	// holder, which is exactly why this path is direct.
	const submit = async () => {
		setError(null);
		setDone(null);
		if (!currentVehId || !slotId) {
			setError('Choose a free wheel seat first.');
			return;
		}
		setBusy(true);
		try {
			const actor = await fetchCurrentEmployee();
			if (!actor) throw new Error('No employee account is linked to this session — someone else must move this tyre.');
			const res = await moveTyrePosition(tyre.id, { actorId: actor.id, toVehicle: currentVehId, toSlot: slotId, note: 'position change' });
			hapticImpact('medium');
			setDone(`${res.event === 'rotated' ? 'Rotated' : 'Moved'} — move saved.`);
			setOpen(false);
			setSlotId(null);
			onRecorded();
		} catch (err) {
			hapticImpact('light');
			console.error('[tyres] move failed', err);
			setError(err instanceof Error && err.message ? err.message : 'Could not move this tyre — try again.');
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="mt-2.5">
			{/* Cross-link — hop to the truck this tyre currently sits on (its wheel
			    plan) so the mounting context is one tap away, not a re-search. */}
			{currentVehId && tyre.plateNo ? (
				<button
					type="button"
					onClick={() => {
						hapticSelection();
						navigate(`/app/tyres/vehicle/${currentVehId}`);
					}}
					className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-meta font-semibold leading-none text-foreground transition-transform duration-150 active:scale-95"
				>
					<Truck className="size-3.5" aria-hidden />
					On {tyre.plateNo} · Wheel Condition
				</button>
			) : null}
			<button
				type="button"
				onClick={() => {
					hapticSelection();
					setOpen((v) => !v);
					setError(null);
				}}
				className="flex w-full items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
				aria-expanded={open}
			>
				<span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
					{done ? <Check className="size-4 text-status-success" aria-hidden /> : <Move className="size-4" aria-hidden />}
				</span>
				<span className="min-w-0 flex-1">
					<span className="block text-sub font-semibold leading-tight text-foreground">{done ?? 'Move to another position'}</span>
					<span className="block text-meta leading-snug text-muted-foreground">
						{done ?? 'Rotate to another free wheel seat on this truck.'}
					</span>
				</span>
				<X className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-45' : ''}`} aria-hidden />
			</button>

			{open ? (
				<div className="mt-2 rounded-xl border border-border/70 bg-card p-3">
					{mountedQuery.isPending ? (
						<p className="text-xs leading-snug text-muted-foreground">Finding free wheel seats…</p>
					) : targets.length === 0 ? (
						<p className="text-xs leading-snug text-muted-foreground">
							Every other wheel position on <b>{tyre.plateNo}</b> is already filled — no free seat to rotate to. Free one up, or file a
							transfer to move it to another truck.
						</p>
					) : (
						<>
							{/* It stays on the truck that holds it — the fixed destination is stated, not
							    picked: a rotation keeps the holder, so there is nothing to choose here. */}
							<p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">On {tyre.plateNo}</p>

							{/* The truck's OWN rig — the same chassis drawing the truck page renders,
							    with its free seats as the tap targets. Reading the gap beats decoding a
							    list of seat codes. */}
							<p className="mt-3 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Free wheel position</p>
							<div className="mt-2">
								{destRows.length > 0 ? (
									<WheelSeatPicker
										rows={destRows}
										freeSeatIds={freeSeatIds}
										selectedSeatId={slotId}
										currentSeatId={tyre.slot}
										onSelect={(next) => {
											setSlotId(next);
											setError(null);
										}}
									/>
								) : (
									<p className="text-xs leading-snug text-muted-foreground">This plate declares no wheel layout.</p>
								)}
							</div>

							<button
								type="button"
								disabled={busy || !slotId}
								onClick={() => void submit()}
								className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
							>
								<Move className="size-4" aria-hidden />
								{busy ? 'Moving…' : slotId ? 'Rotate here' : 'Tap a free wheel seat'}
							</button>
							{error ? (
								<p className="mt-2.5 rounded-lg bg-status-danger-soft px-3 py-2 text-xs leading-snug text-status-danger">{error}</p>
							) : null}

							{/* The governed path, stated where the operator looks for a cross-truck
							    move. It is a FILING, not a write, so it lives on the transfer screen —
							    a second truck is deliberately absent from the seat grid above. */}
							<p className="mt-3 border-t border-border/60 pt-2.5 text-meta leading-snug text-muted-foreground">
								Moving to <b>another truck</b> needs a superior’s approval — file it from the unit’s <b>Request a transfer</b> action.
							</p>
						</>
					)}
				</div>
			) : null}
		</div>
	);
}

interface TyreDetailBodyProps {
	/** The resolved serial unit — the LIVE snapshot the header paints instantly
	 *  from while the history loads. */
	tyre: TyreCardModel;
}

/**
 * Hand a LOOSE asset out of the store — store stock (or an un-worn tyre with no
 * wheel seat) into an employee's custody. This is the DIRECT writer behind an
 * employee's asset register, and it is direct because a store → person issue does
 * not change a holder: the store is not one.
 *
 * An ALREADY-HELD unit is deliberately given NOTHING here. Custody moving from one
 * holder to another is the approval-gated shape (`assertCustodyChangeAllowed`), and
 * that filing lives where the holder is MANAGED — the truck board's action menu
 * (`Request a transfer`) and the holder's own register — not on this page, which is
 * a READ-ONLY life-story: the timeline below is the whole point of opening a unit.
 * A SEATED unit is likewise not offered: take it off the wheel first so its seat is
 * freed.
 */
function CustodySection({ tyre }: { tyre: TyreCardModel }) {
	const queryClient = useQueryClient();
	const [employeeId, setEmployeeId] = useState('');
	const [employeeName, setEmployeeName] = useState('');
	const [pickerOpen, setPickerOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState<string | null>(null);

	// Only the store → person issue is direct, and only from the store. A held unit
	// offers no form here — its governed path is the board's transfer request.
	if (tyre.status !== 'in_stock') return null;

	const submit = async () => {
		setError(null);
		setDone(null);
		if (!employeeId) {
			setError('Choose the employee who takes custody.');
			return;
		}
		setBusy(true);
		try {
			const actor = await fetchCurrentEmployee();
			if (!actor) throw new Error('No employee account is linked to this session — someone else must hand this over.');
			await issueAsset(tyre.id, { actorId: actor.id, toEmployee: employeeId });
			hapticImpact('medium');
			setEmployeeId('');
			setEmployeeName('');
			setDone('Custody assigned — the asset now shows in that employee’s register.');
			void queryClient.invalidateQueries({ queryKey: qk.holderAssets() });
			void queryClient.invalidateQueries({ queryKey: qk.tyreEvents(tyre.id) });
			void queryClient.invalidateQueries({ queryKey: qk.tyreUnit(tyre.id) });
		} catch (err) {
			hapticImpact('light');
			setError(err instanceof Error && err.message ? err.message : 'Could not assign custody — try again.');
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="mt-4 rounded-xl border border-border/70 bg-card px-3 py-3">
			<p className="text-sub font-semibold leading-tight text-foreground">Assign to employee</p>
			<p className="mt-0.5 text-meta leading-snug text-muted-foreground">
				Issues this in-store asset into a person’s custody (it leaves store stock).
			</p>
			<div className="mt-2.5 flex gap-2">
				<button
					type="button"
					onClick={() => setPickerOpen(true)}
					disabled={busy}
					aria-label="Employee taking custody"
					className={`flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm outline-none focus-visible:border-ring/60 disabled:opacity-50 ${employeeId ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
				>
					<span className="min-w-0 flex-1 truncate leading-myanmar">{employeeId ? employeeName : 'Choose employee…'}</span>
					<Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
				</button>
				<button
					type="button"
					disabled={busy || !employeeId}
					onClick={() => void submit()}
					className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
				>
					{busy ? 'Saving…' : 'Assign'}
				</button>
			</div>
			{error ? <p className="mt-2 rounded-lg bg-status-danger-soft px-3 py-2 text-xs leading-snug text-status-danger">{error}</p> : null}
			{done ? <p className="mt-2 text-xs leading-snug text-status-success">{done}</p> : null}

			<PersonnelPickerSheet
				open={pickerOpen}
				onOpenChange={setPickerOpen}
				value={employeeId && employeeName ? [{ id: employeeId, name: employeeName, photo: null }] : []}
				onToggle={(person) => {
					setEmployeeId(person.id);
					setEmployeeName(person.name);
				}}
				title="Assign custody"
				singleSelect
			/>
		</div>
	);
}

export function TyreDetailBody({ tyre }: TyreDetailBodyProps) {
	// The unit's immutable history — one on-demand read for THE opened serial.
	const history = useQuery({
		queryKey: qk.tyreEvents(tyre.id),
		queryFn: () => fetchTyreEvents(tyre.id),
		staleTime: TYRE_STALE_MS,
	});
	const events = history.data ?? [];
	const noHistory = !history.isPending && events.length === 0;
	// Remaining tread as a BAR — measurement-only: the track paints ONLY when a REAL
	// `checked` reading AND the SKU's new-tread baseline exist (`remainingTreadPercent`
	// guards both), never an estimate.
	const treadPercent = remainingTreadPercent(tyre);

	return (
		<div className="flex flex-1 flex-col">
			{/* Header — the LIVE snapshot: model + status pill, and the measured tread
			   with its bar. The SERIAL is the app-bar title above (like the plate on a
			   vehicle page), so it is not repeated here. */}
			<div className={`${DENSE_CARD_FRAME} shadow-card p-3`}>
				<div className="flex min-w-0 items-center justify-between gap-3">
					<p className="min-w-0 truncate text-key font-bold leading-tight tracking-tight text-foreground capitalize">
						{tyre.modelName ?? '—'}
					</p>
					<StatusPill status={tyre.status} />
				</div>
				{treadPercent != null ? (
					<div className="mt-2 rounded-lg border border-border/60 bg-muted/40 p-2">
						<div className="flex items-baseline justify-between gap-2 text-[11px]">
							<span className="font-medium text-muted-foreground">Remaining tread</span>
							<span className="font-bold tabular-nums text-foreground">{treadReadingLabel(tyre)}</span>
						</div>
						<div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border/70">
							<div className="h-full rounded-full bg-foreground" style={{ width: `${treadPercent}%` }} />
						</div>
					</div>
				) : null}
			</div>

			{/* Custody — hand a loose/store asset to a person (hidden for seated units). */}
			<CustodySection tyre={tyre} />

			{/* The unit's WHOLE immutable history — a card timeline on a hairline spine,
			   newest at the top. This page is a pure life-story: every ACTION on a tyre
			   lives on the wheel-position board (the kiosk), and a governed truck→truck
			   move is filed from there too, so nothing here competes with the timeline. */}
			<div className="mt-4">
				<div className="flex items-center justify-between gap-2 px-0.5">
					<p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Lifecycle history</p>
					{events.length > 0 ? (
						<span className="text-[10px] font-medium tabular-nums text-muted-foreground">
							{events.length} event{events.length === 1 ? '' : 's'}
						</span>
					) : null}
				</div>
				{history.isPending ? (
					<div className="mt-3">
						<TimelineShimmer />
					</div>
				) : history.isError ? (
					<div className="mt-2 px-1">
						<p className="text-sub leading-snug text-status-danger">Couldn't load the lifecycle history.</p>
						<button
							type="button"
							onClick={() => void history.refetch()}
							className="mt-2 rounded-full border border-border px-3 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-muted/60"
						>
							Try again
						</button>
					</div>
				) : noHistory ? (
					<p className="mt-2 px-1 text-sub leading-snug text-muted-foreground">
						No lifecycle events yet — this unit’s history starts once it is received, issued, transferred or fitted.
					</p>
				) : (
					/* The spine sits at x=12px of this container — the node (-left-7, size-6)
					   centres on it, so the icon reads as ON the line, not beside it. */
					<div className="relative mt-3 pl-7">
						<span aria-hidden className="absolute top-3 bottom-3 left-[11.5px] w-px bg-border" />
						<ul className="flex flex-col gap-2.5">
							{events.map((line, index) => (
								<TimelineRow key={line.id} line={line} latest={index === 0} />
							))}
						</ul>
					</div>
				)}
			</div>
		</div>
	);
}
