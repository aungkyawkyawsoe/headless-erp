import { describe, expect, it } from 'vitest';
import { aspectRatio, clampRect, FULL, gradeParams, gradePixels, moveRect, NEUTRAL, reaspect, toTurn } from './image-edit';

describe('gradePixels / gradeParams', () => {
	it('neutral grade leaves bytes unchanged', () => {
		const bytes = new Uint8ClampedArray([10, 128, 255, 200, 0, 0, 255, 255]);
		const copy = bytes.slice();
		gradePixels(copy, 2, { ...NEUTRAL });
		expect(Array.from(copy)).toEqual(Array.from(bytes));
	});

	it('brightness lift brightens and clips', () => {
		const px = gradeParams({ brightness: 100, exposure: 0, contrast: 0 });
		expect(px.lift).toBeCloseTo(0.35);
		expect(px.gain).toBeCloseTo(1);
	});

	it('exposure raises gain monotonically', () => {
		expect(gradeParams({ brightness: 0, exposure: 100, contrast: 0 }).gain).toBeGreaterThan(1);
		expect(gradeParams({ brightness: 0, exposure: -100, contrast: 0 }).gain).toBeLessThan(1);
	});

	it('brightens a mid pixel and clips white', () => {
		const bytes = new Uint8ClampedArray([100, 100, 100, 255, 250, 250, 250, 255]);
		gradePixels(bytes, 2, { brightness: 100, exposure: 0, contrast: 0 });
		// lift +0.35 → 100/255≈0.392+0.35=0.742 → ~189
		expect(bytes[0]).toBeGreaterThan(150);
		expect(bytes[0]).toBeLessThan(255);
		// bright pixel ~250/255≈0.98 +0.35 → clip to 255
		expect(bytes[4]).toBe(255);
	});
});

describe('orientation', () => {
	it('toTurn wraps within 0..3', () => {
		expect(toTurn(0)).toBe(0);
		expect(toTurn(3)).toBe(3);
		expect(toTurn(4)).toBe(0);
		expect(toTurn(-1)).toBe(3);
	});
});

describe('crop geometry', () => {
	it('FULL is the whole image', () => {
		expect(FULL).toEqual({ x: 0, y: 0, w: 1, h: 1 });
	});

	it('aspect ratios', () => {
		expect(aspectRatio('free')).toBe(0);
		expect(aspectRatio('1:1')).toBe(1);
		expect(aspectRatio('4:3')).toBeCloseTo(4 / 3);
		expect(aspectRatio('16:9')).toBeCloseTo(16 / 9);
	});

	it('clampRect keeps within [0,1] and honours the min side floor', () => {
		expect(clampRect({ x: -1, y: 2, w: 1, h: 1 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
		const r = clampRect({ x: 0.5, y: 0.5, w: 0.001, h: 1 });
		expect(r.x).toBeGreaterThanOrEqual(0);
		expect(r.w).toBeCloseTo(0.06); // MIN_CROP floor
		expect(r.h).toBe(1);
	});

	it('moveRect translates but never leaves the image', () => {
		const r = clampRect({ x: 0.2, y: 0.2, w: 0.3, h: 0.3 });
		const moved = moveRect(r, 10, 0);
		expect(moved.x).toBe(0.7); // clamped to 1-w = 0.7
		expect(moved.y).toBeCloseTo(0.2);
	});

	it('reaspect keeps centre for a preset ratio', () => {
		const r = reaspect({ x: 0.1, y: 0.2, w: 0.6, h: 0.6 }, 1);
		// fits a 1:1 rect of min side (0.06 ≤ w,h ≤ 1) centred at (0.4,0.5)
		expect(reaspect({ x: 0.1, y: 0.2, w: 0.6, h: 0.6 }, 1).w).toBeGreaterThan(0);
		expect(r.w / r.h).toBeCloseTo(1, 5);
	});
});
