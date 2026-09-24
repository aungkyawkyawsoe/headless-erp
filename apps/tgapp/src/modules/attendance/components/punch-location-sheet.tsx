import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { DENSE_CARD_FRAME } from '@/shared/components/card';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LogIn, LogOut, MapPin, Navigation } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';

import { TILE_LAYERS } from './attendance-map';
import { formatPunchTime } from '../utils/time';
import { formatEnglishDayMonth } from '@/shared/time/myanmar';
import type { HistoryDay } from './attendance-history';

/** "16.8409,96.1735" → `{ lat, lng }` (null when absent / malformed). */
function parseGeo(geo: string | null | undefined): { lat: number; lng: number } | null {
	if (!geo) return null;
	const [lat, lng] = geo.split(',').map(Number);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
	return { lat, lng };
}

type PunchKind = 'in' | 'out';

/** One located punch — the map marker + the fact row. */
interface PunchPoint {
	kind: PunchKind;
	time: string | null;
	geo: string;
	lat: number;
	lng: number;
}

/**
 * Punch-location sheet — a superior taps a day in a report's attendance list to
 * see WHERE (and WHEN) the punches were struck, on a map. The In/Out fact rows
 * at the bottom are buttons: tapping one ZOOMS the map to that punch (and opens
 * its popup), so "where did they check out?" is one tap, not a hunt. Each row
 * also carries an "Open in Google Maps" link.
 *
 * Read-only otherwise. Renders nothing when the day has no located punch (the
 * row isn't tappable in that case — see `AttendanceHistory`).
 */
interface PunchLocationSheetProps {
	day: HistoryDay | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function PunchLocationSheet({ day, open, onOpenChange }: PunchLocationSheetProps) {
	const mapRef = useRef<PunchMapHandle>(null);

	const points = useMemo<PunchPoint[]>(() => {
		if (!day) return [];
		const list: PunchPoint[] = [];
		const inGeo = parseGeo(day.checkInGeo);
		if (day.checkIn && inGeo) list.push({ kind: 'in', time: day.checkIn, geo: day.checkInGeo as string, ...inGeo });
		const outGeo = parseGeo(day.checkOutGeo);
		if (day.checkOut && outGeo) list.push({ kind: 'out', time: day.checkOut, geo: day.checkOutGeo as string, ...outGeo });
		return list;
	}, [day]);

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="bottom">
				<SheetHeader className="pb-0">
					<SheetTitle>{day ? formatEnglishDayMonth(day.date) : 'Punch location'}</SheetTitle>
				</SheetHeader>
				<div className="px-4 pb-safe pt-2">
					{points.length > 0 ? (
						<PunchMap ref={mapRef} points={points} />
					) : (
						<p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-xs leading-myanmar text-muted-foreground">
							No location was recorded for this day.
						</p>
					)}

					<div className="mt-3 flex flex-col gap-2">
						<PunchFact kind="in" time={day?.checkIn ?? null} geo={day?.checkInGeo ?? null} onFocus={() => mapRef.current?.focus('in')} />
						<PunchFact
							kind="out"
							time={day?.checkOut ?? null}
							geo={day?.checkOutGeo ?? null}
							onFocus={() => mapRef.current?.focus('out')}
						/>
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}

/** One In/Out fact row — tap the row to zoom the map to that punch; the trailing
 *  link opens the coordinates in Google Maps. */
function PunchFact({ kind, time, geo, onFocus }: { kind: PunchKind; time: string | null; geo: string | null; onFocus: () => void }) {
	const located = Boolean(time && parseGeo(geo));
	return (
		<div className={`flex items-center gap-1.5 ${DENSE_CARD_FRAME} px-2 py-2`}>
			<button
				type="button"
				onClick={onFocus}
				disabled={!located}
				aria-label={located ? `Zoom the map to the ${kind === 'in' ? 'check-in' : 'check-out'} location` : undefined}
				className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-0.5 text-left transition-transform duration-150 active:scale-[0.99] disabled:cursor-default"
			>
				<span
					className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
						kind === 'in' ? 'bg-status-success-soft text-status-success' : 'bg-status-warning-soft text-status-warning'
					}`}
				>
					{kind === 'in' ? <LogIn className="size-4" aria-hidden /> : <LogOut className="size-4" aria-hidden />}
				</span>
				<div className="min-w-0 flex-1">
					<p className="text-xs leading-myanmar text-muted-foreground">{kind === 'in' ? 'Check in' : 'Check out'}</p>
					<p className="text-sm font-semibold tabular-nums text-foreground">{time ? formatPunchTime(time) : '--:--'}</p>
				</div>
				{located && geo ? (
					<span className="flex min-w-0 items-center gap-1 text-meta text-muted-foreground">
						<MapPin className="size-3 shrink-0" aria-hidden />
						<span className="truncate">{geo}</span>
					</span>
				) : (
					<span className="text-meta text-muted-foreground">no location</span>
				)}
			</button>
			{located && geo ? (
				<a
					href={`https://www.google.com/maps?q=${encodeURIComponent(geo)}`}
					target="_blank"
					rel="noreferrer"
					aria-label="Open in Google Maps"
					className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground"
				>
					<Navigation className="size-4" aria-hidden />
				</a>
			) : null}
		</div>
	);
}

