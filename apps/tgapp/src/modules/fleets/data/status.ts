import type { Filter } from '@mmbix/sdk';

import type { FluidKind, FleetRow, FleetUnitType } from './types';

/** The fleets list's unit-type filter — `'all'` (အားလုံး) shows every vehicle.
 *  Only the three unit types the live fleet actually carries are selectable;
 *  any other row (e.g. a `forklift` reintroduced later) stays under `'all'`. */
export type FleetUnitTypeFilterValue = 'all' | FleetUnitType;

/** The filter sheet's options — the single source both the sheet rows and the
 *  bar's center label read (labels are derived, never re-typed). */
export const UNIT_TYPE_OPTIONS: ReadonlyArray<{ value: FleetUnitTypeFilterValue; label: string }> = [
	{ value: 'all', label: 'All' },
	{ value: 'tractor_unit', label: 'Tractor Unit' },
	{ value: 'box', label: 'Box Truck' },
	{ value: 'trailer', label: 'Trailer' },
];

/** Value → label — derived from the options so the two can never drift. */
export const UNIT_TYPE_LABELS = Object.fromEntries(UNIT_TYPE_OPTIONS.map((option) => [option.value, option.label])) as Record<
	FleetUnitTypeFilterValue,
	string
>;

/**
 * The fleet rows the Daily ODO / Fluid service apps list — every vehicle EXCEPT
 * declared `trailer` rows (a pure trailer has no engine/odometer of its own to
 * service). NULL-safe on purpose: an unclassified row (`unit_type` unset) still
 * shows, so only explicit trailers are excluded — a bare `_neq` would also drop
 * unset rows (SQL `!=` is NULL-unknown) and hide vehicles that were never
 * classified. Applied SERVER-side to the `veh_fleets` reads so the 25-row
 * cursor never counts a trailer that would render nothing.
 */
export const SERVICEABLE_VEHICLE_FILTER: Filter<FleetRow> = {
	_or: [{ unit_type: { _null: true } }, { unit_type: { _neq: 'trailer' } }],
};

// ── Vehicle Care — fluid kind + km-left tone vocabulary ─────────────────────

/** Fluid kind → the care sheet's section label. */
export const FLUID_KIND_LABELS: Record<FluidKind, string> = {
	engine_oil: 'Engine oil',
	gear_oil: 'Gear oil',
};

/** The km-left urgency tone of a fluid — green ≥ `KM_OK_AFTER_KM`, amber inside
 *  the last `KM_OK_AFTER_KM`, red once the current odo passed the due odo. */
export type KmLeftTone = 'ok' | 'warn' | 'alert';

/** A fluid with at least this many km left is green. */
export const KM_OK_AFTER_KM = 1000;

/**
 * The km-left tone — the mileage analogue of the expiry-day windows the
 * license/insurance pills use: `ok` (green) ≥ 1000 km left, `warn` (amber)
 * 0–999, `alert` (red) once the current odo is PAST the due odo. Tones come
 * from the same tailwind status palette as the license/insurance pills.
 */
export function kmLeftTone(kmLeft: number | null | undefined): KmLeftTone {
	if (kmLeft === null || kmLeft === undefined) return 'alert';
	if (kmLeft < 0) return 'alert';
	if (kmLeft < KM_OK_AFTER_KM) return 'warn';
	return 'ok';
}

/** Pill tint per km-left tone — soft bg + tone text (the expiry-pill palette). */
export const KM_LEFT_TONE_CLASS: Record<KmLeftTone, string> = {
	ok: 'bg-status-success-soft text-status-success',
	warn: 'bg-status-warning-soft text-status-warning',
	alert: 'bg-status-danger-soft text-status-danger',
};

/** "2,400 km left" / "800 km left" / "300 km past due" — the pill's copy. */
export function kmLeftLabel(kmLeft: number | null | undefined): string {
	if (kmLeft === null || kmLeft === undefined) return 'No service yet';
	if (kmLeft < 0) return `${Math.abs(kmLeft).toLocaleString()} km past due`;
	if (kmLeft === 0) return 'Due now';
	return `${kmLeft.toLocaleString()} km left`;
}

/** "2,400 km" / "800 km" / "300 overdue" — the compact pill's copy (no "left"). */
export function kmLeftShort(kmLeft: number | null | undefined): string {
	if (kmLeft === null || kmLeft === undefined) return '—';
	if (kmLeft < 0) return `${Math.abs(kmLeft).toLocaleString()} overdue`;
	return `${kmLeft.toLocaleString()} km`;
}

/** A km value as "1,234 km" — the due/odo facts (— when null). */
export function kmValueLabel(km: number | null | undefined): string {
	if (km === null || km === undefined) return '—';
	return `${km.toLocaleString()} km`;
}
