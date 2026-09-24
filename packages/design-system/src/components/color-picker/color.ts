/**
 * Color parsing/formatting utilities for the ColorPicker.
 *
 * Supports the four CSS color formats the picker can display and edit:
 * HEX (`#rrggbb` / `#rrggbbaa`), `rgb()`, `hsl()` and `oklch()` — with an
 * optional alpha channel in every format. Conversions follow the standard
 * sRGB → HSL and sRGB → OKLab (Björn Ottosson) matrices.
 */

export type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'oklch';

export interface RGBA {
	/** Red, 0–255 */
	r: number;
	/** Green, 0–255 */
	g: number;
	/** Blue, 0–255 */
	b: number;
	/** Alpha, 0–1 */
	a: number;
}

export const COLOR_FORMATS: ColorFormat[] = ['hex', 'rgb', 'hsl', 'oklch'];

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const round = (v: number, digits: number) => {
	const f = 10 ** digits;
	return Math.round(v * f) / f;
};

// ── Parsing ─────────────────────────────────────────────

const HEX_RE = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE = /^rgba?\((.*)\)$/i;
const HSL_RE = /^hsla?\((.*)\)$/i;
const OKLCH_RE = /^oklch\((.*)\)$/i;
const ANGLE_RE = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|grad|rad|turn)?$/i;

/** Splits `rgb(59 130 246 / 0.5)`-style channel lists into channels + alpha. */
function splitChannels(body: string): { channels: string[]; alpha?: string } {
	const [head, ...tail] = body.split('/');
	const channels = (head ?? '')
		.trim()
		.split(/[\s,]+/)
		.filter(Boolean);
	const alpha = tail.length > 0 ? tail.join('/').trim() : undefined;
	return { channels, alpha };
}

/** Parses a number or percentage. Percentages are returned as 0–1. */
function parseUnit(value: string): number | null {
	const t = value.trim();
	if (t.endsWith('%')) {
		const n = parseFloat(t);
		return Number.isFinite(n) ? n / 100 : null;
	}
	const n = parseFloat(t);
	return Number.isFinite(n) ? n : null;
}

/** Parses an angle (bare number = degrees; also deg/grad/rad/turn) into degrees. */
function parseAngle(value: string): number | null {
	const m = ANGLE_RE.exec(value.trim());
	if (!m) return null;
	const n = parseFloat(m[1]);
	switch ((m[2] ?? 'deg').toLowerCase()) {
		case 'deg':
			return n;
		case 'grad':
			return n * 0.9;
		case 'rad':
			return (n * 180) / Math.PI;
		case 'turn':
			return n * 360;
		default:
			return null;
	}
}

function parseAlpha(value: string | undefined): number {
	if (value == null || value === '') return 1;
	return clamp(parseUnit(value) ?? 1, 0, 1);
}

function parseHex(value: string): RGBA | null {
	const m = HEX_RE.exec(value.trim());
	if (!m) return null;
	const hex = m[1];
	return {
		r: parseInt(hex.slice(0, 2), 16),
		g: parseInt(hex.slice(2, 4), 16),
		b: parseInt(hex.slice(4, 6), 16),
		a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
	};
}

function parseRgb(value: string): RGBA | null {
	const m = RGB_RE.exec(value.trim());
	if (!m) return null;
	const { channels, alpha } = splitChannels(m[1]);
	if (channels.length !== 3) return null;
	const [r, g, b] = channels;
	const rv = parseUnit(r);
	const gv = parseUnit(g);
	const bv = parseUnit(b);
	if (rv == null || gv == null || bv == null) return null;
	return {
		r: clamp(rv * (r.endsWith('%') ? 255 : 1), 0, 255),
		g: clamp(gv * (g.endsWith('%') ? 255 : 1), 0, 255),
		b: clamp(bv * (b.endsWith('%') ? 255 : 1), 0, 255),
		a: parseAlpha(alpha),
	};
}

function parseHsl(value: string): RGBA | null {
	const m = HSL_RE.exec(value.trim());
	if (!m) return null;
	const { channels, alpha } = splitChannels(m[1]);
	if (channels.length !== 3) return null;
	const hRaw = parseAngle(channels[0]);
	const s = parseUnit(channels[1]);
	const l = parseUnit(channels[2]);
	if (hRaw == null || s == null || l == null) return null;
	const h = ((hRaw % 360) + 360) % 360;
	return {
		...hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1)),
		a: parseAlpha(alpha),
	};
}

function parseOklch(value: string): RGBA | null {
	const m = OKLCH_RE.exec(value.trim());
	if (!m) return null;
	const { channels, alpha } = splitChannels(m[1]);
	if (channels.length !== 3) return null;
	const l = parseUnit(channels[0]);
	const c = parseUnit(channels[1]);
	const h = parseAngle(channels[2]);
	if (l == null || c == null || h == null) return null;
	const { r, g, b } = oklchToRgb(clamp(l, 0, 1), clamp(c, 0, 0.5), h);
	return { r, g, b, a: parseAlpha(alpha) };
}

