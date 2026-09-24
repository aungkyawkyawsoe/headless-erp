import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { DENSE_CARD_FRAME } from '@/shared/components/card';
import { SpinnerGlyph } from '@/shared/components/page-spinner';
import { MapPin, Navigation, X } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';

import type { ShiftLocation } from './shifts-card';
import { usePreciseLocation } from '../hooks/useTelegramLocation';
import { hapticImpact } from '@/shared/platform/haptics';
import { formatShiftRange } from '@/shared/time/myanmar';

// The map (Leaflet ~150 kB) is its own lazy chunk — it must NOT download on
// every dashboard visit, only when a punch dialog actually renders a map. The
// chunk starts loading a beat AFTER a fix lands (see `showMap`), so it never
// competes with the punch write.
const AttendanceMap = lazy(() => import('./attendance-map').then((module) => ({ default: module.AttendanceMap })));

/** Placeholder while the lazy map chunk streams in — same box as the locating state. */
function MapPlaceholder() {
	return (
		<div className="flex h-50 items-center justify-center rounded-xl border border-border bg-muted/30">
			<SpinnerGlyph className="size-5" />
		</div>
	);
}

interface PunchDialogProps {
	/** Which punch this dialog records. */
	type: 'check-in' | 'check-out';
	/** The employee's assigned shifts — shown as the selectable shift card(s). */
	shifts?: ShiftLocation[] | null;
	shiftsLoading?: boolean;
	/** A REAL failure loading the shifts (not the no-shift case) — shown instead
	 *  of the bare "no shift assigned" card. */
	shiftsError?: boolean;
	/** Called with the freshly-acquired precise location + chosen shift when confirmed. */
	onConfirm: (params: { lat: number; lng: number; accuracy: number; shiftId?: string }) => Promise<void>;
	onClose: () => void;
}

/**
 * Punch dialog (Check-in / Check-out Records) — the BOTTOM SHEET from
 * the design reference (slides up over a dimmed backdrop; backdrop tap or Esc
 * closes it — the sheet locks the page scroll behind it):
 *
 *   1. Google-Maps tile map (zoom +/- on the left, locate button on the right,
 *      blue user dot + accuracy ring, optional shift marker)
 *   2. Raw coordinates under the map (16.8277, 96.2101)
 *   3. Shift card(s) with their time ranges
 *   4. Cancel / Confirm pills — pinned above the safe area
 *
 * Location is acquired FRESH when the dialog mounts — the WebView geolocation
 * API first (`maximumAge: 0` forces a brand-new GPS fix on every open), the
 * Telegram native LocationManager only as a fallback. The map never shows a
 * stale/previous pin and the confirm pill stays disabled until a fix arrives.
 */
