import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Slider } from '@mmbix/design-system';
import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw, Trash2 } from 'lucide-react';

import { canvasToBlob } from '../lib/canvas-encode';
import { uploadFile } from '../lib/api';
import {
	ASPECT_IDS,
	aspectRatio,
	clampRect,
	FULL,
	gradePixels,
	GRADE_RANGE,
	moveRect,
	NEUTRAL,
	reaspect,
	toTurn,
	type AspectId,
	type Grade,
	type Rect,
	type Turn,
} from '../lib/image-edit';

/** A source image queued for editing. `src` is anything an <img> can load
 *  (object-URL of a File, an /api/media/… path, or an https URL). */
export interface ImageEditRequest {
	src: string;
	/** Base filename for the derived asset. */
	name: string;
}

interface ImageEditorDialogProps {
	open: boolean;
	request: ImageEditRequest | null;
	token?: string;
	onClose: () => void;
	onApply: (url: string) => void;
	onBusy?: (busy: boolean) => void;
}

const MAX_SIDE = 1600; // longest edge of the oriented working bitmap
const STAGE_W = 700;
const STAGE_H = 500;
const MIN_CROP_PX = 20; // smallest visible crop (stage px); we clamp on resize

type Drag = { kind: 'move'; dx: number; dy: number } | { kind: 'resize'; sx: number; sy: number };

/** Read an image into an orient-applied, capped working canvas. */
async function loadAndBake(src: string, turn: Turn, flipX: boolean, flipY: boolean): Promise<HTMLCanvasElement> {
	const img = await loadImg(src);
	const nw = img.naturalWidth;
	const nh = img.naturalHeight;
	const swap = turn === 1 || turn === 3;
	const baseW = swap ? nh : nw;
	const baseH = swap ? nw : nh;
	const scale = Math.min(1, MAX_SIDE / Math.max(baseW, baseH));
	const W = Math.max(1, Math.round(baseW * scale));
	const H = Math.max(1, Math.round(baseH * scale));

	const rotated = document.createElement('canvas');
	rotated.width = W;
	rotated.height = H;
	const ctx = rotated.getContext('2d');
	if (!ctx) throw new Error('Canvas is not supported in this browser.');
	ctx.save();
	ctx.translate(W / 2, H / 2);
	ctx.rotate(turn * (Math.PI / 2));
	// Draw at natural density; the canvas itself already encodes the swap + scale.
	const dcx = swap ? scale : scale;
	ctx.scale(dcx, dcx);
	ctx.drawImage(img, -nw / 2, -nh / 2);
	ctx.restore();

	if (!flipX && !flipY) return rotated;
	const flipped = document.createElement('canvas');
	flipped.width = W;
	flipped.height = H;
	const fctx = flipped.getContext('2d');
	if (!fctx) throw new Error('Canvas is not supported in this browser.');
	fctx.translate(flipX ? W : 0, flipY ? H : 0);
	fctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
	fctx.drawImage(rotated, 0, 0);
	return flipped;
}

function loadImg(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('That image could not be opened for editing.'));
		img.src = src;
	});
}

