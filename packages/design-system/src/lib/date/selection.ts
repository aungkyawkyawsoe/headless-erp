/**
 * Selection state machines for single / multiple / range modes.
 *
 * Semantics are a faithful port of react-day-picker v10's `useSingle`,
 * `useMulti` and `useRange` (+ `addToRange`), so existing consumers keep the
 * same click behavior. Pure functions — easy to unit test.
 */
import { isBefore, isDayBetweenInclusive, isSameDay } from './compare';
import { addDays, startOfDay } from './mutate';

export type DateRange = { from: Date | undefined; to?: Date | undefined };

export type CalendarSelection = Date | Date[] | DateRange | undefined;

export function isDateRange(value: unknown): value is DateRange {
	return typeof value === 'object' && value !== null && 'from' in value;
}

export interface SelectionConstraints {
	/** Range/multiple mode: minimum number of days. 0 = no limit. */
	min?: number;
	/** Range/multiple mode: maximum number of days. 0 = no limit. */
	max?: number;
	/** Whether the selection can never be cleared. */
	required?: boolean;
	/** Range mode: clicking a day starts a new range when none/open exists. */
	resetOnSelect?: boolean;
	/** Range mode: reset the range if it would include a disabled day. */
	excludeDisabled?: boolean;
	/** Range mode: matchers used with `excludeDisabled`. */
	disabled?: unknown;
}

function differenceInCalendarDays(a: Date, b: Date): number {
	return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / (24 * 60 * 60 * 1000));
}

// ── Single mode ────────────────────────────────────────────────────────────

export function selectSingle(current: Date | undefined, day: Date, required?: boolean): Date | undefined {
	if (!required && current && isSameDay(current, day)) return undefined;
	return startOfDay(day);
}

// ── Multiple mode ──────────────────────────────────────────────────────────

export function toggleDateInArray(current: Date[] | undefined, day: Date, constraints?: SelectionConstraints): Date[] {
	const { min = 0, max = 0, required = false } = constraints ?? {};
	const list = current ?? [];
	const dayStart = startOfDay(day);
	const isSelected = list.some((d) => isSameDay(d, dayStart));

	if (isSelected) {
		if (min > 0 && list.length === min) return list;
		if (required && list.length === 1) return list;
		return list.filter((d) => !isSameDay(d, dayStart));
	}

	if (max > 0 && list.length === max) {
		// Max reached — reset the selection to the clicked day.
		return [dayStart];
	}
	return [...list, dayStart];
}

// ── Range mode ─────────────────────────────────────────────────────────────

/**
 * Adds a day to a range, honoring `min` / `max` span constraints, `required`
 * and `resetOnSelect`. Mirrors RDP v10 `addToRange` + `useRange` logic.
 */
export function reduceRangeSelection(current: DateRange | undefined, day: Date, constraints?: SelectionConstraints): DateRange | undefined {
	const { min = 0, max = 0, required = false } = constraints ?? {};
	const date = startOfDay(day);
	const from = current?.from ? startOfDay(current.from) : undefined;
	const to = current?.to ? startOfDay(current.to) : undefined;

	let range: DateRange | undefined;

	if (!from && !to) {
		// Empty range — start it. With no minimum, RDP completes it immediately.
		range = { from: date, to: min > 0 ? undefined : date };
	} else if (from && !to) {
		// Open range (from set, no to yet).
		if (isSameDay(from, date)) {
			if (min === 0) range = { from, to: date };
			else if (required) range = { from, to: undefined };
			else range = undefined;
		} else if (isBefore(date, from)) {
			range = { from: date, to: from };
		} else {
			range = { from, to: date };
		}
	} else if (from && to) {
		// Complete range.
		if (isSameDay(from, date) && isSameDay(to, date)) {
			range = required ? { from, to } : undefined;
		} else if (isSameDay(from, date)) {
			range = { from, to: min > 0 ? undefined : date };
		} else if (isSameDay(to, date)) {
			range = { from: date, to: min > 0 ? undefined : date };
		} else if (isBefore(date, from)) {
			range = { from: date, to };
		} else {
			range = { from, to: date };
		}
	}

	// Enforce min / max span.
	if (range?.from && range.to) {
		const diff = differenceInCalendarDays(range.to, range.from);
		if (max > 0 && diff > max) {
			range = { from: date, to: undefined };
		} else if (min > 1 && diff < min) {
			range = { from: date, to: undefined };
		}
	}

	return range;
}

