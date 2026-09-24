import { useNavigate } from 'react-router-dom';
import {
	ArrowRightLeft,
	ArrowUp,
	Ban,
	ChevronRight,
	Gauge,
	History,
	Move,
	PackageOpen,
	RotateCw,
	Trash2,
	X,
	type LucideIcon,
} from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@mmbix/design-system/sheet';

import { onBoardActions, type BoardActionKind, type BoardUnitState } from '../data/board-actions';
import { seatCodeById } from '../data/layout';
import { treadBandOf, type TreadBand } from '../data/readings';
import { TYRE_STATUS_META } from '../data/status';
import type { TyreCardModel } from '../data/types';
import type { VehicleBoardState } from '../data/board';
import type { VehWheelSeat } from '../data/spec';
import { hapticSelection } from '@/shared/platform/haptics';

/**
 * The ACTION MENU for ONE unit of a truck's on-board registry — the surface a row of
 * the registry list (`truck-inventory-list.tsx`) opens when it is tapped.
 *
 * It renders the pure rule (`onBoardActions`) as a BOTTOM SHEET — a vertical list of
 * verbs, so a 10-wheel truck's full set never wraps into a tower of buttons and the
 * list body is never pushed around. An action the engine would refuse stays VISIBLE,
 * inert, WITH ITS REASON under its label (Poka-Yoke — the operator is told why, never
 * left guessing).
 *
 * Every verb leaves for its OWN full-screen page (`/app/tyres/vehicle/:id/action/
 * :kind/:tyreId`, which carries the app bar's real back) — the six route kinds, the
 * governed `transfer` filer, and `history`. The sheet itself is single-paned: it hands
 * off, it never stacks a second surface. `wear` is the ONE hand-off to a sibling
 * overlay the list hosts (the wheel picker), so this sheet closes first.
 */

/** The tread-band text tone for a measured depth (no reading → muted). */
const BAND_TONE: Record<TreadBand, string> = {
	good: 'text-status-success',
	warn: 'text-status-warning',
	danger: 'text-status-danger',
};

