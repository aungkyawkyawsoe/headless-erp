import { useMemo, useState } from 'react';
import { Check, Disc3, LoaderCircle, X } from 'lucide-react';

import { WheelSeatPicker } from './tyre-wheel-plan';
import { fitTyreToSeat } from '../data/api';
import { requireActorId } from '../data/actor';
import { axleRowsOf, seatCodeById } from '../data/layout';
import { treadBandOf } from '../data/readings';
import { TyreStatusPill } from './tyre-status-pill';
import type { TyreCardModel } from '../data/types';
import type { VehicleBoardState } from '../data/board';
import { hapticImpact, hapticSelection } from '@/shared/platform/haptics';

/** The stable "no seat is free" set used while a fit is in flight — one frozen
 *  instance, so the picker's memo never re-runs for nothing. */
const EMPTY_SEATS: ReadonlySet<string> = new Set<string>();

/** The tread-band text tone for the unit's measured depth (no reading → muted). */
function bandTone(band: ReturnType<typeof treadBandOf>): string {
	if (band === 'good') return 'text-status-success';
	if (band === 'warn') return 'text-status-warning';
	if (band === 'danger') return 'text-status-danger';
	return 'text-muted-foreground';
}

/**
 * WEAR ON A WHEEL POSITION — the truck's OWN rig, reopened as the seat picker.
 *
 * The action menu's `Wear on a wheel position` verb used to hand off to a dialog
 * listing the vacant seats as chips: the operator had to translate `A2-2` into a
 * mental picture of the truck, then trust it. This instead shows the SAME chassis
 * drawing the truck page renders (`WheelSeatPicker` — one component, so the picker
 * and the board can never drift), with a `+` on every FREE seat: the gap you can
 * see is the thing you tap, while the occupied wheels stay as context and are never
 * tappable (Poka-Yoke: a wheel carrying a tyre cannot be chosen).
 *
 * It is opened as VIEW state (`?serial=<unit id>` on the same vehicle route), so the
 * app bar's back and a reload both behave: entering the mode is a URL write, leaving
 * it clears the param. The mode CARRIES the unit — the operator already decided which
 * un-worn tyre when they tapped its row, so nothing re-asks it here.
 *
 * ONE writer: a free seat tap fits that unit onto that wheel (`fitTyreToSeat` →
 * `POST /serials/:id/fit`), so the truck's tray loses it and its lifecycle gains the
 * immutable `fitted` event. While that call is in flight the picker is handed NO free
 * seat, so every tile reverts to the read-only drawing and a double tap cannot file
 * two fits.
 */
export function WearOnWheelPanel({
	vehicle,
	tyre,
	onPlaced,
	onCancel,
}: {
	/** The truck whose wheels are being filled — the same board the page drew. */
	vehicle: VehicleBoardState;
	/** The un-worn tyre to place (the row the operator tapped). */
	tyre: TyreCardModel;
	/** Called after a successful fit with the changed serial ids, so the page can
	 *  invalidate the register + those serials' history. */
	onPlaced: (serialIds: readonly string[]) => void;
	/** Leave the mode (the banner's ✕) — a URL write owned by the page. */
	onCancel: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const axles = useMemo(() => axleRowsOf(vehicle), [vehicle]);
	// Only seats with NO tyre are offered (the caller owns the rule the picker obeys).
	const freeSeatIds = useMemo(
		() =>
			new Set(
				axles
					.flatMap((row) => [...row.left, ...row.right, ...row.center])
					.filter((wheel) => !wheel.tyre)
					.map((wheel) => wheel.seat.id),
			),
		[axles],
	);
	const codes = useMemo(() => seatCodeById(vehicle), [vehicle]);
	const tone = bandTone(treadBandOf(tyre.treadMm));

	const place = async (seatId: string) => {
		if (busy) return;
		setError(null);
		setBusy(true);
		try {
			const actorId = await requireActorId();
			await fitTyreToSeat(tyre.id, {
				actorId,
				toVehicle: vehicle.id,
				toSlot: seatId,
				note: `Worn on ${codes.get(seatId) ?? seatId} of ${vehicle.plateNo}`,
			});
			hapticImpact('medium');
			onPlaced([tyre.id]);
		} catch (err) {
			hapticImpact('light');
			console.error('[tyres] wear failed', err);
			setError(err instanceof Error && err.message ? err.message : 'Could not wear it there — try another wheel.');
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/* WHAT is being placed — the exact unit the operator acted on, so the mode
			    never re-asks which tyre. */}
			<div className="mb-2 flex items-center gap-2.5 rounded-xl border border-primary/30 bg-primary/5 p-3">
				<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<Disc3 className="size-4" aria-hidden />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sub font-bold tracking-tight text-foreground">{tyre.serialNo ?? '—'}</span>
					<span className="mt-0.5 block truncate text-meta font-medium text-muted-foreground">
						{tyre.modelName ?? 'Tyre'}
						{tyre.treadMm != null ? <span className={`font-bold tabular-nums ${tone}`}> · {tyre.treadMm} mm</span> : null}
					</span>
				</span>
				<TyreStatusPill status={tyre.status} size="xs" />
				<button
					type="button"
					onClick={() => {
						hapticSelection();
						onCancel();
					}}
					aria-label="Cancel wearing"
					className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
				>
					<X className="size-4" aria-hidden />
				</button>
			</div>

			<p className="mb-2 text-meta leading-snug font-semibold text-muted-foreground">
				{freeSeatIds.size > 0
					? `Tap a + wheel on ${vehicle.plateNo} to wear it there.`
					: 'No vacant wheel on this truck — take one off first.'}
			</p>

			{/* The rig itself owns the scrolling (a 10-wheel truck is taller than the
			    viewport) and its `+` seats are the only tap targets in it. */}
			<div className="min-h-0 shrink grow basis-auto overflow-y-auto pb-6">
				<WheelSeatPicker
					rows={axles}
					freeSeatIds={busy ? EMPTY_SEATS : freeSeatIds}
					selectedSeatId={null}
					onSelect={(seatId) => void place(seatId)}
				/>
				{busy ? (
					<p className="mt-2 flex items-center justify-center gap-2 text-meta font-semibold text-muted-foreground">
						<LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Wearing…
					</p>
				) : null}
				{error ? (
					<p className="mt-2 rounded-lg bg-status-danger-soft px-3 py-2 text-xs leading-snug text-status-danger">{error}</p>
				) : null}
				{!busy && !error && freeSeatIds.size === 0 ? (
					<p className="mt-2 flex items-center justify-center gap-1.5 text-meta font-semibold text-muted-foreground">
						<Check className="size-3.5" aria-hidden /> Every wheel on this truck carries a tyre.
					</p>
				) : null}
			</div>
		</div>
	);
}