export interface PunchMapHandle {
	/** Zoom to a located punch and open its popup. No-op when absent. */
	focus: (kind: PunchKind) => void;
}

/** Read-only Leaflet map — one marker per located punch, green (in) / amber (out). */
const PunchMap = forwardRef<PunchMapHandle, { points: PunchPoint[] }>(function PunchMap({ points }, ref) {
	const containerRef = useRef<HTMLDivElement>(null);
	const mapRef = useRef<L.Map | null>(null);
	const markersRef = useRef(new Map<PunchKind, L.Marker>());

	useEffect(() => {
		if (!containerRef.current) return;
		const tile = TILE_LAYERS.roadmap;
		const map = L.map(containerRef.current, {
			zoomControl: true,
			attributionControl: false,
			dragging: true,
			touchZoom: true,
			scrollWheelZoom: false,
			doubleClickZoom: true,
		});
		L.tileLayer(tile.url, { attribution: tile.attribution, maxZoom: 20, className: 'map-tiles-roadmap' }).addTo(map);

		markersRef.current.clear();
		for (const p of points) {
			const color = p.kind === 'in' ? '#10b981' : '#f59e0b';
			const icon = L.divIcon({
				className: `punch-location-marker punch-location-marker-${p.kind}`,
				html: `<div style="width:14px;height:14px;background:${color};border:3px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.35)"></div>`,
				iconSize: [14, 14],
				iconAnchor: [7, 7],
			});
			const marker = L.marker([p.lat, p.lng], { icon })
				.addTo(map)
				.bindPopup(`${p.kind === 'in' ? 'Check in' : 'Check out'} · ${formatPunchTime(p.time)}`);
			markersRef.current.set(p.kind, marker);
		}

		if (points.length === 1) {
			map.setView([points[0].lat, points[0].lng], 16);
		} else if (points.length > 1) {
			map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 16 });
		}

		// The sheet animates in — re-measure once its box has a real size, or the
		// tiles render into a 0-height container.
		const raf = requestAnimationFrame(() => map.invalidateSize());
		const settle = setTimeout(() => map.invalidateSize(), 300);
		mapRef.current = map;
		return () => {
			cancelAnimationFrame(raf);
			clearTimeout(settle);
			mapRef.current = null;
			map.remove();
		};
	}, [points]);

	useImperativeHandle(
		ref,
		() => ({
			focus: (kind: PunchKind) => {
				const map = mapRef.current;
				const point = points.find((p) => p.kind === kind);
				if (!map || !point) return;
				map.setView([point.lat, point.lng], 17, { animate: true });
				markersRef.current.get(kind)?.openPopup();
			},
		}),
		[points],
	);

	return (
		<div className="relative h-56 w-full overflow-hidden rounded-xl border border-border">
			<div ref={containerRef} className="h-full w-full" />
		</div>
	);
});