export function PunchDialog({ type, shifts, shiftsLoading, shiftsError, onConfirm, onClose }: PunchDialogProps) {
	const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
	const [punching, setPunching] = useState(false);
	// A REAL failure recording the punch — shown inline so the dialog never
	// silently re-enables after a failed check-in/out (the error UI mirrors the
	// shifts-error card below). Cleared on the next attempt.
	const [punchError, setPunchError] = useState<string | null>(null);

	// Fresh-on-open precise location (WebView GPS first, Telegram-native fallback)
	// — one hook instance, never conditionally swapped (Rules of Hooks).
	const { state: locationState, retry: retryLocation } = usePreciseLocation();

	// Enter with the slide-up transition: the dialog mounts conditionally, and
	// a sheet mounted with `open` already true renders instantly (no enter
	// animation) — so it starts closed and flips open on mount. `requestClose`
	// mirrors that: it plays the slide-down FIRST, then hands the unmount to
	// the parent so the exit is never cut off.
	const [open, setOpen] = useState(false);
	useEffect(() => {
		setOpen(true);
	}, []);
	const requestClose = useCallback(() => {
		setOpen(false);
		window.setTimeout(onClose, 220);
	}, [onClose]);

	const isCheckIn = type === 'check-in';
	const locationAvailable = locationState.status === 'available';
	const locationBlocked = locationState.status === 'denied' || locationState.status === 'unavailable';

	// Defer the map chunk (Leaflet, ~150 kB raw / 44 kB gz) until the dialog has
	// settled. It used to start downloading the INSTANT a GPS fix arrived — the
	// exact moment the confirm pill enables — so on a slow link the user's tap
	// raced the tile-library download for bandwidth, which is the perceived
	// latency of the app's primary action. The fix itself is untouched (the punch
	// still requires a fresh location); only the map's paint is deferred.
	const [showMap, setShowMap] = useState(false);
	useEffect(() => {
		if (!locationAvailable) {
			setShowMap(false);
			return;
		}
		const timer = setTimeout(() => setShowMap(true), 700);
		return () => clearTimeout(timer);
	}, [locationAvailable]);

	// Default-select the first shift so its card + map marker render immediately.
	const activeShiftId = selectedShiftId ?? shifts?.[0]?.id ?? null;
	const activeShift = shifts?.find((s) => s.id === activeShiftId) ?? null;
	// Stable object for the map's shift marker — memoized on the shift's own
	// fields so location-stream re-renders don't rebuild the marker each time
	// (the map's marker effect keys on this object's identity).
	const mapShiftLocation = useMemo(
		() =>
			activeShift?.lat != null && activeShift?.lng != null
				? { lat: activeShift.lat, lng: activeShift.lng, name: activeShift.location_name ?? activeShift.shift_name }
				: null,
		[activeShift?.lat, activeShift?.lng, activeShift?.location_name, activeShift?.shift_name],
	);

	const handleConfirm = async () => {
		if (locationState.status !== 'available') return;
		hapticImpact('medium');
		setPunching(true);
		setPunchError(null);
		try {
			await onConfirm({
				lat: locationState.location.lat,
				lng: locationState.location.lng,
				accuracy: locationState.location.accuracy,
				shiftId: activeShiftId ?? undefined,
			});
			// Slide down first — the parent unmounts (dialogType → null) once the
			// exit transition has played.
			requestClose();
		} catch (err) {
			// Stay open and say why — a failed punch must never look like a no-op
			// (the button re-enables below, ready for a retry).
			const message = err instanceof Error && err.message ? err.message : null;
			setPunchError(
				message ?? (isCheckIn ? 'Check-in could not be recorded. Please try again.' : 'Check-out could not be recorded. Please try again.'),
			);
		} finally {
			setPunching(false);
		}
	};

	return (
		<Sheet
			open={open}
			onOpenChange={(next) => {
				if (!next) requestClose();
			}}
		>
			<SheetContent side="bottom" showCloseButton={false} className="rounded-t-3xl">
				{/* Header row — title (left) + circular close button (right) */}
				<SheetHeader className="flex-row items-center justify-between gap-3 pb-1">
					<SheetTitle className="leading-myanmar">{isCheckIn ? 'Check-in Record' : 'Check-out Record'}</SheetTitle>
					<button
						type="button"
						onClick={requestClose}
						aria-label="Close"
						className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground active:scale-90"
					>
						<X className="size-4" aria-hidden />
					</button>
				</SheetHeader>

				{/* Scrollable body — map, coordinates, shift picker; the action pills
				 * stay pinned below it so they never scroll out of reach. */}
				<div className="max-h-[62dvh] overflow-y-auto overscroll-contain px-4">
					{/* Map — painted after a short settle (see `showMap`). */}
					{locationAvailable && showMap ? (
						<Suspense fallback={<MapPlaceholder />}>
							<AttendanceMap location={locationState.location} shiftLocation={mapShiftLocation} height="200px" />
						</Suspense>
					) : locationState.status === 'requesting' || locationState.status === 'idle' ? (
						<div className="flex h-50 items-center justify-center rounded-xl border border-border bg-muted/30">
							<div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
								<Navigation className="size-6 animate-pulse text-primary" />
								<span>Finding your location…</span>
							</div>
						</div>
					) : (
						<div className="flex h-50 items-center justify-center rounded-xl border border-dashed border-border bg-muted/20">
							<div className="flex flex-col items-center gap-2 px-4 text-center text-xs text-muted-foreground">
								<MapPin className="size-6" />
								<span>{locationState.status === 'denied' ? 'Location permission was denied' : 'No precise location available'}</span>
								<button
									type="button"
									onClick={retryLocation}
									className="mt-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
								>
									Try Again
								</button>
							</div>
						</div>
					)}

					{/* Coordinates under the map — the design's 16.8277, 96.2101 line */}
					<p className="mt-2 text-xs tabular-nums text-muted-foreground">
						{locationAvailable ? `${locationState.location.lat.toFixed(4)}, ${locationState.location.lng.toFixed(4)}` : ''}
					</p>

					{/* Shift section */}
					<p className="mb-2 mt-4 text-sm font-semibold leading-myanmar text-foreground">Shift</p>
					{shiftsLoading ? (
						<div className={`${DENSE_CARD_FRAME} p-3.5`}>
							<div className="h-4 w-40 animate-pulse rounded bg-muted" />
							<div className="mt-2 h-3 w-28 animate-pulse rounded bg-muted" />
						</div>
					) : shifts && shifts.length > 0 ? (
						<div className="space-y-2">
							{shifts.map((shift) => {
								const sel = activeShiftId === shift.id;
								return (
									<button
										key={shift.id}
										type="button"
										onClick={() => setSelectedShiftId(shift.id)}
										aria-pressed={sel}
										className={
											'w-full rounded-xl border-2 bg-card px-3 py-2 text-left transition-colors ' +
											(sel ? 'border-primary' : 'border-border')
										}
									>
										{/* Top row — name (grows) + optional radius chip + the radio at the
										 * right corner indicating this card's selection. */}
										<span className="flex items-center gap-2">
											<span className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">{shift.shift_name ?? '—'}</span>
											{shift.radius != null && shift.radius > 0 ? (
												<span className="shrink-0 rounded-full bg-muted/70 px-1.5 py-px text-[10px] leading-myanmar font-semibold tabular-nums text-muted-foreground">
													{shift.radius}m
												</span>
											) : null}
											{/* Radio — the card's top-right selection dot. */}
											<span
												aria-hidden
												className={
													'flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ' +
													(sel ? 'border-primary' : 'border-muted-foreground/30')
												}
											>
												{sel ? <span className="size-2.5 rounded-full bg-primary" /> : null}
											</span>
										</span>
										<span className="mt-0.5 block text-xs leading-myanmar text-muted-foreground">
											{formatShiftRange(shift.start_time, shift.end_time)}
										</span>
										{shift.location_name ? (
											<span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
												<MapPin className="size-3 shrink-0" aria-hidden />
												<span className="truncate">{shift.location_name}</span>
											</span>
										) : null}
									</button>
								);
							})}
						</div>
					) : shiftsError ? (
						<div className="rounded-xl border border-dashed border-border bg-card p-3.5">
							<p className="text-sm font-medium leading-myanmar text-destructive">
								Shift times could not be loaded. Check your connection and try again.
							</p>
						</div>
					) : (
						<div className={`${DENSE_CARD_FRAME} p-3.5`}>
							<p className="text-sm font-bold text-foreground">General Shift</p>
							<p className="mt-1 text-xs leading-myanmar text-muted-foreground">No shift assigned</p>
						</div>
					)}

					{/* Location required notice */}
					{locationBlocked && (
						<p className="mt-3 text-center text-xs font-medium leading-myanmar text-status-danger">A location fix is required to confirm</p>
					)}

					{/* Punch failure — inline, same destructive card style as the shifts error. */}
					{punchError && (
						<div className="mt-3 rounded-xl border border-dashed border-border bg-card p-3.5">
							<p className="text-sm font-medium leading-myanmar text-destructive">{punchError}</p>
						</div>
					)}
				</div>

				{/* Actions — pinned at the sheet's bottom, above the safe area */}
				<div className="flex items-center gap-3 px-4 pt-1 pb-safe">
					<button
						type="button"
						onClick={requestClose}
						disabled={punching}
						className="flex-1 rounded-full border border-border bg-background px-4 py-2.5 text-sm font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95 disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={!locationAvailable || punching}
						onClick={() => void handleConfirm()}
						className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-bold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95 disabled:opacity-40 disabled:active:scale-100"
					>
						{punching ? 'Submitting…' : 'Confirm'}
					</button>
				</div>
			</SheetContent>
		</Sheet>
	);
}
