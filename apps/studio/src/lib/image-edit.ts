/**
 * Pure image-editing math + helpers for the inline `ImageEditorDialog`.
 *
 * The engine `image` field stores a plain URL string; editing happens in the
 * browser on a `<canvas>`. Crop/rotate/zoom are geometry; brightness/exposure/
 * contrast are one deterministic per-pixel transfer so the live preview and the
 * baked export use the same transformation. Cloudflare Image Resizing can't do
 * colour grading and there's no server WASM `sharp`, so editing stays
 * client-side. The finished image is uploaded as a NEW R2 asset — never mutating
 * a shared/source image (image-field-type design doc §9).
 *
 * DOM/React-free on purpose so it unit-tests in isolation.
 */

// ── Colour grading ──────────────────────────────────────────

/** Editor colour knobs (normalized −100…100 each; 0 = neutral).
 *  brightness = lift (additive), exposure = gain (multiplicative),
 *  contrast pivots the ramp around mid-grey. Each is a distinct transfer so the
 *  preview always equals the baked result. */
export type Grade = { brightness: number; exposure: number; contrast: number };

export const NEUTRAL: Grade = { brightness: 0, exposure: 0, contrast: 0 };

export const GRADE_RANGE = { min: -100, max: 100, step: 1 } as const;

export function gradeParams(g: Grade): { lift: number; gain: number; contrast: number } {
	const lift = (g.brightness / 100) * 0.35; // additive lift wrap ±0.35
	const gain = Math.pow(2, g.exposure / 100); // multiplicative exposure 0.5×…2×
	const contrast = 1 + (g.contrast / 100) * 0.6; // pivot slope 0.4…1.6
	return { lift, gain, contrast };
}

/** Grade RGB triplets in place over `pixelCount` pixels. Mutates the caller's
 *  buffer (pass a copy). Alpha is left untouched. */
export function gradePixels(px: Uint8ClampedArray, pixelCount: number, g: Grade): void {
	const { lift, gain, contrast } = gradeParams(g);
	let i = 0;
	for (let p = 0; p < pixelCount; p++) {
		for (let c = 0; c < 3; c++, i++) {
			let v = px[i] / 255; // sRGB byte → [0,1]
			v *= gain; // exposure
			v = (v - 0.5) * contrast + 0.5; // contrast about mid-grey
			v += lift; // brightness
			px[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
		}
	}
}

// ── Orientation ─────────────────────────────────────────────

/** Quarter turns for the 90° rotate buttons. Orientation is re-baked into an
 *  axis-aligned working bitmap once so per-frame draws and cropping stay
 *  axis-aligned and simple. */
export type Turn = 0 | 1 | 2 | 3;

export function toTurn(n: number): Turn {
	return (((Math.round(n) % 4) + 4) % 4) as Turn;
}

// ── Crop geometry (image-normalized 0..1) ───────────────────

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

export const MIN_CROP = 0.06; // smallest crop side as a fraction of the image

export type AspectId = 'free' | '1:1' | '4:3' | '16:9';
export const ASPECT_IDS: AspectId[] = ['free', '1:1', '4:3', '16:9'];

/** width/height ratio for a preset; 0 = free. */
export function aspectRatio(id: AspectId): number {
	switch (id) {
		case '1:1':
			return 1;
		case '4:3':
			return 4 / 3;
		case '16:9':
			return 16 / 9;
		default:
			return 0;
	}
}

export function clampRect(r: Rect): Rect {
	const w = Math.max(MIN_CROP, Math.min(1, r.w));
	const h = Math.max(MIN_CROP, Math.min(1, r.h));
	const x = Math.min(Math.max(0, r.x), 1 - w);
	const y = Math.min(Math.max(0, r.y), 1 - h);
	return { x, y, w, h };
}

/** Move a rect by a normalized delta, clamped inside the unit image. */
export function moveRect(r: Rect, dx: number, dy: number): Rect {
	return clampRect({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h });
}

/** If a free-shaped crop existed and we now need a fixed ratio at the same
 *  centre, produce the box that keeps the centre and obeys ratio, clamped. */
export function reaspect(box: Rect, ratio: number): Rect {
	const cx = box.x + box.w / 2;
	const cy = box.y + box.h / 2;
	const fit = ratio <= 0 ? { ...FULL, x: 0, y: 0, w: 1, h: 1 } : fitRectAtCentre(ratio, cx, cy);
	return clampRect(fit);
}

function fitRectAtCentre(ratio: number, cx: number, cy: number): Rect {
	// largest centred rect of ratio within [0,1]x[0,1]
	let w: number;
	let h: number;
	if (ratio >= 1) {
		w = 1;
		h = 1 / ratio;
	} else {
		h = 1;
		w = ratio;
	}
	return { x: cx - w / 2, y: cy - h / 2, w, h };
}