/**
 * Applies `resetOnSelect`: when there is no `from` or the range is complete,
 * clicking a day starts a brand-new open range.
 */
export function resetRangeOnSelect(current: DateRange | undefined, day: Date, constraints?: SelectionConstraints): DateRange | undefined {
	const { min = 0, required = false } = constraints ?? {};
	const date = startOfDay(day);
	const from = current?.from;
	const to = current?.to;
	const isClickingSingleDayRange = !!from && !!to && isSameDay(from, to) && isSameDay(date, from);

	if (!required && isClickingSingleDayRange) return undefined;
	return { from: date, to: min > 0 ? undefined : date };
}

/** True when the completed range would include a day matching `disabled`. */
export function rangeContainsDisabledDay(range: DateRange, disabled: unknown): boolean {
	const matchers = Array.isArray(disabled) ? disabled : [disabled];
	const { from, to } = range;
	if (!from || !to) return false;

	const rangeHas = (matcher: unknown): boolean => {
		if (typeof matcher === 'function') return false; // evaluated in the loop
		if (typeof matcher === 'boolean') return matcher;
		if (matcher instanceof Date) return isDayBetweenInclusive(matcher, from, to);
		if (Array.isArray(matcher)) {
			return matcher.some((m) => m instanceof Date && isDayBetweenInclusive(m, from, to));
		}
		if (matcher && typeof matcher === 'object') {
			const m = matcher as Record<string, unknown>;
			if (m.dayOfWeek && Array.isArray(m.dayOfWeek)) {
				let cursor = startOfDay(from);
				for (let i = 0; i <= differenceInCalendarDays(to, from); i++) {
					if ((m.dayOfWeek as number[]).includes(cursor.getDay())) return true;
					cursor = addDays(cursor, 1);
				}
				return false;
			}
			// `{ before }` / `{ after }` / `{ before, after }` intervals.
			const before = m.before instanceof Date ? m.before : undefined;
			const after = m.after instanceof Date ? m.after : undefined;
			if (before && after) {
				return (
					isDayBetweenInclusive(from, addDays(after, 1), addDays(before, -1)) ||
					isDayBetweenInclusive(to, addDays(after, 1), addDays(before, -1))
				);
			}
			if (before) return isDayBetweenInclusive(from, from, addDays(before, -1));
			if (after) return isDayBetweenInclusive(to, addDays(after, 1), to);
			return false;
		}
		return false;
	};

	if (matchers.some((m) => typeof m !== 'function' && rangeHas(m))) return true;

	// Evaluate function matchers day by day.
	const functionMatchers = matchers.filter((m) => typeof m === 'function') as ((date: Date) => boolean)[];
	if (functionMatchers.length > 0) {
		let cursor = startOfDay(from);
		const total = differenceInCalendarDays(to, from);
		for (let i = 0; i <= total; i++) {
			if (functionMatchers.some((m) => m(cursor))) return true;
			cursor = addDays(cursor, 1);
		}
	}
	return false;
}

// ── Day-level helpers ──────────────────────────────────────────────────────

export type RangeModifier = 'start' | 'middle' | 'end' | 'both' | null;

/**
 * Range modifier for a single day. `previewTo` drives the hover preview:
 * `{ from, to: hovered }` is applied while the range is still open.
 * A single-day range (from === to) returns `"both"` so the day renders
 * fully rounded, matching react-day-picker.
 */
export function getRangeModifier(date: Date, range: DateRange | undefined, previewTo?: Date): RangeModifier {
	if (!range?.from) return null;
	const to = previewTo ?? range.to;
	if (!to) return isSameDay(date, range.from) ? 'start' : null;
	if (isSameDay(date, range.from) && isSameDay(date, to)) return 'both';
	if (isSameDay(date, range.from)) return 'start';
	if (isSameDay(date, to)) return 'end';
	if (isDayBetweenInclusive(date, range.from, to)) return 'middle';
	return null;
}
