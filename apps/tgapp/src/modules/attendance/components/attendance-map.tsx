import { useCallback, useEffect, useRef } from 'react';
import { Crosshair } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { TelegramLocation } from '../hooks/useTelegramLocation';

/**
 * Google Maps tile layers that work without API keys (roadmap only).
 * For higher zoom detail or satellite imagery, a Google Maps API key is needed.
 *
 * Exported so a second Leaflet view (the read-only punch-location sheet) paints
 * the SAME tiles and the same per-style dark/light filter class as this one.
 */
export const TILE_LAYERS = {
	roadmap: {
		url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
		attribution: '&copy; <a href="https://maps.google.com">Google Maps</a>',
	},
	satellite: {
		url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
		attribution: '&copy; <a href="https://maps.google.com">Google Maps</a>',
	},
	hybrid: {
		url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
		attribution: '&copy; <a href="https://maps.google.com">Google Maps</a>',
	},
	terrain: {
		url: 'https://mt1.google.com/vt/lyrs=t&x={x}&y={y}&z={z}',
		attribution: '&copy; <a href="https://maps.google.com">Google Maps</a>',
	},
};

type TileStyle = keyof typeof TILE_LAYERS;

interface AttendanceMapProps {
	/** Current location to center the map on */
	location: TelegramLocation;
	/** Optional shift location to show as a second marker */
	shiftLocation?: { lat: number; lng: number; name?: string | null } | null;
	/** Tile style (default: roadmap) */
	tileStyle?: TileStyle;
	/** Re-enable pan/pinch (default false — the compact map is VIEW-ONLY: zoom
	 * happens through the +/- control and the locate recenter ONLY; the
	 * Telegram WebView eats drag gestures for its own page scroll anyway). */
	draggable?: boolean;
	/** Zoom level (default: 15) */
	zoom?: number;
	/** Map height CSS (default: 200px) */
	height?: string;
	/** Whether to show the user's accuracy circle */
	showAccuracy?: boolean;
}

/**
 * Compact Leaflet map with Google Maps tile layers, showing the user's current
 * location and (optionally) their shift/office location.
 *
 * VIEW-ONLY by default: panning, pinch, wheel, double-tap, box and keyboard
 * zoom are all off — the native +/- control and the locate recenter are the
 * only interactions (the design's compact preview map).
 */
export function AttendanceMap({
	location,
	shiftLocation,
	tileStyle = 'roadmap',
	draggable = false,
	zoom = 15,
	height = '200px',
	showAccuracy = true,
}: AttendanceMapProps) {
	const mapRef = useRef<HTMLDivElement>(null);
	const mapInstanceRef = useRef<L.Map | null>(null);
	const markerRef = useRef<L.Marker | null>(null);
	const accuracyCircleRef = useRef<L.Circle | null>(null);
	const shiftMarkerRef = useRef<L.Marker | null>(null);

	useEffect(() => {
		if (!mapRef.current || mapInstanceRef.current) return;

		const tileLayer = TILE_LAYERS[tileStyle] ?? TILE_LAYERS.roadmap;

		const map = L.map(mapRef.current, {
			center: [location.lat, location.lng],
			zoom,
			zoomControl: true,
			attributionControl: false,
			// View-only: no pan/drag/pinch — the +/- control (and the locate
			// recenter) are the only interactions. With dragging off the map
			// never calls preventDefault on touch, so swiping over the map
			// scrolls the page naturally instead of fighting the WebView.
			dragging: draggable,
			touchZoom: draggable,
			scrollWheelZoom: false,
			doubleClickZoom: false,
			boxZoom: false,
			keyboard: false,
		});

		L.tileLayer(tileLayer.url, {
			attribution: tileLayer.attribution,
			maxZoom: 20,
			// Per-style class — index.css keys the dark/light tile filters off it.
			className: `map-tiles-${tileStyle}`,
		}).addTo(map);

		// User location marker
		const userIcon = L.divIcon({
			className: 'user-location-marker',
			html: `<div style="
				width: 16px; height: 16px;
				background: #3b82f6;
				border: 3px solid white;
				border-radius: 50%;
				box-shadow: 0 1px 4px rgba(0,0,0,0.3);
			"></div>`,
			iconSize: [16, 16],
			iconAnchor: [8, 8],
		});

		const marker = L.marker([location.lat, location.lng], { icon: userIcon }).addTo(map);
		markerRef.current = marker;

		// Accuracy circle
		if (showAccuracy && location.accuracy > 0) {
			const circle = L.circle([location.lat, location.lng], {
				radius: location.accuracy,
				color: '#3b82f6',
				fillColor: '#3b82f6',
				fillOpacity: 0.1,
				weight: 1,
				opacity: 0.3,
			}).addTo(map);
			accuracyCircleRef.current = circle;
		}

		mapInstanceRef.current = map;

		return () => {
			map.remove();
			mapInstanceRef.current = null;
		};
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	// Update marker position when location changes
	useEffect(() => {
		if (!mapInstanceRef.current) return;
		const map = mapInstanceRef.current;

		// Update user marker
		if (markerRef.current) {
			markerRef.current.setLatLng([location.lat, location.lng]);
		}
		if (accuracyCircleRef.current) {
			accuracyCircleRef.current.setLatLng([location.lat, location.lng]);
			if (location.accuracy > 0) {
				accuracyCircleRef.current.setRadius(location.accuracy);
			}
		}

		map.setView([location.lat, location.lng], map.getZoom());
	}, [location.lat, location.lng, location.accuracy]);

	// Update shift marker when location changes
	useEffect(() => {
		if (!mapInstanceRef.current) return;
		const map = mapInstanceRef.current;

		// Remove old shift marker
		if (shiftMarkerRef.current) {
			map.removeLayer(shiftMarkerRef.current);
			shiftMarkerRef.current = null;
		}

		if (shiftLocation) {
			const shiftIcon = L.divIcon({
				className: 'shift-location-marker',
				html: `<div style="
					width: 14px; height: 14px;
					background: #f59e0b;
					border: 2px solid white;
					border-radius: 50%;
					box-shadow: 0 1px 4px rgba(0,0,0,0.3);
				"></div>`,
				iconSize: [14, 14],
				iconAnchor: [7, 7],
			});

			const marker = L.marker([shiftLocation.lat, shiftLocation.lng], { icon: shiftIcon })
				.addTo(map)
				.bindPopup(shiftLocation.name ?? shiftLocation.lat.toFixed(4) + ', ' + shiftLocation.lng.toFixed(4));
			shiftMarkerRef.current = marker;

			// Fit bounds to include both markers
			const bounds = L.latLngBounds([location.lat, location.lng], [shiftLocation.lat, shiftLocation.lng]);
			map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
		}
	}, [shiftLocation]); // eslint-disable-line react-hooks/exhaustive-deps

	// Recenter the map on the user's current location (the locate button).
	const recenter = useCallback(() => {
		mapInstanceRef.current?.setView([location.lat, location.lng], 17, { animate: true });
	}, [location.lat, location.lng]);

	return (
		<div className="relative overflow-hidden rounded-xl border border-border" style={{ height, width: '100%' }}>
			<div ref={mapRef} className="h-full w-full" />
			{/* Locate / recenter — bottom-right, mirrors the design's ⊕ control. */}
			<button
				type="button"
				onClick={recenter}
				aria-label="Recenter on my location"
				className="absolute bottom-3 right-3 z-1000 flex size-9 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-md transition-transform duration-150 active:scale-90"
			>
				<Crosshair className="size-4" aria-hidden />
			</button>
		</div>
	);
}
