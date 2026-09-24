/**
 * Date matchers — the same shapes react-day-picker's `disabled` /
 * `modifiers` props accepted, implemented without any dependency.
 */
import { isAfter, isBefore, isSameDay } from './compare';
import { startOfMonth, endOfMonth } from './mutate';

export type DateMatcher =
	| boolean
	| ((date: Date) => boolean)
	| Date
	| Date[]
	| { before: Date; after?: Date }
	| { after: Date; before?: Date }
	| { dayOfWeek: number[] };

/**
 * True when `date` matches. An array of matchers is an OR; a plain `Date[]`
 * is treated as a list of dates to match against.
 */
export function matchDate(date: Date, matcher: DateMatcher | DateMatcher[]): boolean {
	if (Array.isArray(matcher)) {
		const matchers = matcher as DateMatcher[];
		if (matchers.length === 0) return false;
		const allDates = matchers.every((m): m is Date => m instanceof Date);
		if (allDates) {
			return (matchers as Date[]).some((m) => isSameDay(date, m));
		}
		return matchers.some((m) => matchDate(date, m));
	}
	return matchSingleMatcher(date, matcher);
}

function matchSingleMatcher(date: Date, matcher: DateMatcher): boolean {
	if (typeof matcher === 'boolean') return matcher;
	if (typeof matcher === 'function') return matcher(date);
	if (matcher instanceof Date) return isSameDay(date, matcher);
	if (Array.isArray(matcher)) return matchDate(date, matcher);

	if ('before' in matcher || 'after' in matcher) {
		const before = matcher.before;
		const after = matcher.after;
		if (before && after) return isAfter(date, before) && isBefore(date, after);
		if (before) return isBefore(date, before);
		if (after) return isAfter(date, after);
		return false;
	}

	if ('dayOfWeek' in matcher) {
		return matcher.dayOfWeek.includes(date.getDay());
	}

	return false;
}

/**
 * Combined "is this day selectable" check — honors `startMonth` / `endMonth`
 * boundaries plus any explicit `disabled` matchers.
 */
export function isDateDisabled(date: Date, disabled: DateMatcher | DateMatcher[] | undefined, startMonth?: Date, endMonth?: Date): boolean {
	if (startMonth && isBefore(date, startOfMonth(startMonth))) return true;
	if (endMonth && isAfter(date, endOfMonth(endMonth))) return true;
	if (disabled) return matchDate(date, disabled);
	return false;
}
