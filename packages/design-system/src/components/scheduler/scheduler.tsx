'use client';

/**
 * Scheduler — DataTable-style event calendar.
 *
 * Views: month grid, week/day time grids and an agenda list; a nav toolbar
 * and an optional mini-month navigator. Everything is configurable via
 * `SchedulerProps`; events are a plain `SchedulerEvent[]` (the widget layer
 * maps bound collection records onto that shape).
 *
 * Composition mirrors DataTable: a lean root that owns state via
 * `core/use-scheduler`, dumb presentational views under `components/` and all
 * date/layout math in `core/`. No date-fns — reuses the shared `@/date`
 * engine (the same one Calendar/DatePicker use).
 */
import { useMemo } from 'react';
import { cn } from '@/utils';
import { SchedulerToolbar } from './components/scheduler-toolbar';
import { TimeGrid } from './components/time-grid';
import { MonthView } from './components/month-view';
import { AgendaView } from './components/agenda-view';
import { MiniMonth } from './components/mini-month';
import { useScheduler } from './core/use-scheduler';
import { normalizeEvents, type NormalizedEvent } from './core/utils';
import type { SchedulerEvent, SchedulerProps } from './core/types';

export function Scheduler(props: SchedulerProps) {
	const { events = [], className, showToolbar = true, showMiniMonth = false, timeStart = 6, timeEnd = 20, onEventClick } = props;

	const s = useScheduler(props);
	const normalized = useMemo<NormalizedEvent[]>(() => normalizeEvents(events), [events]);

	const handleEventClick = (ev: NormalizedEvent) => onEventClick?.(ev as SchedulerEvent);
	const openDay = (date: Date) => {
		s.goTo(date);
		s.setView('day');
	};

	const main = (
		<div className="min-w-0 flex-1">
			{showToolbar ? (
				<SchedulerToolbar
					rangeLabel={s.rangeLabel}
					view={s.view}
					onViewChange={s.setView}
					onPrev={s.goPrev}
					onNext={s.goNext}
					onToday={s.goToday}
					labels={s.labels}
				/>
			) : null}

			{s.view === 'month' ? (
				<MonthView
					monthGrid={s.monthGrid}
					events={normalized}
					weekdayShort={s.weekdayShort}
					weekStartsOn={s.weekStartsOn}
					moreLabel={s.labels.more}
					onEventClick={handleEventClick}
					onOpenDay={openDay}
				/>
			) : null}

			{s.view === 'week' || s.view === 'day' ? (
				<TimeGrid
					days={s.view === 'week' ? s.weekDays : [s.cursor]}
					events={normalized}
					timeStart={timeStart}
					timeEnd={timeEnd}
					weekStartsOn={s.weekStartsOn}
					code={s.code}
					weekdayShort={s.weekdayShort}
					allDayLabel={s.labels.allDay}
					onEventClick={handleEventClick}
				/>
			) : null}

			{s.view === 'agenda' ? (
				<AgendaView
					events={normalized}
					cursor={s.cursor}
					weekdayShort={s.weekdayShort}
					weekStartsOn={s.weekStartsOn}
					code={s.code}
					noEventsLabel={s.labels.noEvents}
					onEventClick={handleEventClick}
				/>
			) : null}
		</div>
	);

	if (!showMiniMonth) {
		return <div className={cn('w-full', className)}>{main}</div>;
	}

	return (
		<div className={cn('flex w-full items-start gap-3', className)}>
			{main}
			<MiniMonth date={s.cursor} weekStartsOn={s.weekStartsOn} code={s.code} onDateChange={s.goTo} />
		</div>
	);
}