export function ImageEditorDialog({ open, request, token, onClose, onApply, onBusy }: ImageEditorDialogProps) {
	const src = request?.src ?? '';
	// Oriented, colour-neutral, capped working bitmap.
	const [bitmap, setBitmap] = useState<HTMLCanvasElement | null>(null);
	const [loadErr, setLoadErr] = useState<string | null>(null);
	// Editor geometry — all normalized to the oriented bitmap (0..1).
	const [crop, setCrop] = useState<Rect>({ ...FULL });
	const [aspect, setAspect] = useState<AspectId>('free');
	const [turn, setTurn] = useState<Turn>(0);
	const [horiz, setHoriz] = useState(false);
	const [vert, setVert] = useState(false);
	const [graded, setGraded] = useState<HTMLCanvasElement>(null as unknown as HTMLCanvasElement);
	const [grade, setGrade] = useState<Grade>({ ...NEUTRAL });
	// View-only zoom factor (0..4), does not alter what crop selects.
	const [zoom, setZoom] = useState(0); // 0 = fit
	const [drag, setDrag] = useState<Drag | null>(null);
	const [applying, setApplying] = useState(false);
	const stageRef = useRef<HTMLCanvasElement | null>(null);
	const wrapRef = useRef<HTMLDivElement | null>(null);

	// Load new source + orientation.
	useEffect(() => {
		if (!src) return;
		let alive = true;
		setBitmap(null);
		setGraded(null as unknown as HTMLCanvasElement);
		setLoadErr(null);
		setCrop({ ...FULL });
		setAspect('free');
		setTurn(0);
		setHoriz(false);
		setVert(false);
		setGrade({ ...NEUTRAL });
		setZoom(0);
		loadAndBake(src, 0, false, false)
			.then((c) => alive && setBitmap(c))
			.catch((e: unknown) => alive && setLoadErr(e instanceof Error ? e.message : 'Could not open that image.'));
		return () => {
			alive = false;
		};
	}, [src]);

	// Re-bake whenever rotate/flip changes (drops any cached graded copy).
	useEffect(() => {
		if (!src) return;
		setGraded(null as unknown as HTMLCanvasElement);
		loadAndBake(src, turn, horiz, vert)
			.then(setBitmap)
			.catch(() => {
				/* keep previous */
			});
	}, [turn, horiz, vert, src]);

	// Grade = the bitmap with colour applied, as a small capped preview so slider
	// drags stay smooth. The neutral case reuses the (already oriented) bitmap
	// unchanged; export applies the same `gradePixels` math at full resolution.
	useEffect(() => {
		if (!bitmap) return;
		if (grade.brightness === 0 && grade.exposure === 0 && grade.contrast === 0) {
			setGraded(bitmap);
			return;
		}
		const target = 1000; // preview cap — single channel pass stays cheap
		const sc = Math.min(1, target / Math.max(bitmap.width, bitmap.height));
		const copy = document.createElement('canvas');
		copy.width = Math.max(1, Math.round(bitmap.width * sc));
		copy.height = Math.max(1, Math.round(bitmap.height * sc));
		const c = copy.getContext('2d', { willReadFrequently: true });
		if (!c) {
			setGraded(bitmap);
			return;
		}
		c.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, copy.width, copy.height);
		const data = c.getImageData(0, 0, copy.width, copy.height);
		gradePixels(data.data, copy.width * copy.height, grade);
		c.putImageData(data, 0, 0);
		setGraded(copy);
	}, [grade, bitmap]);

	// Fit the oriented image (times optional zoom view) inside the stage.
	const layout = useMemo(() => {
		if (!graded) return { imgX: 0, imgY: 0, imgW: 0, imgH: 0 };
		const g = graded.width / graded.height;
		const boxW = STAGE_W;
		const boxH = STAGE_H;
		let w: number;
		let h: number;
		if (g >= boxW / boxH) {
			w = boxW;
			h = boxW / g;
		} else {
			h = boxH;
			w = boxH * g;
		}
		const z = Math.pow(8, zoom / 100) * 0.38 + 0.62; // ~0.62..~3.2
		// position-free: keep centered, allow it to overflow the box when zoomed.
		return { imgW: w * z, imgH: h * z, imgX: (boxW - w * z) / 2, imgY: (boxH - h * z) / 2 };
	}, [graded, zoom]);

	// Paint the graded image (already has crop-drawing after this).
	useEffect(() => {
		if (!graded) return;
		const stage = stageRef.current;
		const ctx = stage?.getContext('2d');
		if (!stage || !ctx) return;
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.fillStyle = '#0b1220';
		ctx.fillRect(0, 0, STAGE_W, STAGE_H);
		ctx.drawImage(graded, 0, 0, graded.width, graded.height, layout.imgX, layout.imgY, layout.imgW, layout.imgH);
		// subtle inner vignette to distinguish from the app behind
	}, [graded, layout]);

	// crop box -> stage px.
	const boxInPx = useMemo(() => {
		return {
			x: layout.imgX + crop.x * layout.imgW,
			y: layout.imgY + crop.y * layout.imgH,
			w: crop.w * layout.imgW,
			h: crop.h * layout.imgH,
		};
	}, [crop, layout]);

	function stagePoint(e: React.PointerEvent | React.WheelEvent): { x: number; y: number } {
		const r = stageRef.current?.getBoundingClientRect();
		return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
	}
	function toNorm(x: number, y: number) {
		return { x: (x - layout.imgX) / layout.imgW, y: (y - layout.imgY) / layout.imgH };
	}

	const onStart = (e: React.PointerEvent) => {
		e.preventDefault();
		e.stopPropagation();
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
		const p = stagePoint(e);
		const n = toNorm(p.x, p.y);
		if ((e.currentTarget as HTMLElement).dataset.edge === 'se') {
			setDrag({ kind: 'resize', sx: 0, sy: 0 });
		} else {
			setDrag({ kind: 'move', dx: n.x - crop.x, dy: n.y - crop.y });
		}
	};
	const onDrag = (e: React.PointerEvent) => {
		e.preventDefault();
		if (!drag) return;
		const p = stagePoint(e);
		const n = toNorm(p.x, p.y);
		if (drag.kind === 'move') {
			setCrop((c) => moveRect(c, n.x - drag.dx - c.x, n.y - drag.dy - c.y));
		} else {
			// resize: anchor NW at crop.x/crop.y
			const x0 = crop.x;
			const y0 = crop.y;
			let w = Math.max(MIN_CROP_PX / layout.imgW, n.x - x0);
			let h = Math.max(MIN_CROP_PX / layout.imgH, n.y - y0);
			const r = aspectRatio(aspect);
			if (r > 0) {
				w = Math.max(w, h * r);
				h = w / r;
			}
			if (x0 + w > 1) w = 1 - x0;
			if (y0 + h > 1) h = 1 - y0;
			if (r > 0 && (x0 + w > 1 || y0 + h > 1)) {
				// fit back to ratio within bounds
				w = Math.min(1 - x0, 1);
				h = w / r;
				if (y0 + h > 1) h = 1 - y0;
			}
			setCrop(clampRect({ x: x0, y: y0, w, h }));
		}
	};
	const stopDrag = () => setDrag(null);

	const applyAspect = (id: AspectId) => {
		setAspect(id);
		setCrop((prev) => reaspect(prev, aspectRatio(id)));
	};

	const applyEdit = async () => {
		if (!bitmap || !request) return;
		setApplying(true);
		onBusy?.(true);
		try {
			const isPng = /\.(png|webp)$/i.test(request.name);
			const mime = isPng ? 'image/png' : 'image/jpeg';
			const blob = await renderResult(bitmap, crop, grade, mime);
			const name = request.name.replace(/\.[^.]+$/, '') + (isPng ? '.png' : '.jpg');
			const file = new File([blob], name, { type: mime });
			if (!token) throw new Error('Upload is unavailable here (no session token).');
			const up = await uploadFile(token, file);
			onApply(up.url);
			onClose();
		} catch (e) {
			setLoadErr(e instanceof Error ? e.message : 'Could not finish the edit.');
		} finally {
			setApplying(false);
			onBusy?.(false);
		}
	};

	const dirtyCrop = crop.x !== 0 || crop.y !== 0 || crop.w < 1 || crop.h < 1;
	const dirtyColour = grade.brightness !== 0 || grade.exposure !== 0 || grade.contrast !== 0;
	const dirtyRot = turn !== 0 || horiz || vert;

	return (
		<Dialog open={open} onOpenChange={(o) => !o && !applying && onClose()}>
			<DialogContent
				style={{ width: 'min(860px, calc(100vw - 2rem))', maxWidth: 860, maxHeight: 'calc(100dvh - 2rem)', overflowY: 'auto' }}
			>
				<DialogHeader>
					<DialogTitle>Edit image</DialogTitle>
					<DialogDescription>
						Crop, rotate, flip, zoom and tune the photo. Applying uploads a processed copy — library originals are never modified.
					</DialogDescription>
				</DialogHeader>

				{loadErr ? (
					<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
						<span style={{ color: '#b45309' }}>{loadErr}</span>
						<span style={{ fontSize: '0.8rem', color: '#64748b' }}>You can still set this image from the picker without editing it.</span>
					</div>
				) : !graded ? (
					<div style={{ color: '#64748b', fontSize: '0.85rem' }}>Preparing image…</div>
				) : (
					<div
						ref={wrapRef}
						style={{ position: 'relative', width: STAGE_W, height: STAGE_H, touchAction: 'none', userSelect: 'none', overflow: 'hidden' }}
					>
						<canvas
							ref={stageRef}
							width={STAGE_W}
							height={STAGE_H}
							style={{ display: 'block', borderRadius: 8, cursor: drag ? 'grabbing' : 'crosshair' }}
						/>
						{/* dim outside the crop */}
						{[
							{ x: 0, y: 0, w: STAGE_W, h: Math.max(0, boxInPx.y) },
							{ x: 0, y: boxInPx.y + boxInPx.h, w: STAGE_W, h: Math.max(0, STAGE_H - boxInPx.y - boxInPx.h) },
							{ x: 0, y: Math.max(0, boxInPx.y), w: Math.max(0, boxInPx.x), h: boxInPx.h },
							{ x: boxInPx.x + boxInPx.w, y: Math.max(0, boxInPx.y), w: Math.max(0, STAGE_W - boxInPx.x - boxInPx.w), h: boxInPx.h },
						].map((r, i) => (
							<div
								key={i}
								style={{
									position: 'absolute',
									left: r.x,
									top: r.y,
									width: r.w,
									height: r.h,
									background: 'rgba(2,6,23,0.45)',
									pointerEvents: 'none',
								}}
							/>
						))}
						{/* drag-to-move body */}
						<div
							onPointerDown={onStart}
							onPointerMove={onDrag}
							onPointerUp={stopDrag}
							onPointerCancel={stopDrag}
							style={{
								position: 'absolute',
								left: boxInPx.x,
								top: boxInPx.y,
								width: boxInPx.w,
								height: boxInPx.h,
								border: '2px solid #fff',
								boxSizing: 'border-box',
								cursor: 'move',
							}}
						/>
						{/* resize handle */}
						<div
							data-edge="se"
							onPointerDown={onStart}
							onPointerMove={onDrag}
							onPointerUp={stopDrag}
							onPointerCancel={stopDrag}
							style={{
								position: 'absolute',
								left: boxInPx.x + boxInPx.w - 8,
								top: boxInPx.y + boxInPx.h - 8,
								width: 18,
								height: 18,
								cursor: 'se-resize',
								zIndex: 3,
							}}
						>
							<div
								style={{
									width: 12,
									height: 12,
									borderRadius: 3,
									background: '#fff',
									margin: 3,
									boxShadow: '0 1px 4px rgba(0,0,0,.4)',
								}}
							/>
						</div>
						<div
							style={{
								position: 'absolute',
								left: 8,
								top: 8,
								fontSize: '0.7rem',
								color: 'rgba(255,255,255,.8)',
								background: 'rgba(0,0,0,.4)',
								padding: '2px 6px',
								borderRadius: 4,
								pointerEvents: 'none',
							}}
						>
							Drag to move · corner to resize · scroll or slider to zoom
						</div>
					</div>
				)}

				{!loadErr && graded && (
					<div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end', marginTop: 4 }}>
						<Tool label="Crop shape">
							<div style={{ display: 'flex', gap: 4 }}>
								{ASPECT_IDS.map((id) => (
									<Button key={id} size="xs" variant={aspect === id ? 'default' : 'outline'} type="button" onClick={() => applyAspect(id)}>
										{id === 'free' ? 'Free' : id}
									</Button>
								))}
							</div>
						</Tool>
						<Tool label="Rotate · flip">
							<div style={{ display: 'flex', gap: 4 }}>
								<Button size="xs" variant="outline" type="button" aria-label="Rotate left" onClick={() => setTurn((t) => toTurn(t - 1))}>
									<RotateCcw size={13} />
								</Button>
								<Button size="xs" variant="outline" type="button" aria-label="Rotate right" onClick={() => setTurn((t) => toTurn(t + 1))}>
									<RotateCw size={13} />
								</Button>
								<Button size="xs" variant="outline" type="button" aria-label="Flip horizontal" onClick={() => setHoriz((v) => !v)}>
									<FlipHorizontal2 size={13} />
								</Button>
								<Button size="xs" variant="outline" type="button" aria-label="Flip vertical" onClick={() => setVert((v) => !v)}>
									<FlipVertical2 size={13} />
								</Button>
							</div>
						</Tool>
						<Tool label="Zoom (view)">
							<div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 200 }}>
								<Slider
									min={-20}
									max={100}
									step={2}
									value={[zoom]}
									onValueChange={(v) => setZoom(Array.isArray(v) ? (v[0] ?? 0) : (v ?? 0))}
									aria-label="Zoom"
								/>
							</div>
						</Tool>
					</div>
				)}

				{!loadErr && graded && (
					<div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
						<GradeSlider label="Brightness" value={grade.brightness} onChange={(v) => setGrade((g) => ({ ...g, brightness: v }))} />
						<GradeSlider label="Exposure" value={grade.exposure} onChange={(v) => setGrade((g) => ({ ...g, exposure: v }))} />
						<GradeSlider label="Contrast" value={grade.contrast} onChange={(v) => setGrade((g) => ({ ...g, contrast: v }))} />
						<Button
							type="button"
							size="xs"
							variant="ghost"
							style={{ alignSelf: 'flex-start' }}
							disabled={!dirtyColour}
							onClick={() => setGrade({ ...NEUTRAL })}
						>
							Reset colour
						</Button>
					</div>
				)}

				<DialogFooter className="sm:justify-between">
					<Button type="button" variant="outline" onClick={onClose} disabled={applying}>
						Cancel
					</Button>
					{!loadErr && (
						<div style={{ display: 'flex', gap: 6 }}>
							{(dirtyCrop || dirtyColour || dirtyRot) && (
								<Button
									type="button"
									variant="outline"
									disabled={applying}
									onClick={() => {
										setTurn(0);
										setHoriz(false);
										setVert(false);
										setCrop({ ...FULL });
										setAspect('free');
										setGrade({ ...NEUTRAL });
										setZoom(0);
									}}
								>
									<Trash2 size={13} />
									Reset
								</Button>
							)}
							<Button type="button" disabled={applying} onClick={() => void applyEdit()}>
								{applying ? 'Applying…' : 'Apply'}
							</Button>
						</div>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function Tool({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
			<span style={{ fontSize: '0.72rem', color: '#64748b' }}>{label}</span>
			{children}
		</div>
	);
}

function GradeSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
	return (
		<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
			<span style={{ width: 84, fontSize: '0.78rem', color: '#374151' }}>{label}</span>
			<div style={{ flex: 1, maxWidth: 340 }}>
				<Slider
					min={GRADE_RANGE.min}
					max={GRADE_RANGE.max}
					step={GRADE_RANGE.step}
					value={[value]}
					onValueChange={(v) => onChange(Array.isArray(v) ? (v[0] ?? 0) : (v ?? 0))}
					aria-label={label}
				/>
			</div>
			<span style={{ width: 40, fontSize: '0.72rem', color: '#94a3b8', textAlign: 'right' }}>{value > 0 ? `+${value}` : value}</span>
		</div>
	);
}

/** Render the selected crop of the oriented bitmap at final resolution, apply
 *  the same per-pixel grade as the preview, and encode to a Blob. */
async function renderResult(bmp: HTMLCanvasElement, crop: Rect, grade: Grade, mime: string): Promise<Blob> {
	const sw = Math.max(1, Math.round(bmp.width * crop.w));
	const sh = Math.max(1, Math.round(bmp.height * crop.h));
	const maxSide = 2200;
	const s = Math.min(1, maxSide / Math.max(sw, sh));
	const W = Math.max(1, Math.round(sw * s));
	const H = Math.max(1, Math.round(sh * s));
	const out = document.createElement('canvas');
	out.width = W;
	out.height = H;
	const ctx = out.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('Canvas is not supported in this browser.');
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	const sx = bmp.width * crop.x;
	const sy = bmp.height * crop.y;
	ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, W, H);
	if (grade.brightness !== 0 || grade.exposure !== 0 || grade.contrast !== 0) {
		const data = ctx.getImageData(0, 0, W, H);
		gradePixels(data.data, W * H, grade);
		ctx.putImageData(data, 0, 0);
	}
	const blob = await canvasToBlob(out, mime, mime === 'image/png' ? undefined : 0.9);
	if (!blob) throw new Error('Could not encode the edited image.');
	return blob;
}
