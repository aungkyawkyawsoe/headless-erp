/**
 * Dependency-free date utilities used by the Calendar and DatePicker
 * components. Replaces the runtime usage of `date-fns` and the
 * react-day-picker selection engine.
 */
export { createLocale, enUS, resolveLocale } from './locale';
export type { CalendarLocale } from './locale';
export {
	compareDates,
	isAfter,
	isAfterOrSame,
	isBefore,
	isBeforeOrSame,
	isDayBetweenInclusive,
	isSameDay,
	isSameMonth,
	isSameYear,
} from './compare';
export {
	addDays,
	addMonths,
	endOfMonth,
	endOfWeek,
	getDaysInMonth,
	getWeekNumber,
	isDayInMonth,
	startOfDay,
	startOfMonth,
	startOfWeek,
} from './mutate';
export { formatDate, getMonthNames, getMonthNamesShort, getWeekdayNames } from './format';
export { isDateDisabled, matchDate } from './matcher';
export type { DateMatcher } from './matcher';
export { getMonthGrid } from './grid';
export type { CalendarDayCell, CalendarGridOptions, CalendarWeek } from './grid';
export {
	getRangeModifier,
	isDateRange,
	rangeContainsDisabledDay,
	reduceRangeSelection,
	resetRangeOnSelect,
	selectSingle,
	toggleDateInArray,
} from './selection';
export type { CalendarSelection, DateRange, RangeModifier, SelectionConstraints } from './selection';
