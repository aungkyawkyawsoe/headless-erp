/**
 * Scheduler state hook — view + cursor-date navigation, plus the derived
 * week/month slices and toolbar labels the views need. Controlled when
 * `view`/`date` props are passed, uncontrolled otherwise.
 */
import { useCallback, useMemo, useState } from 'react';
import {
	addDays,
	addMonths,
	formatDate,
	getMonthGrid,
	getMonthNames,
	getWeekdayNames,
	resolveLocale,
	startOfDay,
	startOfWeek,
} from '@/date';
import type { SchedulerLabels, SchedulerProps, SchedulerView } from './types';

export interface SchedulerState {
	view: SchedulerView;
	setView: (view: SchedulerView) => void;
	/** The visible month/week/day anchor (local midnight). */
	cursor: Date;
	goTo: (date: Date) => void;
	goPrev: () => void;
	goNext: () => void;
	goToday: () => void;
	/** 7 dates of the visible week (week view). */
	weekDays: Date[];
	/** Fixed 6-week month grid (month + mini-month views). */
	monthGrid: ReturnType<typeof getMonthGrid>;
	/** Toolbar headline, e.g. "August 2026" / "August 2 – 8, 2026". */
	rangeLabel: string;
	/** Rotated weekday labels ordered from `weekStartsOn`. */
	weekdayShort: string[];
	code: string;
	weekStartsOn: number;
	labels: Required<Pick<SchedulerLabels, 'today' | 'allDay' | 'noEvents' | 'more' | 'month' | 'week' | 'day' | 'agenda'>>;
}

function shiftCursor(cursor: Date, view: SchedulerView, dir: 1 | -1): Date {
	switch (view) {
		case 'month':
			return addMonths(cursor, dir);
		case 'agenda':
			return addMonths(cursor, dir);
		case 'week':
			return addDays(cursor, 7 * dir);
		case 'day':
			return addDays(cursor, dir);
	}
}

export function useScheduler(props: SchedulerProps): SchedulerState {
	const {
		defaultView = 'week',
		view: viewProp,
		onViewChange,
		date: dateProp,
		defaultDate,
		onDateChange,
		weekStartsOn: weekStartsOnProp,
	} = props;

	const locale = resolveLocale({ code: props.locale });
	const weekStartsOn = (weekStartsOnProp ?? locale.weekStartsOn) as number;

	const [internalView, setInternalView] = useState<SchedulerView>(defaultView);
	const [internalDate, setInternalDate] = useState<Date>(() => startOfDay(defaultDate ?? new Date()));

	const view = viewProp ?? internalView;
	const cursor = dateProp ?? internalDate;

	const setView = useCallback(
		(v: SchedulerView) => {
			if (viewProp === undefined) setInternalView(v);
			onViewChange?.(v);
		},
		[viewProp, onViewChange],
	);

	const goTo = useCallback(
		(d: Date) => {
			const day = startOfDay(d);
			if (dateProp === undefined) setInternalDate(day);
			onDateChange?.(day);
		},
		[dateProp, onDateChange],
	);

	const goPrev = useCallback(() => goTo(shiftCursor(cursor, view, -1)), [cursor, view, goTo]);
	const goNext = useCallback(() => goTo(shiftCursor(cursor, view, 1)), [cursor, view, goTo]);
	const goToday = useCallback(() => goTo(new Date()), [goTo]);

	const weekDays = useMemo(() => {
		const start = startOfWeek(cursor, weekStartsOn);
		return Array.from({ length: 7 }, (_, i) => addDays(start, i));
	}, [cursor, weekStartsOn]);

	const monthGrid = useMemo(
		() => getMonthGrid(cursor, { weekStartsOn, firstWeekContainsDate: 1, fixedWeeks: true }),
		[cursor, weekStartsOn],
	);

	const code = locale.code;
	const monthNames = getMonthNames(code);
	const rangeLabel = useMemo(() => {
		switch (view) {
			case 'month':
			case 'agenda':
				return `${monthNames[cursor.getMonth()]} ${cursor.getFullYear()}`;
			case 'week': {
				const a = weekDays[0];
				const b = weekDays[6];
				if (a.getMonth() === b.getMonth()) {
					return `${monthNames[a.getMonth()]} ${a.getDate()} – ${b.getDate()}, ${a.getFullYear()}`;
				}
				return `${formatDate(a, 'LLL dd, y', code)} – ${formatDate(b, 'LLL dd, y', code)}`;
			}
			case 'day': {
				const fmt = new Intl.DateTimeFormat(code, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
				return fmt.format(cursor);
			}
		}
	}, [view, cursor, weekDays, monthNames, code]);

	const weekdayShort = useMemo(() => {
		const names = getWeekdayNames(code, 'short');
		return names.slice(weekStartsOn).concat(names.slice(0, weekStartsOn));
	}, [code, weekStartsOn]);

	const labels = useMemo(
		() => ({
			today: props.labels?.today ?? 'Today',
			allDay: props.labels?.allDay ?? 'All day',
			noEvents: props.labels?.noEvents ?? 'No events',
			more: props.labels?.more ?? '+{n} more',
			month: props.labels?.month ?? 'Month',
			week: props.labels?.week ?? 'Week',
			day: props.labels?.day ?? 'Day',
			agenda: props.labels?.agenda ?? 'Agenda',
		}),
		[props.labels],
	);

	return {
		view,
		setView,
		cursor,
		goTo,
		goPrev,
		goNext,
		goToday,
		weekDays,
		monthGrid,
		rangeLabel,
		weekdayShort,
		code,
		weekStartsOn,
		labels,
	};
}
