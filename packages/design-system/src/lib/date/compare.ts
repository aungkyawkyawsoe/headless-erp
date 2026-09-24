/**
 * Day-granular date comparisons. All helpers ignore the time component so a
 * `Date` constructed at midnight behaves identically to one with a time set.
 */

/** -1 when `a` < `b`, 0 when equal, 1 when `a` > `b` (day granularity). */
export function compareDates(a: Date, b: Date): -1 | 0 | 1 {
	const ay = a.getFullYear();
	const by = b.getFullYear();
	if (ay !== by) return ay < by ? -1 : 1;
	const am = a.getMonth();
	const bm = b.getMonth();
	if (am !== bm) return am < bm ? -1 : 1;
	const ad = a.getDate();
	const bd = b.getDate();
	if (ad !== bd) return ad < bd ? -1 : 1;
	return 0;
}

export function isSameDay(a: Date, b: Date): boolean {
	return compareDates(a, b) === 0;
}

export function isSameMonth(a: Date, b: Date): boolean {
	return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function isSameYear(a: Date, b: Date): boolean {
	return a.getFullYear() === b.getFullYear();
}

export function isBefore(a: Date, b: Date): boolean {
	return compareDates(a, b) < 0;
}

export function isAfter(a: Date, b: Date): boolean {
	return compareDates(a, b) > 0;
}

export function isBeforeOrSame(a: Date, b: Date): boolean {
	return compareDates(a, b) <= 0;
}

export function isAfterOrSame(a: Date, b: Date): boolean {
	return compareDates(a, b) >= 0;
}

/** True when `date` is within `[from, to]` (inclusive, day granularity). */
export function isDayBetweenInclusive(date: Date, from: Date, to: Date): boolean {
	return isAfterOrSame(date, from) && isBeforeOrSame(date, to);
}
