/**
 * Calendar month-grid generation. Turns a month into weeks of day cells
 * ready to render, including outside/today flags and week numbers.
 */
import { isSameDay } from './compare';
import { addDays, endOfMonth, endOfWeek, getWeekNumber, isDayInMonth, startOfMonth, startOfWeek } from './mutate';

export interface CalendarDayCell {
	/** The day, at local midnight. */
	date: Date;
	/** Belongs to an adjacent month (shown when `showOutsideDays`). */
	isOutside: boolean;
	isToday: boolean;
	/** Computed by the caller via `isDateDisabled`. */
	isDisabled: boolean;
	/** Hidden entirely (outside days when `showOutsideDays` is false). */
	isHidden: boolean;
}

export interface CalendarWeek {
	weekNumber: number;
	days: CalendarDayCell[];
}

export interface CalendarGridOptions {
	weekStartsOn: number;
	firstWeekContainsDate: number;
	showOutsideDays?: boolean;
	showWeekNumber?: boolean;
	fixedWeeks?: boolean;
}

export function getMonthGrid(month: Date, options: CalendarGridOptions): CalendarWeek[] {
	const { weekStartsOn, firstWeekContainsDate, showOutsideDays = true, fixedWeeks = false } = options;

	const firstOfMonth = startOfMonth(month);
	const lastOfMonth = endOfMonth(month);
	const gridStart = startOfWeek(firstOfMonth, weekStartsOn);
	const gridEnd = endOfWeek(lastOfMonth, weekStartsOn);

	const days: Date[] = [];
	let cursor = new Date(gridStart);
	while (cursor.getTime() <= gridEnd.getTime()) {
		days.push(cursor);
		cursor = addDays(cursor, 1);
	}

	// `fixedWeeks` pads to a full 6-week grid so the height stays stable.
	if (fixedWeeks) {
		const weekCount = Math.ceil(days.length / 7);
		if (weekCount < 6) {
			let tail = days[days.length - 1];
			for (let i = 0; i < (6 - weekCount) * 7; i++) {
				tail = addDays(tail, 1);
				days.push(tail);
			}
		}
	}

	const today = new Date();
	const weeks: CalendarWeek[] = [];
	for (let i = 0; i < days.length; i += 7) {
		const weekDays = days.slice(i, i + 7);
		weeks.push({
			weekNumber: getWeekNumber(weekDays[0], weekStartsOn, firstWeekContainsDate),
			days: weekDays.map((date) => {
				const isOutside = !isDayInMonth(date, month);
				return {
					date,
					isOutside,
					isToday: isSameDay(date, today),
					isDisabled: false,
					isHidden: !showOutsideDays && isOutside,
				};
			}),
		});
	}

	return weeks;
}