/**
 * Parses a color string in any supported format. Returns the normalized
 * sRGB value, or `null` when the string is not a valid color.
 */
export function parseColor(value: string): RGBA | null {
	if (!value.trim()) return null;
	return parseHex(value) ?? parseRgb(value) ?? parseHsl(value) ?? parseOklch(value);
}

// ── Formatting ──────────────────────────────────────────

/** Formats an sRGB color as a CSS string in the requested format. */
export function formatColor(color: RGBA, format: ColorFormat): string {
	switch (format) {
		case 'hex': {
			const toHex = (n: number) =>
				Math.round(clamp(n, 0, 255))
					.toString(16)
					.padStart(2, '0');
			const base = `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
			return color.a >= 1 ? base : base + toHex(color.a * 255);
		}
		case 'rgb': {
			const r = Math.round(clamp(color.r, 0, 255));
			const g = Math.round(clamp(color.g, 0, 255));
			const b = Math.round(clamp(color.b, 0, 255));
			return color.a >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${round(color.a, 3)})`;
		}
		case 'hsl': {
			const { h, s, l } = rgbToHsl(color.r, color.g, color.b);
			const hue = Math.round(h);
			const sat = Math.round(s * 100);
			const lig = Math.round(l * 100);
			return color.a >= 1 ? `hsl(${hue} ${sat}% ${lig}%)` : `hsl(${hue} ${sat}% ${lig}% / ${round(color.a, 3)})`;
		}
		case 'oklch': {
			const { l, c, h } = rgbToOklch(color.r, color.g, color.b);
			const base = `oklch(${round(l, 3)} ${round(c, 3)} ${round(h, 2)})`;
			return color.a >= 1 ? base : `${base} / ${round(color.a, 3)}`;
		}
	}
}

// ── Conversions ─────────────────────────────────────────

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const hp = h / 60;
	const x = c * (1 - Math.abs((hp % 2) - 1));
	let r = 0;
	let g = 0;
	let b = 0;
	if (hp < 1) {
		r = c;
		g = x;
	} else if (hp < 2) {
		r = x;
		g = c;
	} else if (hp < 3) {
		g = c;
		b = x;
	} else if (hp < 4) {
		g = x;
		b = c;
	} else if (hp < 5) {
		r = x;
		b = c;
	} else {
		r = c;
		b = x;
	}
	const m = l - c / 2;
	return {
		r: Math.round((r + m) * 255),
		g: Math.round((g + m) * 255),
		b: Math.round((b + m) * 255),
	};
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const l = (max + min) / 2;
	if (max === min) return { h: 0, s: 0, l };
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h: number;
	if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
	else if (max === gn) h = (bn - rn) / d + 2;
	else h = (rn - gn) / d + 4;
	return { h: h * 60, s, l };
}

function srgbToLinear(c: number): number {
	const v = c / 255;
	return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
	const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
	return Math.round(clamp(v, 0, 1) * 255);
}

/** sRGB (0–255) → OKLCH via OKLab. */
function rgbToOklch(r: number, g: number, b: number): { l: number; c: number; h: number } {
	const rl = srgbToLinear(r);
	const gl = srgbToLinear(g);
	const bl = srgbToLinear(b);
	const l_ = Math.cbrt(0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl);
	const m_ = Math.cbrt(0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl);
	const s_ = Math.cbrt(0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl);
	const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
	const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
	const b_ = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
	const c = Math.hypot(a, b_);
	const h = ((Math.atan2(b_, a) * 180) / Math.PI + 360) % 360;
	return { l: L, c, h };
}

/** OKLCH → sRGB (0–255) via OKLab. */
function oklchToRgb(l: number, c: number, h: number): { r: number; g: number; b: number } {
	const hr = (h * Math.PI) / 180;
	const a = c * Math.cos(hr);
	const b_ = c * Math.sin(hr);
	const l_ = l + 0.3963377774 * a + 0.2158037573 * b_;
	const m_ = l - 0.1055613458 * a - 0.0638541728 * b_;
	const s_ = l - 0.0894841775 * a - 1.291485548 * b_;
	const rl = l_ ** 3;
	const gl = m_ ** 3;
	const bl = s_ ** 3;
	return {
		r: linearToSrgb(4.0767416621 * rl - 3.3077115913 * gl + 0.2309699292 * bl),
		g: linearToSrgb(-1.2684380046 * rl + 2.6097574011 * gl - 0.3413193965 * bl),
		b: linearToSrgb(-0.0041960863 * rl - 0.7034186147 * gl + 1.707614701 * bl),
	};
}