/** One measured depth — plain mm text (12.9 / 8 / 4.5 …). */
function depthText(treadMm: number): string {
	const rounded = Math.round(treadMm * 10) / 10;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function UnitActionSheet({
	vehicle,
	unit,
	state,
	vacantSeats,
	peers,
	onOpenHistory,
	onWear,
	onClose,
}: {
	/** The truck whose registry this unit belongs to — builds the action routes and
	 *  supplies the vacant seats the wear picker offers. */
	vehicle: VehicleBoardState;
	/** The unit being acted on. */
	unit: TyreCardModel;
	/** Its state on the truck — decides the verb set (`onBoardActions`). */
	state: BoardUnitState;
	/** This truck's VACANT wheel seats, in draw order (the wear picker's options). */
	vacantSeats: VehWheelSeat[];
	/** How many OTHER tyres are seated on this truck (a swap needs a second one). */
	peers: number;
	/** Open the unit's lifecycle page (`history`). */
	onOpenHistory: (unit: TyreCardModel) => void;
	/** Hand off to the wheel picker (`wear`) — the list hosts it, so this sheet closes. */
	onWear: (unit: TyreCardModel) => void;
	/** Dismiss the sheet (its close control, the backdrop, or Escape). */
	onClose: () => void;
}) {
	const navigate = useNavigate();

	const actions = onBoardActions(state, {
		vacantSeats: vacantSeats.length,
		peers,
		// Only an issued unit can be filed for a governed move — the same rule the
		// filer enforces, so the menu refuses it here rather than after a tap.
		transferable: unit.status === 'issued',
	});

	/** The seat label this unit sits on (a mounted tyre), or null when off a wheel.
	 *  Prefers the truck's own display code (`A2-1`) so the header matches the rig. */
	const seatLabel = unit.slot ? (seatCodeById(vehicle).get(unit.slot) ?? unit.slot) : null;
	const status = TYRE_STATUS_META[unit.status];
	const band = treadBandOf(unit.treadMm);
	const bandTone = band ? BAND_TONE[band] : 'text-muted-foreground';

	/** A row's icon — one map, so a kind can never render a stale glyph. */
	const ICON: Record<BoardActionKind, LucideIcon> = {
		history: History,
		inspect: Gauge,
		move: Move,
		swap: RotateCw,
		unseat: PackageOpen,
		scrap: Trash2,
		wear: ArrowUp,
		transfer: ArrowRightLeft,
	};

	/** Where a verb goes: its own full-screen page, the lifecycle page, or the list-hosted
	 *  wheel picker (wear). Nothing is answered inside the sheet itself. */
	const run = (kind: BoardActionKind) => {
		onClose();
		if (kind === 'history') {
			onOpenHistory(unit);
			return;
		}
		if (kind === 'wear') {
			onWear(unit);
			return;
		}
		navigate(`/app/tyres/vehicle/${vehicle.id}/action/${kind}/${unit.id}`);
	};

	return (
		<Sheet
			open
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<SheetContent side="bottom" showCloseButton={false} className="gap-0 p-0">
				{/* The unit's identity, merged into the sheet header: what is being acted
				    on (serial + lifecycle), where it sits (the plate + wheel position), and
				    what it measures — decided before a verb is ever offered. */}
				<div className="flex items-start gap-2 border-b border-border/70 px-4 pt-4 pb-3">
					<div className="min-w-0 flex-1">
						<SheetTitle className="flex items-center gap-1.5 text-[14px] leading-tight font-bold tracking-tight">
							<span className="truncate font-mono">{unit.serialNo ?? 'Unit'}</span>
							<span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] leading-none font-semibold ${status.className}`}>
								{status.label}
							</span>
						</SheetTitle>
						<SheetDescription className="mt-1 flex flex-wrap items-center gap-1.5 text-meta leading-tight font-medium">
							{unit.plateNo ? (
								<span className="rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-foreground">
									{unit.plateNo}
								</span>
							) : null}
							<span className="truncate">{seatLabel ?? unit.employeeName ?? 'Off wheels'}</span>
							{unit.modelName ? <span className="truncate">· {unit.modelName}</span> : null}
							{unit.treadMm != null ? <span className={`font-bold tabular-nums ${bandTone}`}>· {depthText(unit.treadMm)} mm</span> : null}
						</SheetDescription>
					</div>

					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="-mt-0.5 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
					>
						<X className="size-4" aria-hidden />
					</button>
				</div>

				{/* The verbs — the rule's own set, each with its Burmese gloss, and a refused
				    one inert with its reason instead of hidden (Poka-Yoke). */}
				<div className="flex max-h-[70dvh] flex-col gap-1.5 overflow-y-auto px-4 pt-3 pb-safe">
					{actions.map((action) => {
						const Icon = ICON[action.kind];
						const enabled = action.enabled;
						const danger = action.kind === 'scrap';
						return (
							<button
								key={action.kind}
								type="button"
								disabled={!enabled}
								aria-disabled={!enabled}
								onClick={() => {
									if (!enabled) return;
									hapticSelection();
									run(action.kind);
								}}
								className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] ${
									!enabled
										? 'cursor-not-allowed border-border/60 bg-muted/30 text-muted-foreground'
										: danger
											? 'border-status-danger/30 bg-status-danger-soft text-status-danger'
											: 'border-border bg-card text-foreground hover:bg-muted/40'
								}`}
							>
								<span
									className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
										!enabled ? 'bg-muted/50' : danger ? 'bg-status-danger/15' : 'bg-primary/10 text-primary'
									}`}
								>
									<Icon className="size-4" aria-hidden />
								</span>
								<span className="min-w-0 flex-1">
									<span className="block text-sub leading-tight font-semibold">{action.label}</span>
									<span className="mt-0.5 block text-meta leading-myanmar opacity-80">{action.hint}</span>
									{enabled ? null : <span className="mt-1 block text-meta leading-snug font-semibold">{action.reason}</span>}
								</span>
								{enabled ? (
									<ChevronRight className="size-4 shrink-0 opacity-50" aria-hidden />
								) : (
									<Ban className="size-3.5 shrink-0 opacity-60" aria-hidden />
								)}
							</button>
						);
					})}
				</div>
			</SheetContent>
		</Sheet>
	);
}
