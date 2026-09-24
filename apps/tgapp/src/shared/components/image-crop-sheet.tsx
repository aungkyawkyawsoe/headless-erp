import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, RotateCw, X } from 'lucide-react';
import { hapticImpact } from '@/shared/platform/haptics';
import { useTelegramBackButtonOverride } from '@/shared/platform/back-button-controller';
import { canvasToBlob, encodedImageFile, sniffImageType } from '@/shared/image/canvas-encode';

/**
 * ImageCropSheet — a full-screen crop / zoom / rotate editor for a photo.
 *
 * Flow: opened with a freshly picked `file` → the photo is decoded and shown on
 * a canvas whose backing resolution doubles as the export resolution (what you
 * frame is exactly what onApply returns). The user drags to pan, pinches to
 * zoom, taps ↻ to rotate 90°, and picks a crop aspect from the footer presets
 * (Free mirrors the source's own ratio — no distortion at base zoom — while
 * 1:1 / 4:3 impose a fixed frame). Apply exports a re-encoded JPEG `File`.
 *
 * Geometric model:
 *   - ONE `<canvas>`; its whole area is the crop region.
 *   - Base zoom ("cover") scales the image to fully fill the canvas.
 *   - The transform is (panx,pany) screen-space translation AFTER
 *     rotation·zoom around the canvas centre; pan deltas are scaled by
 *     (backingPx / cssPx) so gestures track 1:1 no matter the dpr/backing size.
 *   - Each repaint draws the source centred at the origin under
 *     ctx: translate(center) → translate(pan) → rotate → scale → drawImage.
 */
interface ImageCropSheetProps {
	file: File | null;
	onClose: () => void;
	/** Called with the re-encoded JPEG when the user taps Apply. */
	onApply: (file: File) => void;
}

type CropAspect = 'free' | '1:1' | '4:3';

const ASPECTS: Array<{ value: CropAspect; label: string }> = [
	{ value: 'free', label: 'Free' },
	{ value: '1:1', label: '1:1' },
	{ value: '4:3', label: '4:3' },
];

/** Width / height ratio. */
const RATIO: Record<CropAspect, (w: number, h: number) => number> = {
	free: (w, h) => (h > 0 ? w / h : 1),
	'1:1': () => 1,
	'4:3': () => 4 / 3,
};

/** The exported canvas's longest edge — plenty for a phone thumbnail. */
const MAX_EDGE = 1400;

interface Source {
	img: HTMLImageElement;
	w: number;
	h: number;
}

interface Transform {
	/** zoom ≥ 1, relative to a base that covers the canvas. */
	zoom: number;
	/** Screen-space pan in CSS pixels (post-rotation). */
	panX: number;
	panY: number;
}

