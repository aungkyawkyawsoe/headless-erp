/**
 * Tread-reading helpers — Slice B: a serial tyre's LIVE snapshot now carries a
 * measured `tread_mm` (from a `checked` inspection) and its `mro_item_model` SKU
 * carries a `reference_tread_mm` (the NEW-tread baseline). From those two numbers
 * we derive an honest remaining-tread figure for the fitment board:
 *
 *   remaining % = treadMm / referenceTreadMm
 *
 * IMPORTANT: never fabricate — if either side is missing there is NO reading to
 * show (Slice B is measurement-only; blank/unknown units show nothing, not a
 * fake estimate).
 */
export interface TyreReadingSource {
	/** Latest measured tread (mm) — null until the first check. */
	treadMm: number | null;
	/** This SKU's NEW-tread reference (mm) — null when the catalog lacks it. */
	referenceTreadMm: number | null;
}

/** True only when BOTH a live reading AND its reference exist → a real % is
 *  computable (100 = brand new, lower = worn). */
export function hasTreadReading(source: TyreReadingSource): boolean {
	return (
		source.treadMm != null && source.referenceTreadMm != null && Number.isFinite(source.referenceTreadMm) && source.referenceTreadMm > 0
	);
}

/** Remaining tread clamped to the meaningful 0–100 band. Requires BOTH sides
 *  (see {@link hasTreadReading}) — otherwise null (call the guard first). */
export function remainingTreadPercent(source: TyreReadingSource): number | null {
	if (!hasTreadReading(source)) return null;
	const each = source.treadMm! / source.referenceTreadMm!;
	return Math.max(0, Math.min(100, Math.round(each * 100)));
}

/** Compact display copy for a reading, e.g. "72% · 10.4 mm" — null when no
 *  reading exists. Used by the fitment wheel blocks + the tyre detail header. */
export function treadReadingLabel(source: TyreReadingSource): string | null {
	if (!hasTreadReading(source)) return null;
	const pct = remainingTreadPercent(source)!;
	const mm = source.treadMm!;
	return `${pct}% · ${mm} mm`;
}

// ── Tread-condition traffic light (the fitment PLAN tiles) ─────────────────
// The wheel-map tiles colour by the MEASURED depth itself (the workshop's
// reference scale: ≥5 mm good, 3–5 mm warning, <3 mm replace) rather than by a
// % of the SKU reference — a reading stands alone; no reference is needed.

/** The plan tile's condition band — one of the three traffic-light tones. */
export type TreadBand = 'good' | 'warn' | 'danger';

/** The legend's rows, in descending condition order — single source for the
 *  tile thresholds AND the footer legend (never two hand-tuned scales). */
export const TREAD_BAND_META: ReadonlyArray<{ band: TreadBand; label: string; caption: string; dot: string }> = [
	{ band: 'good', label: 'Good', caption: '≥ 5 mm', dot: 'bg-status-success' },
	{ band: 'warn', label: 'Warning', caption: '3–5 mm', dot: 'bg-status-warning' },
	{ band: 'danger', label: 'Replace', caption: '< 3 mm', dot: 'bg-status-danger' },
];

/** The traffic-light band of a measured depth (mm) — null when there is no
 *  measured depth (a mounted tyre without a `checked` reading is never tinted:
 *  measurement-only, no estimates). */
export function treadBandOf(treadMm: number | null | undefined): TreadBand | null {
	if (treadMm == null || !Number.isFinite(treadMm)) return null;
	if (treadMm >= 5) return 'good';
	if (treadMm >= 3) return 'warn';
	return 'danger';
}
