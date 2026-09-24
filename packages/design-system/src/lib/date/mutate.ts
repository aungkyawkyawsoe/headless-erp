/**
 * Pure date arithmetic. Every function returns a **new** `Date` and never
 * mutates its arguments.
 */
import { compareDates, isSameMonth } from './compare';

export function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, amount: number): Date {
	const result = new Date(date);
	result.setDate(result.getDate() + amount);
	return result;
}

export function addMonths(date: Date, amount: number): Date {
	const result = new Date(date);
	// Clamp to the last day of the target month (Jan 31 + 1 month → Feb 28/29).
	const day = result.getDate();
	result.setDate(1);
	result.setMonth(result.getMonth() + amount);
	const lastDay = getDaysInMonth(result);
	result.setDate(Math.min(day, lastDay));
	return result;
}

export function startOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function getDaysInMonth(date: Date): number {
	return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function startOfWeek(date: Date, weekStartsOn: number): Date {
	const day = (date.getDay() + 7 - weekStartsOn) % 7;
	return addDays(startOfDay(date), -day);
}

export function endOfWeek(date: Date, weekStartsOn: number): Date {
	const day = (date.getDay() + 7 - weekStartsOn) % 7;
	return addDays(startOfDay(date), 6 - day);
}

export function isDayInMonth(date: Date, month: Date): boolean {
	return isSameMonth(date, month);
}

/**
 * Week number for the week containing `date`, following the same rules as
 * date-fns `getWeek`:
 * - week 1 is the week containing Jan `firstWeekContainsDate` (1 = US,
 *   4 = ISO 8601)
 * - weeks start on `weekStartsOn`
 */
export function getWeekNumber(date: Date, weekStartsOn: number, firstWeekContainsDate: number): number {
	const year = date.getFullYear();

	// The week-year the date belongs to: it can differ from `year` for the
	// first/last days of January/December.
	const firstWeekStartOfNextYear = startOfWeek(new Date(year + 1, 0, firstWeekContainsDate), weekStartsOn);
	let weekYear = year;
	if (compareDates(date, firstWeekStartOfNextYear) >= 0) {
		weekYear = year + 1;
	} else {
		const firstWeekStartOfThisYear = startOfWeek(new Date(year, 0, firstWeekContainsDate), weekStartsOn);
		if (compareDates(date, firstWeekStartOfThisYear) < 0) {
			weekYear = year - 1;
		}
	}

	const firstWeekStart = startOfWeek(new Date(weekYear, 0, firstWeekContainsDate), weekStartsOn);
	const diffDays = Math.round((startOfDay(date).getTime() - firstWeekStart.getTime()) / (24 * 60 * 60 * 1000));
	return Math.floor(diffDays / 7) + 1;
}