export function ImageCropSheet({ file, onClose, onApply }: ImageCropSheetProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const wrapRef = useRef<HTMLDivElement | null>(null);
	const [stage, setStage] = useState<{ w: number; h: number } | null>(null);

	const [source, setSource] = useState<Source | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [aspect, setAspect] = useState<CropAspect>('1:1');
	const transform = useRef<Transform>({ zoom: 1, panX: 0, panY: 0 });
	// Rotation in quarter turns, stored so the render effect depends on it.
	const [rot, setRot] = useState(0);
	// True while the crop is being re-encoded — blocks a double-apply and drives
	// the native button's spinner.
	const [committing, setCommitting] = useState(false);

	// Measure the surrounding canvas wrapper so we can fit the export ratio in it.
	useEffect(() => {
		const node = wrapRef.current;
		if (!node) return;
		const measure = () => {
			const r = node.getBoundingClientRect();
			setStage({ w: Math.max(10, r.width), h: Math.max(10, r.height) });
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(node);
		return () => ro.disconnect();
	}, []);

	// Decode the picked file.
	useEffect(() => {
		if (!file) {
			setSource(null);
			setError(null);
			return;
		}
		setLoading(true);
		setError(null);
		let objectUrl: string | null = null;
		let cancelled = false;
		const img = new Image();
		img.onload = () => {
			if (cancelled) return;
			// `naturalWidth/naturalHeight` (Chromium 129+, Safari 26+) are the
			// decoded intrinsic pixels; older WebViews report them as undefined,
			// where `width/height` on a bare `new Image()` (no width/height
			// content attrs) is the classic intrinsic-size read.
			const w = Number.isFinite(img.naturalWidth) && img.naturalWidth > 0 ? img.naturalWidth : img.width;
			const h = Number.isFinite(img.naturalHeight) && img.naturalHeight > 0 ? img.naturalHeight : img.height;
			setSource({ img, w, h });
			setLoading(false);
			reset();
		};
		img.onerror = () => {
			if (cancelled) return;
			setSource(null);
			setLoading(false);
			setError('Could not open the image — choose another one.');
		};
		objectUrl = URL.createObjectURL(file);
		img.src = objectUrl;
		return () => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [file]);

	const reset = useCallback(() => {
		transform.current = { zoom: 1, panX: 0, panY: 0 };
	}, []);

	// Size + repaint the canvas whenever its inputs change.
	useEffect(() => {
		const src = source;
		if (!src || !stage) return;
		const ratio = RATIO[aspect](src.w, src.h);
		// The biggest box of `ratio` that fits the stage. ratio < 1 is portrait.
		let cssW: number;
		let cssH: number;
		if (ratio >= 1) {
			cssW = stage.w;
			cssH = stage.w / ratio;
			if (cssH > stage.h) {
				cssH = stage.h;
				cssW = cssH * ratio;
			}
		} else {
			cssH = stage.h;
			cssW = stage.h * ratio;
			if (cssW > stage.w) {
				cssW = stage.w;
				cssH = cssW / ratio;
			}
		}
		const canvas = canvasRef.current;
		if (!canvas) return;
		const cssLong = Math.max(cssW, cssH);
		const scaleBacking = Math.min(1, MAX_EDGE / cssLong);
		const outW = Math.max(1, Math.round(cssW * scaleBacking));
		const outH = Math.max(1, Math.round(cssH * scaleBacking));
		canvas.width = outW;
		canvas.height = outH;
		canvas.style.width = `${Math.round(cssW)}px`;
		canvas.style.height = `${Math.round(cssH)}px`;
		repaint(canvas, src, { ...transform.current }, rot, outW, outH);
	}, [source, stage, aspect, rot]);

	const chooseAspect = (a: CropAspect) => {
		hapticImpact('light');
		reset();
		setAspect(a);
		setRot(0);
	};

	const rotate = () => {
		hapticImpact('light');
		setRot((r) => (r + 1) % 4);
	};

	// ── Gestures (pan / pinch-zoom) ───────────────────────────────────────
	// Two pointers → pinch zoom; one pointer drag → pan. Pan deltas arrive in
	// CSS px and are scaled to backing px via the live canvas CSS/backing ratio.
	const gesture = useRef<{ points: Map<number, { x: number; y: number }>; startDist: number; startZoom: number }>({
		points: new Map(),
		startDist: 0,
		startZoom: 1,
	});

	const mapDx = () => {
		const c = canvasRef.current;
		if (!c || c.width === 0) return 1;
		const cssW = parseFloat(c.style.width) || c.clientWidth || 1;
		return (c.width / cssW) * 1; // CSS px → backing px
	};

	function startGesture(e: RPointerEvent<HTMLCanvasElement>) {
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		const g = gesture.current;
		g.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (g.points.size === 2) {
			const [a, b] = Array.from(g.points.values());
			g.startDist = Math.hypot(a.x - b.x, a.y - b.y);
			g.startZoom = transform.current.zoom;
		}
	}

	function moveGesture(e: RPointerEvent<HTMLCanvasElement>) {
		const g = gesture.current;
		if (!g.points.has(e.pointerId)) return;
		e.preventDefault();
		const prev = g.points.get(e.pointerId)!;
		const dxCss = e.clientX - prev.x;
		const dyCss = e.clientY - prev.y;
		g.points.set(e.pointerId, { x: e.clientX, y: e.clientY });

		if (g.points.size === 1) {
			const k = mapDx();
			const t = transform.current;
			t.panX += dxCss * k;
			t.panY += dyCss * k;
			redrawNow();
		} else if (g.points.size === 2 && g.startDist > 0) {
			const [a, b] = Array.from(g.points.values());
			const dist = Math.hypot(a.x - b.x, a.y - b.y);
			const t = transform.current;
			t.zoom = clampZoom(g.startZoom * (dist / g.startDist));
			redrawNow();
		}
	}

	function endGesture(e: RPointerEvent<HTMLCanvasElement>) {
		gesture.current.points.delete(e.pointerId);
		if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
	}

	// Repaint the canvas applying the current transform — computed from the same
	// refs so mid-gesture frames don't cross React boundaries.
	function redrawNow() {
		const c = canvasRef.current;
		const src = source;
		if (!c || !src) return;
		repaint(c, src, transform.current, rot, c.width, c.height);
	}

	const commit = async () => {
		if (committing) return;
		const c = canvasRef.current;
		const src = source;
		if (!c || !src || transform.current.zoom < 1) return;
		setCommitting(true);
		try {
			repaint(c, src, transform.current, rot, c.width, c.height); // final crisp pass
			let blob = await canvasToBlob(c, 'image/jpeg', 0.9);
			if (!blob) {
				// Encoding can fail on constrained WebViews — surface it instead of
				// leaving the editor silently frozen.
				setError('Could not resize the image — choose another one.');
				return;
			}
			// A WebView that ignored the requested JPEG can hand back bytes that are
			// NOT any image we (or the server) recognize. Re-encode as PNG once — the
			// one format every canvas encoder emits — so the upload always declares a
			// type that matches its bytes.
			if (!(await sniffImageType(blob))) {
				const png = await canvasToBlob(c, 'image/png');
				if (png && (await sniffImageType(png))) blob = png;
			}
			// Declare the type the encoded BYTES actually are (a WebView may ignore
			// the requested JPEG, and may misreport `blob.type` too) — the media
			// route's magic-byte check rejects a mismatched declaration.
			onApply(await encodedImageFile(blob, file?.name ?? 'photo'));
		} finally {
			setCommitting(false);
		}
	};

	// The apply affordance is an IN-PAGE full-width button at the foot of the
	// sheet — deliberately NOT the Telegram MainButton: the host form already owns
	// that native button (and tucks it away, `visible: editorFile === null`, while
	// this overlay is open), and two owners of one native button would fight. The
	// foot position also keeps it clear of the client's top-right “⋯” menu, which
	// overlapped the old in-page top-corner button.
	useTelegramBackButtonOverride(onClose);

	// Portal to <body>: the editor must own the WHOLE viewport even when it is
	// opened from deep inside a list row — a `position: fixed` element is
	// contained (not viewport-relative) by any ancestor with a transform/filter,
	// and a card list applies one for its enter/exit animation.
	return createPortal(
		<div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white" role="dialog" aria-modal="true" aria-label="Crop image">
			<div className="flex items-center justify-between px-4 pb-1.5 pt-tg">
				<button
					type="button"
					onClick={onClose}
					className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10"
					aria-label="Close"
				>
					<X className="size-5" aria-hidden />
				</button>
				<p className="text-sm font-semibold leading-myanmar text-white">Crop Image</p>
				{/* Balance the Close button so the title stays centered — the apply action
				    lives at the foot of the sheet, clear of the client's top-right menu. */}
				<span aria-hidden className="size-9" />
			</div>

			<div ref={wrapRef} className="relative min-h-0 flex-1 px-2 pb-1">
				{loading ? (
					<div className="flex h-full flex-col items-center justify-center gap-2">
						<Loader2 className="size-6 animate-spin text-white/70" aria-hidden />
						<span className="text-xs leading-myanmar text-white/70">Opening image…</span>
					</div>
				) : error ? (
					<div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
						<p className="text-sm leading-myanmar text-rose-300">{error}</p>
						<button
							type="button"
							onClick={onClose}
							className="rounded-full border border-white/25 px-4 py-2 text-xs font-semibold leading-6 text-white"
						>
							Back
						</button>
					</div>
				) : source ? (
					<div className="flex h-full w-full touch-none items-center justify-center">
						<canvas
							ref={canvasRef}
							className="block rounded-lg shadow-2xl"
							onPointerDown={startGesture}
							onPointerMove={moveGesture}
							onPointerUp={endGesture}
							onPointerCancel={endGesture}
						/>
					</div>
				) : null}
			</div>

			<div className="flex flex-col gap-3 px-4 pb-safe pt-1.5">
				<div className="flex items-center justify-center gap-3">
					<button
						type="button"
						disabled={!source || loading}
						onClick={rotate}
						className="flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-2 text-xs font-semibold leading-6 text-white active:scale-95 disabled:opacity-40"
					>
						<RotateCw className="size-4" aria-hidden />
						Rotate 90°
					</button>
					<div className="flex items-center gap-1 rounded-full bg-white/10 p-1">
						{ASPECTS.map((a) => (
							<button
								key={a.value}
								type="button"
								disabled={!source || loading}
								onClick={() => chooseAspect(a.value)}
								className={`rounded-full px-3 py-1.5 text-xs font-semibold leading-5 ${
									aspect === a.value ? 'bg-primary text-primary-foreground' : 'text-white/70'
								} disabled:opacity-40`}
							>
								{a.label}
							</button>
						))}
					</div>
				</div>

				{/* In-page apply — full width, at the foot, clear of the client chrome. */}
				<button
					type="button"
					disabled={!source || loading || committing}
					onClick={() => {
						hapticImpact('medium');
						void commit();
					}}
					className="w-full rounded-full bg-primary py-3 text-sm font-semibold leading-6 text-primary-foreground shadow-sm active:scale-[0.98] disabled:opacity-40"
				>
					{committing ? 'Applying…' : 'Use Photo'}
				</button>
			</div>
		</div>,
		document.body,
	);
}

/** Clamp the zoom factor between the base cover (1) and a generous max. */
function clampZoom(z: number): number {
	if (!Number.isFinite(z)) return 1;
	return Math.min(8, Math.max(1, z));
}

/** Repaint `canvas` (backing ×out height) with the source under the current
 *  orient/zoom/pan transform.
 *
 *  Base zoom = "cover": the source is scaled so its rotated footprint at least
 *  fills the canvas, so there are never empty corners at zoom=1 (leftover
 *  gaps after a 90° rotation on an odd aspect just show the white stage). */
function repaint(canvas: HTMLCanvasElement, src: Source, t: Transform, rot: number, outW: number, outH: number) {
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	const odd = rot % 2 === 1;
	// Source footprint (in image px) along each output axis after `rot` turns.
	const footH = odd ? src.h : src.w;
	const footV = odd ? src.w : src.h;
	// Scale (image px → output px) so the footprint covers the canvas.
	const base = Math.max(outW / footH, outH / footV) || 1;
	const zoom = clampZoom(t.zoom);
	const scale = base * zoom;
	const cx = outW / 2;
	const cy = outH / 2;

	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, outW, outH);
	ctx.translate(cx + t.panX, cy + t.panY);
	ctx.rotate((rot * Math.PI) / 2);
	ctx.scale(scale, scale);
	// Draw centred at the origin (the translate above put the image centre at
	// the canvas centre offset by the pan).
	ctx.drawImage(src.img as CanvasImageSource, -src.w / 2, -src.h / 2);
	ctx.setTransform(1, 0, 0, 1, 0, 0);
}
